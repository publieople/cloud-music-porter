import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { P, APP, ensureDirs, loadConfig, saveConfig, loadCookieMeta, loadState, fmtBytes } from '../core/config.js';
import { userAccount, cloudStats, cloudAll, setCookie } from '../core/netease.js';
import { startQrLogin, pollQrLogin } from '../core/login.js';
import { createSourceManager } from '../sources/index.js';
import { loadServiceState, dateKey } from '../service/state.js';

const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const jobs = new Map();
let jobSeq = 0;

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1.5 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, rel) {
  const file = path.join(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    json(res, 404, { error: 'not found' });
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

async function overview() {
  const cfg = loadConfig();
  const state = loadState();
  const serviceState = loadServiceState();
  const meta = loadCookieMeta();
  const out = {
    app: { name: APP.name, version: APP.version, repo: APP.repo, home: P.home, platform: process.platform, node: process.versions.node },
    config: cfg,
    cookie: { saved: Boolean(meta.cookie), updatedAt: meta.updatedAt || null, source: meta.source || '' },
    account: null,
    cloud: null,
    local: { imported: Object.keys(state.imported || {}).length, failed: Object.keys(state.failed || {}).length, runs: (state.runs || []).length },
    service: { lastRunAt: serviceState.lastRunAt || null, lastOk: Boolean(serviceState.lastOk), lastMessage: serviceState.lastMessage || '', lastSummary: serviceState.lastSummary || null, today: dateKey(), attemptsToday: serviceState.attempts && serviceState.attempts.date === dateKey() ? serviceState.attempts.count : 0 },
    sources: null,
  };
  if (meta.cookie) {
    try {
      setCookie(meta.cookie);
      const account = await userAccount();
      out.account = { id: account.id, nickname: account.nickname, vipType: account.vipType || 0 };
      const stats = await cloudStats();
      out.cloud = { count: stats.count, size: stats.size, maxSize: stats.maxSize, sizeText: fmtBytes(stats.size), maxText: fmtBytes(stats.maxSize), percent: stats.maxSize ? Number(((stats.size / stats.maxSize) * 100).toFixed(1)) : null };
    } catch (error) {
      out.accountError = (error && error.message) || String(error);
    }
  }
  try {
    const manager = await createSourceManager(cfg);
    const info = manager.describe();
    out.sources = {
      lx: { enabled: info.lx.enabled, dir: info.lx.dir, error: info.lx.error, count: info.lx.sources.length, names: info.lx.sources.map((item) => item.name) },
      musicfree: { enabled: info.musicfree.enabled, resolveEnabled: info.musicfree.resolveEnabled, dir: info.musicfree.dir, error: info.musicfree.error, count: info.musicfree.plugins.filter((item) => item.ok).length },
    };
  } catch (error) {
    out.sourcesError = (error && error.message) || String(error);
  }
  return out;
}

function buildCommandArgs(command, body) {
  const args = [path.join(P.root, 'src', 'cli.js')];
  const filters = body.filters || {};
  const push = (flag, value) => {
    if (value === undefined || value === null || value === '') return;
    args.push(flag, String(value));
  };
  if (command === 'scan' || command === 'sync' || command === 'match') {
    args.push(command);
    if (filters.liked) args.push('--liked');
    if (filters.all) args.push('--all');
    if (filters.vipOnly) args.push('--vip-only');
    if (filters.allRows) args.push('--all-rows');
    if (filters.includeUnavailable) args.push('--include-unavailable');
    if (filters.dryRun) args.push('--dry-run');
    if (filters.force) args.push('--force');
    push('--playlist', filters.playlist);
    push('--song', filters.song);
    push('--query', filters.query);
    push('--limit', filters.limit);
    push('--offset', filters.offset);
    push('--quality', filters.quality);
    push('--source', filters.source);
    push('--max-gb', filters.maxGb);
    push('--from', filters.from);
    if (command === 'sync' && filters.yes) args.push('--yes');
  } else if (command === 'service-run') {
    args.push('service', 'run');
    if (body.dryRun) args.push('--dry-run');
    if (body.force) args.push('--force');
  } else if (command === 'service-install') {
    args.push('service', 'install');
    if (body.time) args.push('--time', String(body.time));
  } else if (command === 'service-uninstall') {
    args.push('service', 'uninstall');
  } else if (command === 'doctor') {
    args.push('doctor');
  } else {
    throw new Error('不支持的 Web 操作：' + command);
  }
  return args;
}

function startJob(command, body) {
  jobSeq += 1;
  const id = 'job' + jobSeq;
  const args = buildCommandArgs(command, body || {});
  const child = spawn(process.execPath, args, {
    cwd: P.root,
    env: { ...process.env, CMPORTER_WEB: '1' },
    windowsHide: true,
  });
  const job = { id, command, args, child, lines: [], status: 'running', startedAt: Date.now(), exitCode: null, listeners: new Set() };
  const onData = (chunk) => {
    const text = chunk.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (line === '') continue;
      job.lines.push(line);
      if (job.lines.length > 6000) job.lines.splice(0, job.lines.length - 6000);
      for (const listener of job.listeners) listener(line);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', (chunk) => onData(chunk));
  child.on('error', (error) => {
    job.lines.push('启动子进程失败：' + ((error && error.message) || error));
    job.status = 'failed';
    job.exitCode = -1;
  });
  child.on('close', (code) => {
    job.status = code === 0 ? 'done' : 'failed';
    job.exitCode = code;
    job.endedAt = Date.now();
    for (const listener of job.listeners) listener(null);
    job.listeners.clear();
    setTimeout(() => jobs.delete(id), 30 * 60 * 1000).unref();
  });
  jobs.set(id, job);
  return job;
}

function sseRun(req, res, job) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const send = (line) => {
    if (line === null) {
      res.write('event: end\ndata: ' + JSON.stringify({ status: job.status, exitCode: job.exitCode }) + '\n\n');
      return;
    }
    res.write('data: ' + JSON.stringify({ line }) + '\n\n');
  };
  // 首屏把已经产生的日志补上
  for (const line of job.lines) send(line);
  if (job.status === 'running') {
    job.listeners.add(send);
    req.on('close', () => job.listeners.delete(send));
    const keepAlive = setInterval(() => {
      res.write(': ping\n\n');
      if (job.status !== 'running') clearInterval(keepAlive);
    }, 15000);
    keepAlive.unref();
    req.on('close', () => clearInterval(keepAlive));
  } else {
    send(null);
    res.end();
  }
}

function validateHost(req) {
  const host = String(req.headers.host || '');
  const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]';
}

export async function startWebServer(options) {
  const opts = options || {};
  ensureDirs();
  const cfg = loadConfig();
  const port = Number(opts.port || cfg.webPort || 8787);
  const open = opts.open !== false;
  const server = http.createServer(async (req, res) => {
    try {
      if (!validateHost(req)) {
        json(res, 403, { error: '只允许本机访问（127.0.0.1）' });
        return;
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      const pathname = url.pathname;
      if (req.method === 'POST' && req.headers['x-cmporter'] !== 'web') {
        json(res, 403, { error: '缺少 x-cmporter 请求头' });
        return;
      }
      if (pathname === '/' || pathname === '/index.html') return serveStatic(res, 'index.html');
      if (pathname.startsWith('/static/')) return serveStatic(res, pathname.replace('/static/', ''));
      if (pathname === '/api/overview') return json(res, 200, await overview());
      if (pathname === '/api/sources') {
        const manager = await createSourceManager(loadConfig());
        return json(res, 200, manager.describe());
      }
      if (pathname === '/api/config' && req.method === 'GET') {
        return json(res, 200, { config: loadConfig(), configPath: P.config });
      }
      if (pathname === '/api/config' && req.method === 'POST') {
        const body = await readBody(req);
        const allowed = ['quality', 'sourceMode', 'lxDataDir', 'musicFreePluginsDir', 'delayMs', 'maxGbPerRun', 'serviceHour', 'serviceMinute', 'webPort', 'cloudWarnRatio', 'ffprobePath', 'searchTimeoutMs', 'resolveTimeoutMs', 'pluginConcurrency', 'minAudioBytes', 'serviceMaxAttempts'];
        const patch = {};
        for (const key of allowed) {
          if (body && body.config && Object.prototype.hasOwnProperty.call(body.config, key)) patch[key] = body.config[key];
        }
        if (!Object.keys(patch).length) return json(res, 400, { error: '没有可更新的字段' });
        const merged = saveConfig(patch);
        return json(res, 200, { ok: true, config: merged });
      }
      if (pathname === '/api/login/start' && req.method === 'POST') {
        const login = await startQrLogin();
        return json(res, 200, { key: login.key, dataUrl: login.dataUrl, file: login.file, url: login.url });
      }
      if (pathname === '/api/login/poll' && req.method === 'GET') {
        const key = url.searchParams.get('key') || '';
        if (!key) return json(res, 400, { error: '缺少 key' });
        const result = await pollQrLogin(key);
        return json(res, 200, result);
      }
      if (pathname === '/api/run' && req.method === 'POST') {
        const body = await readBody(req);
        const command = String(body.command || '');
        try {
          const job = startJob(command, body);
          return json(res, 200, { jobId: job.id, command: job.command, args: job.args.slice(2) });
        } catch (error) {
          return json(res, 400, { error: (error && error.message) || String(error) });
        }
      }
      const streamMatch = pathname.match(/^\/api\/run\/([^/]+)\/stream$/);
      if (streamMatch) {
        const job = jobs.get(streamMatch[1]);
        if (!job) return json(res, 404, { error: '任务不存在或已过期' });
        return sseRun(req, res, job);
      }
      const jobMatch = pathname.match(/^\/api\/run\/([^/]+)$/);
      if (jobMatch) {
        const job = jobs.get(jobMatch[1]);
        if (!job) return json(res, 404, { error: '任务不存在或已过期' });
        return json(res, 200, { id: job.id, command: job.command, status: job.status, exitCode: job.exitCode, lines: job.lines.slice(-500) });
      }
      if (pathname === '/api/cloud/list') {
        const limit = Number(url.searchParams.get('limit') || 30);
        const meta = loadCookieMeta();
        if (!meta.cookie) return json(res, 401, { error: '还没有登录' });
        setCookie(meta.cookie);
        const cloud = await cloudAll({ pageSize: Math.min(Math.max(limit, 1), 200) });
        return json(res, 200, { count: cloud.count, size: cloud.size, maxSize: cloud.maxSize, entries: cloud.entries.slice(0, limit) });
      }
      return json(res, 404, { error: 'not found' });
    } catch (error) {
      json(res, 500, { error: (error && error.message) || String(error) });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = 'http://127.0.0.1:' + actualPort + '/';
  console.log('');
  console.log(APP.name + ' WebUI 已启动：' + url);
  console.log('只监听本机 127.0.0.1，不要把它暴露到公网。按 Ctrl+C 停止。');
  console.log('');
  if (open) {
    const platform = process.platform;
    const command = platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    try {
      spawn(command[0], command[1], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch (error) {
      console.log('（无法自动打开浏览器，请手动访问上面的地址）');
    }
  }
  return { server, port: actualPort, url };
}
