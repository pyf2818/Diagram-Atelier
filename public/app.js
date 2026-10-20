/* ════════════════════════════════════════════════════════════════
   Diagram Atelier · 前端交互
   - draw.io embed 协议（proto=json）集成官方编辑器组件
   - 与后端 SSE 流式对话，实时把 XML 渲染进画布
   - 大模型自定义配置（仅存本机浏览器）
   ════════════════════════════════════════════════════════════════ */
'use strict';

/* ─── 常量 ─── */
const EDITOR_URL = 'https://embed.diagrams.net/?embed=1&proto=json&libraries=1&noSaveBtn=1&spin=1&ui=kennedy&lang=zh';
const API = {
  health: '/api/health',
  presets: '/api/presets',
  samples: '/api/samples',
  verify: '/api/verify',
  models: '/api/models',
  chat: '/api/chat',
  share: '/api/share',
};
const LS = {
  cfg: 'atelier.cfg.v1',
  cfgs: 'atelier.cfgs.v1',
  session: 'atelier.session.v1',
  versions: 'atelier.versions.v1',
  conversations: 'atelier.conversations.v1',
  theme: 'atelier.theme.v1',
  templates: 'atelier.templates.v1',
  diagrams: 'atelier.diagrams.v1',
  sidebarCollapsed: 'atelier.sidebarCollapsed.v1',
};
const TYPE_EXTRA = {
  flowchart: '请按「流程图」排版：竖向自上而下主轴，矩形步骤、菱形判断、圆角矩形起止，分支对称展开。',
  architecture: '请按「架构图」排版：横向分层 swimlane，接入层 / 应用层 / 服务层 / 数据层 / 基础设施分层。',
  mindmap: '请按「思维导图」排版：中心主题辐射，一级分支左右对称展开，二级挂在外侧。',
  sequence: '请按「时序图」排版：顶部角色等距横排 + 生命线，消息箭头自上而下。',
  er: '请按「ER 图」排版：实体表头 + 字段行，关系边标注基数（1 / 多）。',
};

/* ─── 状态 ─── */
let cfgs = loadCfgs();
let activeCfgId = (cfgs[0] || {}).id || null;
let cfg = cfgs.find((c) => c.id === activeCfgId) || cfgs[0] || defaultCfg();
let presets = [];
let conversations = loadConversations();
let activeConvId = (conversations[0] || {}).id || null;
let conv = conversations.find((c) => c.id === activeConvId) || conversations[0];
let currentXml = '';
let chatHistory = (conv ? conv.history : []);
let versions = loadVersions();
let editorReady = false;
let pendingXml = null;
let editorWatchdog = null;
let busy = false;
let currentFetch = null;
let streamText = '';
let streamingFrozen = false;
let pendingExport = null;

/* 预览模式撤销/重做：纯前端 XML 历史栈 */
let xmlUndo = [];
let xmlRedo = [];
let suppressHist = false;
let lastSentHadXml = false;

/* 视图模式：preview=离线原生 SVG；editor=draw.io 精修 */
let viewMode = 'preview';
let pendingXmlSync = false;   // 等待编辑器回传 XML（切回预览的兜底同步）
let xmlSyncWatchdog = null;
let editorBooted = false;
let previewSvg = null;
let previewBBox = null;
let previewScale = 1;
let previewPanX = 0;
let previewPanY = 0;
let previewWired = false;

/* ─── DOM 引用（init 中赋值） ─── */
let drawio, messagesEl, input, btnSend, btnStop, modelPill, modelName, modelDot,
    toasts, stageBoot, stageError, splitter, canvasTitle, statV, statE, validPill,
    typeDetect, typeDetectLabel, isoPill, stylePill, layoutPill, fixPill,
    settingsEl, scrim, presetGrid, protoSeg, cfgBase, cfgKey, btnToggleKey,
    cfgModel, modelList, modelHint, cfgTemp, tempVal, cfgMaxTokens, cfgExtra,
    btnVerify, btnFetchModels, verifyResult, historyDrawer, historyList, templateDrawer, templateList, tplTabs,
    collabLayer, collabPresence, collabCursors, btnCollab,
    exportWrap, exportMenu, xmlModal, xmlView, xmlSize, agentPanel, bootSub,
    previewWrap, previewEmpty, viewToggle, canvasStage,
    btnTheme, convDrawer, convList, btnConvs, cfgList, btnAddCfg, cfgName,
    editMode, paletteEl, paletteInput, paletteList, diffModal, diffView, diffTitle, btnCloseDiff,
    saveInd, saveText, backupFile, btnBackup, btnRestore, btnWipe, dmWarn, btnToggleSidebar,
    moreWrap, btnMore, btnMyDiagrams, libDrawer, libList, libName, btnLibSave;

/* ─── 小工具 ─── */
const $ = (id) => document.getElementById(id);
const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 160) + 'px';
}
function downloadDataUrl(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
function downloadText(text, name, mime) {
  const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function toast(msg, kind = 'ok', ms = 2600) {
  const icon = kind === 'err' ? '!' : kind === 'brass' ? '✦' : '✓';
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = '<span class="t-ico"></span><span></span>';
  el.querySelector('.t-ico').textContent = icon;
  el.querySelector('span:last-child').textContent = msg;
  toasts.appendChild(el);
  setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 240); }, ms);
}

/* ─── Markdown 轻量渲染 ─── */
function renderMarkdown(src) {
  if (!src) return '';
  let s = esc(src);
  s = s.replace(/```[\w-]*\n([\s\S]*?)```/g, (_m, code) =>
    `<pre><code>${code.replace(/\n+$/, '')}</code></pre>`);
  s = s.replace(/`([^`\n]+)`/g, (_m, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?:)?:/g, (m) => m); // no-op guard
  s = s.replace(/(?:^|\n)((?:[-*]\s+.*)(?:\n[-*]\s+.*)*)/g, (_m, list) => {
    const items = list.trim().split(/\n/)
      .map((l) => l.replace(/^[-*]\s+/, '').trim())
      .filter(Boolean).map((x) => `<li>${x}</li>`).join('');
    return `\n<ul>${items}</ul>`;
  });
  const paras = s.split(/\n{2,}/).map((p) => {
    p = p.trim();
    if (!p) return '';
    if (p.startsWith('<pre') || p.startsWith('<ul')) return p;
    return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
  }).join('');
  return paras;
}

/* ─── 配置持久化（支持多配置数组） ─── */
function defaultCfg() {
  return {
    id: 'cfg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    name: '未命名配置',
    preset: '', protocol: 'openai', baseUrl: '', apiKey: '', model: '',
    temperature: 0.3, maxTokens: 16000, extraPrompt: '',
  };
}
function loadCfgs() {
  try {
    const raw = localStorage.getItem(LS.cfgs);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        return arr.map((c) => Object.assign(defaultCfg(), c));
      }
    }
    // 迁移：兼容旧的单配置键
    const old = localStorage.getItem(LS.cfg);
    if (old) {
      const c = Object.assign(defaultCfg(), JSON.parse(old));
      c.id = c.id || ('cfg-' + Date.now());
      return [c];
    }
  } catch (_) {}
  const d = defaultCfg();
  d.name = '默认配置';
  return [d];
}
function persistCfgs() {
  try { localStorage.setItem(LS.cfgs, JSON.stringify(cfgs)); } catch (_) {}
  markSaved();
}
function saveCfg() { persistCfgs(); }
function clearCfg() {
  cfg.preset = ''; cfg.protocol = 'openai'; cfg.baseUrl = ''; cfg.apiKey = '';
  cfg.model = ''; cfg.temperature = 0.3; cfg.maxTokens = 16000; cfg.extraPrompt = '';
  applyCfgToForm();
  updateModelPill();
  persistCfgs();
  renderCfgList();
}
function selectCfg(id) {
  const c = cfgs.find((x) => x.id === id);
  if (!c) return;
  activeCfgId = id; cfg = c;
  applyCfgToForm(); updateModelPill(); persistCfgs(); renderCfgList();
}
function addCfg() {
  const d = defaultCfg();
  d.name = '新配置';
  cfgs.push(d);
  activeCfgId = d.id; cfg = d;
  applyCfgToForm(); updateModelPill(); persistCfgs(); renderCfgList();
  if (cfgName) { cfgName.focus(); cfgName.select(); }
}
function deleteCfg(id) {
  if (cfgs.length <= 1) { toast('至少保留一个配置', 'brass'); return; }
  cfgs = cfgs.filter((c) => c.id !== id);
  if (activeCfgId === id) { activeCfgId = cfgs[0].id; cfg = cfgs[0]; }
  applyCfgToForm(); updateModelPill(); persistCfgs(); renderCfgList();
  toast('已删除该配置', 'ok');
}
function renderCfgList() {
  if (!cfgList) return;
  cfgList.innerHTML = '';
  cfgs.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'cfg-item' + (c.id === activeCfgId ? ' active' : '');
    item.dataset.id = c.id;
    const name = (c.name && c.name !== '未命名配置') ? c.name : (c.model || '未命名配置');
    item.innerHTML =
      `<span class="cfg-dot"></span><span class="cfg-item-name">${esc(name)}</span>` +
      `<button class="cfg-del" title="删除此配置" data-del="${c.id}">×</button>`;
    item.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      selectCfg(c.id);
    });
    item.querySelector('[data-del]').addEventListener('click', (e) => {
      e.stopPropagation(); deleteCfg(c.id);
    });
    cfgList.appendChild(item);
  });
}
function loadVersions() {
  try {
    const raw = localStorage.getItem(LS.versions);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [];
}
function persistSession() {
  if (!currentXml) return;
  try { localStorage.setItem(LS.session, currentXml); } catch (_) {}
  markSaved();
}
function buildLlmBody() {
  return {
    protocol: cfg.protocol === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: String(cfg.baseUrl || '').trim(),
    apiKey: String(cfg.apiKey || '').trim(),
    model: String(cfg.model || '').trim(),
    temperature: Number(cfg.temperature) || 0.3,
    maxTokens: Number(cfg.maxTokens) || 16000,
  };
}
function hasConfig() {
  return !!String(cfg.baseUrl || '').trim() && !!String(cfg.model || '').trim();
}
function buildExtra(type) {
  const parts = [];
  if (cfg.extraPrompt && cfg.extraPrompt.trim()) parts.push(cfg.extraPrompt.trim());
  if (type && type !== 'auto' && TYPE_EXTRA[type]) parts.push(TYPE_EXTRA[type]);
  return parts.join('\n');
}
function updateModelPill() {
  if (hasConfig()) {
    modelPill.classList.add('ready');
    const label = (cfg.name && cfg.name !== '未命名配置') ? cfg.name : (cfg.model || '已配置');
    modelName.textContent = label;
  } else {
    modelPill.classList.remove('ready');
    modelName.textContent = '未配置模型';
  }
}

/* ══════════════════ 模型设置抽屉 ══════════════════ */
function buildPresetGrid() {
  presetGrid.innerHTML = '';
  presets.forEach((p) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'preset-chip' + (cfg.preset === p.id ? ' active' : '');
    chip.dataset.id = p.id;
    chip.innerHTML = `<span class="pc-dot" style="background:linear-gradient(180deg,#4A5F8E,#24314F)">${esc(p.label.slice(0, 1))}</span><span>${esc(p.label)}</span>`;
    chip.addEventListener('click', () => selectPreset(p.id));
    presetGrid.appendChild(chip);
  });
}
function selectPreset(id) {
  const p = presets.find((x) => x.id === id);
  if (!p) return;
  cfg.preset = id;
  cfg.protocol = p.protocol || 'openai';
  if (p.baseUrl) cfg.baseUrl = p.baseUrl;
  if (p.models && p.models.length) cfg.model = p.models[0];
  qa('.preset-chip', presetGrid).forEach((c) =>
    c.classList.toggle('active', c.dataset.id === id));
  applyCfgToForm();
}
let fetchedModels = []; // 「拉取」按钮从服务端拉到的模型列表（与预设模型合并进 datalist）
function applyCfgToForm() {
  cfgBase.value = cfg.baseUrl || '';
  cfgKey.value = cfg.apiKey || '';
  cfgModel.value = cfg.model || '';
  cfgName.value = cfg.name || '';
  cfgTemp.value = cfg.temperature;
  tempVal.textContent = Number(cfg.temperature).toFixed(2);
  cfgMaxTokens.value = cfg.maxTokens;
  cfgExtra.value = cfg.extraPrompt || '';
  qa('button', protoSeg).forEach((b) =>
    b.classList.toggle('active', b.dataset.proto === cfg.protocol));
  if (modelList) {
    modelList.innerHTML = '';
    const p = presets.find((x) => x.id === cfg.preset);
    const seen = new Set();
    [...(p && p.models ? p.models : []), ...fetchedModels].forEach((m) => {
      if (seen.has(m)) return;
      seen.add(m);
      const o = document.createElement('option'); o.value = m; modelList.appendChild(o);
    });
  }
  modelHint.textContent = (presets.find((x) => x.id === cfg.preset) || {}).hint || '';
}
function wireSettings() {
  modelPill.addEventListener('click', openSettings);
  btnSettings.addEventListener('click', openSettings);
  btnCloseSettings.addEventListener('click', closeSettings);
  scrim.addEventListener('click', () => {
    closeSettings();
    closeAllDrawers();
    closeModal();
  });
  qa('button', protoSeg).forEach((b) =>
    b.addEventListener('click', () => {
      cfg.protocol = b.dataset.proto;
      applyCfgToForm();
    }));
  cfgBase.addEventListener('input', () => { cfg.baseUrl = cfgBase.value; cfg.preset = ''; markPresetNone(); });
  cfgKey.addEventListener('input', () => { cfg.apiKey = cfgKey.value; });
  cfgModel.addEventListener('input', () => { cfg.model = cfgModel.value; });
  cfgTemp.addEventListener('input', () => {
    cfg.temperature = parseFloat(cfgTemp.value);
    tempVal.textContent = cfg.temperature.toFixed(2);
  });
  cfgMaxTokens.addEventListener('input', () => { cfg.maxTokens = parseInt(cfgMaxTokens.value, 10) || 16000; });
  cfgExtra.addEventListener('input', () => { cfg.extraPrompt = cfgExtra.value; });
  if (cfgName) cfgName.addEventListener('input', () => {
    cfg.name = cfgName.value.trim() || '未命名配置';
    updateModelPill(); persistCfgs(); renderCfgList();
  });
  if (btnAddCfg) btnAddCfg.addEventListener('click', addCfg);
  btnToggleKey.addEventListener('click', () => {
    const show = cfgKey.type === 'password';
    cfgKey.type = show ? 'text' : 'password';
    btnToggleKey.textContent = show ? '隐藏' : '显示';
  });
  btnSaveCfg.addEventListener('click', () => {
    saveCfg(); updateModelPill();
    toast('配置已保存到本机浏览器', 'ok');
    closeSettings();
  });
  btnClearCfg.addEventListener('click', () => {
    clearCfg();
    toast('已清空模型配置', 'brass');
  });
  btnVerify.addEventListener('click', verifyConfig);
  if (btnFetchModels) btnFetchModels.addEventListener('click', fetchModelList);
}
/* 拉取当前端点的可用模型列表，填入 datalist 供下拉选择 */
async function fetchModelList() {
  const baseUrl = String(cfgBase.value || '').trim();
  if (!baseUrl) { toast('请先填写 API Base URL', 'brass'); cfgBase.focus(); return; }
  btnFetchModels.disabled = true;
  btnFetchModels.textContent = '拉取中…';
  try {
    const resp = await fetch(API.models, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol: cfg.protocol === 'anthropic' ? 'anthropic' : 'openai',
        baseUrl,
        apiKey: String(cfgKey.value || '').trim(),
      }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || 'HTTP ' + resp.status);
    fetchedModels = data.models || [];
    applyCfgToForm(); // 重新合并预设 + 拉取列表（会重置 hint，故在其后再写提示）
    modelHint.textContent = fetchedModels.length
      ? '已拉取 ' + fetchedModels.length + ' 个模型，点击输入框即可下拉选择'
      : '端点已连通，但未返回任何模型，可手动输入模型名';
    toast(fetchedModels.length ? '已拉取 ' + fetchedModels.length + ' 个模型' : '端点未返回模型列表', fetchedModels.length ? 'ok' : 'brass');
  } catch (err) {
    modelHint.textContent = '拉取失败：' + (err.message || '网络错误');
    toast('模型列表拉取失败：' + (err.message || '网络错误'), 'err');
  } finally {
    btnFetchModels.disabled = false;
    btnFetchModels.textContent = '拉取';
  }
}
function markPresetNone() {
  qa('.preset-chip', presetGrid).forEach((c) => c.classList.remove('active'));
}
function openSettings() {
  applyCfgToForm();
  renderCfgList();
  scrim.hidden = false;
  settingsEl.hidden = false;
}
function closeSettings() {
  settingsEl.hidden = true;
  if (allDrawersClosed() && xmlModal.hidden) scrim.hidden = true;
}

/* ══════════════════ 自动保存指示 ══════════════════ */
let lastSavedAt = 0;
let saveTickHandle = null;
function markSaved() {
  lastSavedAt = Date.now();
  renderSaveState();
}
function relTime(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return '刚刚';
  if (s < 60) return s + ' 秒前';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  return Math.floor(h / 24) + ' 天前';
}
function renderSaveState() {
  if (!saveInd || !saveText) return;
  if (lastSavedAt) {
    saveInd.classList.add('saved');
    saveInd.classList.remove('idle');
    saveText.textContent = '已自动保存 · ' + relTime(lastSavedAt);
  } else {
    saveInd.classList.remove('saved');
    saveInd.classList.add('idle');
    saveText.textContent = '尚未保存';
  }
}
function scheduleSaveTick() {
  renderSaveState();
  if (saveTickHandle) clearInterval(saveTickHandle);
  saveTickHandle = setInterval(renderSaveState, 15000);
}

/* ══════════════════ 数据备份 / 恢复 / 清空 ══════════════════ */
function collectBackup() {
  const data = {};
  for (const k of Object.values(LS)) {
    try { data[k] = localStorage.getItem(k); } catch (_) { data[k] = null; }
  }
  return {
    app: 'Diagram Atelier',
    schema: 1,
    exportedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    data,
  };
}
function backupData() {
  try {
    const payload = collectBackup();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = 'diagram-atelier-backup-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出全部本地数据备份', 'ok');
  } catch (e) {
    toast('导出备份失败：' + (e && e.message ? e.message : e), 'err');
  }
}
function restoreData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const src = parsed && parsed.data ? parsed.data : parsed;
      if (!src || typeof src !== 'object') throw new Error('文件格式不正确');
      let n = 0;
      for (const k of Object.values(LS)) {
        if (Object.prototype.hasOwnProperty.call(src, k) && src[k] != null) {
          localStorage.setItem(k, src[k]);
          n++;
        }
      }
      if (!n) throw new Error('备份中未找到可恢复的数据');
      toast('已恢复 ' + n + ' 项数据，即将刷新…', 'ok');
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      toast('恢复失败：' + (e && e.message ? e.message : e), 'err');
    }
  };
  reader.onerror = () => toast('读取文件失败', 'err');
  reader.readAsText(file);
}
let wipeArmed = false;
let wipeTimer = null;
function armWipe() {
  if (wipeArmed) {
    wipeArmed = false;
    if (wipeTimer) clearTimeout(wipeTimer);
    for (const k of Object.values(LS)) { try { localStorage.removeItem(k); } catch (_) {} }
    toast('已清空全部本地数据，即将刷新…', 'brass');
    setTimeout(() => location.reload(), 900);
    return;
  }
  wipeArmed = true;
  if (btnWipe) btnWipe.textContent = '再次点击确认清空';
  if (dmWarn) dmWarn.textContent = '⚠ 此操作不可恢复，再次点击立即执行';
  if (wipeTimer) clearTimeout(wipeTimer);
  wipeTimer = setTimeout(() => {
    wipeArmed = false;
    if (btnWipe) btnWipe.textContent = '清空全部本地数据';
    if (dmWarn) dmWarn.textContent = '将删除所有图表、对话与配置，不可恢复';
  }, 3500);
}
function wireDataMgmt() {
  if (btnBackup) btnBackup.addEventListener('click', backupData);
  if (btnRestore) btnRestore.addEventListener('click', () => { if (backupFile) backupFile.click(); });
  if (backupFile) backupFile.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    restoreData(f);
    e.target.value = '';
  });
  if (btnWipe) btnWipe.addEventListener('click', armWipe);
}
function wireTidy() {
  if (layoutPill) layoutPill.addEventListener('click', tidyLayout);
}
function wireFix() {
  if (fixPill) fixPill.addEventListener('click', repairDiagram);
}
async function verifyConfig() {
  const body = buildLlmBody();
  if (!body.baseUrl || !body.model) {
    verifyResult.textContent = '请先填写 API Base URL 与模型名称';
    verifyResult.className = 'verify-result err';
    return;
  }
  verifyResult.textContent = '连接测试中…';
  verifyResult.className = 'verify-result pending';
  btnVerify.disabled = true;
  try {
    const resp = await fetch(API.verify, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ llm: body }),
    });
    const data = await resp.json();
    if (data && data.ok) {
      verifyResult.textContent = '✓ 连通成功' + (data.model ? `（${data.model}）` : '');
      verifyResult.className = 'verify-result ok';
      saveCfg(); updateModelPill();
    } else {
      verifyResult.textContent = '✗ ' + (data && data.error ? data.error : '连接失败');
      verifyResult.className = 'verify-result err';
    }
  } catch (err) {
    verifyResult.textContent = '✗ ' + err.message;
    verifyResult.className = 'verify-result err';
  } finally {
    btnVerify.disabled = false;
  }
}

/* ══════════════════ 对话 / SSE ══════════════════ */
function nearBottom() {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
}
function autoScroll() {
  if (nearBottom()) messagesEl.scrollTop = messagesEl.scrollHeight;
}
function buildMsgActions(role, text, el) {
  const bar = document.createElement('div');
  bar.className = 'msg-actions';
  const mk = (label, title, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'msg-act'; b.title = title; b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  };
  bar.appendChild(mk('复制', '复制内容', () => copyMsg(el)));
  if (role === 'user') bar.appendChild(mk('编辑', '编辑并重新发送', () => editMsg(text)));
  else bar.appendChild(mk('重新生成', '重新生成回答（保留原回答）', () => regenerateFrom(el)));
  return bar;
}
function copyMsg(el) {
  const bubble = el.querySelector('.bubble');
  const txt = bubble ? bubble.innerText : '';
  navigator.clipboard.writeText(txt).then(
    () => toast('已复制到剪贴板', 'ok'),
    () => toast('复制失败，请手动选择', 'err')
  );
}
function editMsg(text) {
  input.value = text; autoGrow(); input.focus();
  toast('已载入输入框，修改后发送即可', 'brass');
}
function regenerateFrom(el) {
  if (busy) return;
  if (!hasConfig()) { openSettings(); toast('请先配置大模型', 'brass'); return; }
  const msgs = Array.from(messagesEl.children).filter((c) => c.classList.contains('msg'));
  const idx = msgs.indexOf(el);
  let userText = '';
  for (let i = idx - 1; i >= 0; i--) {
    if (msgs[i].classList.contains('user')) { userText = msgs[i].querySelector('.bubble').textContent; break; }
  }
  if (!userText) { toast('找不到对应的提问', 'err'); return; }
  removeEmptyState();
  streamCompletion(userText);   // 非破坏式：追加新回答，不覆盖原回答
}
function removeEmptyState() {
  const es = messagesEl.querySelector('.empty-state');
  if (es) es.remove();
}
function pushUserMsg(text) {
  const el = document.createElement('div');
  el.className = 'msg user';
  el.innerHTML = `<div class="bubble"></div>`;
  el.querySelector('.bubble').textContent = text;
  el.appendChild(buildMsgActions('user', text, el));
  messagesEl.appendChild(el);
  autoScroll();
}
function pushAssistantMsg() {
  removeEmptyState();
  const el = document.createElement('div');
  el.className = 'msg assistant';
  el.innerHTML = `<div class="avatar">AI</div><div class="bubble"><div class="typing"><i></i><i></i><i></i></div></div>`;
  el.appendChild(buildMsgActions('assistant', '', el));
  messagesEl.appendChild(el);
  autoScroll();
  return el.querySelector('.bubble');
}
function appendFinal(bubble, md) {
  // 已有思考块时保留它（折叠），只把最终内容写进正文区
  const parts = bubble.__parts;
  if (parts) {
    if (parts.thinkChars > 0) { parts.thinkBox.hidden = false; collapseThink(parts); }
    hideStageLine(parts);
    parts.ans.innerHTML = renderMarkdown(md || '');
    autoScroll();
    return;
  }
  bubble.innerHTML = renderMarkdown(md || '');
  autoScroll();
}
/* 未配置模型时的兜底引导：给新用户两条立刻可走的路（看示例 / 去配置） */
function pushNoConfigGuide() {
  removeEmptyState();
  // 同一时刻只保留一条引导消息，避免连续多次发送后堆叠
  const old = messagesEl.querySelector('.msg.guide');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'msg assistant guide';
  el.innerHTML = `<div class="avatar">AI</div><div class="bubble"></div>`;
  const bubble = el.querySelector('.bubble');
  bubble.append('我还画不了——需要先配置一个可用的大模型。你可以：');
  const row = document.createElement('div');
  row.className = 'guide-actions';
  const bSample = document.createElement('button');
  bSample.className = 'qchip';
  bSample.textContent = '先看内置示例（无需配置）';
  bSample.addEventListener('click', () => { closeSettings(); loadSample('flowchart', '流程图示例'); });
  const bCfg = document.createElement('button');
  bCfg.className = 'qchip';
  bCfg.textContent = '去配置模型';
  bCfg.addEventListener('click', openSettings);
  row.append(bSample, bCfg);
  bubble.appendChild(row);
  const tip = document.createElement('div');
  tip.className = 'guide-tip';
  tip.textContent = '配置完成后，刚才输入的需求会留在输入框，点发送即可。';
  bubble.appendChild(tip);
  messagesEl.appendChild(el);
  autoScroll();
}
/* 在助手消息上标注「已编辑当前图」，让增量修改可见 */
function markEdited(bubble) {
  const msg = bubble.closest('.msg');
  if (!msg || msg.querySelector('.edit-tag')) return;
  const tag = document.createElement('div');
  tag.className = 'edit-tag';
  tag.innerHTML = '<span class="et-dot"></span>已基于当前图修改';
  msg.insertBefore(tag, bubble);
}
function setBusy(b) {
  busy = b;
  btnSend.disabled = b;
  btnStop.hidden = !b;
}
function sendChat() {
  if (busy) return;
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  if (!hasConfig()) {
    openSettings();
    pushNoConfigGuide();
    toast('请先在「模型设置」里配置大模型', 'brass');
    return;
  }
  removeEmptyState();
  pushUserMsg(text);
  chatHistory.push({ role: 'user', content: text });
  if (conv) { conv.updatedAt = Date.now(); persistConversations(); renderConvList(); }
  input.value = ''; autoGrow();
  streamCompletion(text);
}
/* 从用户描述推断图类型，供 buildExtra 注入排版约束（语义库不可用时回退 auto） */
function detectTypeFromText(text) {
  try {
    if (window.DiagramSemantic) {
      const r = window.DiagramSemantic.detectIntent(text || '');
      if (r && r.type && r.type !== 'auto') return r.type;
    }
  } catch (_) {}
  return 'auto';
}
function streamCompletion(text) {
  if (busy) return;
  setBusy(true);
  streamingFrozen = false; streamText = '';
  const bubble = pushAssistantMsg();
  const editing = !!currentXml;          // 发送时若已有图，则本次为「基于当前图修改」
  bubble.dataset.edited = editing ? '1' : '';
  const type = detectTypeFromText(text);
  const body = {
    llm: buildLlmBody(),
    input: text,
    history: chatHistory.slice(0, -1),
    currentXml: currentXml || '',
    extraPrompt: buildExtra(type),
    mode: editing ? 'patch' : 'full',
  };
  const ac = new AbortController();
  currentFetch = ac;

  fetch(API.chat, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: ac.signal,
  }).then(async (resp) => {
    if (!resp.ok) {
      let em = '请求失败 (' + resp.status + ')';
      try { const j = await resp.json(); if (j && j.error) em = j.error; } catch (_) {}
      throw new Error(em);
    }
    await readSse(resp, bubble);
  }).catch((err) => {
    if (err && err.name === 'AbortError') appendFinal(bubble, '（已停止生成）');
    else { appendFinal(bubble, '⚠️ ' + (err && err.message || '生成出错')); toast((err && err.message) || '生成出错', 'err'); }
  }).finally(() => {
    setBusy(false); currentFetch = null;
  });
}
function readSse(resp, bubble) {
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const pump = () => reader.read().then(({ value, done }) => {
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
      dispatchSse(raw, bubble);
    }
    return pump();
  });
  return pump();
}
function parseSse(raw) {
  let event = 'message', data = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  try { return { event, data: JSON.parse(data) }; } catch (_) { return { event, data: null }; }
}
function dispatchSse(raw, bubble) {
  const { event, data } = parseSse(raw);
  if (event === 'think') {
    streamThink(bubble, (data && data.t) || '');
  } else if (event === 'stage') {
    const parts = ensureStreamParts(bubble);
    renderStageLine(parts, (data && data.label) || '');
  } else if (event === 'delta') {
    streamText += (data && data.t) || '';
    if (!streamingFrozen) {
      const fence = streamText.indexOf('```');
      const mx = streamText.indexOf('<mxfile');
      if (fence >= 0 && mx > fence) { streamingFrozen = true; renderStream(bubble, true); }
      else renderStream(bubble, false);
    }
  } else if (event === 'done') {
    onDone(data, bubble);
  } else if (event === 'error') {
    appendFinal(bubble, '⚠️ ' + ((data && data.error) || '生成出错'));
    toast((data && data.error) || '生成出错', 'err');
  }
}
/* ─── 流式过程展示：思维链（思考过程）+ 阶段指示 ─── */
function ensureStreamParts(bubble) {
  let parts = bubble.__parts;
  if (!parts) {
    bubble.innerHTML =
      '<div class="think-box" data-collapsed="0" hidden>' +
        '<button class="think-head" type="button" aria-expanded="true">' +
          '<span class="think-dot"></span><span class="think-label">思考过程</span>' +
          '<span class="think-meta"></span><span class="think-chev">▾</span>' +
        '</button>' +
        '<div class="think-body"></div>' +
      '</div>' +
      '<div class="stage-line" hidden></div>' +
      '<div class="ans"></div>';
    const head = bubble.querySelector('.think-head');
    head.addEventListener('click', () => {
      const box = bubble.querySelector('.think-box');
      const open = box.dataset.collapsed === '1';
      box.dataset.collapsed = open ? '0' : '1';
      head.setAttribute('aria-expanded', String(open));
    });
    parts = {
      thinkBox: bubble.querySelector('.think-box'),
      thinkBody: bubble.querySelector('.think-body'),
      thinkMeta: bubble.querySelector('.think-meta'),
      stageLine: bubble.querySelector('.stage-line'),
      ans: bubble.querySelector('.ans'),
      thinkRaw: '',
      thinkChars: 0,
      thinkStart: 0,
    };
    bubble.__parts = parts;
  }
  return parts;
}
function streamThink(bubble, chunk) {
  if (!chunk) return;
  const parts = ensureStreamParts(bubble);
  if (parts.thinkChars === 0) {
    parts.thinkStart = Date.now();
    parts.thinkBox.hidden = false;
    parts.thinkBox.dataset.collapsed = '0';
    renderStageLine(parts, '深度思考中…');
  }
  parts.thinkChars += chunk.length;
  parts.thinkRaw += chunk;
  // 防止超长思维链撑爆 DOM：只保留最近一段
  if (parts.thinkRaw.length > 9000) parts.thinkRaw = parts.thinkRaw.slice(-8000);
  parts.thinkBody.textContent = parts.thinkRaw;
  parts.thinkBody.scrollTop = parts.thinkBody.scrollHeight;
  autoScroll();
}
function collapseThink(parts) {
  parts.thinkBox.dataset.collapsed = '1';
  parts.thinkBox.querySelector('.think-head').setAttribute('aria-expanded', 'false');
  if (parts.thinkChars > 0) {
    const secs = Math.max(1, Math.round((Date.now() - parts.thinkStart) / 1000));
    parts.thinkMeta.textContent = '已思考 ' + secs + ' 秒 · ' + parts.thinkChars + ' 字';
  }
}
function renderStageLine(parts, label) {
  if (!parts || !label) return;
  parts.stageLine.hidden = false;
  parts.stageLine.innerHTML = '<span class="stage-dot"></span>' + esc(label);
}
function hideStageLine(parts) {
  if (parts) parts.stageLine.hidden = true;
}
function renderStream(bubble, frozen) {
  const parts = ensureStreamParts(bubble);
  // 正文开始输出：折叠思考块并标注耗时
  if (parts.thinkChars > 0 && parts.thinkBox.dataset.collapsed === '0') collapseThink(parts);
  renderStageLine(parts, frozen ? '正在排版图表…' : '生成图表中…');
  if (frozen) {
    const fence = streamText.indexOf('```');
    const intro = fence >= 0 ? streamText.slice(0, fence) : streamText;
    parts.ans.innerHTML = renderMarkdown(intro) +
      '<div class="typing"><i></i><i></i><i></i></div> <span style="color:var(--muted);font-size:12px">正在排版图表…</span>';
  } else {
    parts.ans.innerHTML = renderMarkdown(streamText);
    autoScroll();
  }
}
function onDone(data, bubble) {
  if (!data) return;
  let reply = data.reply || (data.xml ? '图表已生成。' : '');
  const intro = streamText.indexOf('```') >= 0 ? streamText.slice(0, streamText.indexOf('```')) : streamText;
  const finalMd = reply || intro;
  // 结束态：思考块折叠保留（可展开回看），阶段指示隐藏，正文写最终说明
  const parts = bubble.__parts;
  if (parts) {
    if (parts.thinkChars > 0) { parts.thinkBox.hidden = false; collapseThink(parts); }
    hideStageLine(parts);
    parts.ans.innerHTML = renderMarkdown(finalMd);
    autoScroll();
  } else {
    appendFinal(bubble, finalMd);
  }
  chatHistory.push({ role: 'assistant', content: reply || '' });
  const editedHere = bubble.dataset.edited === '1';
  let finalXml = null;
  let finalSummary = null;

  if (data.mode === 'patch' && data.patch && currentXml) {
    try {
      const patchResult = applyXmlPatch(currentXml, data.patch);
      if (!patchResult.ok) {
        console.warn('patch 部分失败', patchResult.errors);
        toast(`patch 应用: ${patchResult.applied.length} 成功, ${patchResult.errors.length} 失败`, 'brass');
      }
      finalXml = patchResult.xml;
      finalSummary = null; // loadXml 后会触发 updateDiagramInsight 刷新统计
      reply = reply || `已应用 ${patchResult.applied.length} 处改动`;
    } catch (err) {
      appendFinal(bubble, '⚠️ patch 应用失败：' + err.message);
      toast('patch 应用失败：' + err.message, 'err');
      setValid(false, [err.message], null);
      return;
    }
  } else if (data.xml) {
    finalXml = data.xml;
    finalSummary = data.summary;
  }

  if (finalXml) {
    loadXml(finalXml);
    updateStats(finalSummary);
    setValid(data.valid, data.errors, data.autofix);
    pushVersion((editedHere ? '修改：' : '') + (reply || '图表'), finalXml, finalSummary);
    if (editedHere) markEdited(bubble);
    if (conv) { conv.xml = finalXml; conv.summary = finalSummary || null; }
  } else {
    setValid(false, data.errors || ['本次未返回 XML'], null);
  }
  if (conv) {
    conv.updatedAt = Date.now();
    if (conv.name === '新对话' || !conv.name) conv.name = autoTitle();
    persistConversations();
    renderConvList();
  }
}
function updateStats(summary) {
  if (!summary) return;
  const vSpan = statV && statV.querySelector('b');
  const eSpan = statE && statE.querySelector('b');
  if (vSpan) vSpan.textContent = summary.vertices ?? 0;
  if (eSpan) eSpan.textContent = summary.edges ?? 0;
}
function setValid(valid, errors, autofix) {
  validPill.classList.remove('ok', 'err', 'fixing');
  if (autofix && autofix.length) {
    validPill.classList.add('fixing');
    validPill.textContent = '已自动修复 ' + autofix.length + ' 处';
    setTimeout(() => setValidFinal(valid), 1400);
  } else {
    setValidFinal(valid, errors);
  }
}
function setValidFinal(valid, errors) {
  validPill.classList.remove('ok', 'err', 'fixing');
  if (valid) { validPill.classList.add('ok'); validPill.textContent = 'XML 合法'; }
  else { validPill.classList.add('err'); validPill.textContent = (errors && errors[0]) ? '校验未过' : '等待生成'; }
}
function pushVersion(title, xml, summary) {
  versions.unshift({
    id: Date.now(),
    title: (title || '图表').slice(0, 40),
    time: Date.now(),
    xml,
    summary: summary || null,
  });
  if (versions.length > 40) versions = versions.slice(0, 40);
  try { localStorage.setItem(LS.versions, JSON.stringify(versions)); } catch (_) {}
  verBadge.textContent = versions.length;
}

/* ══════════════════ 对话历史（每对话独立上下文） ══════════════════ */
function loadConversations() {
  try {
    const raw = localStorage.getItem(LS.conversations);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        return arr.map((c) => ({
          id: c.id || ('conv-' + Date.now() + Math.random().toString(36).slice(2, 5)),
          name: c.name || '新对话',
          createdAt: c.createdAt || Date.now(),
          updatedAt: c.updatedAt || Date.now(),
          history: Array.isArray(c.history) ? c.history : [],
          xml: c.xml || '',
          summary: c.summary || null,
        }));
      }
    }
  } catch (_) {}
  return [{ id: 'conv-' + Date.now(), name: '新对话', createdAt: Date.now(), updatedAt: Date.now(), history: [], xml: '', summary: null }];
}
function persistConversations() {
  try { localStorage.setItem(LS.conversations, JSON.stringify(conversations)); } catch (_) {}
  markSaved();
}
function setActiveConv(id) {
  activeConvId = id;
  conv = conversations.find((c) => c.id === id) || conversations[0];
  chatHistory = conv ? conv.history : [];
}
function autoTitle() {
  const firstUser = (chatHistory || []).find((h) => h.role === 'user');
  if (firstUser && firstUser.content) return firstUser.content.slice(0, 22);
  return '新对话';
}
function newConversation() {
  clearLiveShare();
  const c = {
    id: 'conv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
    name: '新对话', createdAt: Date.now(), updatedAt: Date.now(),
    history: [], xml: '', summary: null,
  };
  conversations.push(c);
  setActiveConv(c.id);
  messagesEl.innerHTML = '';
  addEmptyState();
  currentXml = '';
  previewWrap.innerHTML = '';
  previewEmpty.hidden = false;
  persistConversations(); renderConvList();
  toast('已开启新对话', 'ok');
}
function selectConversation(id) {
  clearLiveShare();
  const c = conversations.find((x) => x.id === id);
  if (!c) return;
  setActiveConv(id);
  chatHistory = c.history;
  rebuildMessages(c.history);
  currentXml = c.xml || '';
  if (currentXml) renderPreview(currentXml);
  else { previewWrap.innerHTML = ''; previewEmpty.hidden = false; }
  canvasTitle.textContent = c.name || '画布';
  persistConversations(); renderConvList();
  closeAllDrawers();
  closeConvDrawer();
  toast('已切换到「' + (c.name || '对话') + '」', 'ok');
}
function deleteConversation(id) {
  if (conversations.length <= 1) {
    const c = conversations[0];
    c.history = []; c.xml = ''; c.summary = null; c.name = '新对话'; c.updatedAt = Date.now();
    if (activeConvId === id) selectConversation(c.id);
    else { persistConversations(); renderConvList(); }
    toast('已清空该对话', 'ok');
    return;
  }
  conversations = conversations.filter((c) => c.id !== id);
  if (activeConvId === id) selectConversation(conversations[0].id);
  else { persistConversations(); renderConvList(); }
  toast('已删除对话', 'ok');
}
function rebuildMessages(history) {
  messagesEl.innerHTML = '';
  if (!history || !history.length) { addEmptyState(); return; }
  history.forEach((h) => {
    if (h.role === 'user') pushUserMsg(h.content);
    else if (h.role === 'assistant') { const b = pushAssistantMsg(); appendFinal(b, h.content || ''); }
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
function renderConvList() {
  if (!convList) return;
  convList.innerHTML = '';
  if (!conversations.length) {
    convList.innerHTML = '<div class="empty-state"><p>还没有对话</p></div>';
    return;
  }
  const sorted = conversations.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  sorted.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'conv-item' + (c.id === activeConvId ? ' active' : '');
    item.dataset.id = c.id;
    const time = fmtTime(c.updatedAt || c.createdAt);
    const cnt = (c.history ? c.history.length : 0);
    item.innerHTML =
      `<div class="conv-main"><div class="conv-name">${esc(c.name || '新对话')}</div>` +
      `<div class="conv-meta">${cnt} 条消息 · ${time}</div></div>` +
      `<button class="conv-del" title="删除对话" data-del="${c.id}">×</button>`;
    item.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      selectConversation(c.id);
    });
    item.querySelector('[data-del]').addEventListener('click', (e) => {
      e.stopPropagation(); deleteConversation(c.id);
    });
    convList.appendChild(item);
  });
}
function openConvDrawer() { if (convDrawer) { convDrawer.hidden = false; renderConvList(); } }
function closeConvDrawer() { if (convDrawer) convDrawer.hidden = true; }

/* ══════════════════ draw.io 编辑器桥接 ══════════════════ */
function initEditor() {
  clearTimeout(editorWatchdog);
  drawio.src = EDITOR_URL;
  window.addEventListener('message', onEditorMessage);
  editorWatchdog = setTimeout(() => {
    if (!editorReady) showStage('error');
  }, 12000);
}
function onIframeLoad() {
  if (editorReady || !bootSub) return;
  bootSub.textContent = '编辑器已连接，正在初始化…';
}
function onEditorMessage(e) {
  let msg;
  try { msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (_) { return; }
  if (!msg || typeof msg !== 'object') return;
  switch (msg.event) {
    case 'init':
      editorReady = true;
      clearTimeout(editorWatchdog);
      hideStage();
      if (pendingXml != null) { const x = pendingXml; pendingXml = null; postLoad(x); }
      else if (currentXml) postLoad(currentXml);
      break;
    case 'load':
    case 'autosave':
    case 'save':
      applyEditorXml(msg.xml);
      break;
    case 'export':
      // format=xml 的回包来自「切回预览」的兜底同步请求，避免与图片导出（msg.data）混淆
      if (pendingXmlSync && msg.format === 'xml' && typeof msg.xml === 'string' && msg.xml) {
        pendingXmlSync = false;
        clearTimeout(xmlSyncWatchdog);
        applyEditorXml(msg.xml);
        break;
      }
      onExport(msg);
      break;
    default:
      break;
  }
}
function postLoad(xml) {
  if (drawio.contentWindow) {
    // autosave 是 load 消息参数（非 URL 参数）：启用后编辑器每次改动都会回传 {event:'autosave', xml}
    drawio.contentWindow.postMessage(
      JSON.stringify({ action: 'load', xml, title: 'Atelier', spin: 'load', autosave: 1 }), '*');
  }
}
/* 把编辑器回传的最新 XML 应用到全局状态（autosave / save / 切换兜底共用一条路径） */
function applyEditorXml(xml) {
  if (typeof xml !== 'string' || !xml) return;
  currentXml = xml;
  persistSession();
  scheduleLiveSync(); // 精修模式改动也要实时同步到分享链接
  // 实时协作：精修模式手动改图经编辑器回传，广播给协作者（remoteEchoUntil 抑制远端 doc 回环）
  if (collab && collab.connected && Date.now() > remoteEchoUntil) collab.broadcastDoc(xml);
  if (viewMode === 'preview') renderPreview(xml);
}
/* 切回预览时向编辑器索取当前图 XML（autosave 的双保险），带回包看门狗 */
function requestEditorXml() {
  if (!editorReady || !drawio.contentWindow) return false;
  pendingXmlSync = true;
  postToEditor({ action: 'export', format: 'xml' });
  clearTimeout(xmlSyncWatchdog);
  xmlSyncWatchdog = setTimeout(() => {
    if (!pendingXmlSync) return;
    pendingXmlSync = false;
    if (viewMode === 'preview' && currentXml) renderPreview(currentXml);
  }, 1500);
  return true;
}

/* ─── 增量 patch 应用（对话即改图）─── */
function applyPatchOp(doc, root, op) {
  const type = String(op.op || '').trim();
  const id = String(op.id || '').trim();
  if (!id) throw new Error('patch op 缺少 id');
  const findCell = (cid) => Array.from(root.children).find((c) => c.getAttribute('id') === cid) || null;
  const createCell = (cid) => { const c = doc.createElement('mxCell'); c.setAttribute('id', cid); return c; };
  const ensureGeo = (cell) => {
    let g = cell.querySelector(':scope > mxGeometry');
    if (!g) { g = doc.createElement('mxGeometry'); g.setAttribute('as', 'geometry'); cell.appendChild(g); }
    return g;
  };
  const setGeo = (g, k, v) => { if (v !== undefined && v !== null) g.setAttribute(k, String(v)); };

  if (type === 'add') {
    if (findCell(id)) throw new Error(`id ${id} 已存在`);
    const cellType = String(op.type || '').trim();
    if (cellType !== 'vertex' && cellType !== 'edge') throw new Error('add 类型必须是 vertex 或 edge');
    const cell = createCell(id);
    cell.setAttribute(cellType === 'vertex' ? 'vertex' : 'edge', '1');
    cell.setAttribute('parent', String(op.parent || '1'));
    if (op.value !== undefined) cell.setAttribute('value', String(op.value));
    if (op.style !== undefined) cell.setAttribute('style', String(op.style));
    if (cellType === 'edge') {
      if (op.source) cell.setAttribute('source', String(op.source));
      if (op.target) cell.setAttribute('target', String(op.target));
      ensureGeo(cell).setAttribute('relative', '1');
    } else {
      const g = ensureGeo(cell);
      setGeo(g, 'x', op.x); setGeo(g, 'y', op.y); setGeo(g, 'width', op.width); setGeo(g, 'height', op.height);
    }
    root.appendChild(cell);
  } else if (type === 'update') {
    const cell = findCell(id); if (!cell) throw new Error(`id ${id} 不存在`);
    if (op.value !== undefined) cell.setAttribute('value', String(op.value));
    if (op.style !== undefined) cell.setAttribute('style', String(op.style));
    if (op.source !== undefined) cell.setAttribute('source', String(op.source));
    if (op.target !== undefined) cell.setAttribute('target', String(op.target));
    if (op.parent !== undefined) cell.setAttribute('parent', String(op.parent));
    if (cell.getAttribute('vertex') === '1') {
      const g = ensureGeo(cell);
      setGeo(g, 'x', op.x); setGeo(g, 'y', op.y); setGeo(g, 'width', op.width); setGeo(g, 'height', op.height);
    }
  } else if (type === 'delete') {
    const cell = findCell(id); if (!cell) throw new Error(`id ${id} 不存在`);
    if (cell.getAttribute('vertex') === '1') {
      Array.from(root.children).forEach((c) => {
        if (c.getAttribute('edge') === '1' && (c.getAttribute('source') === id || c.getAttribute('target') === id)) root.removeChild(c);
      });
    }
    root.removeChild(cell);
  } else {
    throw new Error(`未知 patch op: ${type}`);
  }
}

function applyXmlPatch(xml, patch) {
  if (!patch || !Array.isArray(patch.ops)) throw new Error('patch 格式错误');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.querySelector('mxGraphModel > root');
  if (!root) throw new Error('XML 结构异常');
  const applied = [];
  const errors = [];
  for (const op of patch.ops) {
    try { applyPatchOp(doc, root, op); applied.push(op.id); }
    catch (err) { errors.push({ id: op.id, error: err.message }); }
  }
  return { xml: new XMLSerializer().serializeToString(doc), applied, errors, ok: errors.length === 0 };
}

/* ══════════════════ 实时协作（CollabClient，浏览器原生 WebSocket） ══════════════════
 * 零依赖：直接复用浏览器 WebSocket，对接后端 lib/collab.js 的原生 WS 协议。
 * 合并点唯一：远端 doc 经 loadXml 应用，与本地编辑 / AI 改图 / 撤销重做同一条路径，天然一致。
 * 回声抑制：applyingRemote 屏蔽「应用远端 doc 时 loadXml 自身的广播」；remoteEchoUntil
 *            屏蔽「远端 doc 经 draw.io 编辑器重新 save 回来」造成的回环广播。 */
let collab = null;            // CollabClient 实例
let applyingRemote = false;   // 正在应用远端 doc，禁用 loadXml 内的回声广播
let remoteEchoUntil = 0;      // 时间戳：此前不广播（抑制编辑器回环）

function initials(name) {
  const s = String(name || '').trim();
  return s ? s.slice(0, 1).toUpperCase() : '?';
}

class CollabClient {
  constructor() {
    this.ws = null;
    this.room = null;
    this.name = '我';
    this.peers = new Map();   // id -> { name, color }
    this.me = null;           // { clientId, color }
    this.connected = false;
    this._lastCursor = 0;
  }
  connect(room, name) {
    this.room = room;
    this.name = name || '我';
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = proto + '://' + location.host + '/collab?room=' + encodeURIComponent(room);
    try { this.ws = new WebSocket(wsUrl); }
    catch (err) { toast('协作连接失败：' + err.message, 'bad'); return; }
    this.ws.onopen = () => {
      this.connected = true;
      this.send({ type: 'hello', name: this.name });
      if (btnCollab) btnCollab.classList.add('active');
      if (collabLayer) collabLayer.hidden = false;
      toast('已接入协作房间', 'ok');
    };
    this.ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
      this.handle(msg);
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.peers.clear();
      if (btnCollab) btnCollab.classList.remove('active');
      if (collabPresence) collabPresence.innerHTML = '';
      if (collabCursors) collabCursors.innerHTML = '';
    };
    this.ws.onerror = () => { if (!this.connected) toast('协作连接失败', 'bad'); };
  }
  send(obj) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(obj)); } catch (_) {}
    }
  }
  handle(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'welcome':
        this.me = { clientId: msg.clientId };
        this.peers.clear();
        (msg.peers || []).forEach((p) => this.peers.set(p.id, { name: p.name, color: p.color }));
        this.renderPresence();
        break;
      case 'peer-join':
        this.peers.set(msg.id, { name: msg.name, color: msg.color });
        this.renderPresence();
        this.removeCursor(msg.id);
        break;
      case 'peer-leave':
        this.peers.delete(msg.id);
        this.renderPresence();
        this.removeCursor(msg.id);
        break;
      case 'doc':
        if (msg.from && typeof msg.xml === 'string') {
          applyingRemote = true;
          remoteEchoUntil = Date.now() + 600; // 抑制编辑器回环
          loadXml(msg.xml);
          applyingRemote = false;
        }
        break;
      case 'cursor':
        this.renderCursor(msg.id, msg.x, msg.y, msg.name, msg.color);
        break;
      case 'selection':
        break; // 预留：远端选中高亮
    }
  }
  broadcastDoc(xml) { this.send({ type: 'doc', xml }); }
  sendCursor(x, y) { this.send({ type: 'cursor', x, y }); }
  renderPresence() {
    if (!collabPresence) return;
    const items = ['<span class="cp-dot me" title="你（' + esc(this.name) + '）">' + esc(initials(this.name)) + '</span>'];
    for (const [id, p] of this.peers) {
      items.push('<span class="cp-dot" style="background:' + esc(p.color) + '" title="' + esc(p.name) + '">' + esc(initials(p.name)) + '</span>');
    }
    collabPresence.innerHTML = items.join('');
  }
  renderCursor(id, x, y, name, color) {
    if (!collabCursors) return;
    let el = document.getElementById('rc-' + id);
    if (x == null || y == null) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.className = 'rc-cursor';
      el.id = 'rc-' + id;
      el.innerHTML = '<svg class="rc-arrow" viewBox="0 0 24 24" width="22" height="22"><path d="M5 3l14 7-6 1.6L10.5 19z"/></svg><span class="rc-name"></span>';
      collabCursors.appendChild(el);
    }
    const c = color || (this.peers.get(id) && this.peers.get(id).color) || '#e6492d';
    const arrow = el.querySelector('.rc-arrow path');
    if (arrow) arrow.setAttribute('fill', c);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    const nm = name || (this.peers.get(id) && this.peers.get(id).name) || '协作者';
    el.querySelector('.rc-name').textContent = nm;
    el.querySelector('.rc-name').style.background = c;
  }
  removeCursor(id) {
    const el = document.getElementById('rc-' + id);
    if (el) el.remove();
  }
  disconnect() {
    if (this.ws) { try { this.ws.close(); } catch (_) {} }
    this.ws = null; this.connected = false; this.peers.clear();
  }
}

function collabInviteUrl(room) {
  return location.origin + location.pathname + '?collab=' + encodeURIComponent(room);
}
function copyCollabInvite(room) {
  const r = room || (collab && collab.room);
  if (!r) return;
  const url = collabInviteUrl(r);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(
      () => toast('协作邀请链接已复制', 'ok'),
      () => toast('邀请链接：' + url, 'brass')
    );
  } else {
    toast('邀请链接：' + url, 'brass');
  }
}
function startCollab(room, name) {
  collab = new CollabClient();
  collab.connect(room, name || '我');
}
function openCollab() {
  if (collab && collab.connected) { copyCollabInvite(); return; }
  let room = new URLSearchParams(location.search).get('collab');
  if (!room) room = 'r-' + Math.random().toString(36).slice(2, 9);
  startCollab(room, '我');
  copyCollabInvite(room);
}
function wireCollab() {
  if (!btnCollab) return;
  btnCollab.addEventListener('click', openCollab);
  if (canvasStage) {
    canvasStage.addEventListener('mousemove', (e) => {
      if (!collab || !collab.connected) return;
      const now = Date.now();
      if (now - collab._lastCursor < 45) return;
      collab._lastCursor = now;
      const rect = canvasStage.getBoundingClientRect();
      collab.sendCursor(Math.round(e.clientX - rect.left), Math.round(e.clientY - rect.top));
    });
  }
}

function loadXml(xml) {
  if (!suppressHist && currentXml && currentXml !== xml) {
    xmlUndo.push(currentXml);
    if (xmlUndo.length > 80) xmlUndo.shift();
    xmlRedo = [];
  }
  currentXml = xml;
  persistSession();
  updateDiagramInsight();
  if (viewMode === 'editor') {
    if (!editorReady) { pendingXml = xml; return; }
    postLoad(xml);
  } else {
    renderPreview(xml);
    pendingXml = xml; // 供稍后进入精修模式时载入
  }
  // 若当前对话已生成分享链接，防抖同步到只读页（实时化核心）
  scheduleLiveSync();
  // 实时协作：本地变更（AI 改图 / 撤销重做 / 模板载入 / 远端合并后的再编辑）经唯一合并点广播
  if (collab && collab.connected && !applyingRemote && Date.now() > remoteEchoUntil) {
    collab.broadcastDoc(currentXml);
  }
}
/* 预览模式撤销/重做（精修模式交由 draw.io 内核处理） */
function doUndo() {
  /* embed 协议没有 undo/redo 顶层 action，须经 invokeAction 转发（见 drawio 官方文档） */
  if (viewMode === 'editor') { postToEditor({ action: 'invokeAction', actionName: 'undo' }); return; }
  if (!xmlUndo.length) { toast('没有可撤销的操作', 'brass'); return; }
  xmlRedo.push(currentXml);
  const prev = xmlUndo.pop();
  suppressHist = true; loadXml(prev); suppressHist = false;
  toast('已撤销', 'ok');
}
function doRedo() {
  if (viewMode === 'editor') { postToEditor({ action: 'invokeAction', actionName: 'redo' }); return; }
  if (!xmlRedo.length) { toast('没有可重做的操作', 'brass'); return; }
  xmlUndo.push(currentXml);
  const nxt = xmlRedo.pop();
  suppressHist = true; loadXml(nxt); suppressHist = false;
  toast('已重做', 'ok');
}

/* ─── 离线预览渲染 + 平移/缩放（CSS transform 方案） ─── */
function renderPreview(xml) {
  if (!window.DiagramRender) return;
  const r = window.DiagramRender.render(previewWrap, xml);
  if (r.ok) {
    previewSvg = previewWrap.querySelector('svg');
    previewBBox = r.bbox;
    previewScale = 1; previewPanX = 0; previewPanY = 0;
    previewFit();
    previewEmpty.hidden = true;
    wirePreviewInteractions();
    ensurePreviewCanvas();
    renderPins();
  } else {
    previewEmpty.hidden = false;
    toast('预览渲染失败：' + (r.error || '未知错误'), 'err');
  }
}
function previewApplyTransform() {
  const t = `translate(${previewPanX.toFixed(1)}px, ${previewPanY.toFixed(1)}px) scale(${previewScale})`;
  if (previewSvg) previewSvg.style.transform = t;
  if (annoLayer) annoLayer.style.transform = t;
  updateZoomLabel();
}
function updateZoomLabel() {
  const lbl = qa('[data-act="resetView"]', canvasTitle.closest('.canvas-bar'))[0];
  if (lbl) lbl.textContent = Math.round(previewScale * 100) + '%';
}
function previewFit() {
  if (!previewSvg || !previewBBox) return;
  const VW = previewWrap.clientWidth || 800;
  const VH = previewWrap.clientHeight || 600;
  const s = clamp(Math.min(VW / previewBBox.w, VH / previewBBox.h) * 0.92, 0.1, 2);
  previewScale = s;
  previewPanX = (VW - previewBBox.w * s) / 2;
  previewPanY = (VH - previewBBox.h * s) / 2;
  previewApplyTransform();
}
function previewZoom(factor) {
  if (!previewSvg) return;
  const VW = previewWrap.clientWidth || 800;
  const VH = previewWrap.clientHeight || 600;
  previewZoomAt(factor, VW / 2, VH / 2);
}
function previewZoomAt(factor, cx, cy) {
  const ns = clamp(previewScale * factor, 0.1, 5);
  const k = ns / previewScale;
  previewPanX = cx - (cx - previewPanX) * k;
  previewPanY = cy - (cy - previewPanY) * k;
  previewScale = ns;
  previewApplyTransform();
}
function wirePreviewInteractions() {
  if (previewWired) return;
  previewWired = true;
  const el = previewWrap;
  el.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) return;   // 放行浏览器原生缩放（触控板 pinch 也带 Ctrl）
    if (!currentXml) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    previewZoomAt(factor, cx, cy);
  }, { passive: false });
  // ── 指针交互：鼠标 / 单指平移 / 双指 pinch 缩放（零依赖，纯 PointerEvent）──
  const pts = new Map();            // pointerId -> {x, y}（同时 tracked 的触点）
  let panning = false, psx = 0, psy = 0, ppx = 0, ppy = 0;
  let pinch = null;                 // {cx, cy, dist} 上一帧双指中点与间距
  const avgPt = () => {
    let x = 0, y = 0; for (const p of pts.values()) { x += p.x; y += p.y; }
    const n = pts.size || 1; return { x: x / n, y: y / n };
  };
  const pinchDist = () => {
    const a = [...pts.values()];
    return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
  };
  el.addEventListener('pointerdown', (e) => {
    if (!currentXml) return;
    if (e.button !== 0) return;
    if (annotateMode) {
      const u = screenToUser(e.clientX, e.clientY);
      if (u) addComment(u.x, u.y);
      return;
    }
    if (e.target.closest('.pe-chip, button, a, input, textarea')) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    if (pts.size === 1) {
      panning = true; psx = e.clientX; psy = e.clientY; ppx = previewPanX; ppy = previewPanY;
      el.classList.add('grabbing');
    } else if (pts.size === 2) {
      panning = false; el.classList.remove('grabbing');
      const c = avgPt(); pinch = { cx: c.x, cy: c.y, dist: pinchDist() };
    }
  });
  el.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size >= 2 && pinch) {
      const c = avgPt(); const d = pinchDist();
      const rect = el.getBoundingClientRect();
      const cx = c.x - rect.left, cy = c.y - rect.top;
      const dfactor = d / (pinch.dist || d);
      const ns = clamp(previewScale * dfactor, 0.1, 5);
      const k = ns / previewScale;
      previewPanX = cx - (cx - previewPanX) * k + (c.x - pinch.cx);
      previewPanY = cy - (cy - previewPanY) * k + (c.y - pinch.cy);
      previewScale = ns;
      previewApplyTransform();
      pinch.cx = c.x; pinch.cy = c.y; pinch.dist = d;
    } else if (panning) {
      previewPanX = ppx + (e.clientX - psx);
      previewPanY = ppy + (e.clientY - psy);
      previewApplyTransform();
    }
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) { panning = false; el.classList.remove('grabbing'); }
    else if (pts.size === 1) {
      const [p] = [...pts.values()];
      psx = p.x; psy = p.y; ppx = previewPanX; ppy = previewPanY; panning = true;
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', (e) => {
    if (e.target.closest('.pe-chip, button')) return;
    previewFit();
  });
}
function postToEditor(payload) {
  if (drawio.contentWindow) drawio.contentWindow.postMessage(JSON.stringify(payload), '*');
}
function exportDiagram(fmt) {
  if (!currentXml) { toast('画布为空，无法导出', 'err'); return; }
  pendingExport = fmt;
  postToEditor({ action: 'export', format: fmt, xml: currentXml, spin: 'export' });
}
function onExport(msg) {
  const fmt = pendingExport;
  const data = msg && msg.data;
  if (!data) { pendingExport = null; return; }
  if (fmt === 'png') downloadDataUrl(data, 'diagram.png');
  else if (fmt === 'svg') downloadText(data, 'diagram.svg', 'image/svg+xml');
  if (fmt) toast('已导出 ' + fmt.toUpperCase(), 'ok');
  pendingExport = null;
}
function canvasAction(act) {
  if (viewMode === 'preview') {
    if (act === 'zoomIn') previewZoom(1.25);
    else if (act === 'zoomOut') previewZoom(0.8);
    else if (act === 'fit' || act === 'resetView') previewFit();
    else if (act === 'undo') doUndo();
    else if (act === 'redo') doRedo();
    return;
  }
  /* embed 协议中 undo/redo/zoom 等均须走 invokeAction；fit 是顶层专用 action */
  const viaInvoke = { undo: 'undo', redo: 'redo', zoomIn: 'zoomIn', zoomOut: 'zoomOut', resetView: 'actualSize' };
  if (viaInvoke[act]) postToEditor({ action: 'invokeAction', actionName: viaInvoke[act] });
  else if (act === 'fit') postToEditor({ action: 'fit', border: 16, maxScale: 3 });
}

/* ══════════════════ 评论批注（Phase 3 ②） ══════════════════ */
let annoLayer = null;        // 覆盖在 SVG 上的批注层（与 SVG 共享 origin:0,0 + 同 transform）
let annotateMode = false;    // 是否处于「点选落批注」模式
let commentsDrawer, btnAnnotate, btnComments, cmtBadge, commentsList;

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function getComments() {
  if (!conv) return [];
  if (!conv.comments) conv.comments = [];
  return conv.comments;
}
function ensurePreviewCanvas() {
  if (!previewSvg || !previewBBox) return;
  annoLayer = document.createElement('div');
  annoLayer.className = 'anno-layer';
  annoLayer.style.width = previewBBox.w + 'px';
  annoLayer.style.height = previewBBox.h + 'px';
  previewWrap.appendChild(annoLayer);
  previewApplyTransform();
}
function screenToUser(clientX, clientY) {
  if (!previewSvg) return null;
  const pt = previewSvg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const ctm = previewSvg.getScreenCTM();
  if (!ctm) return null;
  const u = pt.matrixTransform(ctm.inverse());
  return { x: u.x, y: u.y };
}
function renderPins() {
  if (!annoLayer) return;
  annoLayer.innerHTML = '';
  const list = getComments();
  list.forEach((c, i) => {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'anno-pin' + (c.resolved ? ' resolved' : '');
    pin.style.left = ((c.x || 0) - previewBBox.minX) + 'px';
    pin.style.top = ((c.y || 0) - previewBBox.minY) + 'px';
    pin.textContent = String(i + 1);
    pin.title = (c.text || '（空批注）') + (c.resolved ? ' · 已解决' : '');
    pin.addEventListener('pointerdown', (e) => e.stopPropagation());
    pin.addEventListener('click', (e) => { e.stopPropagation(); focusComment(c.id); });
    annoLayer.appendChild(pin);
  });
  updateCommentsBadge();
}
function updateCommentsBadge() {
  const list = getComments();
  if (cmtBadge) { cmtBadge.textContent = list.length; cmtBadge.hidden = list.length === 0; }
  if (btnComments) btnComments.classList.toggle('has-cmt', list.length > 0);
  if (btnAnnotate) btnAnnotate.classList.toggle('active', annotateMode);
}
function setAnnotateMode(on) {
  annotateMode = !!on;
  if (previewWrap) previewWrap.classList.toggle('annotate', annotateMode);
  updateCommentsBadge();
}
function addComment(x, y) {
  const list = getComments();
  const c = {
    id: 'cmt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
    x, y, text: '', author: '我', createdAt: Date.now(), resolved: false,
  };
  list.push(c);
  persistConversations();
  renderPins();
  setAnnotateMode(false);
  openComments();
  const el = commentsList && commentsList.querySelector('[data-id="' + c.id + '"] .cmt-text');
  if (el) { el.focus(); try { el.scrollIntoView({ block: 'center' }); } catch (_) {} }
  toast('已添加批注，写下你的评论吧', 'ok');
}
function focusComment(id) {
  const c = getComments().find((x) => x.id === id);
  if (!c || !previewBBox) return;
  const VW = previewWrap.clientWidth || 800;
  const VH = previewWrap.clientHeight || 600;
  previewPanX = VW / 2 - c.x * previewScale;
  previewPanY = VH / 2 - c.y * previewScale;
  previewApplyTransform();
  renderPins();
  openComments();
  const item = commentsList && commentsList.querySelector('[data-id="' + id + '"]');
  if (item) { item.classList.add('focus'); try { item.scrollIntoView({ block: 'center' }); } catch (_) {} }
}
function resolveComment(id) {
  const c = getComments().find((x) => x.id === id);
  if (!c) return;
  c.resolved = !c.resolved;
  persistConversations(); renderPins(); renderCommentsList();
}
function deleteComment(id) {
  const list = getComments();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return;
  list.splice(i, 1);
  persistConversations(); renderPins(); renderCommentsList();
  toast('已删除批注', 'ok');
}
function updateCommentText(id, text) {
  const c = getComments().find((x) => x.id === id);
  if (!c) return;
  c.text = text;
  persistConversations();
  const idx = getComments().findIndex((x) => x.id === id);
  const pin = annoLayer && annoLayer.children[idx];
  if (pin) pin.title = (text || '（空批注）') + (c.resolved ? ' · 已解决' : '');
}
function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch (_) { return ''; }
}
function renderCommentsList() {
  if (!commentsList) return;
  const list = getComments();
  commentsList.innerHTML = '';
  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'cmt-empty';
    empty.textContent = '还没有批注。点击「📍 批注」后在画布上点选位置即可添加。';
    commentsList.appendChild(empty);
    updateCommentsBadge();
    return;
  }
  list.forEach((c, i) => {
    const item = document.createElement('div');
    item.className = 'cmt-item' + (c.resolved ? ' resolved' : '');
    item.dataset.id = c.id;
    item.innerHTML =
      `<span class="cmt-num">${i + 1}</span>` +
      `<div class="cmt-main">` +
        `<textarea class="cmt-text" rows="2" placeholder="写下评论…">${escapeHtml(c.text || '')}</textarea>` +
        `<div class="cmt-meta"><span class="cmt-time">${fmtTime(c.createdAt)}</span>` +
        (c.resolved ? ` <span class="cmt-resolved-tag">已解决</span>` : '') + `</div>` +
      `</div>` +
      `<div class="cmt-actions">` +
        `<button class="icon-btn sm cmt-resolve" title="标记解决 / 取消">${c.resolved ? '↺' : '✓'}</button>` +
        `<button class="icon-btn sm cmt-del" title="删除">🗑</button>` +
      `</div>`;
    const ta = item.querySelector('.cmt-text');
    ta.addEventListener('input', () => updateCommentText(c.id, ta.value));
    item.querySelector('.cmt-resolve').addEventListener('click', () => resolveComment(c.id));
    item.querySelector('.cmt-del').addEventListener('click', () => deleteComment(c.id));
    item.addEventListener('click', (e) => { if (e.target === item || e.target.closest('.cmt-main')) focusComment(c.id); });
    commentsList.appendChild(item);
  });
  updateCommentsBadge();
}
function openComments() {
  if (commentsDrawer) { commentsDrawer.hidden = false; scrim.hidden = false; }
  renderCommentsList();
}
function closeComments() {
  if (commentsDrawer) commentsDrawer.hidden = true;
  if (allDrawersClosed() && settingsEl.hidden && xmlModal.hidden && diffModal.hidden && paletteEl.hidden && shareModal.hidden) scrim.hidden = true;
  const f = commentsList && commentsList.querySelector('.cmt-item.focus');
  if (f) f.classList.remove('focus');
}
function wireComments() {
  if (btnAnnotate) btnAnnotate.addEventListener('click', () => setAnnotateMode(!annotateMode));
  if (btnComments) btnComments.addEventListener('click', openComments);
}

/* ─── 视图模式切换 ─── */
function setViewMode(mode) {
  if (mode === viewMode) return;
  viewMode = mode;
  qa('.vt', viewToggle).forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  if (mode === 'editor') {
    canvasStage.classList.remove('mode-preview');
    canvasStage.classList.add('mode-editor');
    enterEditorMode();
  } else {
    canvasStage.classList.remove('mode-editor');
    canvasStage.classList.add('mode-preview');
    // 从编辑器编辑结果同步回预览：先向编辑器索取最新 XML（autosave 的兜底），回包后再渲染
    if (editorReady && requestEditorXml()) return;
    if (currentXml) renderPreview(currentXml);
  }
}
function enterEditorMode() {
  if (!editorBooted) {
    editorBooted = true;
    bootSub.textContent = '正在加载 draw.io 精修内核…';
    showStage('boot');
    initEditor();
  } else if (editorReady && currentXml) {
    postLoad(currentXml);
  }
  showEditorTipsOnce();
}
/* 首次进入精修模式时给出操作提示（只提示一次） */
function showEditorTipsOnce() {
  try {
    if (localStorage.getItem('atelier.editorTips.v1') === '1') return;
    localStorage.setItem('atelier.editorTips.v1', '1');
  } catch (_) { return; }
  setTimeout(() => {
    toast('精修模式：可直接拖动图形 / 拉连线；空格+拖拽或右键拖拽平移画布', 'brass', 5200);
  }, 1200);
}

/* ─── 离线 PNG 导出（无需 draw.io） ─── */
function exportPngOffline() {
  const last = window.DiagramRender && window.DiagramRender.last;
  if (!last || !last.ok) { toast('画布为空，无法导出', 'err'); return; }
  const scale = 2;
  const svg = last.svg;
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(last.bbox.w * scale);
    cv.height = Math.ceil(last.bbox.h * scale);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = document.documentElement.getAttribute('data-theme') === 'dark' ? '#1B202B' : '#FFFFFF';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    try { downloadDataUrl(cv.toDataURL('image/png'), 'diagram.png'); toast('已导出 PNG（2× 高清）', 'ok'); }
    catch (e) { toast('PNG 导出失败：' + (e.message || ''), 'err'); }
    URL.revokeObjectURL(url);
  };
  img.onerror = () => { toast('PNG 导出失败', 'err'); URL.revokeObjectURL(url); };
  img.src = url;
}

/* ══════════════════ 舞台遮罩 ══════════════════ */
let verBadge, btnRetryEditor, btnNewChat, btnCloseSettings, btnSettings,
    btnTemplates, btnHistory, btnExport, btnImportVisio, visioFile, btnCloseXml, btnCopyXml, btnDownloadXml,
    cloudModal, btnCloud, btnCloseCloud, cloudAuth, cloudPanel, cloudUser, cloudPass, cloudAuthErr,
    btnCloudLogin, btnCloudRegister, cloudWhoami, cloudCount, btnCloudSave, btnCloudRefresh, btnCloudLogout, cloudList;

/* 复制渲染结果到系统剪贴板（PNG 图片 / SVG 矢量） */
async function copyImage(fmt) {
  const last = window.DiagramRender && window.DiagramRender.last;
  if (!last || !last.ok) { toast('画布为空，无法复制', 'err'); return; }
  const bg = document.documentElement.getAttribute('data-theme') === 'dark' ? '#1B202B' : '#FFFFFF';
  try {
    if (fmt === 'svg') {
      const blob = new Blob([last.svg], { type: 'image/svg+xml' });
      await navigator.clipboard.write([new ClipboardItem({ 'image/svg+xml': blob })]);
      toast('SVG 已复制到剪贴板', 'ok');
    } else {
      const blob = await svgToPngBlob(last.svg, last.bbox, bg, 2);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('PNG 图片已复制到剪贴板', 'ok');
    }
  } catch (e) {
    try {
      await navigator.clipboard.writeText(fmt === 'svg' ? last.svg : (currentXml || ''));
      toast('已复制为文本（当前环境不支持图片剪贴板）', 'brass');
    } catch (_) {
      toast('复制失败：' + (e && e.message || '未知错误'), 'err');
    }
  }
}
function svgToPngBlob(svg, bbox, bg, scale) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.ceil((bbox && bbox.w || 400) * scale));
      cv.height = Math.max(1, Math.ceil((bbox && bbox.h || 300) * scale));
      const ctx = cv.getContext('2d');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob 失败')), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG 渲染失败')); };
    img.src = url;
  });
}

/* 将 JPEG 字节封装为最小可用 PDF（零依赖，DCTDecode 直接内嵌） */
function buildPdfFromJpeg(jpeg, wPt, hPt, pw, ph) {
  const enc = new TextEncoder();
  const parts = [];
  let offset = 0;
  const offsets = [];
  const pushStr = (s) => { const b = enc.encode(s); parts.push(b); offset += b.length; };
  const markObj = () => offsets.push(offset);
  pushStr('%PDF-1.3\n');
  markObj(); pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  markObj(); pushStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  markObj(); pushStr(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt} ${hPt}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`);
  markObj();
  pushStr(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pw} /Height ${ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  parts.push(new Uint8Array(jpeg)); offset += jpeg.length;
  pushStr('\nendstream\nendobj\n');
  markObj();
  const content = `q\n${wPt} 0 0 ${hPt} 0 0 cm /Im0 Do\nQ\n`;
  pushStr(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
  const xrefStart = offset;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 0; i < offsets.length; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  pushStr(xref);
  pushStr(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}

/* 导出 PDF：先把 SVG 栅格化为 2× JPEG，再封装进单页 PDF */
async function exportPdf() {
  const last = window.DiagramRender && window.DiagramRender.last;
  if (!last || !last.ok) { toast('画布为空，无法导出', 'err'); return; }
  const scale = 2;
  const bg = document.documentElement.getAttribute('data-theme') === 'dark' ? '#1B202B' : '#FFFFFF';
  try {
    const svgBlob = new Blob([last.svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const { jpegBytes, pw, ph } = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.ceil((last.bbox.w || 400) * scale));
        cv.height = Math.max(1, Math.ceil((last.bbox.h || 300) * scale));
        const ctx = cv.getContext('2d');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob((b) => {
          if (!b) return reject(new Error('toBlob 失败'));
          b.arrayBuffer().then((ab) => resolve({ jpegBytes: ab, pw: cv.width, ph: cv.height })).catch(reject);
        }, 'image/jpeg', 0.95);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG 渲染失败')); };
      img.src = url;
    });
    const wPt = Math.ceil(last.bbox.w || 400);
    const hPt = Math.ceil(last.bbox.h || 300);
    const pdf = buildPdfFromJpeg(jpegBytes, wPt, hPt, pw, ph);
    downloadBlob(pdf, 'diagram.pdf');
    toast('已导出 PDF 文档', 'ok');
  } catch (e) {
    toast('PDF 导出失败：' + (e && e.message || '未知错误'), 'err');
  }
}

function showStage(which) {
  stageBoot.hidden = which !== 'error';
  stageError.hidden = which !== 'error';
}
function hideStage() { stageBoot.hidden = true; stageError.hidden = true; }

/* ══════════════════ 输入区 / 类型条 ══════════════════ */
function wireComposer() {
  btnSend.addEventListener('click', sendChat);
  btnStop.addEventListener('click', () => { if (currentFetch) currentFetch.abort(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  input.addEventListener('input', autoGrow);
  syncEditBanner();
}
/* 有图时显示「基于当前图迭代」横幅（原快改 chips 行已移除） */
function syncEditBanner() {
  if (editMode) editMode.hidden = !currentXml;
}
/* ══════════════════ 模板抽屉 ══════════════════ */
/* ══════════════════ 个人模板库（Phase 3 ③ 团队/个人模板库） ════════════════ */
/* 单机版「团队模板库」：模板存于本机 localStorage，可一键沉淀 AI 生成的图，
   也支持复制 XML 手动分享给队友；架构上已为日后接入后端共享模板留好数据结构。 */
const TPL_CAP = 100;
function loadTemplates() {
  try { const raw = localStorage.getItem(LS.templates); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; }
  catch (_) { return []; }
}
function persistTemplates(arr) {
  try { localStorage.setItem(LS.templates, JSON.stringify(arr.slice(0, TPL_CAP))); } catch (_) {}
}
function addTemplate(xml, title, summary) {
  const arr = loadTemplates();
  const t = {
    id: 'tpl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    title: title || '未命名模板', xml, summary: summary || null, createdAt: Date.now(),
  };
  arr.unshift(t);
  persistTemplates(arr);
  return t;
}
function deleteTemplate(id) {
  const arr = loadTemplates().filter((t) => t.id !== id);
  persistTemplates(arr);
  return arr;
}
function deriveTemplateTitle() {
  if (conv && conv.title) return conv.title;
  const t = deriveShareTitle();
  if (t) return t;
  if (canvasTitle && canvasTitle.textContent && canvasTitle.textContent !== '画布') return canvasTitle.textContent;
  return '未命名模板';
}
function saveCurrentAsTemplate() {
  if (!currentXml) { toast('画布为空，无法存为模板', 'err'); return; }
  const last = window.DiagramRender && window.DiagramRender.last;
  const summary = last && last.ok ? { vertices: last.vertices, edges: last.edges } : null;
  const t = addTemplate(currentXml, deriveTemplateTitle(), summary);
  if (typeof markSaved === 'function') markSaved();
  toast('已存入模板库：' + t.title, 'ok');
  openTemplates();
}
function loadTemplate(id) {
  clearLiveShare();
  const t = loadTemplates().find((x) => x.id === id);
  if (!t) { toast('模板不存在或已删除', 'err'); return; }
  loadXml(t.xml);
  canvasTitle.textContent = t.title || '模板';
  if (t.summary) updateStats(t.summary);
  setValid(true, null, null);
  toast('已载入模板：' + (t.title || id), 'ok');
  closeAllDrawers();
}
function buildTemplateCard(item, kind = 'sample') {
  const card = document.createElement('div');
  card.className = 'tpl-card' + (kind === 'mine' ? ' mine' : '');
  const metaParts = [];
  if (item.summary && (item.summary.vertices != null || item.summary.edges != null)) {
    metaParts.push(`${item.summary.vertices ?? 0} 图形 · ${item.summary.edges ?? 0} 连线`);
  } else if (item.vertices != null || item.edges != null) {
    metaParts.push(`${item.vertices ?? 0} 图形 · ${item.edges ?? 0} 连线`);
  }
  if (item.author) metaParts.push('@' + esc(item.author));
  if (item.tags && item.tags.length) metaParts.push(item.tags.map((t) => '#' + esc(t)).join(' '));
  const meta = metaParts.join(' · ');
  const title = esc(item.title || item.label || '模板');
  const desc = esc(item.desc || (kind === 'mine' ? '我保存的模板' : kind === 'community' ? '社区模板' : ''));
  card.innerHTML =
    `<div class="tpl-ico"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6">` +
    `<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>` +
    `<rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></div>` +
    `<div class="tpl-main"><h4>${title}</h4><p>${desc}</p>${meta ? `<p class="tpl-meta">${meta}</p>` : ''}</div>`;
  card.addEventListener('click', (e) => {
    if (e.target.closest('.tpl-del, .tpl-copy, .tpl-publish')) return;
    if (kind === 'mine') loadTemplate(item.id);
    else if (kind === 'community') loadCommunityTemplate(item.id);
    else loadSample(item.key, item.label);
  });
  if (kind === 'mine') {
    const copy = document.createElement('button');
    copy.className = 'icon-btn sm tpl-copy'; copy.type = 'button'; copy.title = '复制模板 XML';
    copy.innerHTML = '<svg viewBox="0 0 20 20" width="14" height="14"><rect x="6.5" y="6.5" width="9" height="9" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 13V4.5A1.5 1.5 0 015.5 3H13" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
    copy.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await navigator.clipboard.writeText(item.xml); toast('模板 XML 已复制，可分享给队友', 'ok'); }
      catch (_) { toast('复制失败，请手动导出', 'err'); }
    });
    const del = document.createElement('button');
    del.className = 'icon-btn sm tpl-del'; del.type = 'button'; del.title = '删除模板';
    del.innerHTML = '<svg viewBox="0 0 20 20" width="14" height="14"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTemplate(item.id);
      toast('已删除模板', 'ok');
      openTemplates();
    });
    card.appendChild(copy);
    card.appendChild(del);
  }
  return card;
}

/* ─── 专业图形库（云架构图标）─── */
let shapesDrawer, shapesGrid, shapesSearch, btnShapes;
let btnShapeUpload, shapeUploadModal, shapeFile, shapeSvgInput, shapeName, shapePreview, shapeUploadErr, btnShapeSave;
function openShapesDrawer() {
  if (!shapesDrawer) return;
  buildShapeGrid('');
  shapesDrawer.hidden = false;
  scrim.hidden = false;
  if (shapesSearch) setTimeout(() => shapesSearch.focus(), 30);
}
function closeShapesDrawer() {
  if (shapesDrawer) shapesDrawer.hidden = true;
  if (allDrawersClosed() && settingsEl.hidden && xmlModal.hidden && diffModal.hidden && paletteEl.hidden) scrim.hidden = true;
}
function buildShapeGrid(filter) {
  if (!shapesGrid || !window.DiagramShapes) return;
  const lib = window.DiagramShapes;
  const q = (filter || '').trim().toLowerCase();
  shapesGrid.innerHTML = '';
  lib.categories.forEach((cat) => {
    const items = lib.icons.filter((it) =>
      it.category === cat.id &&
      (!q || it.label.toLowerCase().includes(q) || (it.keywords || []).some((k) => k.toLowerCase().includes(q)))
    );
    if (!items.length) return;
    const sec = document.createElement('div');
    sec.className = 'shapes-sec';
    sec.innerHTML = `<h4>${esc(cat.label)}</h4>`;
    const grid = document.createElement('div');
    grid.className = 'shapes-grid';
    items.forEach((it) => {
      const isCustom = it.category === 'custom';
      const cell = document.createElement('button');
      cell.className = 'shape-cell' + (isCustom ? ' custom' : '');
      cell.type = 'button';
      cell.title = isCustom ? (it.label + '（自定义 · 点右上角 × 删除）') : it.label;
      const url = lib.getImageUrl(it.id);
      cell.innerHTML = `<img src="${url}" alt="${esc(it.label)}" class="shape-ico"/><span>${esc(it.label)}</span>`;
      cell.addEventListener('click', () => insertShape(it.id));
      if (isCustom) {
        const del = document.createElement('button');
        del.className = 'shape-del';
        del.type = 'button';
        del.title = '删除该自定义图标';
        del.setAttribute('aria-label', '删除自定义图标 ' + it.label);
        del.textContent = '×';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.confirm('删除自定义图标「' + it.label + '」？\n已插入到图中的实例不会受影响。')) {
            if (window.DiagramShapes && window.DiagramShapes.removeCustom(it.id)) {
              buildShapeGrid(shapesSearch ? shapesSearch.value : '');
              toast('已删除「' + it.label + '」', 'ok');
            }
          }
        });
        cell.appendChild(del);
      }
      grid.appendChild(cell);
    });
    sec.appendChild(grid);
    shapesGrid.appendChild(sec);
  });
  if (!shapesGrid.children.length) {
    shapesGrid.innerHTML = '<div class="empty-state"><p>没有匹配的图形</p></div>';
  }
}
function insertShape(id) {
  if (!window.DiagramShapes || !window.DiagramShapes.byId[id]) return;
  if (!currentXml || !currentXml.includes('<mxCell')) {
    toast('请先生成或打开一张图，再插入图形', 'err');
    return;
  }
  const icon = window.DiagramShapes.byId[id];
  const doc = new DOMParser().parseFromString(currentXml, 'application/xml');
  const root = doc.getElementsByTagName('root')[0];
  if (!root) { toast('当前图结构异常，无法插入', 'err'); return; }
  const cells = doc.getElementsByTagName('mxCell');
  let maxNum = 1;
  for (let i = 0; i < cells.length; i++) {
    const cid = cells[i].getAttribute('id') || '';
    const m = cid.match(/^(\d+)$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  const newId = String(maxNum + 1);
  let cx = 80, cy = 80;
  if (previewBBox && previewBBox.w) {
    cx = Math.round((previewBBox.minX + previewBBox.w / 2) / 10) * 10 - 60;
    cy = Math.round((previewBBox.minY + previewBBox.h / 2) / 10) * 10 - 40;
  } else {
    cx = 80 + Math.floor(Math.random() * 40);
    cy = 80 + Math.floor(Math.random() * 40);
  }
  const node = doc.createElement('mxCell');
  node.setAttribute('id', newId);
  node.setAttribute('value', icon.label);
  node.setAttribute('style', 'shape=atos:' + id + ';whiteSpace=wrap;html=1;');
  node.setAttribute('vertex', '1');
  node.setAttribute('parent', '1');
  const geo = doc.createElement('mxGeometry');
  geo.setAttribute('x', String(cx));
  geo.setAttribute('y', String(cy));
  geo.setAttribute('width', '120');
  geo.setAttribute('height', '80');
  geo.setAttribute('as', 'geometry');
  node.appendChild(geo);
  root.appendChild(node);
  const xml = new XMLSerializer().serializeToString(doc.documentElement);
  loadXml(xml);
  closeShapesDrawer();
  markSaved();
  toast('已插入「' + icon.label + '」', 'ok');
}

async function loadCommunityTemplate(id) {
  try {
    const resp = await fetch('/api/templates/' + encodeURIComponent(id));
    if (!resp.ok) throw new Error('加载失败');
    const t = await resp.json();
    loadXml(t.xml);
    canvasTitle.textContent = t.title || '社区模板';
    setValid(true, null, null);
    toast('已载入社区模板：' + (t.title || id), 'ok');
    closeAllDrawers();
  } catch (err) {
    toast('社区模板加载失败：' + err.message, 'err');
  }
}

async function publishToCommunity() {
  if (!currentXml) { toast('画布为空，无法发布', 'err'); return; }
  const title = deriveTemplateTitle();
  try {
    const resp = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ xml: currentXml, title, author: '我' }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '发布失败');
    toast('已发布到社区模板：' + data.title, 'ok');
    openTemplates('community');
  } catch (err) {
    toast('发布失败：' + err.message, 'err');
  }
}

async function renderTemplatesTab(tab) {
  if (!templateList) return;
  templateList.innerHTML = '<div class="empty-state" style="margin:8px auto"><p style="font-size:12px">加载中…</p></div>';

  if (tab === 'mine') {
    const mine = loadTemplates();
    templateList.innerHTML = '';
    const sec = document.createElement('div');
    sec.className = 'tpl-section';
    sec.innerHTML = `<div class="tpl-section-title"><span>我的模板</span><span class="tpl-count">${mine.length}</span></div>`;
    if (!mine.length) {
      const empty = document.createElement('div');
      empty.className = 'tpl-empty';
      empty.textContent = '还没有保存的模板。把当前图点「⭐ 存模板」即可沉淀为可复用模板。';
      sec.appendChild(empty);
    } else {
      mine.forEach((t) => sec.appendChild(buildTemplateCard(t, 'mine')));
    }
    templateList.appendChild(sec);
    return;
  }

  if (tab === 'community') {
    let list = [];
    let total = 0;
    try {
      const resp = await fetch('/api/templates');
      const data = await resp.json();
      list = data.list || [];
      total = data.total || 0;
    } catch (_) { list = []; }
    templateList.innerHTML = '';
    const sec = document.createElement('div');
    sec.className = 'tpl-section';
    sec.innerHTML = `<div class="tpl-section-title"><span>社区模板</span><span class="tpl-count">${total}</span></div>`;
    if (currentXml) {
      const pub = document.createElement('button');
      pub.className = 'btn primary sm tpl-publish';
      pub.style.cssText = 'margin-bottom:10px;width:100%;';
      pub.textContent = '＋ 把当前图发布到社区';
      pub.addEventListener('click', publishToCommunity);
      sec.appendChild(pub);
    }
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'tpl-empty';
      empty.textContent = '社区暂无模板。点击上方按钮发布第一张。';
      sec.appendChild(empty);
    } else {
      list.forEach((t) => sec.appendChild(buildTemplateCard(t, 'community')));
    }
    templateList.appendChild(sec);
    return;
  }

  // samples
  let samples = [];
  try {
    const resp = await fetch(API.samples);
    const data = await resp.json();
    samples = (data && data.samples) || [];
  } catch (_) { samples = []; }
  templateList.innerHTML = '';
  const sec = document.createElement('div');
  sec.className = 'tpl-section';
  sec.innerHTML = `<div class="tpl-section-title"><span>示例模板</span><span class="tpl-count">${samples.length}</span></div>`;
  if (!samples.length) {
    const empty = document.createElement('div');
    empty.className = 'tpl-empty';
    empty.textContent = '示例模板加载失败。';
    sec.appendChild(empty);
  } else {
    samples.forEach((s) => sec.appendChild(buildTemplateCard(s, 'sample')));
  }
  templateList.appendChild(sec);
}

async function openTemplates(tab = 'mine') {
  if (tab !== 'mine' && tab !== 'community' && tab !== 'samples') tab = 'mine';
  templateDrawer.hidden = false;
  scrim.hidden = false;
  // 同步标签按钮状态
  qa('.tpl-tab', tplTabs).forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  await renderTemplatesTab(tab);
}
async function loadSample(key, label) {
  clearLiveShare();
  try {
    const resp = await fetch(API.samples + '?key=' + encodeURIComponent(key));
    const data = await resp.json();
    if (data && data.xml) {
      loadXml(data.xml);
      canvasTitle.textContent = label || data.label || '模板';
      const sum = data.summary || null;
      updateStats(sum);
      setValid(true, null, null);
      toast('已载入模板：' + (label || key), 'ok');
    }
  } catch (_) {
    toast('模板载入失败', 'err');
  }
  closeAllDrawers();
}

/* ══════════════════ 版本历史抽屉 ══════════════════ */
function openHistory() {
  historyDrawer.hidden = false;
  scrim.hidden = false;
  renderHistory();
}
function renderHistory() {
  historyList.innerHTML = '';
  if (!versions.length) {
    historyList.innerHTML = '<div class="empty-state"><p>还没有生成记录。<br>描述你的第一张图试试吧。</p></div>';
    return;
  }
  versions.forEach((v) => {
    const meta = v.summary
      ? `${v.summary.vertices ?? 0} 图形 · ${v.summary.edges ?? 0} 连线` : '';
    const item = document.createElement('div');
    item.className = 'hist-item';
    item.innerHTML = `
      <div class="hi-top"><span class="hi-title">${esc(v.title || '图表')}</span><span class="hi-time">${fmtTime(v.time)}</span></div>
      <div class="hi-meta">${meta || 'draw.io 兼容 XML'}</div>
      <div class="hi-actions">
        <span class="hi-diff">对比当前</span>
        <span class="hi-del">删除</span>
      </div>`;
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('hi-del') || e.target.classList.contains('hi-diff')) return;
      loadXml(v.xml);
      canvasTitle.textContent = v.title || '历史版本';
      updateStats(v.summary);
      closeAllDrawers();
      toast('已恢复到该版本', 'ok');
    });
    item.querySelector('.hi-diff').addEventListener('click', (e) => {
      e.stopPropagation();
      openDiff(v.xml, v.title || '历史版本');
    });
    item.querySelector('.hi-del').addEventListener('click', (e) => {
      e.stopPropagation();
      versions = versions.filter((x) => x.id !== v.id);
      try { localStorage.setItem(LS.versions, JSON.stringify(versions)); } catch (_) {}
      markSaved();
      verBadge.textContent = versions.length;
      renderHistory();
    });
    historyList.appendChild(item);
  });
}

/* ══════════════════ 我的图表（本机图库） ══════════════════ */
/* 与「版本历史」（自动快照）互补：这里是用户主动命名保存的图，跨对话常驻 */
const LIB_CAP = 200;
function loadLib() {
  try {
    const raw = localStorage.getItem(LS.diagrams);
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a : [];
  } catch (_) { return []; }
}
function persistLib(arr) {
  try { localStorage.setItem(LS.diagrams, JSON.stringify(arr.slice(0, LIB_CAP))); } catch (_) {}
}
function openLib() {
  libDrawer.hidden = false;
  scrim.hidden = false;
  renderLib();
}
function defaultLibName() {
  const base = (canvasTitle && canvasTitle.textContent && canvasTitle.textContent !== '画布')
    ? canvasTitle.textContent.trim() : '未命名图表';
  return base + ' · ' + fmtTime(Date.now());
}
function saveToLib() {
  if (!currentXml) { toast('画布为空，先画点东西再保存', 'brass'); return; }
  const name = ((libName && libName.value) || '').trim() || defaultLibName();
  const arr = loadLib();
  arr.unshift({
    id: 'dg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    name,
    xml: currentXml,
    summary: window.DiagramRender && window.DiagramRender.last && window.DiagramRender.last.ok
      ? { vertices: window.DiagramRender.last.vertices, edges: window.DiagramRender.last.edges }
      : null,
    updatedAt: Date.now(),
  });
  persistLib(arr);
  if (libName) libName.value = '';
  renderLib();
  toast('已保存到我的图表：' + name, 'ok');
}
function renderLib() {
  if (!libList) return;
  libList.innerHTML = '';
  const arr = loadLib();
  if (!arr.length) {
    libList.innerHTML = '<div class="empty-state"><p>还没有保存的图表。<br>上方输入名称后点「保存当前」即可沉淀。</p></div>';
    return;
  }
  arr.forEach((d) => {
    const meta = d.summary ? `${d.summary.vertices ?? 0} 图形 · ${d.summary.edges ?? 0} 连线` : 'draw.io 兼容 XML';
    const item = document.createElement('div');
    item.className = 'hist-item';
    item.innerHTML = `
      <div class="hi-top"><span class="hi-title">${esc(d.name)}</span><span class="hi-time">${fmtTime(d.updatedAt)}</span></div>
      <div class="hi-meta">${meta}</div>
      <div class="hi-actions">
        <span class="hi-diff">载入</span>
        <span class="hi-del">删除</span>
      </div>`;
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('hi-del') || e.target.classList.contains('hi-diff')) return;
      loadXml(d.xml);
      canvasTitle.textContent = d.name;
      updateStats(d.summary);
      closeAllDrawers();
      toast('已载入：' + d.name, 'ok');
    });
    item.querySelector('.hi-del').addEventListener('click', (e) => {
      e.stopPropagation();
      persistLib(loadLib().filter((x) => x.id !== d.id));
      renderLib();
      toast('已删除：' + d.name, 'ok');
    });
    libList.appendChild(item);
  });
}

/* ════════════════ 版本对比（行级 diff） ════════════════ */
function prettifyXml(xml) {
  if (!xml) return '';
  // 在标签边界插入换行，便于按行比对
  return xml.replace(/>\s*</g, '>\n<').replace(/></g, '>\n<').split('\n')
    .map((s) => s.trim()).filter(Boolean);
}
function diffLines(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const rows = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ t: 'eq', l: a[i], r: b[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ t: 'del', l: a[i], r: '' }); i++; }
    else { rows.push({ t: 'add', l: '', r: b[j] }); j++; }
  }
  while (i < n) rows.push({ t: 'del', l: a[i++], r: '' });
  while (j < m) rows.push({ t: 'add', l: '', r: b[j++] });
  return rows;
}
function openDiff(versionXml, title) {
  if (!versionXml) return;
  const left = prettifyXml(versionXml);
  const right = prettifyXml(currentXml || '');
  const rows = diffLines(left, right);
  diffTitle.textContent = (title || '历史版本') + '  ↔  当前画布';
  diffView.innerHTML = '';
  const L = document.createElement('div'); L.className = 'diff-col diff-left';
  const R = document.createElement('div'); R.className = 'diff-col diff-right';
  let add = 0, del = 0;
  rows.forEach((r) => {
    if (r.t === 'add') add++; else if (r.t === 'del') del++;
    const le = document.createElement('div');
    le.className = 'diff-line ' + (r.t === 'del' ? 'del' : 'ctx');
    le.textContent = r.l; L.appendChild(le);
    const re = document.createElement('div');
    re.className = 'diff-line ' + (r.t === 'add' ? 'add' : 'ctx');
    re.textContent = r.r; R.appendChild(re);
  });
  const stat = document.createElement('div');
  stat.className = 'diff-stat';
  stat.textContent = `共 ${rows.length} 行 · 新增 ${add} · 删除 ${del} · 相同 ${rows.length - add - del}`;
  diffView.appendChild(stat);
  diffView.appendChild(L); diffView.appendChild(R);
  diffModal.hidden = false; scrim.hidden = false;
}

/* ══════════════════ 导出菜单 / XML 弹窗 ══════════════════ */
async function exportVisioFile() {
  if (!currentXml) { toast('画布为空', 'err'); return; }
  try {
    toast('正在生成 Visio 文件…', 'ok');
    const resp = await fetch('/api/export/visio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xml: currentXml, title: 'Diagram Atelier' }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error((data && data.error) || '导出失败');
    }
    const buf = await resp.arrayBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.ms-visio.drawing' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'diagram.vsdx';
    a.click();
    setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch (_) {} }, 4000);
    toast('已导出 .vsdx，可用 Visio / LibreOffice 打开', 'ok');
  } catch (err) {
    toast('Visio 导出失败：' + (err && err.message ? err.message : err), 'err');
  }
}
function wireExport() {
  btnExport.addEventListener('click', (e) => {
    e.stopPropagation();
    exportWrap.classList.toggle('open');
  });
  qa('button', exportMenu).forEach((b) => {
    b.addEventListener('click', () => {
      exportWrap.classList.remove('open');
      const fmt = b.dataset.fmt;
      if (fmt === 'drawio') {
        if (!currentXml) { toast('画布为空', 'err'); return; }
        downloadText(currentXml, 'diagram.drawio', 'application/xml');
        toast('已导出 .drawio 源文件', 'ok');
      } else if (fmt === 'vsdx') {
        exportVisioFile();
      } else if (fmt === 'xmlview') {
        openXmlModal();
      } else if (fmt === 'svg') {
        if (viewMode === 'preview' && window.DiagramRender && window.DiagramRender.last && window.DiagramRender.last.ok) {
          downloadText(window.DiagramRender.last.svg, 'diagram.svg', 'image/svg+xml');
          toast('已导出 SVG 矢量图', 'ok');
        } else {
          exportDiagram('svg');
        }
      } else if (fmt === 'png') {
        if (viewMode === 'preview' && window.DiagramRender && window.DiagramRender.last && window.DiagramRender.last.ok) {
          exportPngOffline();
        } else {
          exportDiagram('png');
        }
      } else if (fmt === 'pdf') {
        if (viewMode === 'preview' && window.DiagramRender && window.DiagramRender.last && window.DiagramRender.last.ok) {
          exportPdf();
        } else {
          toast('PDF 导出需切换到预览模式', 'brass');
        }
      } else if (fmt === 'copypng') {
        copyImage('png');
      } else if (fmt === 'copysvg') {
        copyImage('svg');
      } else if (fmt === 'share') {
        shareDiagram();
      } else if (fmt === 'savetpl') {
        saveCurrentAsTemplate();
      }
    });
  });
  document.addEventListener('click', () => exportWrap.classList.remove('open'));
}
function openXmlModal() {
  if (!currentXml) { toast('画布为空', 'err'); return; }
  xmlView.textContent = currentXml;
  const bytes = new Blob([currentXml]).size;
  xmlSize.textContent = (bytes / 1024).toFixed(1) + ' KB';
  xmlModal.hidden = false;
  scrim.hidden = false;
}
function closeModal() { xmlModal.hidden = true; if (allDrawersClosed() && settingsEl.hidden) scrim.hidden = true; }
function wireModal() {
  btnCloseXml.addEventListener('click', closeModal);
  btnCopyXml.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(currentXml); toast('XML 已复制到剪贴板', 'ok'); }
    catch (_) { toast('复制失败，请手动选择', 'err'); }
  });
  btnDownloadXml.addEventListener('click', () => downloadText(currentXml, 'diagram.drawio', 'application/xml'));
}

/* ══════════════════ 分享（Phase 3 ① 分享链接 + 只读视图） ══════════════════ */
let shareModal, shareLink, btnCopyShare, btnOpenShare, btnOpenEditShare, btnCloseShare;
let btnSaveTpl, btnSaveTplFromShare;

/* 实时同步：分享后的链接会随编辑自动 PATCH 更新（仅对「当前分享所属对话」生效） */
let liveShareId = null;       // 已生成分享链接的分享 ID
let liveShareConvId = null;   // 该分享所属对话 ID（避免切对话误改他人链接）
let liveSyncTimer = null;     // 防抖定时器
let livePill, livePillText;   // 画布栏「实时同步」徽标
const LIVE_SYNC_DEBOUNCE = 1200; // 编辑停手 1.2s 后上报，避免连续改动刷屏

function showLivePill(state, text) {
  if (!livePill) return;
  livePill.hidden = false;
  livePill.classList.remove('syncing', 'dead');
  if (state === 'syncing') livePill.classList.add('syncing');
  else if (state === 'dead') livePill.classList.add('dead');
  if (livePillText && text) livePillText.textContent = text;
}

function scheduleLiveSync() {
  if (!liveShareId || !conv || liveShareConvId !== conv.id) return;
  if (liveSyncTimer) clearTimeout(liveSyncTimer);
  showLivePill('syncing', '同步中…');
  liveSyncTimer = setTimeout(async () => {
    try {
      const resp = await fetch('/api/share/' + encodeURIComponent(liveShareId), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          xml: currentXml,
          title: deriveShareTitle(),
          comments: getComments().map((c) => ({
            id: c.id, x: c.x, y: c.y, text: c.text, author: c.author,
            createdAt: c.createdAt, resolved: !!c.resolved,
          })),
        }),
      });
      if (resp.status === 404) {
        // 分享已被删除：停止同步，标记失效
        liveShareId = null; liveShareConvId = null;
        showLivePill('dead', '链接已失效');
        return;
      }
      if (!resp.ok) { showLivePill('syncing', '实时同步'); return; }
      showLivePill('on', '已同步');
    } catch (_) {
      // 网络抖动：保留徽标，下次编辑重试
      showLivePill('syncing', '实时同步');
    }
  }, LIVE_SYNC_DEBOUNCE);
}

function clearLiveShare() {
  if (liveSyncTimer) { clearTimeout(liveSyncTimer); liveSyncTimer = null; }
  liveShareId = null;
  liveShareConvId = null;
  if (livePill) livePill.hidden = true;
}

function deriveShareTitle() {
  if (conv && conv.title) return conv.title;
  const m = currentXml.match(/<mxCell[^>]*\bvertex="1"[^>]*\bvalue="([^"]*)"/);
  if (m && m[1]) return m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return '';
}

async function shareDiagram() {
  if (!currentXml) { toast('画布为空，无法分享', 'err'); return; }
  setShareItemBusy(true);
  try {
    const resp = await fetch(API.share, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        xml: currentXml,
        title: deriveShareTitle(),
        comments: getComments().map((c) => ({
          id: c.id, x: c.x, y: c.y, text: c.text, author: c.author,
          createdAt: c.createdAt, resolved: !!c.resolved,
        })),
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.id) {
      throw new Error((data && data.error) || ('生成分享链接失败（' + resp.status + '）'));
    }
    const url = location.origin + data.url;
    liveShareId = data.id;
    liveShareConvId = conv ? conv.id : null;
    showLivePill('on', '已同步');
    if (shareLink) shareLink.value = url;
    if (shareModal) { shareModal.hidden = false; scrim.hidden = false; }
    try {
      await navigator.clipboard.writeText(url);
      toast('分享链接已生成并复制到剪贴板', 'ok');
    } catch (_) {
      toast('分享链接已生成，请手动复制', 'brass');
    }
  } catch (err) {
    toast(err.message || '分享失败', 'err');
  } finally {
    setShareItemBusy(false);
  }
}

function setShareItemBusy(on) {
  const item = exportMenu && exportMenu.querySelector('[data-fmt="share"]');
  if (item) { item.disabled = !!on; item.style.opacity = on ? '0.6' : ''; }
}

function wireShare() {
  if (btnCloseShare) btnCloseShare.addEventListener('click', closeShareModal);
  if (btnCopyShare) btnCopyShare.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(shareLink.value); toast('链接已复制', 'ok'); }
    catch (_) { shareLink.select(); if (document.execCommand) document.execCommand('copy'); toast('已选中，请按 Ctrl/Cmd+C', 'brass'); }
  });
  if (btnOpenShare) btnOpenShare.addEventListener('click', () => window.open(shareLink.value, '_blank'));
  if (btnOpenEditShare) btnOpenEditShare.addEventListener('click', () => {
    const editUrl = (shareLink.value || '').replace(/\/v\//, '/?s=');
    window.open(editUrl, '_blank');
  });
}

function closeShareModal() {
  shareModal.hidden = true;
  if (allDrawersClosed() && settingsEl.hidden && xmlModal.hidden && diffModal.hidden && paletteEl.hidden) scrim.hidden = true;
}

/* 模板库：画布栏「⭐ 存模板」+ 分享弹窗「保存为模板」 */
function wireTemplates() {
  if (btnSaveTpl) btnSaveTpl.addEventListener('click', saveCurrentAsTemplate);
  if (btnSaveTplFromShare) btnSaveTplFromShare.addEventListener('click', saveCurrentAsTemplate);
  // 模板抽屉三标签切换：我的 / 社区 / 示例
  if (tplTabs) {
    qa('.tpl-tab', tplTabs).forEach((b) => {
      b.addEventListener('click', () => openTemplates(b.dataset.tab));
    });
  }
}
function wireShapes() {
  if (btnShapes) btnShapes.addEventListener('click', openShapesDrawer);
  if (shapesSearch) shapesSearch.addEventListener('input', (e) => buildShapeGrid(e.target.value));
}

/* 上传自定义图标：文件 / 粘贴 SVG → 预览 → 入库（localStorage 持久化） */
function openShapeUpload() {
  if (!shapeUploadModal) return;
  if (shapeSvgInput) shapeSvgInput.value = '';
  if (shapeName) shapeName.value = '';
  if (shapeFile) shapeFile.value = '';
  if (shapeUploadErr) shapeUploadErr.hidden = true;
  if (shapePreview) shapePreview.innerHTML = '<span class="muted">尚未加载图标</span>';
  shapeUploadModal.hidden = false;
  if (shapeName) setTimeout(() => shapeName.focus(), 30);
}

function updateShapePreview() {
  if (!shapePreview || !shapeSvgInput) return;
  const svg = shapeSvgInput.value.trim();
  if (!/<svg[\s>]/i.test(svg)) {
    shapePreview.innerHTML = '<span class="muted">尚未加载图标</span>';
    return;
  }
  shapePreview.innerHTML = '<img src="data:image/svg+xml,' + encodeURIComponent(svg) + '" alt="预览" />';
}

function wireShapeUpload() {
  if (btnShapeUpload) btnShapeUpload.addEventListener('click', openShapeUpload);
  if (shapeFile) shapeFile.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (shapeSvgInput) shapeSvgInput.value = String(reader.result || '');
      if (shapeName && !shapeName.value) {
        shapeName.value = (f.name || 'custom').replace(/\.svg$/i, '');
      }
      updateShapePreview();
    };
    reader.onerror = () => {
      if (shapeUploadErr) { shapeUploadErr.textContent = '读取文件失败'; shapeUploadErr.hidden = false; }
    };
    reader.readAsText(f);
  });
  if (shapeSvgInput) shapeSvgInput.addEventListener('input', updateShapePreview);
  if (btnShapeSave) btnShapeSave.addEventListener('click', () => {
    if (!window.DiagramShapes || !window.DiagramShapes.addCustom) return;
    const label = shapeName ? shapeName.value.trim() : '';
    const svg = shapeSvgInput ? shapeSvgInput.value.trim() : '';
    const res = window.DiagramShapes.addCustom({ label, svg });
    if (!res.ok) {
      if (shapeUploadErr) { shapeUploadErr.textContent = res.error || '保存失败'; shapeUploadErr.hidden = false; }
      return;
    }
    if (shapeUploadErr) shapeUploadErr.hidden = true;
    if (shapeUploadModal) shapeUploadModal.hidden = true;
    buildShapeGrid(shapesSearch ? shapesSearch.value : '');
    toast('已入库「' + label + '」，可在「我的图标」中插入', 'ok');
  });
}

/* 打开别人发来的 ?s=ID 链接时，把分享副本载入工作台 */
async function loadSharedFromUrl() {
  let id = '';
  try { id = new URLSearchParams(location.search).get('s') || ''; } catch (_) { return; }
  if (!id) return;
  try {
    clearLiveShare(); // 载入的是他人分享副本，不应回写原链接
    const resp = await fetch('/api/share/' + encodeURIComponent(id));
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.xml) { toast('分享链接无效或已失效', 'err'); return; }
    if (conv) { conv.comments = Array.isArray(data.comments) ? data.comments : []; }
    loadXml(data.xml);
    renderPins();
    try { history.replaceState(null, '', location.pathname); } catch (_) {}
    toast(data.title ? ('已载入分享副本：' + data.title) : '已载入分享副本', 'ok', 3800);
  } catch (err) {
    toast('载入分享失败：' + (err.message || err), 'err');
  }
}

/* ══════════════════ 抽屉 / 弹窗 通用 ══════════════════ */
function closeAllDrawers() {
  historyDrawer.hidden = true;
  templateDrawer.hidden = true;
  if (shapesDrawer) shapesDrawer.hidden = true;
  if (libDrawer) libDrawer.hidden = true;
}
function allDrawersClosed() {
  return historyDrawer.hidden && templateDrawer.hidden && (!commentsDrawer || commentsDrawer.hidden) && (!shapesDrawer || shapesDrawer.hidden) && (!libDrawer || libDrawer.hidden);
}
function wireDrawers() {
  btnTemplates.addEventListener('click', openTemplates);
  btnHistory.addEventListener('click', openHistory);
  // 「更多」下拉：点击切换，点击外部收起；菜单项各自打开对应抽屉
  if (btnMore) btnMore.addEventListener('click', (e) => {
    e.stopPropagation();
    moreWrap.classList.toggle('open');
  });
  document.addEventListener('click', () => { if (moreWrap) moreWrap.classList.remove('open'); });
  if (btnMyDiagrams) btnMyDiagrams.addEventListener('click', () => { moreWrap.classList.remove('open'); openLib(); });
  if (btnLibSave) btnLibSave.addEventListener('click', saveToLib);
  if (libName) libName.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveToLib(); });
  qa('[data-close]').forEach((b) =>
    b.addEventListener('click', () => { $(b.dataset.close).hidden = true; if (allDrawersClosed()) scrim.hidden = true; }));
  // 画布空状态：示例库（一键载入模板）+ AI 生成快捷入口
  const pe = previewEmpty;
  if (pe) {
    qa('.ex-card', pe).forEach((b) =>
      b.addEventListener('click', () => loadSample(b.dataset.key, b.dataset.label)));
    qa('.ex-ai-chip', pe).forEach((b) =>
      b.addEventListener('click', () => {
        input.value = b.dataset.prompt || b.textContent.trim();
        autoGrow(); input.focus();
        sendChat();
      }));
    const more = pe.querySelector('#exMore');
    if (more) more.addEventListener('click', openTemplates);
  }
}

/* ══════════════════ 画布工具条 ══════════════════ */
function wireCanvasBar() {
  qa('[data-act]', canvasTitle.closest('.canvas-bar')).forEach((b) =>
    b.addEventListener('click', () => canvasAction(b.dataset.act)));
}

/* ══════════════════ 分隔条拖拽 ══════════════════ */
function wireSplitter() {
  let startX = 0, startW = 0, dragging = false;
  splitter.addEventListener('pointerdown', (e) => {
    dragging = true; startX = e.clientX;
    startW = agentPanel.getBoundingClientRect().width;
    splitter.classList.add('dragging');
    agentPanel.classList.add('dragging');
    splitter.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  splitter.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const w = Math.max(340, Math.min(startW + (e.clientX - startX), window.innerWidth * 0.66));
    agentPanel.style.width = w + 'px';
  });
  splitter.addEventListener('pointerup', (e) => {
    dragging = false; splitter.classList.remove('dragging'); agentPanel.classList.remove('dragging');
    try { splitter.releasePointerCapture(e.pointerId); } catch (_) {}
  });
}

/* ─── 侧边栏收起 / 展开 ─── */
function applySidebarState(ws, collapsed) {
  ws.classList.toggle('sidebar-collapsed', collapsed);
  if (btnToggleSidebar) btnToggleSidebar.setAttribute('aria-expanded', String(!collapsed));
  try { localStorage.setItem(LS.sidebarCollapsed, collapsed ? '1' : '0'); } catch (_) {}
}
function toggleSidebar(ws) {
  if (!ws) ws = document.querySelector('.workspace');
  applySidebarState(ws, !ws.classList.contains('sidebar-collapsed'));
}
function wireSidebar() {
  const ws = document.querySelector('.workspace');
  if (btnToggleSidebar) btnToggleSidebar.addEventListener('click', () => toggleSidebar(ws));
  let collapsed = false;
  try { collapsed = localStorage.getItem(LS.sidebarCollapsed) === '1'; } catch (_) {}
  applySidebarState(ws, collapsed);
}

/* ══════════════════ 命令面板（Cmd/Ctrl+K） ══════════════════ */
function buildCommands() {
  return [
    { label: '切换深 / 浅主题', keys: 'theme dark light 主题 外观', run: () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark') },
    { label: '新建对话', keys: 'new chat 对话 新建', run: newConversation },
    { label: '打开对话列表', keys: 'conversation 对话 列表', run: openConvDrawer },
    { label: '打开模板库', keys: 'template 模板 起步', run: openTemplates },
    { label: '打开版本历史', keys: 'history 版本 历史', run: openHistory },
    { label: '打开模型设置', keys: 'settings 模型 配置 设置', run: openSettings },
    { label: '导出 PNG', keys: 'export png 图片 导出', run: () => { if (viewMode === 'preview' && window.DiagramRender?.last?.ok) exportPngOffline(); else exportDiagram('png'); } },
    { label: '导出 SVG', keys: 'export svg 矢量 导出', run: () => { if (viewMode === 'preview' && window.DiagramRender?.last?.ok) downloadText(window.DiagramRender.last.svg, 'diagram.svg', 'image/svg+xml'); else exportDiagram('svg'); } },
    { label: '导出 .drawio 源文件', keys: 'export drawio 源文件 导出', run: () => { if (currentXml) { downloadText(currentXml, 'diagram.drawio', 'application/xml'); toast('已导出 .drawio', 'ok'); } else toast('画布为空', 'err'); } },
    { label: '查看 / 复制 XML', keys: 'xml 查看 复制', run: openXmlModal },
    { label: '生成分享只读链接', keys: 'share 分享 链接 只读', run: shareDiagram },
    { label: '复制图片到剪贴板', keys: 'copy png 复制 剪贴板 图片', run: () => copyImage('png') },
    { label: '复制 SVG 到剪贴板', keys: 'copy svg 复制 剪贴板 矢量', run: () => copyImage('svg') },
    { label: '切换到预览模式', keys: 'preview 预览 模式', run: () => setViewMode('preview') },
    { label: '切换到精修模式', keys: 'editor 精修 drawio 模式', run: () => setViewMode('editor') },
    { label: '收起 / 展开 AI 助手侧边栏', keys: 'sidebar 侧边栏 收起 展开 面板 收回', run: () => toggleSidebar(document.querySelector('.workspace')) },
    { label: '适应窗口', keys: 'fit 适应 缩放', run: () => canvasAction('fit') },
    { label: '放大', keys: 'zoom in 放大', run: () => canvasAction('zoomIn') },
    { label: '缩小', keys: 'zoom out 缩小', run: () => canvasAction('zoomOut') },
    { label: '撤销', keys: 'undo 撤销', run: doUndo },
    { label: '重做', keys: 'redo 重做', run: doRedo },
  ];
}
let paletteCmds = [];
function openPalette() {
  paletteEl.hidden = false; scrim.hidden = false;
  paletteInput.value = '';
  paletteCmds = buildCommands();
  renderPalette('');
  setTimeout(() => paletteInput.focus(), 30);
}
function closePalette() {
  paletteEl.hidden = true;
  if (allDrawersClosed() && settingsEl.hidden && xmlModal.hidden && diffModal.hidden) scrim.hidden = true;
}
function renderPalette(q) {
  const kw = (q || '').trim().toLowerCase();
  const list = kw ? paletteCmds.filter((c) => (c.label + ' ' + (c.keys || '')).toLowerCase().includes(kw)) : paletteCmds;
  paletteList.innerHTML = '';
  paletteList._cmds = list;
  if (!list.length) { paletteList.innerHTML = '<div class="palette-empty">无匹配命令</div>'; return; }
  list.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'palette-item' + (i === 0 ? ' active' : '');
    row.textContent = c.label;
    row.addEventListener('click', () => { closePalette(); c.run(); });
    paletteList.appendChild(row);
  });
}
function wireVisioImport() {
  if (!btnImportVisio || !visioFile) return;
  btnImportVisio.addEventListener('click', () => {
    try { visioFile.click(); } catch (_) {}
  });
  visioFile.addEventListener('change', async () => {
    const file = visioFile.files && visioFile.files[0];
    if (!file) return;
    const lower = String(file.name || '').toLowerCase();
    if (!lower.endsWith('.vsdx') && !lower.endsWith('.vdx')) {
      toast('请选择 .vsdx 格式的 Visio 文件', 'brass');
      visioFile.value = '';
      return;
    }
    try {
      toast('正在解析 Visio 文件…', 'ok');
      const buf = await file.arrayBuffer();
      const resp = await fetch('/api/import/visio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buf,
      });
      const data = await resp.json();
      if (!resp.ok || !data.xml) {
        throw new Error((data && data.error) || 'Visio 解析失败');
      }
      loadXml(data.xml);
      const s = data.summary || {};
      toast(`Visio 导入成功：导入 ${s.shapes || 0} 个图形、${(s.edges || 0)} 条连线`, 'ok');
    } catch (err) {
      toast('Visio 导入失败：' + (err && err.message ? err.message : err), 'err');
    } finally {
      visioFile.value = '';
    }
  });
}
/* ══════════════════ 云端图库（自托管账号） ══════════════════ */
const LS_CLOUD_TOKEN = 'atelier.cloud.token.v1';
let cloudToken = null;

function cloudHeaders() {
  return { 'content-type': 'application/json', authorization: 'Bearer ' + (cloudToken || '') };
}

function showCloudAuthErr(msg) {
  if (!cloudAuthErr) return;
  if (msg) { cloudAuthErr.textContent = msg; cloudAuthErr.hidden = false; }
  else { cloudAuthErr.hidden = true; }
}

function switchCloudPanel(loggedIn) {
  cloudAuth.hidden = loggedIn;
  cloudPanel.hidden = !loggedIn;
  if (loggedIn) showCloudAuthErr('');
}

async function cloudAuthRequest(mode) {
  const username = (cloudUser.value || '').trim();
  const password = cloudPass.value || '';
  if (!username || !password) { showCloudAuthErr('请填写用户名和密码'); return; }
  try {
    const resp = await fetch('/api/auth/' + mode, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.token) throw new Error(data.error || '操作失败');
    cloudToken = data.token;
    try { localStorage.setItem(LS_CLOUD_TOKEN, cloudToken); } catch (_) {}
    cloudPass.value = '';
    switchCloudPanel(true);
    cloudWhoami.textContent = data.user.username;
    await refreshCloudList();
    toast(mode === 'register' ? '注册成功，已登录「' + data.user.username + '」' : '欢迎回来，「' + data.user.username + '」', 'ok');
  } catch (err) {
    showCloudAuthErr(err && err.message ? err.message : String(err));
  }
}

async function refreshCloudList() {
  try {
    const resp = await fetch('/api/diagrams', { headers: cloudHeaders() });
    if (resp.status === 401) { cloudSignOut(true); return; }
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '读取失败');
    const list = data.list || [];
    cloudCount.textContent = list.length + ' 张';
    if (!list.length) {
      cloudList.innerHTML = '<p class="cloud-empty">云端还没有图表，点上方「保存当前图到云端」试试。</p>';
      return;
    }
    cloudList.innerHTML = '';
    for (const d of list) {
      const row = document.createElement('div');
      row.className = 'cloud-item';
      const meta = document.createElement('div');
      meta.className = 'cloud-item-meta';
      const name = document.createElement('button');
      name.className = 'cloud-item-title';
      name.textContent = d.title;
      name.title = '点击载入到画布';
      name.addEventListener('click', () => cloudOpen(d.id));
      const info = document.createElement('span');
      info.className = 'cloud-item-info';
      info.textContent = `${d.vertices || 0} 节点 · ${d.edges || 0} 连线 · ${new Date(d.updatedAt || d.createdAt).toLocaleDateString()}`;
      meta.appendChild(name);
      meta.appendChild(info);
      const actions = document.createElement('div');
      actions.className = 'cloud-item-actions';
      const openBtn = document.createElement('button');
      openBtn.className = 'btn ghost sm';
      openBtn.textContent = '打开';
      openBtn.addEventListener('click', () => cloudOpen(d.id));
      const delBtn = document.createElement('button');
      delBtn.className = 'btn ghost sm';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', () => cloudDelete(d.id, d.title));
      actions.appendChild(openBtn);
      actions.appendChild(delBtn);
      row.appendChild(meta);
      row.appendChild(actions);
      cloudList.appendChild(row);
    }
  } catch (err) {
    toast('云端列表读取失败：' + (err && err.message ? err.message : err), 'err');
  }
}

async function cloudOpen(id) {
  try {
    const resp = await fetch('/api/diagrams/' + encodeURIComponent(id), { headers: cloudHeaders() });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '读取失败');
    loadXml(data.xml);
    cloudModal.hidden = true;
    if (allDrawersClosed() && settingsEl.hidden) scrim.hidden = true;
    toast('已载入云端图表「' + data.title + '」', 'ok');
  } catch (err) {
    toast('云端图表载入失败：' + (err && err.message ? err.message : err), 'err');
  }
}

async function cloudSaveCurrent() {
  if (!currentXml) { toast('画布为空，先画点什么再保存', 'err'); return; }
  const defTitle = (canvasTitle && canvasTitle.textContent || '').trim();
  const title = window.prompt('保存到云端的图表名称：', defTitle && defTitle !== '未命名图表' ? defTitle : '未命名图表');
  if (title === null) return; // 用户取消
  try {
    const resp = await fetch('/api/diagrams', {
      method: 'POST',
      headers: cloudHeaders(),
      body: JSON.stringify({ title, xml: currentXml }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '保存失败');
    toast('已保存到云端「' + data.title + '」', 'ok');
    await refreshCloudList();
  } catch (err) {
    toast('云端保存失败：' + (err && err.message ? err.message : err), 'err');
  }
}

async function cloudDelete(id, title) {
  if (!window.confirm('确定删除云端图表「' + title + '」？此操作不可恢复。')) return;
  try {
    const resp = await fetch('/api/diagrams/' + encodeURIComponent(id), { method: 'DELETE', headers: cloudHeaders() });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || '删除失败');
    }
    toast('已删除「' + title + '」', 'ok');
    await refreshCloudList();
  } catch (err) {
    toast('删除失败：' + (err && err.message ? err.message : err), 'err');
  }
}

function cloudSignOut(silent) {
  const hadToken = !!cloudToken;
  cloudToken = null;
  try { localStorage.removeItem(LS_CLOUD_TOKEN); } catch (_) {}
  switchCloudPanel(false);
  if (!silent && hadToken) toast('已退出云端登录', 'ok');
}

function openCloudModal() {
  cloudModal.hidden = false;
  scrim.hidden = false;
  if (cloudToken) {
    switchCloudPanel(true);
    refreshCloudList();
  } else {
    switchCloudPanel(false);
  }
}

async function cloudRestoreSession() {
  let token = null;
  try { token = localStorage.getItem(LS_CLOUD_TOKEN); } catch (_) {}
  if (!token) return;
  try {
    const resp = await fetch('/api/auth/me', { headers: { authorization: 'Bearer ' + token } });
    if (!resp.ok) { cloudSignOut(true); return; }
    const data = await resp.json();
    cloudToken = token;
    cloudWhoami.textContent = data.user && data.user.username;
  } catch (_) { /* 服务端不可达时保留 token，打开面板再验 */ }
}

function wireCloud() {
  if (!btnCloud || !cloudModal) return;
  btnCloud.addEventListener('click', openCloudModal);
  btnCloseCloud.addEventListener('click', () => {
    cloudModal.hidden = true;
    if (allDrawersClosed() && settingsEl.hidden) scrim.hidden = true;
  });
  btnCloudLogin.addEventListener('click', () => cloudAuthRequest('login'));
  btnCloudRegister.addEventListener('click', () => cloudAuthRequest('register'));
  cloudPass.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); cloudAuthRequest(cloudAuth.hidden ? 'login' : 'login'); }
  });
  btnCloudSave.addEventListener('click', cloudSaveCurrent);
  btnCloudRefresh.addEventListener('click', refreshCloudList);
  btnCloudLogout.addEventListener('click', () => {
    fetch('/api/auth/logout', { method: 'POST', headers: cloudHeaders() }).catch(() => {});
    cloudSignOut(false);
  });
}

function wirePalette() {
  if (!paletteEl) return;
  paletteInput.addEventListener('input', () => renderPalette(paletteInput.value));
  paletteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); return; }
    const items = Array.from(paletteList.querySelectorAll('.palette-item'));
    if (!items.length) return;
    let idx = items.findIndex((x) => x.classList.contains('active'));
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(items.length - 1, idx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = paletteList._cmds[idx]; if (c) { closePalette(); c.run(); } return; }
    else return;
    items.forEach((x, i) => x.classList.toggle('active', i === idx));
    items[idx].scrollIntoView({ block: 'nearest' });
  });
}

/* ══════════════════ 键盘 / 路由 ══════════════════ */
/* a11y：对话框焦点管理（零侵入集中式） */
const FOCUSABLE_SEL = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const DIALOG_IDS = ['historyDrawer', 'templateDrawer', 'commentsDrawer', 'shapesDrawer', 'settings', 'xmlModal', 'diffModal', 'shareModal', 'palette', 'shapeUploadModal', 'cloudModal'];
let a11yDialogs = [];
let focusReturn = null;

function visibleDialog() {
  for (const d of a11yDialogs) if (d && !d.hidden) return d;
  return null;
}
function trapTab(e) {
  const d = visibleDialog();
  if (!d) return;
  const items = [...d.querySelectorAll(FOCUSABLE_SEL)].filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (!items.length) { e.preventDefault(); d.focus(); return; }
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  else if (!d.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
}
function wireA11y() {
  a11yDialogs = DIALOG_IDS.map((id) => $(id)).filter(Boolean);
  a11yDialogs.forEach((d) => {
    if (!d.hasAttribute('tabindex')) d.setAttribute('tabindex', '-1');
    d.querySelectorAll('[data-close], #btnCloseXml, #btnCloseDiff, #btnCloseShare').forEach((b) => {
      if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', '关闭');
    });
    new MutationObserver(() => {
      if (!d.hidden) {
        focusReturn = document.activeElement;
        requestAnimationFrame(() => { if (!d.hidden) d.focus(); });
      } else if (focusReturn && document.contains(focusReturn)) {
        focusReturn.focus();
        focusReturn = null;
      }
    }).observe(d, { attributes: true, attributeFilter: ['hidden'] });
  });
}

function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!paletteEl.hidden) { closePalette(); return; }
      if (!xmlModal.hidden) closeModal();
      else if (!diffModal.hidden) { diffModal.hidden = true; if (allDrawersClosed() && settingsEl.hidden && xmlModal.hidden) scrim.hidden = true; }
      else if (!settingsEl.hidden) closeSettings();
      else if (!allDrawersClosed()) { closeAllDrawers(); scrim.hidden = true; }
      return;
    }
    if (e.key === 'Tab') { trapTab(e); }
    const mod = e.ctrlKey || e.metaKey;
    const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    const inField = document.activeElement === input;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      setViewMode(viewMode === 'preview' ? 'editor' : 'preview');
      toast('已切换到「' + (viewMode === 'preview' ? '预览' : '精修') + '」模式', 'brass');
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') {
      e.preventDefault(); toggleSidebar(document.querySelector('.workspace'));
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault(); openPalette();
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'h') {
      e.preventDefault(); openHistory();
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault(); doUndo();
    } else if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z')) && !typing) {
      e.preventDefault(); doRedo();
    } else if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (!currentXml) { toast('画布为空，无法导出', 'err'); return; }
      if (viewMode === 'preview' && window.DiagramRender && window.DiagramRender.last && window.DiagramRender.last.ok) exportPngOffline();
      else exportDiagram('png');
    } else if (!mod && e.key === '?' && !inField) {
      e.preventDefault();
      toast('快捷键  Ctrl+E 预览/精修 · Ctrl+B 收起/展开侧栏 · Ctrl+K 命令面板 · Ctrl+H 历史 · Ctrl+S 导出PNG · Ctrl+Z 撤销 · ？帮助', 'brass', 5200);
    }
  });
}
function applyHashRoute() {
  const h = location.hash || '';
  const m = h.match(/#(?:tpl|sample)=([\w-]+)/);
  if (m) {
    const key = m[1];
    const label = (presets.find((p) => p.id === key) && key) || key;
    loadSample(key, label);
  }
}

/* ══════════════════ 主题（深 / 浅） ══════════════════ */
function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(LS.theme, t); } catch (_) {}
  // 切主题后重渲染预览，使图表配色跟随主题
  if (currentXml) renderPreview(currentXml);
}
function wireTheme() {
  if (!btnTheme) return;
  btnTheme.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });
}

/* ══════════════════ 空状态 ══════════════════ */
function addEmptyState() {
  const es = document.createElement('div');
  es.className = 'empty-state';
  es.innerHTML = `
    <div class="es-ico">
      <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 9h18M8 14h8"/>
      </svg>
    </div>
    <h3>用一句话画出专业图表</h3>
    <p>描述需求，AI 自动生成可继续编辑的流程图、架构图或思维导图。</p>
    <div class="es-examples">
      <button data-act="templates">浏览模板库</button>
      <button>画一个电商下单到发货的流程图，含库存校验与支付失败分支</button>
    </div>`;
  es.querySelectorAll('.es-examples button').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.act === 'templates') { openTemplates(); return; }
      input.value = b.textContent.trim();
      autoGrow();
      sendChat();
    }));
  messagesEl.appendChild(es);
}

/* ══════════════════ 引导启动 ══════════════════ */
/* 对话有内容时自动收起副标题引导语，把空间让给输出区 */
function syncAgentChrome() {
  if (!agentPanel || !messagesEl) return;
  agentPanel.classList.toggle('has-conv', messagesEl.children.length > 0);
}
async function bootstrap() {
  // DOM 引用
  drawio = $('drawio'); messagesEl = $('messages'); input = $('input'); btnSend = $('btnSend');
  btnStop = $('btnStop'); modelPill = $('modelPill'); modelName = $('modelName'); modelDot = $('modelDot');
  toasts = $('toasts'); stageBoot = $('stageBoot'); stageError = $('stageError'); splitter = $('splitter');
  bootSub = $('bootSub'); drawio.addEventListener('load', onIframeLoad);
  canvasTitle = $('canvasTitle'); statV = $('statVertices'); statE = $('statEdges'); validPill = $('validPill');
  typeDetect = $('typeDetect'); typeDetectLabel = $('typeDetectLabel'); isoPill = $('isoPill'); stylePill = $('stylePill');
  layoutPill = $('layoutPill');
  fixPill = $('fixPill');
  settingsEl = $('settings'); scrim = $('scrim'); presetGrid = $('presetGrid');
  protoSeg = $('protoSeg'); cfgBase = $('cfgBase'); cfgKey = $('cfgKey'); btnToggleKey = $('btnToggleKey');
  cfgModel = $('cfgModel'); modelList = $('modelList'); modelHint = $('modelHint'); cfgTemp = $('cfgTemp');
  btnFetchModels = $('btnFetchModels');
  tempVal = $('tempVal'); cfgMaxTokens = $('cfgMaxTokens'); cfgExtra = $('cfgExtra'); btnVerify = $('btnVerify');
  verifyResult = $('verifyResult'); historyDrawer = $('historyDrawer'); historyList = $('historyList');
  templateDrawer = $('templateDrawer'); templateList = $('templateList'); tplTabs = $('tplTabs'); exportWrap = $('exportWrap');
  exportMenu = $('exportMenu'); xmlModal = $('xmlModal'); xmlView = $('xmlView'); xmlSize = $('xmlSize');
  agentPanel = $('agentPanel');
  previewWrap = $('previewWrap'); previewEmpty = $('previewEmpty');
  viewToggle = $('viewToggle'); canvasStage = $('canvasStage');
  verBadge = $('verBadge'); btnRetryEditor = $('btnRetryEditor'); btnNewChat = $('btnNewChat');
  btnCloseSettings = $('btnCloseSettings'); btnSettings = $('btnSettings');
  btnTemplates = $('btnTemplates'); btnHistory = $('btnHistory'); btnExport = $('btnExport');
  btnImportVisio = $('btnImportVisio'); visioFile = $('visioFile');
  btnCloud = $('btnCloud'); cloudModal = $('cloudModal'); btnCloseCloud = $('btnCloseCloud');
  cloudAuth = $('cloudAuth'); cloudPanel = $('cloudPanel'); cloudUser = $('cloudUser'); cloudPass = $('cloudPass');
  cloudAuthErr = $('cloudAuthErr'); btnCloudLogin = $('btnCloudLogin'); btnCloudRegister = $('btnCloudRegister');
  cloudWhoami = $('cloudWhoami'); cloudCount = $('cloudCount'); btnCloudSave = $('btnCloudSave');
  btnCloudRefresh = $('btnCloudRefresh'); btnCloudLogout = $('btnCloudLogout'); cloudList = $('cloudList');
  btnCloseXml = $('btnCloseXml'); btnCopyXml = $('btnCopyXml'); btnDownloadXml = $('btnDownloadXml');
  btnTheme = $('btnTheme');
  convDrawer = $('convDrawer'); convList = $('convList'); btnConvs = $('btnConvs');
  cfgList = $('cfgList'); btnAddCfg = $('btnAddCfg'); cfgName = $('cfgName');
  editMode = $('editMode');
  paletteEl = $('palette'); paletteInput = $('paletteInput'); paletteList = $('paletteList');  diffModal = $('diffModal'); diffView = $('diffView'); diffTitle = $('diffTitle');
  btnCloseDiff = $('btnCloseDiff');
  btnToggleSidebar = $('btnToggleSidebar');
  moreWrap = $('moreWrap'); btnMore = $('btnMore'); btnMyDiagrams = $('btnMyDiagrams');
  libDrawer = $('libDrawer'); libList = $('libList'); libName = $('libName'); btnLibSave = $('btnLibSave');
  saveInd = $('saveInd'); saveText = $('saveText');
  backupFile = $('backupFile'); btnBackup = $('btnBackup'); btnRestore = $('btnRestore');
  btnWipe = $('btnWipe'); dmWarn = $('dmWarn');
  shareModal = $('shareModal'); shareLink = $('shareLink');
  btnCopyShare = $('btnCopyShare'); btnOpenShare = $('btnOpenShare');
  btnOpenEditShare = $('btnOpenEditShare'); btnCloseShare = $('btnCloseShare');
  livePill = $('livePill'); livePillText = $('livePillText');
  btnSaveTpl = $('btnSaveTpl'); btnSaveTplFromShare = $('btnSaveTplFromShare');
  commentsDrawer = $('commentsDrawer'); btnAnnotate = $('btnAnnotate'); btnComments = $('btnComments');
  cmtBadge = $('cmtBadge'); commentsList = $('commentsList');
  shapesDrawer = $('shapesDrawer'); shapesGrid = $('shapesGrid'); shapesSearch = $('shapesSearch'); btnShapes = $('btnShapes');
  btnShapeUpload = $('btnShapeUpload'); shapeUploadModal = $('shapeUploadModal'); shapeFile = $('shapeFile');
  shapeSvgInput = $('shapeSvgInput'); shapeName = $('shapeName'); shapePreview = $('shapePreview'); shapeUploadErr = $('shapeUploadErr'); btnShapeSave = $('btnShapeSave');
  collabLayer = $('collabLayer'); collabPresence = $('collabPresence'); collabCursors = $('collabCursors'); btnCollab = $('btnCollab');

  // 应用已保存的主题（须在读取会话与渲染预览之前）
  try {
    const saved = localStorage.getItem(LS.theme);
    if (saved === 'dark' || saved === 'light') document.documentElement.setAttribute('data-theme', saved);
  } catch (_) {}

  // 恢复当前对话的画布（优先用对话内保存的 xml，其次回退旧 session）
  try {
    const s = localStorage.getItem(LS.session);
    if (s) currentXml = s;
  } catch (_) {}
  if (conv && conv.xml) currentXml = conv.xml;
  verBadge.textContent = versions.length;

  // 预设
  try {
    const resp = await fetch(API.presets);
    const data = await resp.json();
    presets = (data && data.presets) || [];
  } catch (_) { presets = []; }
  buildPresetGrid();
  applyCfgToForm();
  updateModelPill();

  // 事件
  wireComposer();
  syncEditBanner();
  wireSettings();
  wireDataMgmt();
  wireTidy();
  wireFix();
  scheduleSaveTick();
  wireExport();
  wireModal();
  wireShare();
  wireTemplates();
  wireComments();
  wireShapes();
  wireShapeUpload();
  wireDrawers();
  wireCanvasBar();
  wireSplitter();
  wireSidebar();
  wireKeyboard();
  wireA11y();
  wirePalette();
  wireTheme();
  wireCollab();
  wireVisioImport();
  wireCloud();
  cloudRestoreSession();
  // 携带 ?collab=room 进入：自动重连到邀请的协作房间
  try {
    const autoRoom = new URLSearchParams(location.search).get('collab');
    if (autoRoom) startCollab(autoRoom, '我');
  } catch (_) {}
  if (btnCloseDiff) btnCloseDiff.addEventListener('click', () => {
    diffModal.hidden = true;
    if (allDrawersClosed() && settingsEl.hidden && xmlModal.hidden && paletteEl.hidden) scrim.hidden = true;
  });
  btnNewChat.addEventListener('click', newConversation);

  // 监听对话区变化，自动切换 has-conv（收起副标题引导语）
  try {
    const chatObserver = new MutationObserver(() => syncAgentChrome());
    chatObserver.observe(messagesEl, { childList: true });
  } catch (_) {}
  syncAgentChrome();
  if (btnConvs) btnConvs.addEventListener('click', openConvDrawer);

  btnRetryEditor.addEventListener('click', () => { editorReady = false; showStage('boot'); initEditor(); });

  // 视图模式切换
  qa('.vt', viewToggle).forEach((b) =>
    b.addEventListener('click', () => setViewMode(b.dataset.mode)));

  // 从当前对话恢复消息与画布
  rebuildMessages(conv ? conv.history : []);
  if (currentXml) renderPreview(currentXml);
  else { previewWrap.innerHTML = ''; previewEmpty.hidden = false; }
  renderConvList();

  applyHashRoute();
  showRecoveryNotice();
  loadSharedFromUrl();

  // 首启自动聚焦输入框（窄屏跳过，避免移动端弹出软键盘遮挡画布）
  try { if (window.innerWidth > 768) input.focus({ preventScroll: true }); } catch (_) {}
}

/* 崩溃 / 重开后的恢复确认提示：检测本地是否有真实进度，仅每会话首次提示一次 */
function showRecoveryNotice() {
  try {
    if (sessionStorage.getItem('atelier.recovered.v1')) return;
    sessionStorage.setItem('atelier.recovered.v1', '1');
  } catch (_) {}
  const hasConv = Array.isArray(conversations) && conversations.some((c) => (c.history && c.history.length) || c.xml);
  const hasVer = Array.isArray(versions) && versions.length > 0;
  const hasCanvas = !!currentXml;
  if (!hasConv && !hasVer && !hasCanvas) return;
  const parts = [];
  if (hasConv) parts.push((conversations.length) + ' 个对话');
  if (hasVer) parts.push(versions.length + ' 个版本');
  if (hasCanvas && !hasConv && !hasVer) parts.push('上次的画布');
  toast('已自动恢复你上次的工作 · ' + parts.join(' / '), 'ok', 4200);
}

/* ══════════════════ 智能识别与诊断（Phase 2） ══════════════════ */
/* 解析当前图 XML，启发式识别图类型、统计节点/连线、检测孤立节点 */
function analyzeDiagram(xml) {
  const out = { type: 'diagram', typeLabel: '通用图', nodes: 0, edges: 0, isolated: [], styleIssues: [], layoutIssues: [], misAligned: 0, overlaps: 0, layoutClean: true, repairs: [], needsRepair: false };
  if (!xml) return out;
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) return out;
    const cells = Array.from(doc.querySelectorAll('mxCell'));
    const styleOf = (c) => (c.getAttribute('style') || '');
    const isVertex = (c) => c.getAttribute('vertex') === '1' && c.id !== '0' && c.id !== '1';
    const isEdge = (c) => c.getAttribute('edge') === '1';
    const isLane = (c) => /swimlane/.test(styleOf(c));
    const isText = (c) => /(^|;)text;/.test(styleOf(c)) && !isLane(c);
    const laneCount = cells.filter((c) => isVertex(c) && isLane(c)).length;
    const nodes = cells.filter((c) => isVertex(c) && !isLane(c) && !isText(c));
    const edges = cells.filter(isEdge);
    out.nodes = nodes.length;
    out.edges = edges.length;
    const laneIds = new Set(cells.filter((c) => isVertex(c) && isLane(c)).map((c) => c.id));
    const childCount = {};
    cells.forEach((c) => { const p = c.getAttribute('parent'); if (p) childCount[p] = (childCount[p] || 0) + 1; });
    const connected = new Set();
    edges.forEach((e) => {
      const s = e.getAttribute('source'), t = e.getAttribute('target');
      if (s) connected.add(s);
      if (t) connected.add(t);
    });
    nodes.forEach((n) => {
      const p = n.getAttribute('parent');
      const grouped = (p && laneIds.has(p)) || (childCount[n.id] || 0) > 0;
      if (!grouped && !connected.has(n.id)) {
        const v = (n.getAttribute('value') || '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim();
        out.isolated.push(v || ('节点 ' + n.id));
      }
    });
    out.isolated = out.isolated.slice(0, 5);
    const hasRhombus = nodes.some((n) => /rhombus|perimeter=rhombusPerimeter/.test(styleOf(n)));
    const hasCenter = nodes.some((n) => /arcSize=50/.test(styleOf(n)) || /fillColor=#24314F/.test(styleOf(n)));
    const hasLifeline = nodes.some((n) => /shape=line/.test(styleOf(n))) ||
      edges.some((e) => /endArrow=none/.test(styleOf(e)) && /exitY=1|vertical/.test(styleOf(e)));
    const hasCylinder = nodes.some((n) => /shape=cylinder3/.test(styleOf(n)));
    if (laneCount >= 2) { out.type = 'architecture'; out.typeLabel = '架构图'; }
    else if (hasCenter && out.nodes >= 3) { out.type = 'mindmap'; out.typeLabel = '思维导图'; }
    else if (hasRhombus) { out.type = 'flowchart'; out.typeLabel = '流程图'; }
    else if (hasLifeline) { out.type = 'sequence'; out.typeLabel = '时序图'; }
    else if (hasCylinder) { out.type = 'er'; out.typeLabel = 'ER 图'; }
    else { out.type = 'diagram'; out.typeLabel = '通用图'; }
    // 风格一致性（按图类型调整严格度：思维导图天生多彩，不查配色）
    const fontSizes = {};
    const fillColors = {};
    const checkColor = out.type !== 'mindmap';
    const isCenter = (n) => /arcSize=50/.test(styleOf(n)) || /fillColor=#24314F/.test(styleOf(n));
    nodes.forEach((n) => {
      if (isCenter(n)) return;
      const st = styleOf(n);
      const fs = (st.match(/fontSize=(\d+)/) || [])[1];
      if (fs) fontSizes[fs] = (fontSizes[fs] || 0) + 1;
      if (checkColor) {
        const fc = (st.match(/fillColor=([^;]+)/) || [])[1];
        if (fc && fc !== 'none') fillColors[fc] = (fillColors[fc] || 0) + 1;
      }
    });
    const issues = [];
    if (Object.keys(fontSizes).length > 1) issues.push('混用 ' + Object.keys(fontSizes).length + ' 种字号');
    if (checkColor && Object.keys(fillColors).length > 6) issues.push('配色过于杂乱（' + Object.keys(fillColors).length + ' 种）');
    out.styleIssues = issues;
    out.styleConsistent = issues.length === 0;

    // 布局诊断（智能对齐提醒）：仅看顶层节点（parent=默认图层），不破坏泳道等容器内部布局
    // 双层阈值：TOL=同一行/列归属（避免合并真实分行）；JIT=对齐容差（同一行内偏移 >JIT 才算未对齐）
    // 用「同行/列是否对齐 + 是否重叠」判定，而非绝对网格——示例图落在 10px 网格上也判为整洁，避免误报
    const TOL = 18, JIT = 10;
    const geoOf = (c) => {
      const g = c.querySelector && c.querySelector('mxGeometry');
      if (!g) return null;
      return {
        x: parseFloat(g.getAttribute('x')) || 0,
        y: parseFloat(g.getAttribute('y')) || 0,
        w: parseFloat(g.getAttribute('width')) || 0,
        h: parseFloat(g.getAttribute('height')) || 0,
      };
    };
    const rects = nodes
      .filter((n) => (n.getAttribute('parent') || '1') === '1')
      .map((n) => { const g = geoOf(n); return g ? { id: n.id, x: g.x, y: g.y, w: g.w, h: g.h } : null; })
      .filter(Boolean);
    const clusterBy = (arr, key, tol) => {
      const sorted = arr.slice().sort((a, b) => key(a) - key(b));
      const groups = [];
      for (const it of sorted) {
        const last = groups[groups.length - 1];
        if (last && Math.abs(key(it) - key(last[0])) <= tol) last.push(it);
        else groups.push([it]);
      }
      return groups;
    };
    let misAligned = 0;
    clusterBy(rects, (r) => r.y, TOL).forEach((grp) => {
      if (grp.length < 2) return;
      // 连续性约束：仅当同行节点在 x 方向连续排布（相邻间距 ≤400）才视为真实横排，
      // 否则是无关节点偶然同高（如思维导图左右分支），不误报
      const xs = grp.map((r) => r.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > 400) return;
      const ys = grp.map((r) => r.y);
      if (Math.max.apply(null, ys) - Math.min.apply(null, ys) > JIT) misAligned += grp.length;
    });
    clusterBy(rects, (r) => r.x, TOL).forEach((grp) => {
      if (grp.length < 2) return;
      const xs = grp.map((r) => r.x);
      if (Math.max.apply(null, xs) - Math.min.apply(null, xs) > JIT) misAligned += grp.length;
    });
    let overlaps = 0;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 4 && oy > 4) overlaps++;
      }
    }
    const layoutIssues = [];
    if (misAligned > 0) layoutIssues.push(misAligned + ' 个节点未对齐（同行/列错位）');
    if (overlaps > 0) layoutIssues.push(overlaps + ' 处节点重叠');
    out.misAligned = misAligned; out.overlaps = overlaps;
    out.layoutIssues = layoutIssues;
    out.layoutClean = layoutIssues.length === 0;

    // 破损检测（可自动修复项，仅读取不修改）
    const repairs = [];
    const idCount = {};
    cells.forEach((c) => { const id = c.getAttribute('id'); if (id) idCount[id] = (idCount[id] || 0) + 1; });
    const idSet = new Set(cells.map((c) => c.getAttribute('id')).filter(Boolean));
    Object.keys(idCount).forEach((id) => { if (idCount[id] > 1) repairs.push({ type: 'duplicate-id', desc: '重复 id ' + id }); });
    edges.forEach((e) => {
      const s = e.getAttribute('source'), t = e.getAttribute('target');
      if ((s && !idSet.has(s)) || (t && !idSet.has(t))) repairs.push({ type: 'dangling-edge', desc: '悬空边（连接缺失）' });
    });
    cells.forEach((c) => {
      const p = c.getAttribute('parent');
      if (p && p !== '0' && p !== '1' && !idSet.has(p)) repairs.push({ type: 'orphan-parent', desc: '父节点缺失的孤儿节点' });
    });
    cells.forEach((c) => {
      if (c.getAttribute('vertex') !== '1') return;
      const g = c.querySelector && c.querySelector('mxGeometry');
      if (!g) { repairs.push({ type: 'missing-geometry', desc: '节点缺几何信息' }); return; }
      ['width', 'height'].forEach((a) => { const v = parseFloat(g.getAttribute(a)); if (!isFinite(v) || v <= 0) repairs.push({ type: 'bad-coords', desc: '非法尺寸' }); });
      ['x', 'y'].forEach((a) => { const v = parseFloat(g.getAttribute(a)); if (!isFinite(v)) repairs.push({ type: 'bad-coords', desc: '非法坐标' }); });
    });
    out.repairs = repairs;
    out.needsRepair = repairs.length > 0;
  } catch (_) {
    out.type = 'diagram'; out.typeLabel = '通用图';
  }
  return out;
}
function updateDiagramInsight() {
  if (!currentXml) {
    if (typeDetect) typeDetect.hidden = true;
    if (isoPill) isoPill.hidden = true;
    if (layoutPill) layoutPill.hidden = true;
    if (fixPill) fixPill.hidden = true;
    return;
  }
  const a = analyzeDiagram(currentXml);
  if (typeDetect) {
    typeDetect.hidden = false;
    typeDetect.dataset.type = a.type;
    typeDetectLabel.textContent = a.typeLabel;
  }
  const vSpan = statV && statV.querySelector('b');
  const eSpan = statE && statE.querySelector('b');
  if (vSpan) vSpan.textContent = a.nodes ?? 0;
  if (eSpan) eSpan.textContent = a.edges ?? 0;
  if (isoPill) {
    if (a.isolated.length) {
      isoPill.hidden = false;
      isoPill.textContent = '⚠ ' + a.isolated.length + ' 孤立';
      isoPill.title = '未连接到任何连线：' + a.isolated.join('、');
    } else {
      isoPill.hidden = true;
    }
  }
  if (stylePill) {
    if (a.styleIssues && a.styleIssues.length) {
      stylePill.hidden = false;
      stylePill.textContent = '⚠ 风格 ' + a.styleIssues.length;
      stylePill.title = '风格一致性：' + a.styleIssues.join('；');
    } else {
      stylePill.hidden = true;
    }
  }
  // 布局诊断：问题徽标本身可点击触发整理
  if (layoutPill) {
    if (a.layoutIssues && a.layoutIssues.length) {
      layoutPill.hidden = false;
      layoutPill.textContent = '⚠ 布局 ' + a.layoutIssues.length;
      layoutPill.title = '布局建议：' + a.layoutIssues.join('；') + ' · 点此自动对齐';
    } else {
      layoutPill.hidden = true;
    }
  }
  // 破损检测：问题徽标本身可点击触发修复
  if (fixPill) {
    if (a.repairs && a.repairs.length) {
      fixPill.hidden = false;
      fixPill.textContent = '⚠ ' + a.repairs.length + ' 修复';
      fixPill.title = '可自动修复：' + [...new Set(a.repairs.map((r) => r.desc))].join('、') + ' · 点此自动处理';
    } else {
      fixPill.hidden = true;
    }
  }
}

/* 一键整理布局：贴网格 + 同行/列对齐（仅作用于顶层节点，不破坏泳道内部） */
function tidyLayout() {
  if (!currentXml) return;
  try {
    const doc = new DOMParser().parseFromString(currentXml, 'application/xml');
    if (doc.querySelector('parsererror')) { toast('布局整理失败：XML 解析错误', 'err'); return; }
    const GRID = 20, TOL = 18;
    const topCells = Array.from(doc.querySelectorAll('mxCell'))
      .filter((c) => c.getAttribute('vertex') === '1' && (c.getAttribute('parent') || '1') === '1')
      .map((c) => ({ c, g: c.querySelector('mxGeometry') }))
      .filter((o) => o.g);
    if (!topCells.length) { toast('没有可整理的图形', 'brass'); return; }
    const list = topCells.map((o) => {
      const x = Math.round((parseFloat(o.g.getAttribute('x')) || 0) / GRID) * GRID;
      const y = Math.round((parseFloat(o.g.getAttribute('y')) || 0) / GRID) * GRID;
      o.g.setAttribute('x', x); o.g.setAttribute('y', y);
      return { o, x, y };
    });
    const clusterBy = (arr, key, tol) => {
      const sorted = arr.slice().sort((a, b) => key(a) - key(b));
      const groups = [];
      for (const it of sorted) {
        const last = groups[groups.length - 1];
        if (last && Math.abs(key(it) - key(last[0])) <= tol) last.push(it);
        else groups.push([it]);
      }
      return groups;
    };
    clusterBy(list, (i) => i.y, TOL).forEach((grp) => {
      if (grp.length < 2) return;
      const ty = Math.round(grp.reduce((s, i) => s + i.y, 0) / grp.length / GRID) * GRID;
      grp.forEach((i) => i.o.g.setAttribute('y', ty));
    });
    clusterBy(list, (i) => i.x, TOL).forEach((grp) => {
      if (grp.length < 2) return;
      const tx = Math.round(grp.reduce((s, i) => s + i.x, 0) / grp.length / GRID) * GRID;
      grp.forEach((i) => i.o.g.setAttribute('x', tx));
    });
    const xml = new XMLSerializer().serializeToString(doc.documentElement);
    loadXml(xml);
    toast('已按网格对齐并整理布局', 'ok', 2600);
  } catch (e) {
    toast('布局整理失败：' + (e && e.message ? e.message : e), 'err');
  }
}

/* 破损图自动修复：删除悬空边 / 重命名重复 id / 重挂孤儿节点 / 补全缺失几何 / 修正非法坐标。
   仅做安全可逆的修复（loadXml 后进入撤销栈，可 Ctrl+Z 回退）。 */
function repairDiagram() {
  if (!currentXml) return;
  try {
    const doc = new DOMParser().parseFromString(currentXml, 'application/xml');
    if (doc.querySelector('parsererror')) { toast('修复失败：XML 解析错误', 'err'); return; }
    const cells = Array.from(doc.querySelectorAll('mxCell'));
    const ids = new Set(cells.map((c) => c.getAttribute('id')).filter(Boolean));
    let fixed = 0; const kinds = new Set();
    // 1) 重复 id 重命名（保留首个，其余加 _rN 后缀，避免与现有 id 冲突）
    const seen = {};
    cells.forEach((c) => {
      const id = c.getAttribute('id'); if (!id) return;
      if (seen[id]) {
        let n = 1, nid;
        do { nid = id + '_r' + n++; } while (ids.has(nid));
        c.setAttribute('id', nid); ids.add(nid); kinds.add('重复 id'); fixed++;
      } else seen[id] = true;
    });
    const ids2 = new Set(cells.map((c) => c.getAttribute('id')).filter(Boolean));
    // 2) 悬空边（source/target 指向不存在的节点）→ 删除
    cells.filter((c) => c.getAttribute('edge') === '1').forEach((e) => {
      const s = e.getAttribute('source'), t = e.getAttribute('target');
      if ((s && !ids2.has(s)) || (t && !ids2.has(t))) {
        if (e.parentNode) e.parentNode.removeChild(e);
        kinds.add('悬空边'); fixed++;
      }
    });
    // 3) 孤儿节点（parent 指向不存在的 id，且非根 0/1）→ 重挂到默认图层 1
    cells.forEach((c) => {
      const p = c.getAttribute('parent');
      if (p && p !== '0' && p !== '1' && !ids2.has(p)) {
        c.setAttribute('parent', '1'); kinds.add('孤儿节点'); fixed++;
      }
    });
    // 4) 缺几何 / 非法坐标 → 补默认
    cells.filter((c) => c.getAttribute('vertex') === '1').forEach((v) => {
      let g = v.querySelector('mxGeometry');
      if (!g) {
        g = doc.createElement('mxGeometry');
        g.setAttribute('as', 'geometry'); g.setAttribute('x', '40'); g.setAttribute('y', '40');
        g.setAttribute('width', '120'); g.setAttribute('height', '40');
        v.appendChild(g); kinds.add('缺失几何'); fixed++;
      } else {
        ['width', 'height', 'x', 'y'].forEach((a) => {
          const val = parseFloat(g.getAttribute(a));
          if (!isFinite(val) || ((a === 'width' || a === 'height') && val <= 0)) {
            g.setAttribute(a, a === 'width' ? '120' : a === 'height' ? '40' : '40');
            kinds.add('非法坐标'); fixed++;
          }
        });
      }
    });
    if (!fixed) { toast('未发现需要修复的问题', 'ok'); return; }
    const xml = new XMLSerializer().serializeToString(doc.documentElement);
    loadXml(xml);
    toast('已自动修复 ' + fixed + ' 处：' + [...kinds].join('、'), 'ok', 4200);
  } catch (e) {
    toast('修复失败：' + (e && e.message ? e.message : e), 'err');
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);
if (document.readyState !== 'loading') bootstrap();
