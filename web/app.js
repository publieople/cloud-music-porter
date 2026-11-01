const $ = (id) => document.getElementById(id);
const state = { jobId: null, source: null, loginKey: null, loginTimer: null };

async function api(url, options = {}) {
  const init = { method: options.method || 'GET', headers: { 'x-cmporter': 'web' } };
  if (options.body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

function text(id, value) {
  const el = $(id);
  if (el) el.textContent = value === undefined || value === null || value === '' ? '—' : String(value);
}

function setBusy(busy) {
  for (const id of ['btnScan', 'btnSync', 'btnMatch', 'btnDoctor', 'btnInstall', 'btnUninstall', 'btnServiceRun', 'btnServiceStatus']) {
    const el = $(id);
    if (el) el.disabled = busy;
  }
}

function timeText(value) {
  if (!value) return '—';
  const d = new Date(typeof value === 'number' ? value : Date.parse(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('zh-CN', { hour12: false });
}

async function refreshOverview() {
  try {
    const data = await api('/api/overview');
    state.overview = data;
    text('appSubtitle', data.app.name + ' v' + data.app.version + ' · 数据目录 ' + data.app.home);
    if (data.account) {
      text('accountName', data.account.nickname || ('uid ' + data.account.id));
      text('accountMeta', 'uid ' + data.account.id + ' · 会员类型 ' + (data.account.vipType || 0) + ' · cookie ' + (data.cookie.updatedAt ? timeText(data.cookie.updatedAt) : '未知'));
    } else if (data.accountError) {
      text('accountName', '登录需要刷新');
      text('accountMeta', data.accountError);
    } else {
      text('accountName', '未登录');
      text('accountMeta', '点右上角「扫码登录」，或运行 cmporter login');
    }
    if (data.cloud) {
      text('cloudCount', data.cloud.count + ' 条');
      text('cloudMeta', data.cloud.sizeText + ' / ' + data.cloud.maxText + (data.cloud.percent !== null ? '（已用 ' + data.cloud.percent + '%）' : ''));
      $('cloudMeter').style.width = Math.min(100, data.cloud.percent || 0) + '%';
    } else {
      text('cloudCount', '—');
      text('cloudMeta', '读取不到云盘信息');
    }
    if (data.sources) {
      const lx = data.sources.lx;
      const mf = data.sources.musicfree;
      text('lxMeta', lx.count ? lx.count + ' 个源' + (lx.enabled ? '' : '（已按配置禁用解析）') : (lx.error || '不可用'));
      text('mfMeta', mf.count ? mf.count + ' 个插件' + (mf.resolveEnabled ? '' : '（只搜索、不解析）') : (mf.error || '不可用'));
    } else {
      text('lxMeta', data.sourcesError || '不可用');
      text('mfMeta', data.sourcesError || '不可用');
    }
    text('serviceState', data.service.lastOk ? '上次成功' : (data.service.lastRunAt ? '上次失败' : '还没运行过'));
    text('serviceMeta', '今天已尝试 ' + data.service.attemptsToday + ' 次 · ' + (data.service.lastMessage || '无记录') + ' · 上次 ' + timeText(data.service.lastRunAt));
    return data;
  } catch (error) {
    text('appSubtitle', '读取概览失败：' + error.message);
    return null;
  }
}

async function loadConfig() {
  try {
    const data = await api('/api/config');
    const cfg = data.config;
    if ($('cfgQuality')) $('cfgQuality').value = cfg.quality || 'flac';
    if ($('cfgSourceMode')) $('cfgSourceMode').value = cfg.sourceMode || 'auto';
    if ($('cfgLxDir')) $('cfgLxDir').value = cfg.lxDataDir || '';
    if ($('cfgMfDir')) $('cfgMfDir').value = cfg.musicFreePluginsDir || '';
    if ($('cfgDelay')) $('cfgDelay').value = cfg.delayMs === undefined ? 800 : cfg.delayMs;
    if ($('serviceTime')) $('serviceTime').value = String(cfg.serviceHour === undefined ? 8 : cfg.serviceHour).padStart(2, '0') + ':' + String(cfg.serviceMinute === undefined ? 30 : cfg.serviceMinute).padStart(2, '0');
    text('configPath', '配置文件：' + data.configPath);
  } catch (error) {
    text('configPath', '读取配置失败：' + error.message);
  }
}

function filtersFromUi() {
  const target = $('target').value;
  const value = ($('targetValue').value || '').trim();
  const filters = { vipOnly: $('vipOnly').checked, dryRun: $('dryRun').checked };
  if (target === 'liked') filters.liked = true;
  else if (target === 'all') filters.all = true;
  else if (target === 'playlist') filters.playlist = value;
  else if (target === 'song') filters.song = value;
  else if (target === 'query') filters.query = value;
  const quality = $('quality').value;
  if (quality) filters.quality = quality;
  const maxGb = $('maxGb').value;
  if (maxGb !== '') filters.maxGb = Number(maxGb);
  return filters;
}

function openDrawer(title) {
  $('drawer').classList.remove('hidden');
  $('btnOpenDrawer').classList.add('hidden');
  $('log').textContent = '';
  text('drawerTitle', title || '输出');
  text('jobState', '待命');
  $('jobState').className = 'badge';
}

function closeDrawer() {
  $('drawer').classList.add('hidden');
  $('btnOpenDrawer').classList.remove('hidden');
  if (state.source) {
    state.source.close();
    state.source = null;
  }
}

function appendLine(line) {
  const el = $('log');
  el.textContent += line + '\n';
  el.scrollTop = el.scrollHeight;
}

function subscribe(jobId, title) {
  if (state.source) state.source.close();
  openDrawer(title);
  if (state.jobId && state.jobId !== jobId) {
    /* 旧任务保留在后台，不再订阅 */
  }
  state.jobId = jobId;
  text('jobState', '运行中');
  $('jobState').className = 'badge running';
  const source = new EventSource('/api/run/' + jobId + '/stream');
  state.source = source;
  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.line !== undefined && data.line !== null) appendLine(data.line);
    } catch (error) { /* ignore */ }
  };
  source.addEventListener('end', (event) => {
    try {
      const data = JSON.parse(event.data);
      text('jobState', data.status === 'done' ? '完成' : '失败（退出码 ' + data.exitCode + '）');
      $('jobState').className = 'badge ' + (data.status === 'done' ? 'done' : 'failed');
    } catch (error) {
      text('jobState', '结束');
    }
    source.close();
    state.source = null;
    setBusy(false);
    refreshOverview();
  });
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) {
      text('jobState', '连接中断');
      setBusy(false);
    }
  };
}

async function runJob(command, body, title) {
  setBusy(true);
  openDrawer(title);
  text('jobState', '启动中');
  $('jobState').className = 'badge running';
  try {
    const data = await api('/api/run', { method: 'POST', body: Object.assign({ command }, body || {}) });
    appendLine('$ cmporter ' + data.args.join(' '));
    subscribe(data.jobId, title);
  } catch (error) {
    appendLine('启动失败：' + error.message);
    text('jobState', '失败');
    $('jobState').className = 'badge failed';
    setBusy(false);
  }
}

function initTarget() {
  const sync = () => {
    const target = $('target').value;
    const input = $('targetValue');
    if (target === 'playlist' || target === 'song' || target === 'query') {
      input.classList.remove('hidden');
      input.placeholder = target === 'playlist' ? '歌单链接或 id' : target === 'song' ? '歌曲 id，多个用逗号' : '关键词';
    } else {
      input.classList.add('hidden');
      input.value = '';
    }
  };
  $('target').addEventListener('change', sync);
  sync();
}

async function loginFlow() {
  $('modal').classList.remove('hidden');
  text('loginState', '正在申请二维码…');
  $('qrImg').removeAttribute('src');
  try {
    const data = await api('/api/login/start', { method: 'POST', body: {} });
    $('qrImg').src = data.dataUrl;
    state.loginKey = data.key;
    text('loginState', '请用网易云音乐 App 扫码，并在手机上确认登录');
    if (state.loginTimer) clearInterval(state.loginTimer);
    state.loginTimer = setInterval(pollLogin, 2000);
  } catch (error) {
    text('loginState', '申请二维码失败：' + error.message);
  }
}

async function pollLogin() {
  if (!state.loginKey) return;
  try {
    const data = await api('/api/login/poll?key=' + encodeURIComponent(state.loginKey));
    if (data.status === 'ok') {
      clearInterval(state.loginTimer);
      state.loginTimer = null;
      text('loginState', '登录成功：' + (data.account && data.account.nickname ? data.account.nickname : '已保存 cookie'));
      setTimeout(() => { $('modal').classList.add('hidden'); refreshOverview(); }, 1200);
    } else if (data.status === 'scanned') {
      text('loginState', '已扫码，请在手机上点击确认');
    } else if (data.status === 'expired') {
      clearInterval(state.loginTimer);
      state.loginTimer = null;
      text('loginState', '二维码已过期，请重新点击「扫码登录」');
    }
  } catch (error) {
    /* 轮询失败静默重试 */
  }
}

function bind() {
  $('btnRefresh').addEventListener('click', refreshOverview);
  $('btnOpenDrawer').addEventListener('click', () => $('drawer').classList.remove('hidden'));
  $('btnCloseDrawer').addEventListener('click', closeDrawer);
  $('btnCloseModal').addEventListener('click', () => { $('modal').classList.add('hidden'); if (state.loginTimer) { clearInterval(state.loginTimer); state.loginTimer = null; } });
  $('btnLogin').addEventListener('click', loginFlow);
  $('btnScan').addEventListener('click', () => runJob('scan', { filters: filtersFromUi() }, '扫描'));
  $('btnSync').addEventListener('click', () => {
    if (!confirm('开始把需要的歌导入云盘？')) return;
    runJob('sync', { filters: Object.assign({ yes: true }, filtersFromUi()) }, '同步到云盘');
  });
  $('btnMatch').addEventListener('click', () => runJob('match', { filters: { liked: true } }, '匹配云盘副本'));
  $('btnDoctor').addEventListener('click', () => runJob('doctor', {}, '环境检查'));
  $('btnInstall').addEventListener('click', () => runJob('service-install', { time: $('serviceTime').value || '08:30' }, '安装每日自动同步'));
  $('btnUninstall').addEventListener('click', () => {
    if (!confirm('卸载每日自动同步？')) return;
    runJob('service-uninstall', {}, '卸载每日自动同步');
  });
  $('btnServiceRun').addEventListener('click', () => runJob('service-run', {}, '立即运行一次'));
  $('btnServiceStatus').addEventListener('click', async () => {
    openDrawer('服务状态');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const res = await fetch('/api/overview', { signal: controller.signal, headers: { 'x-cmporter': 'web' } });
      clearTimeout(timer);
      const data = await res.json();
      appendLine('上次运行：' + timeText(data.service.lastRunAt));
      appendLine('今天尝试：' + data.service.attemptsToday + ' 次');
      appendLine('结果：' + (data.service.lastOk ? '成功' : '失败') + ' —— ' + (data.service.lastMessage || '无记录'));
      appendLine('提示：完整服务状态可运行 cmporter service status');
    } catch (error) {
      appendLine('读取失败：' + error.message);
    }
  });
  $('btnSaveConfig').addEventListener('click', async () => {
    const patch = {
      quality: $('cfgQuality').value,
      sourceMode: $('cfgSourceMode').value,
      lxDataDir: $('cfgLxDir').value.trim(),
      musicFreePluginsDir: $('cfgMfDir').value.trim(),
      delayMs: Number($('cfgDelay').value || 800),
    };
    try {
      await api('/api/config', { method: 'POST', body: { config: patch } });
      text('configPath', '已保存到配置文件');
      refreshOverview();
    } catch (error) {
      text('configPath', '保存失败：' + error.message);
    }
  });
}

bind();
initTarget();
refreshOverview();
loadConfig();
