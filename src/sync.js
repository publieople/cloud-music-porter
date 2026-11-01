import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import * as netease from './core/netease.js';
import { downloadAudio, validateAudioFile } from './core/audio.js';
import { candidateLabel } from './core/matcher.js';
import { loadConfig, loadState, saveState, sleep, normalizeText, artistKey, fmtBytes, fmtDuration, shortStamp, safeFileName, md5Of, P } from './core/config.js';

const AUDIO_EXTS = new Set(['flac', 'mp3', 'm4a', 'aac', 'ogg', 'wav']);

export function buildCloudIndex(cloud) {
  const matchedIds = new Set();
  const matchedMap = new Map();
  const md5Map = new Map();
  const nameMap = new Map();
  const ids = new Set();
  for (const entry of cloud.entries) {
    if (entry.cloudSongId) ids.add(Number(entry.cloudSongId));
    if (entry.matchedSongId) {
      matchedIds.add(Number(entry.matchedSongId));
      matchedMap.set(Number(entry.matchedSongId), entry);
    }
    if (entry.md5) md5Map.set(entry.md5, entry);
    const key = normalizeText(entry.name);
    if (key) {
      if (!nameMap.has(key)) nameMap.set(key, new Set());
      nameMap.get(key).add(artistKey(entry.artist));
    }
  }
  return { matchedIds, matchedMap, md5Map, nameMap, ids, size: cloud.size, maxSize: cloud.maxSize, count: cloud.count };
}

export function findInCloud(index, song) {
  if (!song) return null;
  if (index.matchedIds.has(Number(song.id))) {
    const entry = index.matchedMap.get(Number(song.id));
    return { reason: 'matched', cloudSongId: entry ? entry.cloudSongId : 0 };
  }
  const key = normalizeText(song.name);
  const artists = index.nameMap.get(key);
  if (artists) {
    const wanted = artistKey(song.artists);
    for (const artist of artists) {
      if (!artist || !wanted) continue;
      if (artist === wanted || artist.includes(wanted) || wanted.includes(artist)) return { reason: 'name' };
    }
  }
  return null;
}

export function downloadNeeded(urlInfo) {
  if (!urlInfo) return { needed: true, reason: '没有播放地址信息', unknown: true };
  if (urlInfo.freeTrialInfo) return { needed: true, reason: '试听（VIP）', vip: true };
  if (!urlInfo.url) {
    const code = Number(urlInfo.code || 0);
    const unavailable = code === 404 || code === 403;
    return { needed: true, reason: unavailable ? '无音源（下架/无版权）' : '无音源', unavailable };
  }
  return { needed: false, reason: '可正常播放' };
}

export function parsePlaylistId(value) {
  if (!value) return 0;
  const match = /(?:playlist|toplist)[\/?].*?id=(\d+)/.exec(String(value)) || /id=(\d+)/.exec(String(value)) || /(\d{4,})/.exec(String(value));
  return match ? Number(match[1]) : 0;
}

export async function resolveTracks(opts) {
  const account = await netease.userAccount();
  if (opts.songIds && opts.songIds.length) {
    const { songs } = await netease.songDetails(opts.songIds);
    const tracks = opts.songIds.map((id) => songs.get(Number(id))).filter(Boolean).map(netease.songBrief);
    return { label: '指定歌曲 ' + opts.songIds.join(','), account, tracks };
  }
  if (opts.query) {
    const found = await netease.searchSongs(opts.query, { limit: opts.searchLimit || 10 });
    if (!found.length) throw new Error('搜索不到：' + opts.query);
    const best = found[0];
    return { label: '搜索 ' + opts.query + ' → ' + best.name + ' - ' + best.artists.join('/'), account, tracks: [best] };
  }
  if (opts.playlist) {
    const info = await netease.playlistInfo(opts.playlist);
    const { songs } = await netease.songDetails(info.trackIds);
    const tracks = info.trackIds.map((id) => songs.get(Number(id))).filter(Boolean).map(netease.songBrief);
    return { label: '歌单《' + info.name + '》（' + info.trackCount + ' 首）', account, tracks };
  }
  const list = await netease.userPlaylists(account.id);
  if (opts.all) {
    const ids = [];
    const seen = new Set();
    for (const playlist of list) {
      const info = await netease.playlistInfo(playlist.id);
      for (const id of info.trackIds) {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
      await sleep(150);
    }
    const { songs } = await netease.songDetails(ids);
    const tracks = ids.map((id) => songs.get(Number(id))).filter(Boolean).map(netease.songBrief);
    return { label: '我的全部歌单（去重后 ' + tracks.length + ' 首）', account, tracks };
  }
  const liked = list.find((playlist) => playlist.specialType === 5);
  if (!liked) throw new Error('找不到「我喜欢的音乐」歌单，请用 --playlist <id> 指定歌单');
  const info = await netease.playlistInfo(liked.id);
  const { songs } = await netease.songDetails(info.trackIds);
  const tracks = info.trackIds.map((id) => songs.get(Number(id))).filter(Boolean).map(netease.songBrief);
  return { label: '我喜欢的音乐（' + liked.trackCount + ' 首）', account, tracks };
}

export async function prepare(opts) {
  const cfg = loadConfig();
  const { label, account, tracks } = await resolveTracks(opts);
  console.log('歌单：' + label + '，取到 ' + tracks.length + ' 首');
  const cloud = await netease.cloudAll({});
  const index = buildCloudIndex(cloud);
  console.log(
    '云盘：' + cloud.count + ' 条 / ' + fmtBytes(cloud.size) + '（容量 ' + fmtBytes(cloud.maxSize) +
      (cloud.maxSize ? '，已用 ' + ((cloud.size / cloud.maxSize) * 100).toFixed(1) + '%' : '') + '）'
  );
  const urlMap = await netease.playUrls(tracks.map((song) => song.id));
  const rows = tracks.map((song) => {
    const urlInfo = urlMap.get(Number(song.id));
    return { song, urlInfo, need: downloadNeeded(urlInfo), inCloud: findInCloud(index, song) };
  });
  return { cfg, account, cloud, index, label, rows, tracks };
}

function statusText(row) {
  if (row.inCloud) {
    return row.inCloud.reason === 'matched' ? '云盘已匹配（列表可直接完整播放）' : '云盘有副本（未匹配，从云盘播放）';
  }
  if (row.need.unavailable) return '下架/无版权（默认跳过）';
  if (row.need.needed) return '待同步(' + row.need.reason + ')';
  return '可播放';
}

function isTargetRow(row) {
  return row.need.needed && !row.inCloud && !row.need.unavailable;
}

export function printRows(rows, opts) {
  const options = opts || {};
  let selected;
  if (options.vipOnly) {
    selected = rows.filter((row) => Number(row.song.fee) === 1 || row.need.vip || row.need.unavailable);
    const rank = (row) => (isTargetRow(row) ? 0 : row.need.unavailable ? 3 : row.inCloud && row.inCloud.reason !== 'matched' ? 1 : 2);
    selected = selected.slice().sort((a, b) => rank(a) - rank(b));
  } else if (options.allRows) {
    selected = rows;
  } else {
    selected = rows.filter((row) => isTargetRow(row) || (options.includeUnavailable && row.need.unavailable && !row.inCloud));
  }
  if (!selected.length) {
    console.log('（没有需要展示的歌曲）');
    return;
  }
  selected.forEach((row, index) => {
    const song = row.song;
    console.log(
      '  ' + String(index + 1).padStart(3, ' ') + '. ' + song.name + ' - ' + song.artists.join('/') +
        '  [' + fmtDuration(song.duration) + '] fee=' + song.fee + '  ' + statusText(row)
    );
  });
}

function resolveOutputPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

export async function scan(opts) {
  const prep = await prepare(opts);
  const needRows = prep.rows.filter((row) => row.need.needed);
  const vipRows = needRows.filter((row) => row.need.vip);
  const goneRows = needRows.filter((row) => row.need.unavailable);
  const targets = needRows.filter((row) => !row.inCloud && !row.need.unavailable);
  const feeVip = prep.rows.filter((row) => Number(row.song.fee) === 1);
  const feeVipMatched = feeVip.filter((row) => row.inCloud && row.inCloud.reason === 'matched');
  const feeVipCloudOnly = feeVip.filter((row) => row.inCloud && row.inCloud.reason !== 'matched');
  const feeVipMissing = feeVip.filter((row) => !row.inCloud);
  console.log(
    '统计：总 ' + prep.rows.length + ' 首；VIP 歌（fee=1）' + feeVip.length + ' 首 —— ' +
      '云盘已匹配（列表可直接完整播放）' + feeVipMatched.length + ' 首；' +
      '云盘有副本但列表仍试听 ' + feeVipCloudOnly.length + ' 首；' +
      '云盘没有 ' + feeVipMissing.length + ' 首'
  );
  console.log(
    '      当前列表项仍受试听限制 ' + vipRows.length + ' 首；下架/无版权 ' + goneRows.length + ' 首；待同步 ' + targets.length + ' 首' +
      (goneRows.length ? '（想尝试下架歌可加 --include-unavailable）' : '')
  );
  printRows(prep.rows, { allRows: opts.allRows, includeUnavailable: opts.includeUnavailable, vipOnly: opts.vipOnly });
  if (opts.json) {
    const out = {
      version: 1,
      generatedAt: Date.now(),
      label: prep.label,
      rows: prep.rows.map((row) => ({ song: row.song, need: row.need, inCloud: row.inCloud })),
    };
    const file = resolveOutputPath(opts.json);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n', 'utf8');
    console.log('扫描结果已写入：' + file);
  }
  return prep;
}

function estimateDuration(entry) {
  const bitrate = Number(entry.bitrate) || 0;
  const size = Number(entry.fileSize) || 0;
  if (!bitrate || !size) return 0;
  return (size * 8) / (bitrate * 1000);
}

function durationFits(entry, song) {
  const estimated = estimateDuration(entry);
  if (!estimated || !song.duration) return true;
  return Math.abs(estimated - song.duration) <= Math.max(8, song.duration * 0.05);
}

export async function matchExisting(opts) {
  let rows;
  let cloud;
  if (opts.from) {
    const file = resolveOutputPath(opts.from);
    if (!fs.existsSync(file)) throw new Error('找不到扫描结果文件：' + file);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    rows = data.rows || [];
    cloud = await netease.cloudAll({});
    console.log('歌单：' + (data.label || path.basename(file)) + '（来自扫描缓存 ' + rows.length + ' 首）');
    console.log('云盘：' + cloud.count + ' 条 / ' + fmtBytes(cloud.size));
  } else {
    const prep = await prepare(opts);
    rows = prep.rows;
    cloud = prep.cloud;
  }
  const byName = new Map();
  for (const entry of cloud.entries) {
    const key = normalizeText(entry.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(entry);
  }
  const trials = rows.filter((row) => row.need && row.need.vip);
  const pairs = [];
  let noCopy = 0;
  let alreadyMatched = 0;
  let durationSkip = 0;
  for (const row of trials) {
    const song = row.song;
    const wanted = artistKey(song.artists);
    const candidates = (byName.get(normalizeText(song.name)) || []).filter((entry) => {
      const artist = artistKey(entry.artist);
      return Boolean(artist && wanted && (artist.includes(wanted) || wanted.includes(artist)));
    });
    if (!candidates.length) { noCopy += 1; continue; }
    const unlinked = candidates.filter((entry) => !entry.matchedSongId);
    if (!unlinked.length) { alreadyMatched += 1; continue; }
    const good = unlinked.filter((entry) => durationFits(entry, song));
    if (!good.length) { durationSkip += 1; continue; }
    pairs.push({ row, song, candidate: good[0] });
  }
  console.log(
    '列表项仍受试听限制：' + trials.length + ' 首；云盘有同名副本且时长吻合 ' + pairs.length + ' 首' +
      '（另有 ' + noCopy + ' 首云盘无副本、' + alreadyMatched + ' 首已匹配过、' + durationSkip + ' 首同名但时长对不上，已跳过）'
  );
  if (!pairs.length) {
    console.log('没有需要匹配的歌。');
    return { matched: 0, failed: 0, noCopy, alreadyMatched, durationSkip };
  }
  const offset = opts.offset ? Number(opts.offset) : 0;
  const limit = opts.limit ? Number(opts.limit) : 0;
  const selected = pairs.slice(offset, limit ? offset + limit : undefined);
  if (selected.length !== pairs.length) {
    console.log('本次处理 ' + selected.length + ' 首（offset=' + offset + (limit ? ' limit=' + limit : '') + '）');
  }
  if (opts.dryRun) {
    for (const pair of selected) {
      const entry = pair.candidate;
      console.log(
        '  · ' + pair.song.name + '：候选云盘 ' + entry.cloudSongId + '「' + entry.fileName + '」' +
          ' 估算时长 ' + fmtDuration(Math.round(estimateDuration(entry))) + ' / 歌曲 ' + fmtDuration(pair.song.duration)
      );
    }
    return { dryRun: true, candidates: selected.length };
  }
  const account = await netease.userAccount();
  const matchedIds = [];
  let failed = 0;
  for (const pair of selected) {
    const song = pair.song;
    try {
      const body = await netease.cloudMatch({ userId: account.id, songId: pair.candidate.cloudSongId, adjustSongId: song.id });
      if (Number(body.code) === 200 && body.data !== false) {
        matchedIds.push(song.id);
        console.log('  ✓ ' + song.name + '：匹配成功（云盘 ' + pair.candidate.cloudSongId + ' → 歌曲 ' + song.id + '）');
      } else {
        failed += 1;
        console.log('  ✗ ' + song.name + '：匹配失败（code ' + body.code + '）');
      }
    } catch (error) {
      failed += 1;
      console.log('  ✗ ' + song.name + '：' + String(error.message).slice(0, 160));
    }
    await sleep(600);
  }
  if (matchedIds.length) {
    const map = await netease.playUrls(matchedIds);
    const bad = matchedIds.filter((id) => {
      const info = map.get(Number(id));
      return !info || !info.url || info.freeTrialInfo;
    });
    console.log('验证：' + (matchedIds.length - bad.length) + '/' + matchedIds.length + ' 首已可直接完整播放' + (bad.length ? '；仍不可播：' + bad.join(',') : ''));
  }
  console.log('完成：匹配成功 ' + matchedIds.length + ' 首，失败 ' + failed + ' 首，云盘无副本 ' + noCopy + ' 首，已匹配过 ' + alreadyMatched + ' 首，时长不符 ' + durationSkip + ' 首');
  return { matched: matchedIds.length, failed, noCopy, alreadyMatched, durationSkip };
}

function parseImportCloudId(body) {
  const data = (body && body.data) || body || {};
  const successSongs = data.successSongs || [];
  if (successSongs.length) {
    const item = successSongs[0];
    const song = (item.song && item.song.simpleSong) || (item.song && item.song) || {};
    if (song.id) return Number(song.id);
    if (item.songId) return Number(item.songId);
  }
  const ids = data.successIds || data.songIds || [];
  if (ids.length) return Number(ids[0]);
  return 0;
}

function buildFileName(song, ext) {
  const artist = (song.artists || []).join('/') || '未知艺术家';
  return safeFileName(song.name) + ' - ' + safeFileName(artist) + '.' + (ext || 'mp3');
}

function bitrateParamFor(probe) {
  const codec = String(probe.codec || '').toLowerCase();
  if (codec === 'flac' || codec === 'alac' || codec === 'wav') return 999;
  const bitrate = Number(probe.bitrate) || 320000;
  return Math.max(128, Math.round(bitrate / 1000));
}

async function verifyCloud(cloudSongId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const map = await netease.playUrls([cloudSongId]);
      const info = map.get(Number(cloudSongId));
      if (info && info.url && !info.freeTrialInfo) return { ok: true, size: info.size, br: info.br, md5: info.md5, attempt: attempt + 1 };
    } catch (error) {
      /* ignore */
    }
    await sleep(1500);
  }
  return { ok: false };
}

function finish(ctx, song, result) {
  const state = ctx.state;
  const id = String(song.id);
  const base = { songId: Number(song.id), name: song.name, artists: song.artists, album: song.album, duration: song.duration, time: Date.now() };
  const merged = { ...base, ...result };
  if (result.status === 'skipped') {
    console.log('    ⏸ 跳过：' + (result.reason || ''));
    return merged;
  }
  if (result.status === 'failed') {
    const previousAttempts = (state.failed[id] && state.failed[id].attempts) || 0;
    state.failed[id] = { name: song.name, artists: song.artists, reason: result.reason, time: Date.now(), attempts: previousAttempts + 1 };
    console.log('    ✗ 失败：' + result.reason);
  } else {
    state.imported[id] = merged;
    if (state.failed[id]) delete state.failed[id];
    const verifyText = result.verify ? (result.verify.ok ? '，验证可播 ' + fmtBytes(result.verify.size) : '，⚠ 暂未验证到可播放') : '';
    const actionText = result.status === 'imported' ? '秒传导入' : result.status === 'uploaded' ? '上传完成' : '云盘已有';
    console.log('    ✓ ' + actionText + ' → 云盘 songId ' + (result.cloudSongId || '?') + verifyText);
  }
  return merged;
}

async function tryMatch(ctx, cloudSongId, song) {
  if (!cloudSongId) return { ok: false, reason: 'no-cloud-id' };
  try {
    if (!ctx.account) ctx.account = await netease.userAccount();
    const body = await netease.cloudMatch({ userId: ctx.account.id, songId: cloudSongId, adjustSongId: song.id });
    return { ok: Number(body.code) === 200 && body.data !== false, code: body.code };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function finalizeCloud(ctx, song, result) {
  if (!result.cloudSongId || result.status === 'failed' || result.status === 'skipped') return result;
  const match = await tryMatch(ctx, result.cloudSongId, song);
  if (match.ok) console.log('    ✓ 已匹配到歌曲本体（歌单里可直接完整播放）');
  else if (match.error && !/不支持匹配|400/.test(match.error)) console.log('    · 匹配未成功（不影响云盘播放）：' + String(match.error).slice(0, 120));
  else console.log('    · 这首不支持匹配（不影响云盘播放）');
  return { ...result, match };
}

async function importOrUpload(ctx, song, local, opts) {
  const cfg = ctx.cfg;
  const check = await netease.cloudCheck({ md5: local.md5, fileSize: local.size, bitrate: local.bitrateParam, songId: song.id });
  if (check.upload === 0) {
    const existing = ctx.index.md5Map.get(local.md5);
    console.log('    ✓ 云盘已有这个文件，跳过' + (existing ? '（云盘 songId ' + existing.cloudSongId + '）' : '（按 md5 命中）'));
    return finish(ctx, song, { status: 'already', cloudSongId: existing ? existing.cloudSongId : 0, md5: local.md5, size: local.size, quality: local.quality, source: local.source, bitrateParam: local.bitrateParam });
  }
  if (ctx.budget && ctx.budget.limit && ctx.budget.used + local.size > ctx.budget.limit) {
    ctx.budget.stop = true;
    return finish(ctx, song, { status: 'skipped', reason: '容量预算不足（本次已写 ' + fmtBytes(ctx.budget.used) + '，上限 ' + fmtBytes(ctx.budget.limit) + '）' });
  }
  const fileName = buildFileName(song, local.ext);
  if (check.upload === 1) {
    const imported = await netease.cloudImport({
      checkSongId: check.songId,
      bitrate: local.bitrateParam,
      song: song.name,
      artist: song.artists.join('/'),
      album: song.album,
      fileName,
    });
    const cloudSongId = parseImportCloudId(imported);
    if (!cloudSongId) throw new Error('导入返回里没有云盘歌曲 id：' + JSON.stringify(imported).slice(0, 300));
    const verify = await verifyCloud(cloudSongId);
    return finish(ctx, song, await finalizeCloud(ctx, song, { status: 'imported', cloudSongId, md5: local.md5, size: local.size, quality: local.quality, source: local.source, verify, bitrateParam: local.bitrateParam }));
  }
  const uploaded = await netease.cloudUploadFile({
    filePath: local.filePath,
    md5: local.md5,
    ext: local.ext,
    fileName,
    meta: { song: song.name, artist: song.artists.join('/'), album: song.album },
    bitrateParam: local.bitrateParam,
    cloudId: check.songId,
  });
  if (uploaded.importable) {
    console.log('    · 上传前检查发现资源已在网易云，改用秒传导入');
    const imported = await netease.cloudImport({ checkSongId: uploaded.cloudId, bitrate: local.bitrateParam, song: song.name, artist: song.artists.join('/'), album: song.album, fileName });
    const cloudSongId = parseImportCloudId(imported);
    if (!cloudSongId) throw new Error('导入返回里没有云盘歌曲 id：' + JSON.stringify(imported).slice(0, 300));
    const verify = await verifyCloud(cloudSongId);
    return finish(ctx, song, await finalizeCloud(ctx, song, { status: 'imported', cloudSongId, md5: local.md5, size: local.size, quality: local.quality, source: local.source, verify, bitrateParam: local.bitrateParam }));
  }
  if (uploaded.already) {
    const existing = ctx.index.md5Map.get(local.md5);
    console.log('    ✓ 云盘已有这个文件，跳过');
    return finish(ctx, song, { status: 'already', cloudSongId: existing ? existing.cloudSongId : 0, md5: local.md5, size: local.size, quality: local.quality, source: local.source, bitrateParam: local.bitrateParam });
  }
  const verify = await verifyCloud(uploaded.cloudSongId);
  if (!verify.ok) return finish(ctx, song, { status: 'failed', reason: '上传后仍不可播放（云盘 songId ' + uploaded.cloudSongId + '）' });
  return finish(ctx, song, await finalizeCloud(ctx, song, { status: 'uploaded', cloudSongId: uploaded.cloudSongId, md5: local.md5, size: local.size, quality: local.quality, source: local.source, verify, bitrateParam: local.bitrateParam }));
}

async function syncOne(ctx, song, opts) {
  const cfg = ctx.cfg;
  const quality = opts.quality || cfg.quality || 'flac';
  const tempFiles = [];
  try {
    console.log('  · 搜索候选：' + song.name + ' - ' + song.artists.join('/') + '（' + fmtDuration(song.duration) + '）');
    const candidates = await ctx.sources.search(song, { limit: 8 });
    if (!candidates.length) return finish(ctx, song, { status: 'failed', reason: '没有搜到候选（检查 MusicFree 插件是否已安装、名称是否准确）' });
    candidates.slice(0, 3).forEach((candidate, index) => {
      console.log('    ' + (index + 1) + ') ' + candidate.label + '  [' + (candidate.pluginPlatform || '?') + '] 分数 ' + candidate.score);
    });
    let local = null;
    const errors = [];
    for (const candidate of candidates.slice(0, 3)) {
      let resolved;
      try {
        resolved = await ctx.sources.resolve(song, candidate, { quality, mode: opts.sourceMode });
      } catch (error) {
        errors.push(candidate.label + '：' + String(error.message || error).slice(0, 140));
        continue;
      }
      try {
        const downloaded = await downloadAudio(resolved.url, { headers: resolved.headers, preferredExt: 'mp3' });
        tempFiles.push(downloaded.filePath);
        const probe = validateAudioFile(downloaded.filePath, {
          minBytes: cfg.minAudioBytes,
          expectedDuration: song.duration,
          ffprobePath: cfg.ffprobePath,
          skipProbe: opts.skipProbe,
        });
        if (!probe.ok) {
          errors.push(candidate.label + '：' + probe.reason);
          continue;
        }
        local = {
          filePath: downloaded.filePath,
          md5: downloaded.md5,
          size: downloaded.size,
          ext: probe.ext || downloaded.ext,
          quality: resolved.quality,
          source: resolved.source,
          sourceLabel: resolved.sourceLabel,
          bitrateParam: bitrateParamFor(probe),
          probe,
        };
        console.log(
          '    ✓ ' + resolved.sourceLabel + ' ' + String(resolved.quality).toUpperCase() + ' ' + fmtBytes(local.size) +
            ' md5=' + local.md5 + (probe.warning ? '（' + probe.warning + '）' : '')
        );
        if (probe.duration && song.duration && Math.abs(probe.duration - song.duration) > 15) {
          console.log('    ⚠ 音源时长 ' + fmtDuration(probe.duration) + ' 与歌曲 ' + fmtDuration(song.duration) + ' 相差较大，可能匹配错歌');
        }
        break;
      } catch (error) {
        errors.push(candidate.label + '：' + String(error.message || error).slice(0, 140));
      }
    }
    if (!local) return finish(ctx, song, { status: 'failed', reason: '没有可用的音源：' + errors.slice(0, 3).join('；') });
    return await importOrUpload(ctx, song, local, opts);
  } catch (error) {
    return finish(ctx, song, { status: 'failed', reason: error.message });
  } finally {
    for (const file of tempFiles) {
      try {
        fs.rmSync(file, { force: true });
      } catch (error) {
        /* ignore */
      }
    }
  }
}

async function confirm(question) {
  if (!process.stdin.isTTY) {
    console.log('非交互环境，未加 --yes 时默认取消：' + question);
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question + ' [y/N] ');
    return /^y(es)?/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function writeReport(prep, results, opts) {
  fs.mkdirSync(P.runs, { recursive: true });
  const file = path.join(P.runs, 'run-' + shortStamp() + '.json');
  const summary = {
    imported: results.filter((item) => item.status === 'imported').length,
    uploaded: results.filter((item) => item.status === 'uploaded').length,
    already: results.filter((item) => item.status === 'already').length,
    skipped: results.filter((item) => item.status === 'skipped').length,
    failed: results.filter((item) => item.status === 'failed').length,
  };
  const report = { startedAt: prep.startedAt, finishedAt: Date.now(), label: prep.label, quality: opts.quality || prep.cfg.quality, summary, results };
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return { file, summary };
}

export async function sync(opts) {
  const startedAt = Date.now();
  const cfg = loadConfig();
  let prep;
  if (opts.from) {
    const file = resolveOutputPath(opts.from);
    if (!fs.existsSync(file)) throw new Error('找不到扫描结果文件：' + file);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const cloud = await netease.cloudAll({});
    const index = buildCloudIndex(cloud);
    prep = { cfg, cloud, index, label: data.label || path.basename(file), rows: data.rows, tracks: data.rows.map((row) => row.song) };
    console.log('歌单：' + prep.label + '（来自扫描缓存 ' + data.rows.length + ' 首）');
    console.log('云盘：' + cloud.count + ' 条 / ' + fmtBytes(cloud.size) + (cloud.maxSize ? '（容量 ' + fmtBytes(cloud.maxSize) + '）' : ''));
  } else {
    prep = await prepare(opts);
  }
  prep.startedAt = startedAt;
  const needRows = prep.rows.filter((row) => row.need.needed);
  const goneRows = needRows.filter((row) => row.need.unavailable);
  const allTargets = needRows.filter((row) => !row.inCloud && (opts.includeUnavailable || !row.need.unavailable));
  const offset = opts.offset ? Number(opts.offset) : 0;
  const limit = opts.limit ? Number(opts.limit) : 0;
  const targets = allTargets.slice(offset, limit ? offset + limit : undefined);
  console.log('待同步：' + allTargets.length + ' 首' + (targets.length !== allTargets.length ? '，本次处理 ' + targets.length + ' 首（offset=' + offset + (limit ? ' limit=' + limit : '') + '）' : ''));

  if (opts.dryRun) {
    printRows(targets, { allRows: true });
    return { dryRun: true, targets: targets.length };
  }
  if (!targets.length) {
    console.log('没有需要同步的歌曲，云盘已覆盖。');
    return { synced: 0 };
  }
  const cloud = prep.cloud;
  if (cloud.maxSize && cloud.size > cloud.maxSize * (cfg.cloudWarnRatio || 0.9)) {
    throw new Error('云盘剩余容量不足（已用 ' + fmtBytes(cloud.size) + ' / ' + fmtBytes(cloud.maxSize) + '），请先清理云盘或调高 config.json 的 cloudWarnRatio');
  }
  const freeBytes = cloud.maxSize ? Math.max(0, cloud.maxSize - cloud.size) : 0;
  const maxGb = opts.maxGb ? Number(opts.maxGb) : 0;
  const budgetLimit = maxGb > 0 ? Math.floor(maxGb * 1024 ** 3) : freeBytes ? Math.floor(freeBytes * 0.95) : 0;
  const budget = { limit: budgetLimit, used: 0, stop: false };
  if (budgetLimit) {
    console.log('容量预算：本次最多再写 ' + fmtBytes(budgetLimit) + (maxGb ? '（--max-gb ' + maxGb + '）' : '（云盘剩余 ' + fmtBytes(freeBytes) + ' 的 95%）'));
  }
  if (goneRows.length && !opts.includeUnavailable) console.log('另有 ' + goneRows.length + ' 首下架/无版权，默认跳过（--include-unavailable 可尝试）');
  if (!opts.yes) {
    const ok = await confirm('即将把 ' + targets.length + ' 首歌同步到云盘，继续吗？');
    if (!ok) {
      console.log('已取消。');
      return { synced: 0, cancelled: true };
    }
  }

  const sources = await ctxSources(opts, cfg);
  const state = loadState();
  const ctx = { ...prep, cfg, state, budget, sources };
  const results = [];
  for (let i = 0; i < targets.length; i += 1) {
    const row = targets[i];
    if (!opts.force && state.imported[String(row.song.id)]) {
      const record = state.imported[String(row.song.id)];
      const stillInCloud = record && record.cloudSongId
        ? ctx.index.ids.has(Number(record.cloudSongId)) || ctx.index.matchedIds.has(Number(row.song.id))
        : true;
      if (stillInCloud) {
        console.log('(' + String(i + 1) + '/' + String(targets.length) + ') ' + row.song.name + ' - 已同步过，跳过');
        results.push({ status: 'skipped', songId: Number(row.song.id), name: row.song.name, reason: '本地记录已同步' });
        continue;
      }
      console.log('    · 本地记录说同步过，但云盘里已找不到它了，重新导入');
    }
    console.log('(' + String(i + 1) + '/' + String(targets.length) + ') ' + row.song.name + ' - ' + row.song.artists.join('/'));
    const result = await syncOne(ctx, row.song, opts);
    results.push(result);
    if ((result.status === 'imported' || result.status === 'uploaded') && result.size) budget.used += result.size;
    saveState(state);
    if (result.status === 'skipped') {
      console.log('    容量预算已用尽，结束本次同步（下次可继续）。');
      break;
    }
    if (i + 1 < targets.length) await sleep(Number(opts.delayMs || cfg.delayMs || 800));
  }
  const { file, summary } = writeReport(prep, results, opts);
  state.runs.unshift({ time: startedAt, label: prep.label, total: results.length, imported: summary.imported + summary.uploaded, already: summary.already, failed: summary.failed, report: file });
  state.runs = state.runs.slice(0, 100);
  saveState(state);
  console.log(
    '完成：新增 ' + (summary.imported + summary.uploaded) + ' 首，已在云盘 ' + summary.already + ' 首' +
      (summary.skipped ? '，跳过 ' + summary.skipped + ' 首（已同步过或容量不足）' : '') +
      '，失败 ' + summary.failed + ' 首；报告：' + file
  );
  return { synced: summary.imported + summary.uploaded, ...summary, report: file };
}

let cachedSources = null;
async function ctxSources(opts, cfg) {
  if (opts.sources) return opts.sources;
  if (cachedSources) return cachedSources;
  const { createSourceManager } = await import('./sources/index.js');
  cachedSources = await createSourceManager(cfg);
  return cachedSources;
}

// 导入本地音频文件（用户自己合法拥有的文件）：按「歌名 - 歌手」文件名匹配网易云曲库后送进云盘。
export async function importDir(opts) {
  const dir = path.resolve(opts.dir || '.');
  if (!fs.existsSync(dir)) throw new Error('目录不存在：' + dir);
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (opts.recursive !== false) walk(full);
        continue;
      }
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      if (AUDIO_EXTS.has(ext)) files.push(full);
    }
  };
  walk(dir);
  if (!files.length) throw new Error('目录里没有音频文件（支持 ' + [...AUDIO_EXTS].join('/') + '）：' + dir);
  console.log('找到 ' + files.length + ' 个音频文件：' + dir);
  const cfg = loadConfig();
  const cloud = await netease.cloudAll({});
  const index = buildCloudIndex(cloud);
  console.log('云盘：' + cloud.count + ' 条 / ' + fmtBytes(cloud.size));
  const state = loadState();
  const freeBytes = cloud.maxSize ? Math.max(0, cloud.maxSize - cloud.size) : 0;
  const budget = { limit: opts.maxGb ? Math.floor(Number(opts.maxGb) * 1024 ** 3) : freeBytes ? Math.floor(freeBytes * 0.95) : 0, used: 0, stop: false };
  const ctx = { cfg, cloud, index, state, budget, account: null };
  const results = [];
  const targets = opts.limit ? files.slice(0, Number(opts.limit)) : files;
  for (let i = 0; i < targets.length; i += 1) {
    const file = targets[i];
    const base = path.basename(file, path.extname(file));
    const parts = base.split(' - ');
    const guessName = (parts.length > 1 ? parts[0] : base).trim();
    const guessArtist = parts.length > 1 ? parts[1].trim() : '';
    console.log('(' + (i + 1) + '/' + targets.length + ') ' + path.basename(file) + ' → 匹配「' + guessName + '」' + (guessArtist ? ' / ' + guessArtist : ''));
    try {
      const probe = validateAudioFile(file, { minBytes: cfg.minAudioBytes, ffprobePath: cfg.ffprobePath });
      if (!probe.ok) throw new Error('文件不是有效音频：' + probe.reason);
      const found = await netease.searchSongs([guessName, guessArtist].filter(Boolean).join(' '), { limit: 5 });
      if (!found.length) throw new Error('网易云曲库搜不到这首歌');
      const song = found[0];
      const md5 = md5Of(fs.readFileSync(file));
      const local = { filePath: file, md5, size: probe.size, ext: probe.ext, quality: 'local', source: 'local', probe, bitrateParam: bitrateParamFor(probe) };
      console.log('    匹配到：' + song.name + ' - ' + song.artists.join('/') + '（歌曲 id ' + song.id + '）');
      if (opts.dryRun) {
        const check = await netease.cloudCheck({ md5, fileSize: probe.size, bitrate: local.bitrateParam, songId: song.id });
        const action = check.upload === 0 ? '云盘已有，会跳过' : check.upload === 1 ? '会秒传导入（不传字节）' : '会真上传 ' + fmtBytes(probe.size);
        console.log('    演练：' + action + '（未写入云盘）');
        results.push({ status: 'dry-run', file, name: song.name, action });
        await sleep(Number(cfg.delayMs || 800));
        continue;
      }
      const result = await importOrUpload(ctx, song, local, opts);
      results.push(result);
      if ((result.status === 'imported' || result.status === 'uploaded') && result.size) budget.used += result.size;
      saveState(state);
      if (result.status === 'skipped') {
        console.log('    容量预算已用尽，结束本次导入。');
        break;
      }
    } catch (error) {
      console.log('    ✗ 失败：' + error.message);
      results.push({ status: 'failed', file, name: base, reason: error.message });
    }
    await sleep(Number(cfg.delayMs || 800));
  }
  const summary = {
    imported: results.filter((item) => item.status === 'imported').length,
    uploaded: results.filter((item) => item.status === 'uploaded').length,
    already: results.filter((item) => item.status === 'already').length,
    skipped: results.filter((item) => item.status === 'skipped').length,
    failed: results.filter((item) => item.status === 'failed').length,
  };
  const dryRunCount = results.filter((item) => item.status === 'dry-run').length;
  console.log('完成：新增 ' + (summary.imported + summary.uploaded) + ' 首，已在云盘 ' + summary.already + ' 首，失败 ' + summary.failed + ' 首' + (dryRunCount ? '，演练 ' + dryRunCount + ' 首（未写入）' : ''));
  return summary;
}
