import test from 'node:test';
import assert from 'node:assert/strict';
import { recordRunOutcome } from '../src/service/outcome.js';

test('recordRunOutcome：真实运行写入当天成功状态', () => {
  const state = {};
  const out = recordRunOutcome(state, { key: '2026-11-01', summary: { imported: 2, failed: 0, skipped: 1 } });
  assert.equal(out.dryRun, false);
  assert.equal(out.ok, true);
  assert.equal(state.lastRunDate, '2026-11-01');
  assert.equal(state.lastOk, true);
  assert.equal(state.lastMessage, '新增 2 首，失败 0 首，跳过 1 首');
  assert.equal(state.lastSummary.imported, 2);
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].mode, 'real');
});

test('recordRunOutcome：dry-run 不能记成当天成功（否则当天真实同步会被跳过）', () => {
  const state = {};
  const out = recordRunOutcome(state, { key: '2026-11-01', dryRun: true, summary: {} });
  assert.equal(out.dryRun, true);
  assert.equal(out.ok, true);
  assert.equal(state.lastRunDate, undefined);
  assert.equal(state.lastOk, undefined);
  assert.equal(state.lastMessage, undefined);
  assert.equal(state.lastSummary, undefined);
  assert.ok(state.lastDryRunAt);
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].mode, 'dry-run');
});

test('recordRunOutcome：dry-run 不覆盖已有的真实成功记录', () => {
  const state = { lastRunDate: '2026-10-31', lastOk: true, lastMessage: '新增 1 首，失败 0 首，跳过 0 首', history: [] };
  recordRunOutcome(state, { key: '2026-11-01', dryRun: true, summary: {} });
  assert.equal(state.lastRunDate, '2026-10-31');
  assert.equal(state.lastOk, true);
  assert.equal(state.lastMessage, '新增 1 首，失败 0 首，跳过 0 首');
  assert.equal(state.history.length, 1);
});

test('recordRunOutcome：有失败时 lastOk 为 false，历史只保留最近 90 条', () => {
  const history = Array.from({ length: 95 }, (_, i) => ({ date: 'd' + i, at: i, mode: 'real', ok: true }));
  const state = { history };
  const out = recordRunOutcome(state, { key: '2026-11-01', summary: { imported: 0, failed: 2, skipped: 0 } });
  assert.equal(out.ok, false);
  assert.equal(state.lastOk, false);
  assert.equal(state.lastMessage, '新增 0 首，失败 2 首，跳过 0 首');
  assert.equal(state.history.length, 90);
  assert.equal(state.history[89].date, '2026-11-01');
});

test('recordRunOutcome：summary 缺省按 0 处理', () => {
  const state = {};
  const out = recordRunOutcome(state, { key: '2026-11-01' });
  assert.equal(out.imported, 0);
  assert.equal(out.failed, 0);
  assert.equal(out.skipped, 0);
  assert.equal(state.lastMessage, '新增 0 首，失败 0 首，跳过 0 首');
});
