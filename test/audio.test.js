import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sizeLooksLikeTrial, validateAudioFile } from '../src/core/audio.js';

function tmpFile(name, buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmporter-test-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, buffer);
  return { dir, file };
}

test('sizeLooksLikeTrial 用大小粗判试听片段', () => {
  assert.equal(sizeLooksLikeTrial(481115, 294), true);
  assert.equal(sizeLooksLikeTrial(11786493, 294), false);
  assert.equal(sizeLooksLikeTrial(0, 294), false);
  assert.equal(sizeLooksLikeTrial(1000, 0), false);
});

test('validateAudioFile: 文件不存在/为空/太小', () => {
  assert.equal(validateAudioFile(path.join(os.tmpdir(), 'cmporter-none-' + Date.now())).ok, false);
  const empty = tmpFile('empty.flac', Buffer.alloc(0));
  assert.equal(validateAudioFile(empty.file).reason, '文件为空');
  const tiny = tmpFile('tiny.flac', Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(20)]));
  assert.equal(validateAudioFile(tiny.file, { minBytes: 102400 }).ok, false);
});

test('validateAudioFile: 试听片段会被拦下', () => {
  const { file } = tmpFile('trial.mp3', Buffer.concat([Buffer.from('ID3'), Buffer.alloc(400000)]));
  const result = validateAudioFile(file, { expectedDuration: 294, skipProbe: true });
  assert.equal(result.ok, false);
  assert.equal(result.trial, true);
});

test('validateAudioFile: 识别不了的格式会被拒', () => {
  const { file } = tmpFile('noise.bin', Buffer.alloc(200000, 7));
  assert.equal(validateAudioFile(file, { skipProbe: true }).ok, false);
});

test('validateAudioFile: 合法 FLAC 在 skipProbe 下通过并算出 md5', () => {
  const body = Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(300000, 1)]);
  const { file } = tmpFile('good.flac', body);
  const result = validateAudioFile(file, { minBytes: 1024, skipProbe: true });
  assert.equal(result.ok, true);
  assert.equal(result.ext, 'flac');
  assert.equal(result.size, body.length);
  assert.match(result.md5, /^[0-9a-f]{32}$/);
});
