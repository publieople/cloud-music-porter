#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import * as netease from './core/netease.js';
import { APP, HOME_DIR, P, ensureDirs, loadConfig, saveConfig, loadCookieMeta, loadCookie, loadState, fmtBytes, fmtDuration } from './core/config.js';

const HELP = `cloud-music-porter（cmporter）—— 把你能合法获得的音频送进网易云音乐云盘。

用法：
  cmporter <命令> [选项]

命令：
  login        扫码登录网易云（也支持 --cookie 直接粘贴 cookie）
  doctor       检查环境：登录、ffprobe、LX Music 源、MusicFree 插件、云盘容量
  status       查看账号、云盘容量、本地同步记录
  sources      列出已检测到的 LX Music 自定义源与 MusicFree 插件
  scan         扫描歌单，找出需要 VIP 的歌（默认「我喜欢的音乐」）
  sync         把扫描出的 VIP 歌下载并导入云盘
  match        把云盘里已有的副本匹配回歌曲本体（歌单里直接完整播放）
  import       把本地音频文件（自己合法拥有）匹配并导入云盘
  cloud        查看 / 删除云盘条目
  web          启动本地 WebUI
  service      安装 / 卸载 / 查看每日自动同步（Windows 计划任务 / Linux systemd）
  help         显示这份帮助
  version      显示版本

常用选项：
  --liked                 处理「我喜欢的音乐」（默认）
  --playlist <id|url>     处理指定歌单
  --all                   处理全部歌单（去重）
  --query <关键词>        按搜索到的一首歌处理
  --song <id,id>          处理指定歌曲 id
  --limit <n>             本次最多处理 n 首
  --offset <n>            从第 n 首开始
  --quality <flac|320k>   目标音质（默认读 config.json，flac）
  --source <auto|lx|musicfree> 优先用哪类音源（默认 auto）
  --max-gb <n>            本次最多写入多少 GB（默认云盘剩余空间 95%）
  --vip-only              只列出 VIP / 下架相关歌曲
  --all-rows              列出所有歌曲（含可正常播放的）
  --include-unavailable   也尝试下架 / 无版权的歌
  --json <file>           scan 时把结果写入文件
  --from <file>           sync / match 直接复用 scan 的结果（省时间）
  --force                 忽略本地已同步记录，重新处理
  --dry-run               只看计划，不写入
  --yes                   非交互确认
  --delay <ms>            每首之间的间隔
  --cookie <cookie>       粘贴 cookie 保存（login 命令）
  --timeout <秒>          扫码登录超时（login 命令）
  --port <端口>           WebUI 端口（web 命令）
  --no-open              启动 WebUI 时不自动打开浏览器
  --dir <目录>            import 时处理本地音频目录（也可直接写目录参数）
  --delete <id,id>        删除云盘条目（cloud 命令）
  -h, --help              显示这份帮助
  -v, --version           显示版本

示例：
  cmporter login
  cmporter doctor
  cmporter scan --vip-only
  cmporter sync --yes
  cmporter scan --all --json rows.json && cmporter sync --from rows.json --yes
  cmporter match --from rows.json
  cmporter import "D:\Music\我的下载"
  cmporter web
  cmporter service install --time 08:30
`;

function parseArgs(argv) {
  const args = { _: [] };
  const takeValue = new Set(['playlist', 'limit', 'offset', 'quality', 'json', 'from', 'delay', 'cookie', 'timeout', 'port', 'delete', 'song', 'query', 'max-gb', 'time', 'source', 'dir']);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') {
      args._.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith('-')) {
      args._.push(token);
      continue;
    }
    const isLong = token.startsWith('--');
    let key = token.replace(/^--?/, '');
    let value = null;
    const eq = key.indexOf('=');
    if (eq >= 0) {
      value = key.slice(eq + 1);
      key = key.slice(0, eq);
    } else if (takeValue.has(key) && i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
      value = argv[++i];
    } else if (!isLong) {
      // 短选项组合（-hv 之类）暂不展开，按布尔处理
      key = key;
    }
    if (key === 'h') { args.help = true; continue; }
    if (key === 'v') { args.version = true; continue; }
    args[key] = value === null ? true : value;
  }
  return args;
}

function buildFilter(args) {
  const opts = {};
  if (args.song) opts.songIds = String(args.song).split(',').map((value) => Number(value.trim())).filter(Boolean);
  if (args.query) opts.query = String(args.query);
  if (args.playlist) opts.playlist = String(args.playlist);
  if (args.all) opts.all = true;
  if (args.liked) opts.liked = true;
  if (args.limit) opts.limit = Number(args.limit);
  if (args.offset) opts.offset = Number(args.offset);
  if (args.quality) opts.quality = String(args.quality);
  if (args.json) opts.json = String(args.json);
  if (args.from) opts.from = String(args.from);
  if (args['max-gb']) opts.maxGb = Number(args['max-gb']);
  if (args.delay) opts.delayMs = Number(args.delay);
  if (args['vip-only']) opts.vipOnly = true;
  if (args['all-rows']) opts.allRows = true;
  if (args['include-unavailable']) opts.includeUnavailable = true;
  if (args.force) opts.force = true;
  if (args['dry-run']) opts.dryRun = true;
  if (args.yes) opts.yes = true;
  if (args.source) opts.sourceMode = String(args.source);
  return opts;
}

function requireCookie() {
  if (!fs.existsSync(P.cookie)) throw new Error('还没有登录。先运行：cmporter login');
  loadCookie();
}

function formatTime(value) {
  if (!value) return '未知';
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

async function cmdLogin(args) {
  const { saveCookieString, qrLogin } = await import('./core/login.js');
  ensureDirs();
  if (args.cookie) {
    const account = await saveCookieString(String(args.cookie), 'cli');
    console.log('✓ 已保存 cookie，账号：' + account.nickname + '（uid ' + account.id + '）');
    return;
  }
  await qrLogin({ timeoutSec: Number(args.timeout || 180), open: true });
}

async function cmdDoctor() {
  const { runDoctor } = await import('./doctor.js');
  const result = await runDoctor();
  process.exitCode = result.ok ? 0 : 2;
}

async function cmdStatus() {
  requireCookie();
  const cfg = loadConfig();
  const state = loadState();
  const account = await netease.userAccount();
  const stats = await netease.cloudStats();
  const imported = Object.keys(state.imported || {}).length;
  const failed = Object.keys(state.failed || {}).length;
  console.log('账号：' + (account.nickname || '未知') + '（uid ' + account.id + '，vipType ' + account.vipType + '）');
  console.log('云盘：' + stats.count + ' 条 / ' + fmtBytes(stats.size) + '（上限 ' + fmtBytes(stats.maxSize) + '，已用 ' + (stats.size / stats.maxSize * 100).toFixed(1) + '%）');
  console.log('本地记录：已同步 ' + imported + ' 首，失败 ' + failed + ' 首');
  console.log('配置：' + path.join(HOME_DIR, 'config.json') + '（音质 ' + cfg.quality + '，音源模式 ' + cfg.sourceMode + '）');
  const runs = state.runs || [];
  if (runs.length) {
    console.log('最近一次同步：' + formatTime(runs[0].time) + '  ' + runs[0].label + '  新增 ' + runs[0].imported + ' 首，失败 ' + runs[0].failed + ' 首');
  }
}

function describeSources(info) {
  console.log('LX Music 自定义源：' + (info.lx.enabled ? '' : '（已禁用）'));
  if (!info.lx.enabled) {
    // 跳过
  } else if (!info.lx.dir) {
    console.log('  ✗ ' + (info.lx.error || '没有找到 LX Music 数据目录'));
    console.log('    提示：在 LX Music 里安装至少一个自定义源，或用 config.json 的 lxDataDir 指定 LxDatas 目录');
  } else {
    console.log('  目录：' + info.lx.dir);
    if (!info.lx.sources.length) console.log('  ✗ 没有可用的自定义源');
    for (const source of info.lx.sources) {
      const platforms = source.platforms.map((platform) => platform.name + (platform.qualitys && platform.qualitys.length ? '(' + platform.qualitys.join('/') + ')' : '')).join('、');
      console.log('  ✓ ' + source.name + (source.version ? ' v' + source.version : '') + ' → ' + (platforms || '无平台'));
    }
  }
  console.log('MusicFree 插件：' + (info.musicfree.enabled ? '' : '（已禁用）'));
  if (!info.musicfree.enabled) return;
  if (!info.musicfree.dir) {
    console.log('  ✗ ' + (info.musicfree.error || '没有找到 MusicFree 插件目录'));
    console.log('    提示：把 MusicFree 的音源插件放进 musicfree-plugins 目录，或配置 musicFreePluginsDir');
    return;
  }
  console.log('  目录：' + info.musicfree.dir);
  const okPlugins = info.musicfree.plugins.filter((plugin) => plugin.ok);
  console.log('  可用插件 ' + okPlugins.length + '/' + info.musicfree.plugins.length + ' 个');
  for (const plugin of info.musicfree.plugins) {
    console.log('  ' + (plugin.ok ? '✓' : '✗') + ' ' + plugin.platform + (plugin.version ? ' v' + plugin.version : '') + (plugin.ok ? '' : '：' + plugin.error));
  }
}

async function cmdSources(args) {
  const { createSourceManager } = await import('./sources/index.js');
  const manager = await createSourceManager(loadConfig());
  const info = manager.describe();
  if (args.json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  describeSources(info);
}

async function cmdCloud(args) {
  requireCookie();
  if (args.delete) {
    const ids = String(args.delete).split(',').map((value) => Number(value.trim())).filter(Boolean);
    if (!ids.length) throw new Error('--delete 需要云盘歌曲 id');
    const result = await netease.cloudDelete(ids);
    console.log('已请求删除 ' + ids.length + ' 条：' + JSON.stringify(result).slice(0, 300));
    return;
  }
  const cloud = await netease.cloudAll({});
  console.log('云盘：' + cloud.count + ' 条 / ' + fmtBytes(cloud.size) + (cloud.maxSize ? '（上限 ' + fmtBytes(cloud.maxSize) + '）' : ''));
  const limit = args.limit ? Number(args.limit) : 30;
  cloud.entries.slice(0, limit).forEach((entry, index) => {
    console.log('  ' + String(index + 1).padStart(3, ' ') + '. [' + entry.cloudSongId + '] ' + entry.name + ' - ' + entry.artist + '  ' + fmtBytes(entry.fileSize) + (entry.matchedSongId ? '  已匹配' : ''));
  });
}

async function cmdWeb(args) {
  const { startWebServer } = await import('./web/server.js');
  const port = Number(args.port || loadConfig().webPort || 8787);
  await startWebServer({ port, open: !args['no-open'] });
}

async function cmdService(args) {
  const { serviceCommand } = await import('./service/index.js');
  await serviceCommand(args._[1] || 'status', {
    time: args.time || '',
    dryRun: Boolean(args['dry-run']),
    force: Boolean(args.force),
    quality: args.quality,
    sourceMode: args.source,
    maxGb: args['max-gb'],
    delayMs: args.delay,
  });
}

async function cmdScan(args) {
  requireCookie();
  const { scan } = await import('./sync.js');
  await scan(buildFilter(args));
}

async function cmdSync(args) {
  requireCookie();
  const { sync } = await import('./sync.js');
  await sync(buildFilter(args));
}

async function cmdMatch(args) {
  requireCookie();
  const { matchExisting } = await import('./sync.js');
  await matchExisting(buildFilter(args));
}

async function cmdImport(args) {
  requireCookie();
  const dir = args._[1] || args.dir;
  if (!dir) throw new Error('用法：cmporter import <目录>');
  const { importDir } = await import('./sync.js');
  await importDir({ ...buildFilter(args), dir });
}

let activeCommand = '';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || (args.help ? 'help' : 'help');
  activeCommand = command;
  if (args.version) {
    console.log(APP.name + ' v' + APP.version);
    return;
  }
  ensureDirs();
  if (command === 'help' || args.help) {
    console.log(HELP);
    return;
  }
  if (command === 'version') {
    console.log(APP.name + ' v' + APP.version + '  ' + APP.repo);
    return;
  }
  switch (command) {
    case 'login':
      await cmdLogin(args);
      break;
    case 'doctor':
      await cmdDoctor(args);
      break;
    case 'status':
      await cmdStatus(args);
      break;
    case 'sources':
      await cmdSources(args);
      break;
    case 'scan':
      await cmdScan(args);
      break;
    case 'sync':
      await cmdSync(args);
      break;
    case 'match':
      await cmdMatch(args);
      break;
    case 'import':
      await cmdImport(args);
      break;
    case 'cloud':
      await cmdCloud(args);
      break;
    case 'web':
      await cmdWeb(args);
      break;
    case 'service':
      await cmdService(args);
      break;
    default:
      console.error('不认识的命令：' + command + '\n');
      console.log(HELP);
      process.exitCode = 1;
  }
}

// 音源插件内部常有「没人接的异步请求」，不处理会直接把进程带走；这里统一降级成警告。
process.on('unhandledRejection', (error) => {
  if (process.env.CMPORTER_DEBUG) console.error('[debug] 忽略后台异步错误：' + ((error && error.stack) || error));
});

main()
  .then(() => {
    // 音源插件的运行时偶尔会留下没关的 socket/定时器，web 之外的命令处理完就直接退出。
    if (activeCommand !== 'web') process.exit(process.exitCode || 0);
  })
  .catch((error) => {
    console.error('出错：' + (error && error.message ? error.message : error));
    if (process.env.CMPORTER_DEBUG && error && error.stack) console.error(error.stack);
    process.exit(1);
  });
