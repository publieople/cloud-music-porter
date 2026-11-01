import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { P, APP, ensureDirs, loadConfig, loadCookieMeta, fmtBytes } from './core/config.js';
import { userAccount, cloudStats, setCookie } from './core/netease.js';
import { probeLxSources } from './sources/lx.js';
import { listMusicFreePlugins } from './sources/musicfree.js';

function versionAtLeast(current, required) {
  const a = String(current).split('.').map(Number);
  const b = String(required).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] || 0;
    const right = b[i] || 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}

function mark(level) {
  if (level === 'ok') return '✔';
  if (level === 'warn') return '!';
  return '✘';
}

function check(name, level, detail, hint) {
  return { name, level, ok: level === 'ok', detail, hint: hint || '' };
}

async function checkFfprobe(cfg) {
  try {
    const result = spawnSync(cfg.ffprobePath, ['-version'], { encoding: 'utf8', timeout: 15000 });
    if (result.status === 0) {
      const line = String(result.stdout || '').split('\n')[0].trim();
      return check('ffprobe', 'ok', line);
    }
    return check('ffprobe', 'warn', '执行返回 ' + result.status, '没装也可以跑，但下载后无法校验音频是否完整（只会看文件头）；装一个 ffmpeg 并把 ffprobePath 配成绝对路径。');
  } catch (error) {
    return check('ffprobe', 'warn', '找不到 ' + cfg.ffprobePath, '安装 ffmpeg/ffprobe 后在 config.json 里设置 ffprobePath（或确保 PATH 里有 ffprobe）。');
  }
}

async function checkCookie() {
  const meta = loadCookieMeta();
  if (!meta.cookie) return check('登录', 'fail', '还没有保存 cookie', '运行 cmporter login 扫码登录。');
  setCookie(meta.cookie);
  try {
    const account = await userAccount();
    return check('登录', 'ok', account.nickname + '（uid ' + account.id + '，vipType ' + (account.vipType || 0) + '）', meta.source ? 'cookie 来源：' + meta.source : '');
  } catch (error) {
    return check('登录', 'fail', 'cookie 校验失败：' + ((error && error.message) || error), '运行 cmporter login 重新扫码。');
  }
}

async function checkCloud() {
  try {
    const stats = await cloudStats();
    const percent = stats.maxSize ? ((stats.size / stats.maxSize) * 100).toFixed(1) : '?';
    const level = stats.maxSize && stats.size / stats.maxSize > 0.95 ? 'warn' : 'ok';
    return check('音乐云盘', level, stats.count + ' 条，' + fmtBytes(stats.size) + ' / ' + fmtBytes(stats.maxSize) + '（' + percent + '%）', level === 'warn' ? '容量快满了，先清理云盘再同步。' : '');
  } catch (error) {
    return check('音乐云盘', 'fail', '读取失败：' + ((error && error.message) || error), '检查网络或重新登录。');
  }
}

async function checkLx(cfg) {
  try {
    const result = await probeLxSources({ dataDir: cfg.lxDataDir || '', timeoutMs: cfg.searchTimeoutMs });
    if (!result.dir) return check('LX Music 源', 'warn', result.error || '没有找到数据目录', '打开 LX Music → 设置 → 自定义源，确认有启用中的源；或用 CMPORTER_LX_DATA 指定 LxDatas 目录。');
    const okSources = (result.sources || []).filter((entry) => entry.ok);
    const platforms = new Set();
    for (const source of okSources) for (const platform of source.platforms || []) platforms.add(platform.name || platform.key);
    if (!okSources.length) return check('LX Music 源', 'warn', '找到目录但可用源 0 个：' + result.dir, '在 LX Music 里更新/启用自定义源后重试。');
    return check('LX Music 源', 'ok', okSources.length + ' 个可用源，支持平台：' + [...platforms].join('、') + '（目录 ' + result.dir + '）');
  } catch (error) {
    return check('LX Music 源', 'warn', '加载失败：' + ((error && error.message) || error), '不影响 MusicFree 解析，只是少一层兜底。');
  }
}

function checkMusicFree(cfg) {
  try {
    const result = listMusicFreePlugins({ dir: cfg.musicFreePluginsDir || '' });
    if (!result.dir) return check('MusicFree 插件', 'fail', '没有找到插件目录', 'v0.1.0 的搜索候选来自 MusicFree 插件：装好 MusicFree → 导入音源插件 → 或用 musicFreePluginsDir / CMPORTER_MF_PLUGINS 指定目录。');
    const okPlugins = (result.plugins || []).filter((entry) => entry.ok);
    if (!okPlugins.length) {
      const errors = (result.plugins || []).filter((entry) => entry.error).slice(0, 3).map((entry) => entry.fileName + '：' + entry.error);
      return check('MusicFree 插件', 'fail', '目录里有 ' + result.files.length + ' 个文件，但没有可加载的插件' + (errors.length ? '（' + errors.join('；') + '）' : ''), '确认插件是 CommonJS 格式的 .js 文件。');
    }
    return check('MusicFree 插件', 'ok', okPlugins.length + ' 个可用插件：' + okPlugins.map((entry) => entry.platform || entry.fileName).join('、') + '（目录 ' + result.dir + '）');
  } catch (error) {
    return check('MusicFree 插件', 'fail', '加载失败：' + ((error && error.message) || error), '检查插件目录权限与插件文件格式。');
  }
}

function checkConfig(cfg) {
  const exists = fs.existsSync(P.config);
  return check('配置', exists ? 'ok' : 'warn', (exists ? P.config : '还没有生成，默认值已生效：' + P.config) + '（quality=' + cfg.quality + '，sourceMode=' + cfg.sourceMode + '）', '需要改配置就直接编辑这个文件；也可以用 WebUI 的配置卡保存。');
}

export async function runDoctor() {
  ensureDirs();
  const cfg = loadConfig();
  const nodeVersion = process.versions.node;
  const checks = [];
  checks.push(check('运行环境', versionAtLeast(nodeVersion, '20.0.0') ? 'ok' : 'fail', 'Node ' + nodeVersion + ' / ' + process.platform + ' / ' + APP.name + ' v' + APP.version, versionAtLeast(nodeVersion, '20.0.0') ? '' : '需要 Node 20 以上。'));
  checks.push(checkConfig(cfg));
  checks.push(await checkFfprobe(cfg));
  checks.push(await checkCookie());
  checks.push(await checkCloud());
  checks.push(checkMusicFree(cfg));
  checks.push(await checkLx(cfg));

  console.log('');
  console.log(APP.name + ' 环境检查（cmporter doctor）');
  console.log('  数据目录：' + P.home);
  console.log('');
  for (const item of checks) {
    console.log('  ' + mark(item.level) + ' ' + item.name + '：' + item.detail);
    if (item.hint && item.level !== 'ok') console.log('      → ' + item.hint);
  }
  console.log('');
  const failed = checks.filter((item) => item.level === 'fail');
  const warned = checks.filter((item) => item.level === 'warn');
  const ok = failed.length === 0;
  if (ok) console.log(warned.length ? '结果：基本可用（有 ' + warned.length + ' 条提醒）' : '结果：全部正常，可以开始 cmporter scan / sync 了');
  else console.log('结果：有 ' + failed.length + ' 项阻塞，先按上面的 → 提示处理');
  console.log('');
  return { ok, checks, failed: failed.map((item) => item.name), warned: warned.map((item) => item.name) };
}
