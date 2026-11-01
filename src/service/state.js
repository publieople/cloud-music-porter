import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { P, ensureDirs, loadConfig, loadCookieMeta, stamp } from '../core/config.js';

export const LOG_DIR = path.join(P.data, 'logs');
export const STATE_FILE = path.join(P.data, 'service-state.json');
export const LOG_KEEP_DAYS = 30;

export function dateKey(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function emptyServiceState() {
  return { version: 1, lastRunDate: null, lastRunAt: null, lastOk: false, lastMessage: '', lastSummary: null, attempts: { date: null, count: 0 }, cookie: {}, history: [] };
}

export function loadServiceState() {
  ensureDirs();
  if (!fs.existsSync(STATE_FILE)) return emptyServiceState();
  try {
    return { ...emptyServiceState(), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
  } catch (error) {
    return emptyServiceState();
  }
}

export function saveServiceState(state) {
  ensureDirs();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export function createLogger(logFile) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const stream = fs.createWriteStream(logFile, { flags: 'a' });
  const original = { log: console.log, error: console.error, warn: console.warn };
  const tee = (fn) => (...args) => {
    fn(...args);
    stream.write(util.format(...args) + '\n');
  };
  console.log = tee(original.log);
  console.error = tee(original.error);
  console.warn = tee(original.warn);
  return async () => {
    console.log = original.log;
    console.error = original.error;
    console.warn = original.warn;
    await new Promise((resolve) => stream.end(resolve));
  };
}

export function appendLog(today, line) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, 'service-' + today + '.log'), '[' + new Date().toLocaleString() + '] ' + line + '\n', 'utf8');
  } catch (error) {
    /* ignore */
  }
}

export function cleanupTmp() {
  const dir = P.tmp;
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!/^(dl-|cookies-refresh)/i.test(name)) continue;
    try {
      fs.rmSync(path.join(dir, name), { force: true, recursive: true });
      removed += 1;
    } catch (error) {
      /* ignore */
    }
  }
  return removed;
}

export function cleanupLogs() {
  if (!fs.existsSync(LOG_DIR)) return 0;
  const cutoff = Date.now() - LOG_KEEP_DAYS * 86400 * 1000;
  let removed = 0;
  for (const name of fs.readdirSync(LOG_DIR)) {
    if (!/^service-.*\.log$/.test(name)) continue;
    const file = path.join(LOG_DIR, name);
    try {
      if (fs.statSync(file).mtimeMs < cutoff) {
        fs.rmSync(file, { force: true });
        removed += 1;
      }
    } catch (error) {
      /* ignore */
    }
  }
  return removed;
}

export function printServiceStatus(cfg, platformInfo) {
  const config = cfg || loadConfig();
  const state = loadServiceState();
  const meta = loadCookieMeta();
  const today = dateKey();
  const hour = String(config.serviceHour === undefined ? 8 : config.serviceHour).padStart(2, '0');
  const minute = String(config.serviceMinute === undefined ? 30 : config.serviceMinute).padStart(2, '0');
  console.log('每日自动同步服务');
  console.log('  计划时间：每天 ' + hour + ':' + minute);
  if (platformInfo && platformInfo.description) console.log('  调度方式：' + platformInfo.description);
  console.log('  今天：' + today + '，今天已尝试 ' + (state.attempts && state.attempts.date === today ? state.attempts.count : 0) + ' 次');
  console.log('  上次运行：' + (state.lastRunAt ? stamp(state.lastRunAt) : '从未运行'));
  if (!state.lastRunAt) console.log('  上次结果：从未运行');
  else console.log('  上次结果：' + (state.lastOk ? '成功' : '失败') + ' —— ' + (state.lastMessage || '无记录'));
  if (state.lastSummary) console.log('  上次明细：' + JSON.stringify(state.lastSummary));
  if (state.lastDryRunAt) {
    const targets = Number(state.lastDryRunTargets);
    console.log('  上次演练：' + stamp(state.lastDryRunAt) + (Number.isFinite(targets) ? '（待同步 ' + targets + ' 首，未写入云盘，不记为当天成功）' : '（未写入云盘，不记为当天成功）'));
  }
  console.log('  登录 cookie：' + (meta.updatedAt ? stamp(meta.updatedAt) : '未知') + '（来源 ' + (meta.source || '未知') + '）');
  const cookieState = state.cookie || {};
  if (cookieState.refreshOk) console.log('  客户端 cookie 自动刷新：上次成功（' + (cookieState.updatedAt ? stamp(cookieState.updatedAt) : '') + '）');
  else console.log('  客户端 cookie 自动刷新：上次未成功' + (cookieState.refreshReason ? ' —— ' + cookieState.refreshReason : ''));
  console.log('  配置：quality=' + config.quality + '，每日最多尝试 ' + (config.serviceMaxAttempts || 3) + ' 次，日志保留 ' + LOG_KEEP_DAYS + ' 天');
  const logFile = path.join(LOG_DIR, 'service-' + today + '.log');
  console.log('  今天日志：' + (fs.existsSync(logFile) ? logFile : '（还没有）'));
  if (fs.existsSync(logFile)) {
    const lines = fs.readFileSync(logFile, 'utf8').trim().split(/\r?\n/);
    console.log('  最近日志：');
    for (const line of lines.slice(-15)) console.log('    ' + line);
  }
}
