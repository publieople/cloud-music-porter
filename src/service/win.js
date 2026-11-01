import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { P } from '../core/config.js';

const TASK_NAME = 'CloudMusicPorterDaily';
const PS1 = path.join(P.root, 'scripts', 'install-scheduled-task.ps1');

function spawnEnv() {
  const env = { ...process.env };
  const sysRoot = env.SystemRoot || (fs.existsSync('C:\\Windows') ? 'C:\\Windows' : '');
  if (sysRoot) {
    env.SystemRoot = env.SystemRoot || sysRoot;
    env.windir = env.windir || sysRoot;
  }
  const parts = [];
  if (sysRoot) parts.push(path.join(sysRoot, 'System32'), path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0'));
  if (env.PATH) parts.push(env.PATH);
  env.PATH = parts.filter(Boolean).join(';');
  if (!env.USERPROFILE) env.USERPROFILE = os.homedir();
  if (!env.LOCALAPPDATA) env.LOCALAPPDATA = path.join(os.homedir(), 'AppData', 'Local');
  if (!env.APPDATA) env.APPDATA = path.join(os.homedir(), 'AppData', 'Roaming');
  if (!env.TEMP) env.TEMP = os.tmpdir();
  if (!env.TMP) env.TMP = env.TEMP;
  return env;
}

function powershellPath(env) {
  const root = env.SystemRoot || 'C:\\Windows';
  const candidate = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(candidate) ? candidate : 'powershell.exe';
}

function runPs(args, options) {
  const env = spawnEnv();
  const result = spawnSync(powershellPath(env), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1].concat(args), {
    encoding: 'utf8',
    env,
    timeout: (options && options.timeoutMs) || 120000,
    windowsHide: true,
  });
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  if (stdout) console.log(stdout);
  if (result.status !== 0) {
    throw new Error('PowerShell 安装任务计划失败：' + (stderr.split('\n')[0] || '退出码 ' + result.status));
  }
  if (stderr) console.log(stderr);
  return { stdout, stderr, status: result.status };
}

function psArgs(time) {
  return ['-Time', time, '-TaskName', TASK_NAME, '-NodePath', process.execPath, '-CliPath', path.join(P.root, 'src', 'cli.js')];
}

export function installWindows(time, options) {
  if (!fs.existsSync(PS1)) throw new Error('缺少 scripts/install-scheduled-task.ps1');
  console.log('· 安装 Windows 任务计划：' + TASK_NAME);
  const runNow = !(options && options.runNow === false);
  runPs(psArgs(time).concat(runNow ? ['-RunNow'] : []));
  return { ok: true, platform: 'win32', scheduler: 'Task Scheduler', name: TASK_NAME, time };
}

export function uninstallWindows() {
  runPs(['-TaskName', TASK_NAME, '-Uninstall']);
  return { ok: true };
}

export function statusWindows() {
  runPs(['-TaskName', TASK_NAME, '-Status']);
  return { ok: true, scheduler: 'Task Scheduler（任务计划程序）', name: TASK_NAME };
}
