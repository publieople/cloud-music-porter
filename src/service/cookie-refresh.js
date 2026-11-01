import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { P, ensureDirs, sleep } from '../core/config.js';
import { weapiRaw } from '../core/netease.js';

function localAppData() {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
}

// 网易云客户端（CEF 内核）把登录 cookie 加密存在本地：
//   <LOCALAPPDATA>\Netease\CloudMusic\webapp*\Cookies         （SQLite，v10 前缀 = AES-256-GCM）
//   <LOCALAPPDATA>\Netease\CloudMusic\webapp*\LocalPrefs.json（DPAPI 保护的 AES key）
// 服务每次跑之前读取并解密，得到最新 cookie，客户端保持登录就能长期免扫码。
export function findClientCookieFiles() {
  if (process.platform !== 'win32') return { ok: false, reason: '当前系统不是 Windows，无法从网易云客户端读取 cookie' };
  const base = path.join(localAppData(), 'Netease', 'CloudMusic');
  if (!fs.existsSync(base)) return { ok: false, reason: '找不到网易云客户端目录：' + base };
  const dirs = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (entry.isDirectory() && /^webapp/i.test(entry.name)) dirs.push(path.join(base, entry.name));
  }
  const dir = dirs.find((item) => fs.existsSync(path.join(item, 'Cookies')));
  if (!dir) return { ok: false, reason: '客户端目录下没有 Cookies 文件：' + base };
  return { ok: true, dir, cookiesPath: path.join(dir, 'Cookies'), prefsPath: path.join(dir, 'LocalPrefs.json'), base };
}

async function copyFileWithRetry(source, dest, attempts) {
  const max = attempts || 5;
  let lastError = null;
  for (let attempt = 1; attempt <= max; attempt += 1) {
    try {
      fs.copyFileSync(source, dest);
      return;
    } catch (error) {
      lastError = error;
      await sleep(300 * attempt);
    }
  }
  throw new Error('复制 Cookies 失败（客户端可能正在写入）：' + ((lastError && lastError.message) || lastError));
}

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
  if (!env.LOCALAPPDATA) env.LOCALAPPDATA = localAppData();
  if (!env.USERPROFILE) env.USERPROFILE = os.homedir();
  if (!env.TEMP) env.TEMP = os.tmpdir();
  if (!env.TMP) env.TMP = env.TEMP;
  return env;
}

function decryptClientKey(prefsPath) {
  const env = spawnEnv();
  const keyScript = path.join(P.root, 'scripts', 'get-cookie-key.ps1');
  if (!fs.existsSync(keyScript)) throw new Error('缺少 scripts/get-cookie-key.ps1');
  const psPath = path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = fs.existsSync(psPath) ? psPath : 'powershell.exe';
  const result = spawnSync(command, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', keyScript, '-PrefsPath', prefsPath], {
    encoding: 'utf8',
    env,
    timeout: 30000,
    windowsHide: true,
  });
  const stdout = String(result.stdout || '').trim();
  if (result.status !== 0 || !stdout) {
    const stderr = String(result.stderr || '').trim().split('\n')[0];
    throw new Error('读取客户端加密密钥失败：' + (stderr || 'PowerShell 退出码 ' + result.status));
  }
  const key = Buffer.from(stdout, 'base64');
  if (key.length !== 32) throw new Error('客户端加密密钥长度异常：' + key.length);
  return key;
}

function decryptV10(buffer, key) {
  const enc = Buffer.from(buffer);
  if (enc.length <= 15) return null;
  if (enc.subarray(0, 3).toString() !== 'v10') return null;
  const payload = enc.subarray(3);
  const nonce = payload.subarray(0, 12);
  const tag = payload.subarray(payload.length - 16);
  const cipherText = payload.subarray(12, payload.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8');
}

function readCookieValues(dbPath, key) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare('select host_key, name, value, encrypted_value from cookies order by rowid').all();
    const best = new Map();
    for (const row of rows) {
      const name = String(row.name || '');
      if (!name) continue;
      const host = String(row.host_key || '');
      if (!/(^|\.)163\.com$/i.test(host)) continue;
      let value = row.value;
      if ((!value || String(value).length === 0) && row.encrypted_value && row.encrypted_value.length > 15) {
        try {
          value = decryptV10(row.encrypted_value, key);
        } catch (error) {
          continue;
        }
      }
      if (!value) continue;
      best.set(name, String(value));
    }
    return best;
  } finally {
    db.close();
  }
}

async function verifyCookie(cookie) {
  try {
    const result = await weapiRaw('/api/nuser/account/get', {}, { cookie });
    const body = (result && result.body) || {};
    if (Number(body.code) !== 200) return { ok: false, reason: '接口返回 code ' + body.code };
    const profile = body.profile || null;
    return { ok: true, account: profile ? { id: Number(profile.userId || profile.id) || null, nickname: profile.nickname || '' } : null };
  } catch (error) {
    return { ok: false, reason: (error && error.message) || String(error) };
  }
}

let DatabaseSync = null;

export async function refreshCookieFromClient(options) {
  const opts = options || {};
  ensureDirs();
  if (process.platform !== 'win32') return { ok: false, reason: '当前系统不是 Windows，跳过客户端 cookie 刷新' };
  const files = opts.files || findClientCookieFiles();
  if (!files.ok) return files;
  if (!DatabaseSync) {
    try {
      ({ DatabaseSync } = await import('node:sqlite'));
    } catch (error) {
      return { ok: false, reason: '当前 Node 不支持 node:sqlite（需要 Node 22.5+），无法解密客户端 cookie' };
    }
  }
  let key;
  try {
    key = decryptClientKey(files.prefsPath);
  } catch (error) {
    return { ok: false, reason: (error && error.message) || String(error) };
  }
  const tmpDb = path.join(P.tmp, 'cookies-refresh.db');
  try {
    await copyFileWithRetry(files.cookiesPath, tmpDb);
    for (const suffix of ['-wal', '-journal']) {
      const extra = files.cookiesPath + suffix;
      if (fs.existsSync(extra)) {
        try {
          fs.copyFileSync(extra, tmpDb + suffix);
        } catch (error) {
          /* ignore */
        }
      }
    }
    let values;
    try {
      values = readCookieValues(tmpDb, key);
    } finally {
      for (const suffix of ['', '-wal', '-journal']) {
        try {
          fs.rmSync(tmpDb + suffix, { force: true });
        } catch (error) {
          /* ignore */
        }
      }
    }
    const cookie = [...values.entries()].map(([name, value]) => name + '=' + value).join('; ');
    if (!values.has('MUSIC_U')) return { ok: false, reason: '客户端 cookies 里没有 MUSIC_U（网易云客户端可能没有登录）' };
    const verified = await verifyCookie(cookie);
    if (!verified.ok) return { ok: false, reason: '客户端 cookie 验证失败：' + verified.reason, cookie };
    return { ok: true, cookie, source: 'netease-client-cef', account: verified.account, cookiesPath: files.cookiesPath };
  } catch (error) {
    return { ok: false, reason: (error && error.message) || String(error) };
  }
}
