// 把一次运行的结果写进 service state。
// 关键规则：dry-run 只能记录“演练时间”，绝不能被当成「今天已成功同步」——
// 否则用户当天跑过一次 --dry-run，晚上的真实定时同步就会被跳过（v0.1.0 的 bug）。
export function recordRunOutcome(state, options) {
  const opts = options || {};
  const key = opts.key;
  const summary = opts.summary && typeof opts.summary === 'object' ? opts.summary : {};
  // imported 同时统计秒传导入与真上传成功（sync() 把 uploaded 单独计数）
  const imported = Number(summary.imported || 0) + Number(summary.uploaded || 0);
  const failed = Number(summary.failed || 0);
  const skipped = Number(summary.skipped || 0);
  const mode = opts.dryRun ? 'dry-run' : 'real';
  const entry = { date: key, at: Date.now(), mode, ok: failed === 0, imported, failed, skipped };
  state.history = (state.history || []).concat([entry]).slice(-90);
  if (opts.dryRun) {
    state.lastDryRunAt = new Date().toISOString();
    const targets = Number(opts.targets);
    state.lastDryRunTargets = Number.isFinite(targets) ? targets : 0;
    return { dryRun: true, ok: true, imported: 0, failed: 0, skipped: 0, targets: state.lastDryRunTargets, message: '演练完成（未写入云盘）' };
  }
  state.lastRunDate = key;
  state.lastOk = failed === 0;
  state.lastMessage = '新增 ' + imported + ' 首，失败 ' + failed + ' 首，跳过 ' + skipped + ' 首';
  state.lastSummary = { imported, failed, skipped };
  return { dryRun: false, ok: state.lastOk, imported, failed, skipped, message: state.lastMessage };
}
