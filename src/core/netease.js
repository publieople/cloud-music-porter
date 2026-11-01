import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadCookie } from './config.js';

const require = createRequire(import.meta.url);

// @neteasecloudmusicapienhanced/api 的 request 模块加载时会读取 os.tmpdir()/anonymous_token，
// 文件不存在会直接抛 ENOENT，所以这里先补一个空文件。
const anonymousTokenPath = path.join(os.tmpdir(), 'anonymous_token');
if (!fs.existsSync(anonymousTokenPath)) {
  try {
    fs.writeFileSync(anonymousTokenPath, '');
  } catch (error) {
    /* ignore */
  }
}

const request = require('@neteasecloudmusicapienhanced/api/util/request');
const createOption = require('@neteasecloudmusicapienhanced/api/util/option');

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://music.163.com';

let cookieCache = '';

export function setCookie(cookie) {
  cookieCache = cookie || '';
}

export function getCookie() {
  return cookieCache || loadCookie();
}

export class ApiError extends Error {
  constructor(message, body) {
    super(message);
    this.name = 'ApiError';
    this.body = body;
  }
}

async function withRetry(fn, label, attempts) {
  const max = attempts || 4;
  let lastError = null;
  for (let attempt = 1; attempt <= max; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = String((error && error.message) || error) + ' ' + String((error && error.cause && error.cause.message) || '');
      const retryable = /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|other side closed|network/i.test(message) || (error && (error.name === 'TimeoutError' || error.name === 'AbortError'));
      if (!retryable || attempt === max) throw error;
      await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
    }
  }
  throw lastError;
}

export async function weapiRaw(apiPath, data, options) {
  const opts = options || {};
  const cookie = Object.prototype.hasOwnProperty.call(opts, 'cookie') ? opts.cookie : getCookie();
  const requestOptions = { ...createOption({ cookie }), crypto: 'weapi' };
  try {
    return await withRetry(() => request(apiPath, data || {}, requestOptions), apiPath);
  } catch (error) {
    const body = (error && error.body) || error;
    const message = (body && (body.message || body.msg)) || (error && error.message) || String(error);
    throw new ApiError(apiPath + ' 请求失败：' + message, body);
  }
}

export async function weapi(apiPath, data) {
  const res = await weapiRaw(apiPath, data);
  return (res && res.body) || {};
}

export function assertOk(body, label) {
  if (!body || Number(body.code) !== 200) {
    const message = (body && (body.message || body.msg)) || '未知错误';
    throw new ApiError(label + ' 失败：' + message, body);
  }
  return body;
}

export async function plainGet(apiPath, params, options) {
  const opts = options || {};
  const url = new URL(apiPath, BASE);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const cookie = Object.prototype.hasOwnProperty.call(opts, 'cookie') ? opts.cookie : getCookie();
  return withRetry(async () => {
    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': UA, Referer: BASE + '/', Cookie: cookie || '' },
      signal: AbortSignal.timeout(opts.timeout || 30000),
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new ApiError('非 JSON 响应 HTTP ' + response.status + ' ' + url.pathname + '：' + text.slice(0, 160));
    }
    return body;
  }, url.pathname);
}

export async function userAccount() {
  const body = await weapi('/api/nuser/account/get', {});
  if (Number(body.code) !== 200) throw new ApiError('读取账号失败：' + (body.message || body.msg || body.code), body);
  const account = body.account || {};
  const profile = body.profile || {};
  if (!account.id) throw new ApiError('当前 cookie 已失效（拿不到账号信息），请重新登录：cmporter login', body);
  return { id: Number(account.id), nickname: profile.nickname || '', vipType: profile.vipType || 0, profile };
}

export async function userPlaylists(uid, options) {
  const opts = options || {};
  const body = await weapi('/api/user/playlist', { uid, limit: opts.limit || 100, offset: opts.offset || 0, includeVideo: true });
  assertOk(body, '读取歌单列表');
  return (body.playlist || []).map((item) => ({
    id: Number(item.id),
    name: item.name,
    trackCount: item.trackCount || 0,
    specialType: item.specialType || 0,
    subscribed: Boolean(item.subscribed),
    creatorId: item.creator ? item.creator.userId : 0,
  }));
}

export async function playlistInfo(playlistId) {
  const body = await weapi('/api/v6/playlist/detail', { id: playlistId, n: 100000, s: 8 });
  assertOk(body, '读取歌单详情');
  const playlist = body.playlist || {};
  return {
    id: Number(playlist.id),
    name: playlist.name || String(playlistId),
    trackCount: playlist.trackCount || 0,
    trackIds: (playlist.trackIds || []).map((x) => Number(x.id)),
    creatorId: playlist.userId || 0,
    specialType: playlist.specialType || 0,
  };
}

export async function songDetails(ids, options) {
  const opts = options || {};
  const chunk = opts.chunk || 200;
  const list = Array.from(ids).map(Number);
  const songs = new Map();
  const privileges = new Map();
  for (let i = 0; i < list.length; i += chunk) {
    const part = list.slice(i, i + chunk);
    const c = '[' + part.map((id) => '{"id":' + id + '}').join(',') + ']';
    const body = await weapi('/api/v3/song/detail', { c });
    assertOk(body, '读取歌曲详情');
    for (const song of body.songs || []) songs.set(Number(song.id), song);
    for (const privilege of body.privileges || []) privileges.set(Number(privilege.id), privilege);
    if (i + chunk < list.length) await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return { songs, privileges };
}

export function songBrief(song) {
  return {
    id: Number(song.id),
    name: song.name,
    artists: (song.ar || []).map((x) => x.name),
    artistIds: (song.ar || []).map((x) => x.id),
    album: song.al ? song.al.name : '',
    albumId: song.al ? song.al.id : 0,
    duration: Math.round((song.dt || 0) / 1000),
    fee: song.fee,
    aliases: song.alia || [],
    picUrl: song.al ? song.al.picUrl : '',
  };
}

export async function songBriefById(id) {
  const { songs } = await songDetails([id]);
  const song = songs.get(Number(id));
  return song ? songBrief(song) : null;
}

export async function playUrls(ids, options) {
  const opts = options || {};
  const chunk = opts.chunk || 50;
  const br = opts.br || 320000;
  const list = Array.from(ids).map(Number);
  const map = new Map();
  for (let i = 0; i < list.length; i += chunk) {
    const part = list.slice(i, i + chunk);
    const body = await plainGet('/api/song/enhance/player/url', { ids: JSON.stringify(part), br });
    if (Number(body.code) !== 200) throw new ApiError('读取播放地址失败：' + (body.message || body.msg || body.code), body);
    for (const item of body.data || []) map.set(Number(item.id), item);
    if (i + chunk < list.length) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return map;
}

export async function searchSongs(keyword, options) {
  const opts = options || {};
  const body = await weapi('/api/cloudsearch/pc', { s: keyword, type: 1, limit: opts.limit || 10, offset: opts.offset || 0, total: true });
  assertOk(body, '搜索歌曲');
  const result = body.result || {};
  return (result.songs || []).map(songBrief);
}

export function normalizeCloudEntry(item) {
  const pc = item.privateCloud || {};
  const simple = item.simpleSong || {};
  const artists = pc.artist || (simple.ar || []).map((x) => x.name).join('/');
  return {
    cloudSongId: Number(pc.songId || item.songId || simple.id || 0),
    md5: pc.md5 || '',
    name: pc.song || simple.name || '',
    artist: artists,
    album: pc.album || (simple.al ? simple.al.name : ''),
    fileName: pc.fileName || '',
    bitrate: pc.bitrate || (simple.l ? simple.l.br : 0),
    fileSize: pc.fileSize || (simple.l ? simple.l.size : 0),
    addTime: pc.addTime || 0,
    matchType: item.matchType || '',
    matchedSongId: item.matchType === 'matched' ? Number(simple.id || 0) : 0,
  };
}

export async function cloudAll(options) {
  const opts = options || {};
  const pageSize = opts.pageSize || 200;
  let offset = 0;
  const entries = [];
  let meta = {};
  while (true) {
    const body = await weapi('/api/v1/cloud/get', { limit: pageSize, offset });
    assertOk(body, '读取云盘');
    if (Object.keys(meta).length === 0) meta = { count: Number(body.count || 0), size: Number(body.size || 0), maxSize: Number(body.maxSize || 0) };
    const data = body.data || [];
    for (const item of data) entries.push(normalizeCloudEntry(item));
    offset += data.length;
    if (opts.onPage) opts.onPage(offset, meta.count);
    if (!data.length || offset >= meta.count) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return { ...meta, entries };
}

export async function cloudStats() {
  const body = await weapi('/api/v1/cloud/get', { limit: 1, offset: 0 });
  assertOk(body, '读取云盘容量');
  return { count: Number(body.count || 0), size: Number(body.size || 0), maxSize: Number(body.maxSize || 0) };
}

export async function cloudCheck(params) {
  const body = await weapi('/api/cloud/upload/check/v2', {
    uploadType: 0,
    songs: JSON.stringify([{ md5: params.md5, songId: params.songId || 0, bitrate: params.bitrate, fileSize: params.fileSize }]),
  });
  assertOk(body, '云盘秒传检查');
  const item = (body.data || [])[0];
  if (!item) throw new ApiError('云盘秒传检查没有返回数据：' + JSON.stringify(body).slice(0, 200), body);
  return { md5: item.md5, songId: item.songId, upload: Number(item.upload) };
}

export async function cloudImport(params) {
  return weapi('/api/cloud/user/song/import', {
    uploadType: 0,
    songs: JSON.stringify([{
      songId: params.checkSongId,
      bitrate: params.bitrate,
      song: params.song,
      artist: params.artist,
      album: params.album || '未知专辑',
      fileName: params.fileName,
    }]),
  });
}

export async function cloudDelete(cloudSongIds) {
  const body = await weapi('/api/cloud/del', { songIds: cloudSongIds.map(Number) });
  assertOk(body, '删除云盘歌曲');
  return body;
}

export async function cloudMatch(params) {
  return weapi('/api/cloud/user/song/match', { userId: params.userId, songId: params.songId, adjustSongId: params.adjustSongId });
}

let uploadHostCache = '';

async function discoverUploadHost() {
  if (uploadHostCache) return uploadHostCache;
  try {
    // 这是第三方 NOS 的 LBS 服务，绝对不能把网易云 cookie 发过去。
    const body = await plainGet('https://wanproxy.127.net/lbs', { version: '1.0', bucketname: 'jd-musicrep-privatecloud-audio-public' }, { cookie: '' });
    const hosts = body && body.upload;
    if (Array.isArray(hosts) && hosts.length) {
      uploadHostCache = String(hosts[0].host || '').replace(/\/+$/, '');
      if (uploadHostCache) return uploadHostCache;
    }
  } catch (error) {
    /* 下面统一报错 */
  }
  throw new ApiError('无法从网易云 NOS 获取上传地址（LBS 失败），请检查网络后重试');
}

export async function cloudUploadFile(params) {
  const buffer = fs.readFileSync(params.filePath);
  const fileSize = buffer.length;
  const ext = params.ext || 'mp3';
  const meta = params.meta || {};
  const bitrateKbps = ext === 'flac' ? 999 : (Number(params.bitrateParam) || 320);

  // cloudId 必须来自 /api/cloud/upload/check/v2 的 songId（不透明字符串），
  // /api/upload/cloud/info/v2 的 songid 字段要用它，否则发布的云盘记录不可见。
  let cloudId = params.cloudId;
  if (!cloudId) {
    const v2 = await weapi('/api/cloud/upload/check/v2', {
      uploadType: 0,
      songs: JSON.stringify([{ md5: params.md5, songId: params.songId || 0, bitrate: bitrateKbps, fileSize }]),
    });
    assertOk(v2, '上传前检查');
    const item = (v2.data || [])[0] || {};
    cloudId = item.songId;
    if (Number(item.upload) === 1) return { cloudSongId: 0, uploaded: false, importable: true, cloudId };
    if (Number(item.upload) === 0) return { cloudSongId: 0, uploaded: false, already: true, cloudId };
  }

  const cleanName = String(params.fileName).replace(/\.[^.]+$/, '').replace(/[\s.]+/g, '_');
  const tokenBody = await weapi('/api/nos/token/alloc', {
    bucket: 'jd-musicrep-privatecloud-audio-public',
    ext,
    filename: cleanName,
    local: false,
    nos_product: 3,
    type: 'audio',
    md5: params.md5,
  });
  const result = tokenBody.result || {};
  if (!result.objectKey || !result.token) throw new ApiError('获取上传 token 失败：' + JSON.stringify(tokenBody).slice(0, 300), tokenBody);

  const mime = ext === 'flac' ? 'audio/flac' : ext === 'm4a' ? 'audio/mp4' : 'audio/mpeg';
  const uploadHost = await discoverUploadHost();
  const chunkSize = 4 * 1024 * 1024;
  let offset = 0;
  let context = null;
  while (offset < fileSize) {
    const end = Math.min(offset + chunkSize, fileSize);
    const complete = end >= fileSize;
    let uploadUrl = uploadHost + '/jd-musicrep-privatecloud-audio-public/' + encodeURIComponent(result.objectKey) + '?offset=' + offset + '&complete=' + String(complete) + '&version=1.0';
    if (context) uploadUrl += '&context=' + context;
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'x-nos-token': result.token, 'Content-MD5': params.md5, 'Content-Type': mime, 'Content-Length': String(end - offset) },
      body: buffer.subarray(offset, end),
      signal: AbortSignal.timeout(600000),
    });
    const text = await uploadResponse.text();
    if (!uploadResponse.ok) throw new ApiError('文件上传失败 HTTP ' + uploadResponse.status + '：' + text.slice(0, 200));
    if (complete) break;
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (error) {
      /* ignore */
    }
    if (!json || json.offset === undefined) throw new ApiError('上传分块没有返回 offset：' + text.slice(0, 200));
    offset = Number(json.offset);
    context = json.context || null;
  }

  // info/v2 可能先返回「正在转码」，轮询到成功；「音频解析失败」属于硬错误。
  let infoBody = null;
  const deadline = Date.now() + 120000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const info = await weapi('/api/upload/cloud/info/v2', {
        md5: params.md5,
        songid: cloudId,
        filename: params.fileName,
        song: meta.song || params.fileName,
        album: meta.album || '未知专辑',
        artist: meta.artist || '未知艺术家',
        bitrate: String(bitrateKbps),
        resourceId: result.resourceId,
      });
      if (Number(info.code) === 200) {
        infoBody = info;
        break;
      }
      const message = String(info.msg || info.message || '');
      if (message.includes('解析失败') || message.includes('rep create failed')) throw new ApiError('写入云盘信息失败：' + message, info);
      lastError = new ApiError('写入云盘信息失败：' + (message || info.code), info);
    } catch (error) {
      const message = String((error && error.message) || error);
      if (message.includes('解析失败') || message.includes('rep create failed')) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!infoBody) throw lastError || new ApiError('写入云盘信息超时（转码未完成）');

  let pub = null;
  const pubDeadline = Date.now() + 90000;
  let pubError = null;
  while (Date.now() < pubDeadline) {
    try {
      pub = await weapi('/api/cloud/pub/v2', { songid: infoBody.songId });
      const code = Number(pub.code);
      if (code === 200 || code === 201) break;
      pubError = new ApiError('发布云盘资源失败：' + (pub.msg || pub.message || code), pub);
    } catch (error) {
      pubError = error;
    }
    pub = null;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (!pub) throw pubError || new ApiError('发布云盘资源超时');
  const cloudSongId = Number((pub.privateCloud && pub.privateCloud.songId) || (infoBody.privateCloud && infoBody.privateCloud.simpleSong && infoBody.privateCloud.simpleSong.id) || infoBody.songId || 0);
  return { cloudSongId, uploaded: true };
}
