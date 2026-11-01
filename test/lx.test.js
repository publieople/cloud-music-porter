import test from 'node:test';
import assert from 'node:assert/strict';
import {
  qualityChain,
  lxPlatformForPlugin,
  guessLxPlatform,
  buildLxMusicInfo,
  lxSourceLabel,
  normalizeSongName,
} from '../src/sources/lx.js';

test('qualityChain 音质降级顺序', () => {
  assert.deepEqual(qualityChain('flac'), ['flac', 'flac24bit', '320k', '128k']);
  assert.deepEqual(qualityChain('320k'), ['320k', '128k']);
  assert.deepEqual(qualityChain('128k'), ['128k']);
  assert.deepEqual(qualityChain('master'), ['master', '320k', '128k']);
});

test('lxPlatformForPlugin 从插件名映射平台', () => {
  assert.equal(lxPlatformForPlugin('酷我音乐'), 'kw');
  assert.equal(lxPlatformForPlugin('kuwo'), 'kw');
  assert.equal(lxPlatformForPlugin('元力KW'), 'kw');
  assert.equal(lxPlatformForPlugin('酷狗音乐'), 'kg');
  assert.equal(lxPlatformForPlugin('网易云'), 'wy');
  assert.equal(lxPlatformForPlugin('QQ音乐'), 'tx');
  assert.equal(lxPlatformForPlugin('咪咕音乐'), 'mg');
  assert.equal(lxPlatformForPlugin('bilibili'), '');
  assert.equal(lxPlatformForPlugin(''), '');
});

test('guessLxPlatform 按候选字段猜平台', () => {
  assert.equal(guessLxPlatform({ songmid: 'x' }), 'tx');
  assert.equal(guessLxPlatform({ hash: 'x' }), 'kg');
  assert.equal(guessLxPlatform({ sqhash: 'x' }), 'kg');
  assert.equal(guessLxPlatform({ copyrightId: 'x' }), 'mg');
  assert.equal(guessLxPlatform({ albumId: 1, artistId: 2, id: 3 }), 'kw');
  assert.equal(guessLxPlatform({}), '');
  assert.equal(guessLxPlatform(null), '');
});

test('buildLxMusicInfo 按平台填字段', () => {
  const song = { name: '布拉格广场', artists: ['蔡依林', '周杰伦'], album: '看我72变', duration: 294 };
  const base = buildLxMusicInfo('kw', { id: 160911 }, song, 'flac');
  assert.equal(base.songmid, '160911');
  assert.equal(base.singer, '蔡依林、周杰伦');
  assert.equal(base.albumName, '看我72变');
  assert.equal(base.interval, '04:54');
  assert.equal(base.source, 'kw');

  assert.equal(buildLxMusicInfo('kg', { sqhash: 'SQ', '320hash': 'H320', hash: 'H' }, song, 'flac').hash, 'SQ');
  assert.equal(buildLxMusicInfo('kg', { sqhash: 'SQ', '320hash': 'H320', hash: 'H' }, song, '320k').hash, 'H320');
  assert.equal(buildLxMusicInfo('kg', { hash: 'H' }, song, '128k').hash, 'H');
  assert.equal(buildLxMusicInfo('tx', { songmid: '002Q' }, song, 'flac').songmid, '002Q');
  assert.equal(buildLxMusicInfo('wy', { id: 123 }, song, 'flac').id, '123');
  assert.equal(buildLxMusicInfo('mg', { copyrightId: 'CID' }, song, 'flac').copyrightId, 'CID');
});

test('lxSourceLabel', () => {
  assert.equal(lxSourceLabel({ name: '聚合API接口 (CF)', version: '1.2.0' }), '聚合API接口 (CF) v1.2.0');
  assert.equal(lxSourceLabel({ name: 'Huibq_lxmusic源' }), 'Huibq_lxmusic源');
});

test('normalizeSongName 与 normalizeText 一致', () => {
  assert.equal(normalizeSongName('群青 (Live)'), '群青live');
});
