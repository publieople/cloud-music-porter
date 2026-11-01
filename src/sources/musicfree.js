import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseDuration } from '../core/config.js';

const require = createRequire(import.meta.url);

const PLUGIN_DIR_CANDIDATES = {
  win32: [
    process.env.APPDATA ? path.join(process.env.APPDATA, 'MusicFree', 'musicfree-plugins') : '',
    process.env.APPDATA ? path.join(process.env.APPDATA, 'musicfree', 'musicfree-plugins') : '',
    process.env.APPDATA ? path.join(process.env.APPDATA, 'MusicFree', 'plugins') : '',
  ],
  darwin: [
    path.join(os.homedir(), 'Library', 'Application Support', 'MusicFree', 'musicfree-plugins'),
    path.join(os.homedir(), 'Library', 'Application Support', 'MusicFree', 'plugins'),
  ],
  linux: [
    path.join(os.homedir(), '.config', 'MusicFree', 'musicfree-plugins'),
    path.join(os.homedir(), '.config', 'MusicFree', 'plugins'),
  ],
};

const ALLOWED_MODULES = new Set(['axios', 'cheerio', 'crypto-js', 'dayjs', 'big-integer', 'he', 'qs', 'crypto', 'node:crypto', 'url', 'node:url', 'zlib', 'node:zlib', 'buffer', 'node:buffer', 'querystring', 'node:querystring', 'util', 'node:util', 'http', 'node:http', 'https', 'node:https']);
const NODE_BUILTINS = new Set(['crypto', 'url', 'zlib', 'buffer', 'querystring', 'util', 'http', 'https', 'path', 'fs', 'os', 'events', 'stream']);

function requireShim(name) {
  const key = String(name);
  const bare = key.replace(/^node:/, '');
  if (ALLOWED_MODULES.has(key)) return require(key);
  if (key.startsWith('node:') && NODE_BUILTINS.has(bare)) return require(key);
  if (!key.startsWith('node:') && NODE_BUILTINS.has(key)) return require(key);
  throw new Error('插件依赖了未提供的模块：' + key);
}

function consoleStub(label) {
  const emit = (level) => (...args) => {
    if (process.env.CMPORTER_DEBUG) console.error('[' + label + '][' + level + ']', ...args);
  };
  return { log: emit('log'), info: emit('info'), warn: emit('warn'), error: emit('error'), debug: () => {} };
}

export function detectMusicFreePluginsDir(configuredDir) {
  const candidates = [];
  if (configuredDir) candidates.push(configuredDir);
  if (process.env.CMPORTER_MF_PLUGINS) candidates.push(process.env.CMPORTER_MF_PLUGINS);
  candidates.push(...(PLUGIN_DIR_CANDIDATES[process.platform] || []));
  for (const dir of candidates) {
    if (!dir) continue;
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    } catch (error) {
      /* ignore */
    }
  }
  return '';
}

export function listPluginFiles(dir) {
  if (!dir) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => /\.(js|mjs|cjs)$/i.test(name))
      .map((name) => path.join(dir, name));
  } catch (error) {
    return [];
  }
}

export function loadMusicFreePlugin(file) {
  const code = fs.readFileSync(file, 'utf8');
  const module = { exports: {} };
  const label = path.basename(file);
  if (/^\s*export\s+(default|const|function)/m.test(code) && !/module\.exports/.test(code)) {
    throw new Error('插件是 ESM 模块，当前加载器只支持 CommonJS 格式');
  }
  const wrapper = new Function(
    'module',
    'exports',
    'require',
    '__filename',
    '__dirname',
    'console',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'Buffer',
    'process',
    'global',
    'globalThis',
    'fetch',
    'URL',
    'URLSearchParams',
    code + '\n;return module.exports;',
  );
  const exported = wrapper(
    module,
    module.exports,
    requireShim,
    file,
    path.dirname(file),
    consoleStub(label),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Buffer,
    { env: {} },
    globalThis,
    globalThis,
    fetch,
    URL,
    URLSearchParams,
  );
  const plugin = exported && Object.keys(exported).length ? exported : module.exports;
  if (!plugin || typeof plugin !== 'object') throw new Error('插件没有导出对象');
  if (typeof plugin.search !== 'function') throw new Error('插件没有 search 方法');
  return plugin;
}

export function listMusicFreePlugins(options) {
  const opts = options || {};
  const dir = detectMusicFreePluginsDir(opts.dir);
  const files = listPluginFiles(dir);
  const plugins = [];
  for (const file of files) {
    const entry = { file, fileName: path.basename(file), platform: '', version: '', author: '', ok: false, error: '', plugin: null };
    try {
      const plugin = loadMusicFreePlugin(file);
      entry.plugin = plugin;
      entry.platform = String(plugin.platform || plugin.name || path.basename(file, path.extname(file)));
      entry.version = String(plugin.version || '');
      entry.author = String(plugin.author || '');
      entry.supportedSearchType = plugin.supportedSearchType || plugin.supportSearchType || 'music';
      entry.srcUrl = String(plugin.srcUrl || '');
      entry.ok = true;
    } catch (error) {
      entry.error = String(error.message || error).slice(0, 200);
    }
    plugins.push(entry);
  }
  return { dir, files, plugins };
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

export async function searchAllPlugins(plugins, query, options) {
  const opts = options || {};
  const timeoutMs = Number(opts.timeoutMs || 12000);
  const concurrency = Math.max(1, Number(opts.concurrency || 4));
  const results = [];
  const queue = plugins.filter((entry) => entry.ok && entry.plugin);
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const entry = queue[cursor++];
      try {
        const response = await timeoutPromise(Promise.resolve(entry.plugin.search(query, 1, 'music')), timeoutMs, '搜索');
        const list = (response && (response.data || response.musicList || response.list)) || [];
        for (const item of list) {
          if (!item || typeof item !== 'object') continue;
          results.push({
            ...item,
            pluginPlatform: entry.platform,
            pluginFileName: entry.fileName,
            pluginFile: entry.file,
            plugin: entry.plugin,
            duration: parseDuration(item.duration) || Number(item.duration) || 0,
          });
        }
      } catch (error) {
        if (process.env.CMPORTER_DEBUG) console.error('[musicfree] 搜索失败 ' + entry.platform + '：' + error.message);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
  return results;
}

const QUALITY_CHAIN = {
  flac: ['super', 'high', 'standard', 'low'],
  '320k': ['super', 'high', 'standard', 'low'],
  '128k': ['standard', 'low', 'high'],
};

export async function resolveMusicFreeItem(item, options) {
  const opts = options || {};
  const plugin = item.plugin;
  if (!plugin) throw new Error('候选缺少插件引用');
  if (typeof plugin.getMediaSource !== 'function') throw new Error('插件没有 getMediaSource 方法');
  const chain = QUALITY_CHAIN[opts.quality] || QUALITY_CHAIN['320k'];
  let lastError = null;
  for (const quality of chain) {
    try {
      const result = await timeoutPromise(Promise.resolve(plugin.getMediaSource(Object.assign({}, item), quality)), Number(opts.timeoutMs || 20000), '解析音源');
      const url = typeof result === 'string' ? result : result && (result.url || result.data);
      if (url && typeof url === 'string' && /^https?:\/\//i.test(url)) {
        return { url, quality, headers: (result && result.headers) || {}, pluginPlatform: item.pluginPlatform || '' };
      }
      lastError = new Error('插件没有返回可用 URL（quality=' + quality + '）');
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('解析失败');
}
