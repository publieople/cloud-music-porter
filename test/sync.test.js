import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCloudIndex, findInCloud, downloadNeeded, parsePlaylistId } from '../src/sync.js';

const cloud = {
  count: 3,
  size: 1000,
  maxSize: 2000,
  entries: [
    { cloudSongId: 630000000001, matchedSongId: 1472480890, md5: 'cf8f2a3cdfe97f7df574579af16c5c57', name: '群青', artist: 'YOASOBI', fileSize: 57952881, bitrate: 1866 },
    { cloudSongId: 630000000002, matchedSongId: 0, md5: 'aaaa', name: '布拉格广场', artist: '蔡依林', fileSize: 11786493, bitrate: 320 },
    { cloudSongId: 630000000003, matchedSongId: 0, md5: 'bbbb', name: '布拉格广场', artist: '周杰伦', fileSize: 34918981, bitrate: 950 },
  ],
};

test('buildCloudIndex 建索引', () => {
  const index = buildCloudIndex(cloud);
  assert.equal(index.count, 3);
  assert.equal(index.maxSize, 2000);
  assert.equal(index.matchedIds.has(1472480890), true);
  assert.equal(index.md5Map.get('aaaa').cloudSongId, 630000000002);
  assert.equal(index.ids.has(630000000001), true);
  assert.equal(index.nameMap.get('布拉格广场').size, 2);
});

test('findInCloud 先看已匹配，再看同名同艺人', () => {
  const index = buildCloudIndex(cloud);
  assert.deepEqual(findInCloud(index, { id: 1472480890, name: '群青', artists: ['YOASOBI'] }), { reason: 'matched', cloudSongId: 630000000001 });
  assert.deepEqual(findInCloud(index, { id: 999, name: '布拉格广场', artists: ['蔡依林'] }), { reason: 'name' });
  assert.equal(findInCloud(index, { id: 999, name: '布拉格广场', artists: ['王菲'] }), null);
  assert.equal(findInCloud(index, { id: 999, name: '不存在的歌', artists: ['X'] }), null);
  assert.equal(findInCloud(index, null), null);
});

test('downloadNeeded 区分 VIP 试听 / 下架 / 正常', () => {
  assert.equal(downloadNeeded({ url: 'http://x', freeTrialInfo: { start: 0, end: 30 } }).vip, true);
  assert.equal(downloadNeeded({ url: null, code: 404 }).unavailable, true);
  assert.equal(downloadNeeded({ url: null, code: 403 }).unavailable, true);
  assert.equal(downloadNeeded({ url: null }).unavailable, false);
  assert.equal(downloadNeeded({ url: 'http://x', br: 320000 }).needed, false);
  assert.equal(downloadNeeded(null).unknown, true);
});

test('parsePlaylistId 支持 URL 与纯数字', () => {
  assert.equal(parsePlaylistId('https://music.163.com/playlist?id=123456789'), 123456789);
  assert.equal(parsePlaylistId('https://music.163.com/#/playlist?id=3778678'), 3778678);
  assert.equal(parsePlaylistId('123456789'), 123456789);
  assert.equal(parsePlaylistId(''), 0);
  assert.equal(parsePlaylistId('abc'), 0);
});
