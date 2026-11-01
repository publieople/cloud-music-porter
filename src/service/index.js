import { loadConfig, saveConfig, P } from '../core/config.js';
import { printServiceStatus, loadServiceState } from './state.js';
import { dailyRun } from './run.js';

function parseTime(value, cfg) {
  const raw = String(value || '').trim();
  if (!raw) {
    const hh = String(cfg.serviceHour === undefined ? 8 : cfg.serviceHour).padStart(2, '0');
    const mm = String(cfg.serviceMinute === undefined ? 30 : cfg.serviceMinute).padStart(2, '0');
    return { hour: Number(hh), minute: Number(mm), text: hh + ':' + mm };
  }
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error('时间格式应为 HH:MM，例如 08:30，收到：' + raw);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error('时间超出范围：' + raw);
  return { hour, minute, text: String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') };
}

async function platformModule() {
  if (process.platform === 'win32') return import('./win.js');
  if (process.platform === 'darwin') return import('./macos.js');
  return import('./linux.js');
}

function platformInfo() {
  if (process.platform === 'win32') return { description: 'Windows 任务计划程序（' + 'CloudMusicPorterDaily' + '），登录时也会补跑' };
  if (process.platform === 'darwin') return { description: 'macOS launchd（com.publieople.cloud-music-porter）' };
  return { description: 'systemd --user 定时器（cloud-music-porter.timer），没有 systemd 时用 crontab' };
}

export async function serviceCommand(sub, options) {
  const opts = options || {};
  const cfg = loadConfig();
  const action = sub || 'status';
  if (action === 'run') {
    const result = await dailyRun({ dryRun: opts.dryRun, force: opts.force, quality: opts.quality, sourceMode: opts.sourceMode, maxGb: opts.maxGb, delayMs: opts.delayMs });
    return result && result.exitCode ? result.exitCode : 0;
  }
  if (action === 'status') {
    printServiceStatus(cfg, platformInfo());
    const mod = await platformModule();
    try {
      if (process.platform === 'win32') mod.statusWindows();
      else if (process.platform === 'darwin') mod.statusMacos();
      else mod.statusLinux(parseTime('', cfg).text);
    } catch (error) {
      console.log('  查询系统定时任务失败：' + ((error && error.message) || error));
    }
    return 0;
  }
  if (action === 'install') {
    const time = parseTime(opts.time, cfg);
    saveConfig({ serviceHour: time.hour, serviceMinute: time.minute });
    console.log('· 计划时间已写入配置：每天 ' + time.text + '（' + P.config + '）');
    const mod = await platformModule();
    if (process.platform === 'win32') mod.installWindows(time.text);
    else if (process.platform === 'darwin') mod.installMacos(time.text);
    else mod.installLinux(time.text);
    console.log('');
    console.log('提示：首次运行会自动从网易云客户端刷新 cookie；如果客户端没登录，需要先运行 cmporter login。');
    return 0;
  }
  if (action === 'uninstall') {
    const mod = await platformModule();
    if (process.platform === 'win32') mod.uninstallWindows();
    else if (process.platform === 'darwin') mod.uninstallMacos();
    else mod.uninstallLinux();
    return 0;
  }
  throw new Error('未知的 service 子命令：' + action + '。可用：install / uninstall / status / run');
}

export function serviceHelp() {
  return [
    'cmporter service install [--time 08:30]   安装每天自动同步（Windows 任务计划 / systemd / launchd）',
    'cmporter service uninstall                卸载自动同步',
    'cmporter service status                   查看自动同步状态与最近日志',
    'cmporter service run [--dry-run] [--force] 手动跑一次（就是定时任务执行的动作）',
  ].join('\n');
}
