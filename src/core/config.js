import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HOME_DIR = process.env.CMPORTER_HOME || path.join(os.homedir(), '.cloud-music-porter');
export const DATA = path.join(HOME_DIR, 'data');
export const P = {
  root: ROOT,
  home: HOME_DIR,
  data: DATA,
  cookie: path.join(DATA, 'cookie.json'),
  state: path.join(DATA, 'state.json'),
  config: path.join(HOME_DIR, 'config.json'),
  tmp: path.join(DATA, 'tmp'),
  runs: path.join(DATA, 'runs'),
  logs: path.join(DATA, 'logs'),
  qr: path.join(DATA, 'login_qr.png'),
};

export const APP = {
  name: 'cloud-music-porter',
  cli: 'cmporter',
  version: '0.1.0',
  repo: 'https://github.com/publieople/cloud-music-porter',
};

export const DEFAULT_CONFIG = {
  quality: 'flac',
  sourceMode: 'auto',
  lxDataDir: '',
  musicFreePluginsDir: '',
  delayMs: 800,
  maxGbPerRun: 0,
  serviceHour: 8,
  serviceMinute: 30,
  serviceMaxAttempts: 3,
  webPort: 8787,
  cloudWarnRatio: 0.9,
  ffprobePath: 'ffprobe',
  searchTimeoutMs: 12000,
  resolveTimeoutMs: 15000,
  pluginConcurrency: 4,
  minAudioBytes: 102400,
};

export function ensureDirs() {
  for (const dir of [HOME_DIR, DATA, P.tmp, P.runs, P.logs]) fs.mkdirSync(dir, { recursive: true });
}

export function loadConfig() {
  ensureDirs();
  let user = {};
  if (fs.existsSync(P.config)) {
    try {
      user = JSON.parse(fs.readFileSync(P.config, 'utf8'));
    } catch (error) {
      console.warn('[warn] config.json 解析失败，使用默认配置：' + error.message);
    }
  } else {
    fs.writeFileSync(P.config, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n', 'utf8');
  }
  return { ...DEFAULT_CONFIG, ...user };
}

export function saveConfig(patch) {
  const merged = { ...loadConfig(), ...(patch || {}) };
  ensureDirs();
  fs.writeFileSync(P.config, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return merged;
}

export function loadCookieMeta() {
  if (!fs.existsSync(P.cookie)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(P.cookie, 'utf8'));
    return typeof parsed === 'string' ? { cookie: parsed } : parsed;
  } catch (error) {
    return {};
  }
}

export function loadCookie() {
  const meta = loadCookieMeta();
  const cookie = meta.cookie;
  if (!cookie || !String(cookie).includes('MUSIC_U=')) {
    throw new Error('还没有登录：缺少有效的 ' + P.cookie + '。请先运行：cmporter login');
  }
  return String(cookie);
}

export function saveCookie(cookie, source) {
  ensureDirs();
  fs.writeFileSync(P.cookie, JSON.stringify({ cookie: String(cookie), updatedAt: Date.now(), source: source || 'qr' }, null, 2) + '\n', 'utf8');
  try {
    fs.chmodSync(P.cookie, 0o600);
  } catch (error) {
    /* Windows 上可能不支持，忽略 */
  }
}

function emptyState() {
  return { version: 1, imported: {}, failed: {}, runs: [] };
}

export function loadState() {
  ensureDirs();
  if (!fs.existsSync(P.state)) return emptyState();
  try {
    const parsed = JSON.parse(fs.readFileSync(P.state, 'utf8'));
    return { ...emptyState(), ...parsed };
  } catch (error) {
    return emptyState();
  }
}

export function saveState(state) {
  ensureDirs();
  fs.writeFileSync(P.state, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[·・.,;:'\"!?()\[\]{}<>《》「」『』【】\-_/\\|~!@#$%^&*+=]/g, '');
}

export function splitArtists(value) {
  const list = Array.isArray(value) ? value : String(value || '').split('/');
  return list
    .map((x) => String(x).trim())
    .filter(Boolean)
    .map((x) => x.replace(/\s*(feat\.?|ft\.?)\s+.*$/i, ''));
}

export function artistKey(artists) {
  const first = splitArtists(artists)[0] || '';
  return normalizeText(first);
}

export function artistSet(artists) {
  return new Set(splitArtists(artists).map(normalizeText).filter(Boolean));
}

export function fmtBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return value.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

export function fmtDuration(seconds) {
  const total = Math.round(Number(seconds) || 0);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return String(m) + ':' + String(s).padStart(2, '0');
}

export function stamp(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

export function shortStamp(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

export function safeFileName(value) {
  return String(value || '').replace(/[\\/:*?\"<>|\r\n]/g, '_').replace(/^\s+|\s+$/g, '').slice(0, 160) || 'audio';
}

export function detectExtFromBuffer(buffer) {
  if (!buffer || buffer.length < 12) return '';
  if (buffer.subarray(0, 4).toString() === 'fLaC') return 'flac';
  if (buffer.subarray(0, 3).toString() === 'ID3') return 'mp3';
  const hex2 = buffer.subarray(0, 2).toString('hex');
  if (hex2 === 'fffb' || hex2 === 'fff3' || hex2 === 'fff2' || hex2 === 'fff1') return 'mp3';
  if (buffer.subarray(4, 8).toString() === 'ftyp') return 'm4a';
  if (buffer.subarray(0, 4).toString() === 'OggS') return 'ogg';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WAVE') return 'wav';
  return '';
}

export function md5Of(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

export function probeAudio(filePath, options) {
  const opts = options || {};
  const ffprobePath = opts.ffprobePath || process.env.CMPORTER_FFPROBE || 'ffprobe';
  let result = null;
  try {
    const out = spawnSync(ffprobePath, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath], {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    if (out.error || out.status !== 0) {
      return { ok: false, available: !out.error, error: (out.stderr || String(out.error || 'ffprobe 失败')).slice(0, 200) };
    }
    const info = JSON.parse(out.stdout || '{}');
    const audio = (info.streams || []).find((s) => s.codec_type === 'audio');
    if (!audio) return { ok: false, available: true, error: '文件里没有音频流' };
    const format = info.format || {};
    const duration = Number(format.duration || audio.duration) || 0;
    const bitrate = Number(format.bit_rate) || 0;
    const codec = String(audio.codec_name || '');
    const known = /flac|mp3|aac|m4a|alac|opus|vorbis|pcm|ape|wma|aiff/i.test(codec);
    if (!known) return { ok: false, available: true, error: '不支持的音频编码：' + codec };
    if (!(duration > 1)) return { ok: false, available: true, error: '音频时长无效（' + duration + 's），文件可能损坏' };
    result = { ok: true, available: true, duration, bitrate, codec, container: format.format_name || '', size: Number(format.size) || 0 };
  } catch (error) {
    return { ok: false, available: false, error: String(error.message || error).slice(0, 200) };
  }
  return result;
}

export function parseDuration(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return value > 3600 ? Math.round(value / 1000) : Math.round(value);
  }
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) return parseDuration(Number(text));
  const parts = text.split(':').map((x) => Number(x));
  if (parts.every((x) => Number.isFinite(x))) {
    return parts.reduce((acc, x) => acc * 60 + x, 0);
  }
  return 0;
}

export function countBy(list, field) {
  const map = {};
  for (const item of list) {
    const key = item[field];
    map[key] = (map[key] || 0) + 1;
  }
  return map;
}
