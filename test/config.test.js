import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeText,
  splitArtists,
  artistKey,
  artistSet,
  fmtBytes,
  fmtDuration,
  safeFileName,
  detectExtFromBuffer,
  md5Of,
  parseDuration,
  countBy,
} from '../src/core/config.js';

test('normalizeText 统一全半角、去空白与标点', () => {
  assert.equal(normalizeText('布拉格广场 (Live)'), '布拉格广场live');
  assert.equal(normalizeText('  Hello, World!  '), 'helloworld');
  assert.equal(normalizeText('ＦＵＮＫ'), 'funk');
  assert.equal(normalizeText(null), '');
  assert.equal(normalizeText(undefined), '');
});

test('splitArtists 拆分多艺人与 feat', () => {
  assert.deepEqual(splitArtists('蔡依林/周杰伦'), ['蔡依林', '周杰伦']);
  assert.deepEqual(splitArtists(['A', 'B']), ['A', 'B']);
  assert.deepEqual(splitArtists('周杰伦 feat. 杨瑞代'), ['周杰伦']);
  assert.deepEqual(splitArtists(''), []);
});

test('artistKey / artistSet', () => {
  assert.equal(artistKey('蔡依林/周杰伦'), '蔡依林');
  assert.equal(artistKey(['YOASOBI']), 'yoasobi');
  assert.deepEqual([...artistSet('A/B')].sort(), ['a', 'b']);
});

test('fmtBytes', () => {
  assert.equal(fmtBytes(0), '0 B');
  assert.equal(fmtBytes(512), '512 B');
  assert.equal(fmtBytes(1536), '1.5 KB');
  assert.equal(fmtBytes(17179869184), '16.0 GB');
});

test('fmtDuration', () => {
  assert.equal(fmtDuration(0), '0:00');
  assert.equal(fmtDuration(294.6), '4:55');
  assert.equal(fmtDuration(3661), '61:01');
});

test('safeFileName 去掉非法字符并截断', () => {
  assert.equal(safeFileName('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
  assert.equal(safeFileName('  '), 'audio');
  assert.equal(safeFileName('x'.repeat(300)).length, 160);
});

test('detectExtFromBuffer 识别常见音频文件头', () => {
  const pad = (head) => Buffer.concat([Buffer.from(head), Buffer.alloc(16)]);
  assert.equal(detectExtFromBuffer(pad('fLaC')), 'flac');
  assert.equal(detectExtFromBuffer(pad('ID3')), 'mp3');
  assert.equal(detectExtFromBuffer(Buffer.from('fffb00000000000000000000', 'hex')), 'mp3');
  assert.equal(detectExtFromBuffer(pad('\u0000\u0000\u0000\u0000ftyp')), 'm4a');
  assert.equal(detectExtFromBuffer(pad('OggS')), 'ogg');
  assert.equal(detectExtFromBuffer(pad('RIFF\u0000\u0000\u0000\u0000WAVE')), 'wav');
  assert.equal(detectExtFromBuffer(Buffer.from('not-audio-file')), '');
  assert.equal(detectExtFromBuffer(Buffer.from('abc')), '');
});

test('md5Of', () => {
  assert.equal(md5Of(Buffer.from('abc')), '900150983cd24fb0d6963f7d28e17f72');
});

test('parseDuration 支持秒/毫秒/mm:ss', () => {
  assert.equal(parseDuration(294), 294);
  assert.equal(parseDuration(294600), 295);
  assert.equal(parseDuration('4:54'), 294);
  assert.equal(parseDuration('04:54'), 294);
  assert.equal(parseDuration('0'), 0);
  assert.equal(parseDuration('abc'), 0);
  assert.equal(parseDuration(null), 0);
});

test('countBy', () => {
  assert.deepEqual(countBy([{ a: 1 }, { a: 1 }, { a: 2 }], 'a'), { 1: 2, 2: 1 });
});
