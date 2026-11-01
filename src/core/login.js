import fs from 'node:fs';
import { exec } from 'node:child_process';
import { P, ensureDirs, saveCookie, sleep } from './config.js';
import { weapiRaw, userAccount, setCookie } from './netease.js';

function cookieFromResponse(cookieArray) {
  const parts = [];
  const seen = new Set();
  for (const raw of cookieArray || []) {
    const first = String(raw).split(';')[0].trim();
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const key = first.slice(0, eq);
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(first);
  }
  return parts.join('; ');
}

export async function saveCookieString(cookie, source) {
  const text = String(cookie || '').trim();
  if (!text.includes('MUSIC_U=')) throw new Error('cookie 里没有 MUSIC_U，无法登录');
  saveCookie(text, source || 'manual');
  setCookie(text);
  const account = await userAccount();
  return account;
}

export async function startQrLogin() {
  ensureDirs();
  const qrcode = await import('qrcode');
  const keyResult = await weapiRaw('/api/login/qrcode/unikey', { type: 3 }, { cookie: '' });
  const keyBody = keyResult.body || {};
  const key = keyBody.unikey || (keyBody.data && keyBody.data.unikey);
  if (!key) throw new Error('申请二维码失败：' + JSON.stringify(keyBody).slice(0, 300));
  const url = 'https://music.163.com/login?codekey=' + key;
  const png = await qrcode.toBuffer(url, { width: 360, margin: 2 });
  fs.writeFileSync(P.qr, png);
  const dataUrl = 'data:image/png;base64,' + png.toString('base64');
  return { key, url, file: P.qr, dataUrl };
}

export async function pollQrLogin(key) {
  let result;
  try {
    result = await weapiRaw('/api/login/qrcode/client/login', { key, type: 3 }, { cookie: '' });
  } catch (error) {
    result = { body: (error && error.body) || {}, cookie: (error && error.cookie) || [] };
  }
  const body = result.body || {};
  const code = Number(body.code);
  if (code === 803) {
    const cookie = cookieFromResponse(result.cookie);
    if (!cookie.includes('MUSIC_U=')) throw new Error('登录成功但没拿到 MUSIC_U，请重试或改用 --cookie 方式');
    const account = await saveCookieString(cookie, 'qr');
    return { status: 'ok', account, code };
  }
  if (code === 802) return { status: 'scanned', code };
  if (code === 800) return { status: 'expired', code };
  return { status: 'waiting', code };
}

export async function qrLogin(options) {
  const opts = options || {};
  const timeoutSec = Number(opts.timeoutSec || 180);
  console.log('正在向网易云申请登录二维码…');
  const started = await startQrLogin();
  console.log('二维码链接：' + started.url);
  console.log('二维码图片：' + started.file);
  if (opts.open !== false && process.platform === 'win32') {
    exec('cmd /c start "" "' + started.file + '"', () => {});
  } else if (opts.open !== false && process.platform === 'darwin') {
    exec('open "' + started.file + '"', () => {});
  } else if (opts.open !== false) {
    exec('xdg-open "' + started.file + '"', () => {});
  }
  console.log('请用网易云音乐 App 扫码并确认登录（' + timeoutSec + ' 秒内有效）');
  const deadline = Date.now() + timeoutSec * 1000;
  let lastStatus = '';
  while (Date.now() < deadline) {
    await sleep(2000);
    const state = await pollQrLogin(started.key);
    if (state.status !== lastStatus) {
      lastStatus = state.status;
      if (state.status === 'waiting') console.log('等待扫码…');
      if (state.status === 'scanned') console.log('已扫码，请在手机上确认…');
      if (state.status === 'expired') throw new Error('二维码已过期，请重新运行 login');
    }
    if (state.status === 'ok') {
      console.log('登录成功：' + state.account.nickname + '（uid ' + state.account.id + '）');
      return state.account;
    }
  }
  throw new Error('等待扫码超时（' + timeoutSec + ' 秒），请重新运行 login');
}
