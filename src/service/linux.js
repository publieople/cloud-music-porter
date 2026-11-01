import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { P } from '../core/config.js';

const UNIT = 'cloud-music-porter';
const UNIT_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const SERVICE_FILE = path.join(UNIT_DIR, UNIT + '.service');
const TIMER_FILE = path.join(UNIT_DIR, UNIT + '.timer');

function which(bin) {
  const result = spawnSync('sh', ['-c', 'command -v ' + bin], { encoding: 'utf8' });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function systemdAvailable() {
  if (!which('systemctl')) return false;
  const result = spawnSync('systemctl', ['--user', 'is-system-running'], { encoding: 'utf8' });
  const out = String(result.stdout || '').trim();
  if (['running', 'degraded', 'starting', 'initializing', 'maintenance'].includes(out)) return true;
  return Boolean(process.env.XDG_RUNTIME_DIR || process.env.DBUS_SESSION_BUS_ADDRESS);
}

function serviceUnit() {
  const node = process.execPath;
  const cli = path.join(P.root, 'src', 'cli.js');
  return [
    '[Unit]',
    'Description=cloud-music-porter daily VIP song sync',
    '',
    '[Service]',
    'Type=oneshot',
    'WorkingDirectory=' + P.root,
    'ExecStart=' + JSON.stringify(node) + ' ' + JSON.stringify(cli) + ' service run',
    'StandardOutput=append:' + path.join(P.logs, 'systemd.log'),
    'StandardError=append:' + path.join(P.logs, 'systemd.log'),
    '',
  ].join('\n');
}

function timerUnit(time) {
  const parts = String(time || '08:30').split(':');
  const hh = String(parts[0] || '8').padStart(2, '0');
  const mm = String(parts[1] || '30').padStart(2, '0');
  return [
    '[Unit]',
    'Description=Run cloud-music-porter daily at ' + hh + ':' + mm,
    '',
    '[Timer]',
    'OnCalendar=*-*-* ' + hh + ':' + mm + ':00',
    'Persistent=true',
    'Unit=' + UNIT + '.service',
    '',
    '[Install]',
    'WantedBy=timers.target',
    '',
  ].join('\n');
}

function run(cmd, args, options) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: (options && options.timeoutMs) || 60000 });
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  if (result.status !== 0) {
    throw new Error(cmd + ' 失败：' + (stderr.split('\n')[0] || stdout || '退出码 ' + result.status));
  }
  if (stdout) console.log('  ' + stdout);
  return stdout;
}

export function installLinux(time) {
  fs.mkdirSync(path.join(P.logs), { recursive: true });
  if (systemdAvailable()) {
    fs.mkdirSync(UNIT_DIR, { recursive: true });
    fs.writeFileSync(SERVICE_FILE, serviceUnit(), 'utf8');
    fs.writeFileSync(TIMER_FILE, timerUnit(time), 'utf8');
    run('systemctl', ['--user', 'daemon-reload']);
    run('systemctl', ['--user', 'enable', '--now', UNIT + '.timer']);
    console.log('· 已启用 systemd 用户定时器：' + UNIT + '.timer（每天 ' + time + '）');
    console.log('  查看状态：systemctl --user status ' + UNIT + '.timer');
    console.log('  日志：journalctl --user -u ' + UNIT + '.service -n 50');
    return { ok: true, platform: 'linux', scheduler: 'systemd --user timer', name: UNIT + '.timer', time };
  }
  const cronBin = which('crontab');
  if (!cronBin) throw new Error('系统既没有 systemd user 服务也没有 crontab，无法安装定时任务');
  const [hh, mm] = String(time || '08:30').split(':');
  const cli = path.join(P.root, 'src', 'cli.js');
  const log = path.join(P.logs, 'cron.log');
  const line = String(mm).padStart(2, '0') + ' ' + String(hh).padStart(2, '0') + ' * * * ' + JSON.stringify(process.execPath) + ' ' + JSON.stringify(cli) + ' service run >> ' + JSON.stringify(log) + ' 2>&1';
  const existing = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
  const current = existing.status === 0 ? String(existing.stdout || '') : '';
  const kept = current.split(/\r?\n/).filter((item) => item && !item.includes('cloud-music-porter') && !item.includes('cmporter'));
  const next = kept.concat([line]).join('\n') + '\n';
  const tmp = P.tmp + '/crontab.txt';
  fs.mkdirSync(P.tmp, { recursive: true });
  fs.writeFileSync(tmp, next, 'utf8');
  run('crontab', [tmp]);
  fs.rmSync(tmp, { force: true });
  console.log('· 已写入 crontab（每天 ' + time + '）');
  return { ok: true, platform: 'linux', scheduler: 'crontab', name: 'crontab', time };
}

export function uninstallLinux() {
  let removed = false;
  if (fs.existsSync(TIMER_FILE)) {
    try {
      run('systemctl', ['--user', 'disable', '--now', UNIT + '.timer']);
    } catch (error) {
      /* 定时器可能已停止 */
    }
    fs.rmSync(TIMER_FILE, { force: true });
    removed = true;
  }
  if (fs.existsSync(SERVICE_FILE)) {
    fs.rmSync(SERVICE_FILE, { force: true });
    removed = true;
  }
  if (removed && systemdAvailable()) {
    try {
      run('systemctl', ['--user', 'daemon-reload']);
    } catch (error) {
      /* ignore */
    }
  }
  const existing = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
  if (existing.status === 0) {
    const kept = String(existing.stdout || '').split(/\r?\n/).filter((item) => item && !item.includes('cloud-music-porter') && !item.includes('cmporter'));
    const tmp = P.tmp + '/crontab.txt';
    fs.writeFileSync(tmp, kept.join('\n') + '\n', 'utf8');
    try {
      run('crontab', [tmp]);
      removed = true;
    } catch (error) {
      /* ignore */
    }
    fs.rmSync(tmp, { force: true });
  }
  console.log(removed ? '· 已移除云音乐搬运工的定时任务' : '· 没有找到已安装的定时任务');
  return { ok: true };
}

export function statusLinux(time) {
  let found = false;
  if (fs.existsSync(TIMER_FILE)) {
    found = true;
    console.log('已安装 systemd 用户定时器：' + TIMER_FILE);
    try {
      console.log(run('systemctl', ['--user', 'list-timers', UNIT + '.timer', '--no-pager']));
    } catch (error) {
      console.log('  （无法查询 systemctl，可能不在用户会话里）');
    }
    console.log(run('systemctl', ['--user', 'cat', UNIT + '.timer', '--no-pager']));
  }
  if (!found) {
    const existing = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
    const current = existing.status === 0 ? String(existing.stdout || '') : '';
    const lines = current.split(/\r?\n/).filter((item) => item && (item.includes('cloud-music-porter') || item.includes('cmporter')));
    if (lines.length) {
      found = true;
      console.log('已安装 crontab：');
      for (const line of lines) console.log('  ' + line);
    }
  }
  if (!found) console.log('还没有安装定时任务，运行 cmporter service install 安装（默认 ' + (time || '08:30') + '）。');
  return { ok: true, installed: found };
}
