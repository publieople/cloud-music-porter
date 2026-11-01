import path from 'node:path';
import { ensureDirs, loadConfig, loadCookie, saveCookie, stamp } from '../core/config.js';
import { userAccount, cloudStats, setCookie } from '../core/netease.js';
import { sync } from '../sync.js';
import { refreshCookieFromClient } from './cookie-refresh.js';
import { createLogger, loadServiceState, saveServiceState, dateKey, appendLog, cleanupTmp, cleanupLogs, LOG_DIR } from './state.js';

function today() {
  return dateKey();
}

async function ensureLogin(state) {
  const refreshed = await refreshCookieFromClient();
  if (refreshed.ok) {
    saveCookie(refreshed.cookie, refreshed.source);
    setCookie(refreshed.cookie);
    state.cookie = { refreshOk: true, updatedAt: new Date().toISOString(), updatedAtMs: Date.now(), account: refreshed.account || null };
    console.log('登录：已从网易云客户端刷新 cookie' + (refreshed.account && refreshed.account.nickname ? '（' + refreshed.account.nickname + '）' : ''));
    return true;
  }
  state.cookie = { refreshOk: false, refreshReason: refreshed.reason || '未知原因', updatedAtMs: Date.now() };
  console.log('登录：客户端 cookie 刷新不可用（' + (refreshed.reason || '未知原因') + '），改用已保存的 cookie');
  try {
    const cookie = loadCookie();
    setCookie(cookie);
    const account = await userAccount();
    console.log('登录：已保存的 cookie 有效（' + account.nickname + '，uid ' + account.id + '）');
    return true;
  } catch (error) {
    throw new Error('登录失效，需要重新扫码：' + ((error && error.message) || error));
  }
}

function attemptsAllowed(state, cfg) {
  const key = today();
  if (!state.attempts || state.attempts.date !== key) state.attempts = { date: key, count: 0 };
  const max = Number(cfg.serviceMaxAttempts) > 0 ? Number(cfg.serviceMaxAttempts) : 3;
  return { used: state.attempts.count, max, allowed: state.attempts.count < max };
}

export async function dailyRun(options) {
  const opts = options || {};
  ensureDirs();
  const cfg = loadConfig();
  const state = loadServiceState();
  const key = today();
  const mode = opts.dryRun ? 'dry-run' : 'real';
  const logFile = path.join(LOG_DIR, 'service-' + key + '.log');
  const closeLog = createLogger(logFile);
  let exitCode = 0;
  try {
    console.log('');
    console.log('=== cloud-music-porter 每日同步 ' + stamp() + '（' + mode + '）===');
    if (!opts.force && state.lastRunDate === key && state.lastOk) {
      const message = '今天已成功同步过，跳过';
      appendLog(key, '任务触发但' + message + '（' + (state.lastMessage || '') + '）');
      console.log('· ' + message + '。需要强制再跑一次请加 --force。');
      return { skipped: true, ok: true, reason: 'already-ok-today' };
    }
    const allowance = attemptsAllowed(state, cfg);
    if (!opts.force && !allowance.allowed) {
      const message = '今天已达尝试上限（' + allowance.max + ' 次），跳过';
      appendLog(key, message);
      console.log('· ' + message + '。');
      return { skipped: true, ok: false, reason: 'attempt-limit' };
    }
    state.attempts.count += 1;
    state.attempts.date = key;
    state.lastRunAt = new Date().toISOString();
    state.lastRunAtMs = Date.now();
    saveServiceState(state);

    console.log('· 配置：quality=' + cfg.quality + '，sourceMode=' + cfg.sourceMode + '，每天最多尝试 ' + allowance.max + ' 次');
    console.log('· 清理旧临时文件：' + cleanupTmp() + ' 个，旧日志：' + cleanupLogs() + ' 个');
    await ensureLogin(state);
    const stats = await cloudStats();
    console.log('· 云盘：' + stats.count + ' 条，' + (stats.size / 1024 ** 3).toFixed(1) + ' GiB / ' + (stats.maxSize / 1024 ** 3).toFixed(0) + ' GiB');

    const result = await sync({
      liked: true,
      yes: true,
      dryRun: Boolean(opts.dryRun),
      quality: opts.quality || cfg.quality,
      sourceMode: opts.sourceMode || cfg.sourceMode,
      maxGb: opts.maxGb,
      delayMs: opts.delayMs,
    });
    const summary = (result && result.summary) || {};
    const imported = Number(summary.imported || 0);
    const failed = Number(summary.failed || 0);
    const skipped = Number(summary.skipped || 0);
    state.lastRunDate = key;
    state.lastOk = failed === 0;
    state.lastMessage = '新增 ' + imported + ' 首，失败 ' + failed + ' 首，跳过 ' + skipped + ' 首';
    state.lastSummary = summary;
    state.history = (state.history || []).concat([{ date: key, at: Date.now(), mode, ok: state.lastOk, imported, failed, skipped }]).slice(-90);
    saveServiceState(state);
    appendLog(key, state.lastMessage + (state.lastOk ? '（成功）' : '（有失败）'));
    console.log('· 完成：' + state.lastMessage);
    if (!state.lastOk) exitCode = 1;
    return { ok: state.lastOk, summary, exitCode };
  } catch (error) {
    const message = (error && error.message) || String(error);
    state.lastRunDate = key;
    state.lastOk = false;
    state.lastMessage = '失败：' + message;
    state.history = (state.history || []).concat([{ date: key, at: Date.now(), mode, ok: false, error: message }]).slice(-90);
    saveServiceState(state);
    appendLog(key, '失败：' + message);
    console.error('· 失败：' + message);
    return { ok: false, error: message, exitCode: 1 };
  } finally {
    await closeLog();
  }
}

export async function runServiceCommand(options) {
  const result = await dailyRun(options);
  return result.exitCode || 0;
}
