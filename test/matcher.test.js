import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCandidate, rankCandidates, pickBest, candidateLabel } from '../src/core/matcher.js';

const song = { name: '布拉格广场', artists: ['蔡依林', '周杰伦'], duration: 294 };

test('标题/艺人/时长全对时分数最高', () => {
  const exact = scoreCandidate(song, { title: '布拉格广场', artist: '蔡依林/周杰伦', duration: 294 });
  assert.equal(exact.score, 170);
  assert.deepEqual(exact.reasons, ['标题完全一致 +100', '艺人命中 +40', '时长几乎一致 +30']);
});

test('标题不一致会被扣分并被 pickBest 过滤', () => {
  const wrong = scoreCandidate(song, { title: '夜曲', artist: '周杰伦', duration: 294 });
  assert.ok(wrong.score < 75);
  assert.deepEqual(pickBest(song, [{ title: '夜曲', artist: '周杰伦', duration: 294 }]), []);
});

test('时长差超过 15 秒扣 30 分', () => {
  const near = scoreCandidate(song, { title: '布拉格广场', artist: '蔡依林', duration: 294 });
  const far = scoreCandidate(song, { title: '布拉格广场', artist: '蔡依林', duration: 400 });
  assert.equal(near.score - far.score, 60);
});

test('Live 版本会被扣分，排序靠后', () => {
  const ranked = rankCandidates(song, [
    { title: '布拉格广场 (Live)', artist: '蔡依林', duration: 294 },
    { title: '布拉格广场', artist: '蔡依林', duration: 294 },
  ]);
  assert.equal(ranked[0].title, '布拉格广场');
  assert.ok(ranked[1].score < ranked[0].score);
  assert.ok(ranked[1].reasons.includes('候选是live版本 -20'));
});

test('pluginBonus 会加权', () => {
  const plain = scoreCandidate(song, { title: '布拉格广场', artist: '蔡依林', duration: 294 });
  const bonus = scoreCandidate(song, { title: '布拉格广场', artist: '蔡依林', duration: 294, pluginPlatform: 'kw' }, { pluginBonus: { kw: 7 } });
  assert.equal(bonus.score - plain.score, 7);
});

test('没有标题的候选直接淘汰', () => {
  assert.equal(scoreCandidate(song, {}).score, -999);
});

test('candidateLabel', () => {
  assert.equal(candidateLabel({ title: '群青', artist: 'YOASOBI', album: '群青' }), '群青 - YOASOBI《群青》');
  assert.equal(candidateLabel({ title: '群青' }), '群青 - ');
});
