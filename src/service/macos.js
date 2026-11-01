import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { P } from '../core/config.js';

const LABEL = 'com.publieople.cloud-music-porter';
const DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
const FILE = path.join(DIR, LABEL + '.plist');

function plist(time) {
  const [hh, mm] = String(time || '08:30').split(':');
  const args = [process.execPath, path.join(P.root, 'src', 'cli.js'), 'service', 'run'];
  const argXml = args.map((item) => '    <string>' + item + '</string>').join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key><string>' + LABEL + '</string>',
    '  <key>ProgramArguments</key>',
    '  <array>',
    argXml,
    '  </array>',
    '  <key>WorkingDirectory</key><string>' + P.root + '</string>',
    '  <key>StartCalendarInterval</key>',
    '  <dict>',
    '    <key>Hour</key><integer>' + String(Number(hh) || 8) + '</integer>',
    '    <key>Minute</key><integer>' + String(Number(mm) || 30) + '</integer>',
    '  </dict>',
    '  <key>RunAtLoad</key><true/>',
    '  <key>StandardOutPath</key><string>' + path.join(P.logs, 'launchd.log') + '</string>',
    '  <key>StandardErrorPath</key><string>' + path.join(P.logs, 'launchd.log') + '</string>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0) throw new Error(cmd + ' 失败：' + String(result.stderr || '').trim().split('\n')[0]);
  return String(result.stdout || '').trim();
}

export function installMacos(time) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.mkdirSync(P.logs, { recursive: true });
  fs.writeFileSync(FILE, plist(time), 'utf8');
  try {
    run('launchctl', ['unload', FILE]);
  } catch (error) {
    /* 首次安装时没有加载过 */
  }
  run('launchctl', ['load', '-w', FILE]);
  console.log('· 已安装 launchd 任务：' + FILE + '（每天 ' + time + '）');
  return { ok: true, platform: 'darwin', scheduler: 'launchd', name: LABEL, time };
}

export function uninstallMacos() {
  if (!fs.existsSync(FILE)) {
    console.log('· 没有找到已安装的 launchd 任务');
    return { ok: true };
  }
  try {
    run('launchctl', ['unload', FILE]);
  } catch (error) {
    /* ignore */
  }
  fs.rmSync(FILE, { force: true });
  console.log('· 已移除 launchd 任务');
  return { ok: true };
}

export function statusMacos() {
  if (!fs.existsSync(FILE)) {
    console.log('还没有安装定时任务，运行 cmporter service install 安装。');
    return { ok: true, installed: false };
  }
  console.log('已安装 launchd 任务：' + FILE);
  try {
    console.log(run('launchctl', ['list', LABEL]));
  } catch (error) {
    console.log('  （任务当前未加载）');
  }
  return { ok: true, installed: true };
}
