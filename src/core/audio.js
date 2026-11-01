import fs from 'node:fs';
import path from 'node:path';
import { P, ensureDirs, md5Of, detectExtFromBuffer, probeAudio } from './config.js';

export const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function downloadAudio(url, options) {
  const opts = options || {};
  ensureDirs();
  const headers = { 'User-Agent': DEFAULT_UA, ...(opts.headers || {}) };
  const response = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(opts.timeoutMs || 600000) });
  if (!response.ok) throw new Error('下载失败 HTTP ' + response.status);
  const length = Number(response.headers.get('content-length') || 0);
  if (opts.maxBytes && length && length > opts.maxBytes) throw new Error('文件过大：' + length + ' 字节');
  const buffer = Buffer.from(await response.arrayBuffer());
  const ext = detectExtFromBuffer(buffer) || opts.preferredExt || 'mp3';
  const filePath = path.join(P.tmp, 'dl-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8) + '.' + ext);
  fs.writeFileSync(filePath, buffer);
  return { filePath, size: buffer.length, md5: md5Of(buffer), ext, contentType: response.headers.get('content-type') || '' };
}

// 用「文件大小 vs 歌曲时长」粗判 30 秒试听：即使 64kbps 也远大于试听片段。
export function sizeLooksLikeTrial(size, durationSeconds) {
  const duration = Number(durationSeconds) || 0;
  if (!duration || !size) return false;
  return Number(size) < duration * 8000;
}

export function validateAudioFile(filePath, options) {
  const opts = options || {};
  if (!fs.existsSync(filePath)) return { ok: false, reason: '文件不存在' };
  const stat = fs.statSync(filePath);
  if (!stat.size) return { ok: false, reason: '文件为空' };
  if (opts.minBytes && stat.size < opts.minBytes) return { ok: false, reason: '文件太小（' + stat.size + ' 字节），可能不是完整音频' };
  if (sizeLooksLikeTrial(stat.size, opts.expectedDuration)) {
    return { ok: false, reason: '文件大小 ' + stat.size + ' 字节明显小于歌曲时长所需，可能是试听片段', trial: true };
  }
  const head = Buffer.alloc(Math.min(16, stat.size));
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, head, 0, head.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  const ext = detectExtFromBuffer(head);
  if (!ext) return { ok: false, reason: '无法识别的音频格式（文件头不是 mp3/flac/m4a/ogg/wav）' };
  const md5 = md5Of(fs.readFileSync(filePath));
  const probe = opts.skipProbe ? { available: false, skipped: true } : probeAudio(filePath, { ffprobePath: opts.ffprobePath });
  const result = { ok: true, reason: '', ext, size: stat.size, md5, probe };
  if (probe.available && probe.ok) {
    result.duration = probe.duration;
    result.bitrate = probe.bitrate;
    result.codec = probe.codec;
    if (opts.expectedDuration && opts.durationTolerance) {
      const diff = Math.abs(probe.duration - opts.expectedDuration);
      if (diff > opts.durationTolerance) {
        result.warning = '音源时长 ' + Math.round(probe.duration) + ' 秒与歌曲 ' + opts.expectedDuration + ' 秒相差 ' + Math.round(diff) + ' 秒，可能匹配错歌';
      }
    }
  } else if (probe.available && !probe.ok) {
    return { ok: false, reason: 'ffprobe 无法解析音频：' + probe.error };
  }
  return result;
}
