const $ = (id) => document.getElementById(id);
const state = { jobId: null, source: null, loginKey: null, loginTimer: null, overview: null };
const THEME_KEY = 'cmporter.theme';

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

function setDot(id, value) {
  const el = $(id);
  if (el) el.dataset.state = value || 'idle';
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = Math.max(0, n);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return (index === 0 ? Math.round(value) : value.toFixed(1)) + ' ' + units[index];
}

function timeText(value) {
  if (!value) return '—';
  const d = new Date(typeof value === 'number' ? value : Date.parse(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('zh-CN', { hour12: false });
}

function shortTime(value) {
  if (!value) return '—';
  const d = new Date(typeof value === 'number' ? value : Date.parse(value));
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/* ---------- 主题 ---------- */
function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch (error) { /* ignore */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'dark' ? '#08070d' : '#f7f2ea');
  const btn = $('btnTheme');
  if (btn) btn.title = next === 'dark' ? '切换到亮色主题' : '切换到暗色主题';
}

function initTheme() {
  let theme = null;
  try {
    theme = new URLSearchParams(location.search).get('theme');
    if (theme !== 'light' && theme !== 'dark') theme = localStorage.getItem(THEME_KEY);
  } catch (error) { /* ignore */ }
  applyTheme(theme || 'dark');
}

/* ---------- 概览 ---------- */
function setBusy(busy) {
  const ids = ['btnScan', 'btnSync', 'btnMatch', 'btnDoctor', 'btnInstall', 'btnUninstall', 'btnServiceRun', 'btnServiceStatus', 'btnHeroSync', 'btnHeroScan'];
  for (const id of ids) {
    const el = $(id);
    if (el) el.disabled = busy;
  }
}

function applyAccount(data) {
  if (data.account) {
    const name = data.account.nickname || ('uid ' + data.account.id);
    const vip = data.account.vipType ? 'VIP ' + data.account.vipType : '普通账号';
    const cookieAt = data.cookie.updatedAt ? timeText(data.cookie.updatedAt) : '时间未知';
    text('accountName', name);
    text('accountAvatar', String(name).trim().slice(0, 1) || '?');
    text('accountMeta', 'uid ' + data.account.id + ' · ' + vip + ' · cookie ' + cookieAt);
    setDot('accountDot', 'good');
    const chip = $('topAccount');
    if (chip) {
      chip.dataset.state = 'online';
      chip.title = name + ' · uid ' + data.account.id;
    }
    text('topAccountName', name);
    return;
  }
  text('accountAvatar', data.accountError ? '!' : '?');
  if (data.accountError) {
    text('accountName', '登录需要刷新');
    text('accountMeta', data.accountError);
    setDot('accountDot', 'bad');
    const chip = $('topAccount');
    if (chip) chip.dataset.state = 'error';
    text('topAccountName', '登录失效');
  } else {
    text('accountName', '未登录');
    text('accountMeta', '点右上角「扫码登录」，或运行 cmporter login');
    setDot('accountDot', 'idle');
    const chip = $('topAccount');
    if (chip) chip.dataset.state = 'offline';
    text('topAccountName', '未登录');
  }
}

function applyCloud(data) {
  if (!data.cloud) {
    text('cloudCount', '—');
    text('cloudPercent', '—');
    text('cloudMeta', '读取不到云盘信息');
    text('heroCloudPct', '—');
    text('heroCloudSize', '— / —');
    text('heroCloudLeft', '未读取到云盘容量');
    const meter = $('cloudMeter');
    if (meter) meter.style.width = '0%';
    const heroBar = $('heroCloudBar');
    if (heroBar) heroBar.style.width = '0%';
    return;
  }
  const cloud = data.cloud;
  text('cloudCount', cloud.count + ' 条');
  text('cloudPercent', (cloud.percent === null || cloud.percent === undefined ? '—' : cloud.percent + '%'));
  text('cloudMeta', cloud.sizeText + ' / ' + cloud.maxText);
  const meter = $('cloudMeter');
  if (meter) meter.style.width = Math.min(100, cloud.percent || 0) + '%';
  text('heroCloudPct', (cloud.percent === null || cloud.percent === undefined ? '—' : cloud.percent + '%'));
  text('heroCloudSize', cloud.sizeText + ' / ' + cloud.maxText);
  text('heroCloudLeft', '剩余 ' + formatBytes(cloud.maxSize - cloud.size));
  const heroBar = $('heroCloudBar');
  if (heroBar) heroBar.style.width = Math.min(100, cloud.percent || 0) + '%';
}

function applySources(data) {
  if (!data.sources) {
    const message = data.sourcesError || '不可用';
    text('lxMeta', message);
    text('mfMeta', message);
    setDot('lxDot', 'bad');
    setDot('mfDot', 'bad');
    return;
  }
  const lx = data.sources.lx;
  const mf = data.sources.musicfree;
  if (lx.count) {
    text('lxMeta', lx.count + ' 个自定义源' + (lx.enabled ? '' : ' · 已按配置禁用解析'));
    setDot('lxDot', 'good');
  } else {
    text('lxMeta', lx.error || '未找到自定义源');
    setDot('lxDot', 'warn');
  }
  if (mf.count) {
    text('mfMeta', mf.count + ' 个插件' + (mf.resolveEnabled ? '' : ' · 只搜索不解析'));
    setDot('mfDot', 'good');
  } else {
    text('mfMeta', mf.error || '未找到插件');
    setDot('mfDot', 'warn');
  }
}

function applyService(data) {
  const service = data.service;
  let label = '尚未运行';
  let dot = 'idle';
  if (service.lastRunAt) {
    label = service.lastOk ? '运行正常' : '上次失败';
    dot = service.lastOk ? 'good' : 'bad';
  }
  text('serviceState', label);
  setDot('serviceDot', dot);
  const pieces = [];
  pieces.push(service.lastRunAt ? '上次 ' + shortTime(service.lastRunAt) : '还没有运行记录');
  pieces.push('今天检查 ' + service.attemptsToday + ' 次');
  const summary = service.lastSummary;
  if (summary && typeof summary === 'object') {
    if (!summary.imported && !summary.failed) pieces.push('云盘已覆盖');
    else pieces.push('新增 ' + (summary.imported || 0) + ' 首' + (summary.failed ? ' · 失败 ' + summary.failed + ' 首' : ''));
  } else if (service.lastMessage) {
    pieces.push(service.lastMessage);
  }
  text('serviceMeta', pieces.join(' · '));
}

async function refreshOverview() {
  try {
    const data = await api('/api/overview');
    state.overview = data;
    text('appVersion', 'v' + data.app.version);
    text('footVersion', 'v' + data.app.version);
    const subtitle = $('appSubtitle');
    if (subtitle) subtitle.title = '数据目录：' + data.app.home + ' · Node ' + data.app.node;
    text('heroDelivered', data.cloud ? data.cloud.count : '—');
    applyAccount(data);
    applyCloud(data);
    applySources(data);
    applyService(data);
    return data;
  } catch (error) {
    text('accountName', '读取概览失败');
    text('accountMeta', error.message);
    text('heroDelivered', '—');
    setDot('accountDot', 'bad');
    const chip = $('topAccount');
    if (chip) chip.dataset.state = 'error';
    text('topAccountName', '连接失败');
    return null;
  }
}

/* ---------- 配置 ---------- */
async function loadConfig() {
  try {
    const data = await api('/api/config');
    const cfg = data.config;
    if ($('cfgQuality')) $('cfgQuality').value = cfg.quality || 'flac';
    if ($('cfgSourceMode')) $('cfgSourceMode').value = cfg.sourceMode || 'auto';
    if ($('cfgLxDir')) $('cfgLxDir').value = cfg.lxDataDir || '';
    if ($('cfgMfDir')) $('cfgMfDir').value = cfg.musicFreePluginsDir || '';
    if ($('cfgDelay')) $('cfgDelay').value = cfg.delayMs === undefined ? 800 : cfg.delayMs;
    const hour = String(cfg.serviceHour === undefined ? 8 : cfg.serviceHour).padStart(2, '0');
    const minute = String(cfg.serviceMinute === undefined ? 30 : cfg.serviceMinute).padStart(2, '0');
    const time = hour + ':' + minute;
    if ($('serviceTime')) $('serviceTime').value = time;
    text('serviceFlowTime', time);
    text('serviceHint', '每天 ' + time + ' 自动跑；如果那一刻关机，下次登录后会补跑，不会漏掉。');
    const qualityLabel = { flac: 'FLAC', '320k': '320k', '128k': '128k' }[cfg.quality] || cfg.quality || 'flac';
    text('configSummary', qualityLabel + ' · ' + (cfg.sourceMode || 'auto') + ' · 延迟 ' + (cfg.delayMs === undefined ? 800 : cfg.delayMs) + 'ms');
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

/* ---------- 输出抽屉 ---------- */
function openDrawer(title) {
  $('drawer').classList.remove('hidden');
  $('btnOpenDrawer').classList.add('hidden');
  $('log').textContent = '';
  text('drawerTitle', title || '运行输出');
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

function doScan() {
  runJob('scan', { filters: filtersFromUi() }, '扫描歌单');
}

function doSync() {
  if (!confirm('开始把需要的歌导入云盘？')) return;
  runJob('sync', { filters: Object.assign({ yes: true }, filtersFromUi()) }, '同步到云盘');
}

/* ---------- 处理范围 ---------- */
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
    document.querySelectorAll('#targetSeg .seg').forEach((btn) => {
      const active = btn.dataset.value === target;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  };
  $('target').addEventListener('change', sync);
  document.querySelectorAll('#targetSeg .seg').forEach((btn) => {
    btn.addEventListener('click', () => {
      if ($('target').value === btn.dataset.value) return;
      $('target').value = btn.dataset.value;
      $('target').dispatchEvent(new Event('change'));
    });
  });
  sync();
}

/* ---------- 登录 ---------- */
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

/* ---------- 绑定 ---------- */
function bind() {
  $('btnTheme').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  });
  $('btnRefresh').addEventListener('click', () => {
    refreshOverview();
    loadConfig();
  });
  $('btnOpenDrawer').addEventListener('click', () => {
    $('drawer').classList.remove('hidden');
    $('btnOpenDrawer').classList.add('hidden');
  });
  $('btnCloseDrawer').addEventListener('click', closeDrawer);
  $('btnCloseModal').addEventListener('click', () => {
    $('modal').classList.add('hidden');
    if (state.loginTimer) {
      clearInterval(state.loginTimer);
      state.loginTimer = null;
    }
  });
  $('btnLogin').addEventListener('click', loginFlow);
  $('btnHeroScan').addEventListener('click', doScan);
  $('btnHeroSync').addEventListener('click', doSync);
  $('btnScan').addEventListener('click', doScan);
  $('btnSync').addEventListener('click', doSync);
  $('btnMatch').addEventListener('click', () => {
    runJob('match', { filters: Object.assign({}, filtersFromUi(), { liked: true }) }, '匹配云盘副本');
  });
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
      loadConfig();
      refreshOverview();
    } catch (error) {
      text('configPath', '保存失败：' + error.message);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!$('modal').classList.contains('hidden')) $('btnCloseModal').click();
    if (!$('drawer').classList.contains('hidden')) closeDrawer();
  });
}

initTheme();
bind();
initTarget();
refreshOverview();
loadConfig();
