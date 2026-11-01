import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { normalizeText } from '../core/config.js';

const DATA_DIR_CANDIDATES = {
  win32: [
    process.env.APPDATA ? path.join(process.env.APPDATA, 'lx-music-desktop', 'LxDatas') : '',
    path.join(os.homedir(), 'AppData', 'Roaming', 'lx-music-desktop', 'LxDatas'),
  ],
  darwin: [path.join(os.homedir(), 'Library', 'Application Support', 'lx-music-desktop', 'LxDatas')],
  linux: [
    path.join(os.homedir(), '.config', 'lx-music-desktop', 'LxDatas'),
    path.join(os.homedir(), '.local', 'share', 'lx-music-desktop', 'LxDatas'),
  ],
};

export function detectLxDataDir(configuredDir) {
  const candidates = [];
  if (configuredDir) candidates.push(configuredDir);
  if (process.env.CMPORTER_LX_DATA) candidates.push(process.env.CMPORTER_LX_DATA);
  if (process.env.LX_DATA_DIR) candidates.push(process.env.LX_DATA_DIR);
  candidates.push(...(DATA_DIR_CANDIDATES[process.platform] || []));
  for (const dir of candidates) {
    if (!dir) continue;
    try {
      if (fs.existsSync(path.join(dir, 'user_api.json'))) return dir;
    } catch (error) {
      /* ignore */
    }
  }
  return '';
}

export function decodeSourceScript(script) {
  const text = String(script || '');
  if (!text.startsWith('gz_')) return text;
  const buffer = Buffer.from(text.slice(3), 'base64');
  return zlib.inflateSync(buffer).toString('utf8');
}

export function readLxSourceList(dataDir) {
  const file = path.join(dataDir, 'user_api.json');
  if (!fs.existsSync(file)) return { file, sources: [] };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error('LX Music 的 user_api.json 解析失败：' + error.message);
  }
  const items = Array.isArray(raw) ? raw : raw.sources || raw.userApis || raw.data || [];
  const sources = items
    .map((item) => ({
      id: item.id || item.name || '',
      name: item.name || '未命名源',
      description: item.description || '',
      version: item.version || '',
      author: item.author || '',
      script: item.script || '',
    }))
    .filter((item) => item.script);
  return { file, sources };
}

function makeConsoleStub(logs) {
  const push = (level) => (...args) => {
    if (logs.length < 200) logs.push('[' + level + '] ' + args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).slice(0, 4).join(' ').slice(0, 300));
  };
  return { log: push('log'), info: push('info'), warn: push('warn'), error: push('error'), debug: () => {}, group: () => {}, groupEnd: () => {} };
}

function timeoutPromise(promise, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(label + ' 超时（' + ms + 'ms）')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// 在 node:vm 里按 LX 自定义源规范启动一个源脚本。
export function createLxSourceRuntime(source) {
  const logs = [];
  const state = { inited: null, requestHandler: null, error: null };
  let resolveInited;
  let rejectInited;
  const initedPromise = new Promise((resolve, reject) => {
    resolveInited = resolve;
    rejectInited = reject;
  });
  const sandbox = {};
  const lx = {
    EVENT_NAMES: { request: 'request', inited: 'inited', updateAlert: 'updateAlert' },
    version: '2.12.6',
    env: 'desktop',
    currentScriptInfo: { id: source.id, name: source.name, description: source.description, version: source.version, author: source.author },
    on(event, handler) {
      if (event === 'request') state.requestHandler = handler;
    },
    send(event, data) {
      if (event === 'inited') {
        state.inited = data || {};
        resolveInited(state.inited);
      }
    },
    request(url, options, callback) {
      const opts = options || {};
      const cb = typeof callback === 'function' ? callback : () => {};
      (async () => {
        try {
          const headers = {};
          for (const [key, value] of Object.entries(opts.headers || {})) headers[key] = String(value);
          const response = await fetch(url, {
            method: opts.method || 'GET',
            headers,
            body: opts.body,
            signal: AbortSignal.timeout(20000),
          });
          const text = await response.text();
          let body = text;
          try {
            body = JSON.parse(text);
          } catch (error) {
            /* 保留文本 */
          }
          const responseHeaders = {};
          response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
          });
          cb(null, { statusCode: response.status, status: response.status, headers: responseHeaders, body });
        } catch (error) {
          cb(error);
        }
      })();
    },
    utils: {
      crypto,
      zlib: { inflate: zlib.inflateSync, deflate: zlib.deflateSync, inflateRaw: zlib.inflateRawSync, deflateRaw: zlib.deflateRawSync },
      buffer: {
        from: (...args) => Buffer.from(...args),
        bufToString: (buf, format) => Buffer.from(buf).toString(format || 'utf8'),
        strToBuf: (value) => Buffer.from(String(value)),
        concat: (list) => Buffer.concat(list),
      },
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.lx = lx;
  sandbox.console = makeConsoleStub(logs);
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.setInterval = setInterval;
  sandbox.clearInterval = clearInterval;
  sandbox.URL = URL;
  sandbox.URLSearchParams = URLSearchParams;
  sandbox.Buffer = Buffer;
  sandbox.process = { env: {} };
  sandbox.fetch = fetch;
  vm.createContext(sandbox);
  const code = decodeSourceScript(source.script);
  try {
    vm.runInContext(code, sandbox, { filename: 'lx-source-' + (source.id || 'unknown') + '.js', timeout: 15000 });
  } catch (error) {
    state.error = '脚本执行失败：' + String(error.message || error);
    rejectInited(new Error(state.error));
  }
  return {
    source,
    logs,
    state,
    inited(timeoutMs) {
      return timeoutPromise(initedPromise, timeoutMs || 8000, '等待 LX 源初始化');
    },
    async resolve(platform, musicInfo, quality, timeoutMs) {
      await this.inited(timeoutMs);
      if (!state.requestHandler) throw new Error('源没有注册 request 处理函数');
      let lastError = null;
      for (const type of qualityChain(quality)) {
        try {
          const result = await timeoutPromise(
            Promise.resolve(state.requestHandler({ source: platform, action: 'musicUrl', info: { type, musicInfo } })),
            timeoutMs || 20000,
            '解析音源',
          );
          const url = typeof result === 'string' ? result : result && result.url;
          if (url) return { url, quality: type };
          lastError = new Error('源没有返回 URL（quality=' + type + '）');
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error('解析失败');
    },
  };
}

export function qualityChain(quality) {
  if (quality === 'flac') return ['flac', 'flac24bit', '320k', '128k'];
  if (quality === '320k') return ['320k', '128k'];
  if (quality === '128k') return ['128k'];
  return [quality, '320k', '128k'];
}

export async function probeLxSources(options) {
  const opts = options || {};
  const dataDir = detectLxDataDir(opts.dataDir);
  if (!dataDir) return { dir: '', file: '', sources: [], error: '没有找到 LX Music 数据目录（LxDatas）' };
  const list = readLxSourceList(dataDir);
  const results = [];
  for (const source of list.sources) {
    const entry = { id: source.id, name: source.name, version: source.version, author: source.author, ok: false, platforms: [], error: '' };
    try {
      const runtime = createLxSourceRuntime(source);
      const inited = await runtime.inited(opts.timeoutMs || 8000);
      entry.sources = inited.sources || {};
      entry.platforms = Object.entries(entry.sources).map(([key, value]) => ({ key, name: value && value.name, qualitys: (value && value.qualitys) || [], actions: (value && value.actions) || [] }));
      entry.ok = entry.platforms.length > 0;
      entry.runtime = runtime;
    } catch (error) {
      entry.error = String(error.message || error).slice(0, 200);
    }
    results.push(entry);
  }
  return { dir: dataDir, file: list.file, sources: results };
}

export function lxPlatformForPlugin(platformName) {
  const name = String(platformName || '');
  if (/酷我|kuwo|(^|[^a-z])kw([^a-z]|$)/i.test(name)) return 'kw';
  if (/酷狗|kugou|(^|[^a-z])kg([^a-z]|$)/i.test(name)) return 'kg';
  if (/网易|netease|(^|[^a-z])wy([^a-z]|$)/i.test(name)) return 'wy';
  if (/qq|腾讯|tencent|(^|[^a-z])tx([^a-z]|$)/i.test(name)) return 'tx';
  if (/咪咕|migu|(^|[^a-z])mg([^a-z]|$)/i.test(name)) return 'mg';
  return '';
}

export function guessLxPlatform(item) {
  if (!item) return '';
  if (item.songmid) return 'tx';
  if (item.hash || item.sqhash) return 'kg';
  if (item.copyrightId) return 'mg';
  if (item.albumId !== undefined && item.artistId !== undefined && item.id !== undefined) return 'kw';
  return '';
}

export function buildLxMusicInfo(platform, item, song, quality) {
  const singer = (song.artists || []).join('、');
  const base = { name: song.name, singer, albumName: song.album || item.album || '', interval: String(Math.floor((song.duration || 0) / 60)).padStart(2, '0') + ':' + String((song.duration || 0) % 60).padStart(2, '0'), source: platform };
  if (platform === 'kw') return { ...base, songmid: String(item.id || item.songmid || '') };
  if (platform === 'kg') return { ...base, hash: String((quality === 'flac' ? item.sqhash : item['320hash']) || item.hash || item.id || '') };
  if (platform === 'tx') return { ...base, songmid: String(item.songmid || item.id || '') };
  if (platform === 'wy') return { ...base, id: String(item.id || '') };
  if (platform === 'mg') return { ...base, copyrightId: String(item.copyrightId || item.id || '') };
  return base;
}

export function lxSourceLabel(entry) {
  return entry.name + (entry.version ? ' v' + entry.version : '');
}

export function normalizeSongName(value) {
  return normalizeText(value);
}
