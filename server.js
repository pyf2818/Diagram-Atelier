'use strict';

/**
 * AI Diagram Atelier — 后端服务（Node 原生模块，零第三方依赖）
 *
 * 路由：
 *   GET  /                 静态首页
 *   GET  /api/health       健康检查
 *   GET  /api/presets      内置大模型服务商预设
 *   GET  /api/samples      内置示例图（无 Key 也能跑通闭环）
 *   POST /api/verify       校验用户填写的大模型配置连通性
 *   POST /api/normalize    XML 规范化 + 校验（导入粘贴的 XML 时用）
 *   POST /api/chat         SSE 流式：自然语言 → draw.io XML（支持 patch 模式）
 *   GET  /api/templates    社区模板列表
 *   POST /api/templates    发布模板到社区
 *   GET  /api/templates/:id 获取社区模板 XML
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { PRESETS, streamChat, verify, fetchModels } = require('./lib/llm');
const { buildMessages } = require('./lib/prompt');
const { extractDiagramXml, extractJsonPatch, normalizeDrawioXml, validateXml, summarizeDiagram } = require('./lib/xml');
const { SAMPLES } = require('./lib/samples');
const { handleCollabUpgrade } = require('./lib/collab');
const { vsdxToDrawio } = require('./lib/visio');
const { drawioToVsdx } = require('./lib/vsdx-export');
const { createAccounts } = require('./lib/accounts');

const PORT = Number(process.env.PORT || 7391);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 8 * 1024 * 1024;
const IS_MCP = process.argv.includes('--mcp') || process.env.ATELIER_MCP === '1';
const MCP_URL_BASE = process.env.ATELIER_URL || `http://${HOST}:${PORT}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/* ------------------------------------------------------------------ */
/* 分享存储（内存 Map + 磁盘持久化，重启不丢链接）                       */
/* ------------------------------------------------------------------ */

const SHARE_DIR = process.env.ATELIER_DATA_DIR || path.join(__dirname, 'data');
const SHARE_FILE = path.join(SHARE_DIR, 'shares.json');
const SHARE_MAX = 1000; // 单实例上限，超出按创建时间淘汰最旧

const shares = loadShares();

function loadShares() {
  try {
    const raw = fs.readFileSync(SHARE_FILE, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function genShareId() {
  let id;
  do {
    id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  } while (shares[id]);
  return id;
}

function sanitizeComments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 200)
    .map((c) => ({
      id: String((c && c.id) || '').slice(0, 64),
      x: Number(c && c.x) || 0,
      y: Number(c && c.y) || 0,
      text: String((c && c.text) || '').slice(0, 2000),
      author: String((c && c.author) || '我').slice(0, 40),
      createdAt: Number(c && c.createdAt) || Date.now(),
      resolved: !!(c && c.resolved),
    }));
}

function createShare({ xml, title, comments }) {
  const id = genShareId();
  const summary = summarizeDiagram(xml);
  const entry = {
    id,
    title: (title && String(title).trim()) || '未命名图表',
    xml,
    createdAt: Date.now(),
    vertices: summary.vertices || 0,
    edges: summary.edges || 0,
    comments: sanitizeComments(comments),
  };
  shares[id] = entry;
  // 淘汰最旧，避免无界增长
  const ids = Object.keys(shares)
    .sort((a, b) => shares[a].createdAt - shares[b].createdAt);
  if (ids.length > SHARE_MAX) {
    ids.slice(0, ids.length - SHARE_MAX).forEach((k) => delete shares[k]);
  }
  persistShares();
  return entry;
}

/* 实时同步：作者编辑后 PATCH 更新分享内容（仅更新存在条目，触发只读页轮询刷新） */
function updateShare(id, patch) {
  const entry = shares[id];
  if (!entry) return null;
  patch = patch || {};
  if (typeof patch.xml === 'string') {
    const xml = patch.xml.trim();
    if (!xml) return { error: '分享内容为空，无法更新' };
    const v = validateXml(xml);
    if (!v.ok) {
      return { error: '图表 XML 不合法：' + (v.errors[0] || '未知错误'), errors: v.errors };
    }
    entry.xml = xml;
    const summary = summarizeDiagram(xml);
    entry.vertices = summary.vertices || 0;
    entry.edges = summary.edges || 0;
  }
  if (typeof patch.title === 'string' && patch.title.trim()) {
    entry.title = patch.title.trim().slice(0, 80);
  }
  if (Array.isArray(patch.comments)) {
    entry.comments = sanitizeComments(patch.comments);
  }
  entry.updatedAt = Date.now();
  persistShares();
  return {
    id: entry.id,
    title: entry.title,
    vertices: entry.vertices,
    edges: entry.edges,
    updatedAt: entry.updatedAt,
  };
}

function persistShares() {
  try {
    if (!fs.existsSync(SHARE_DIR)) fs.mkdirSync(SHARE_DIR, { recursive: true });
    fs.writeFileSync(SHARE_FILE, JSON.stringify(shares), 'utf8');
  } catch (e) {
    console.error('[share] 持久化失败', e.message);
  }
}

/* ------------------------------------------------------------------ */
/* 社区模板库（本地轻云）                                               */
/* ------------------------------------------------------------------ */

const TEMPLATE_FILE = path.join(SHARE_DIR, 'templates.json');
const TEMPLATE_MAX = 500;

const communityTemplates = loadCommunityTemplates();

function loadCommunityTemplates() {
  try {
    const raw = fs.readFileSync(TEMPLATE_FILE, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persistCommunityTemplates() {
  try {
    if (!fs.existsSync(SHARE_DIR)) fs.mkdirSync(SHARE_DIR, { recursive: true });
    fs.writeFileSync(TEMPLATE_FILE, JSON.stringify(communityTemplates), 'utf8');
  } catch (e) {
    console.error('[template] 持久化失败', e.message);
  }
}

function sanitizeTemplate(raw) {
  const title = String((raw && raw.title) || '').trim().slice(0, 80) || '未命名模板';
  const xml = String((raw && raw.xml) || '').trim();
  const author = String((raw && raw.author) || '匿名').trim().slice(0, 40);
  const tags = Array.isArray(raw && raw.tags)
    ? raw.tags.map((t) => String(t).trim().slice(0, 20)).filter(Boolean).slice(0, 8)
    : [];
  return { title, xml, author, tags };
}

function createCommunityTemplate(raw) {
  const { title, xml, author, tags } = sanitizeTemplate(raw);
  if (!xml) return { error: '模板 XML 不能为空' };
  const v = validateXml(xml);
  if (!v.ok) return { error: '模板 XML 不合法：' + (v.errors[0] || '未知错误'), errors: v.errors };
  const { xml: normalized } = normalizeDrawioXml(xml);
  const summary = summarizeDiagram(normalized);
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title,
    xml: normalized,
    author,
    tags,
    vertices: summary.vertices || 0,
    edges: summary.edges || 0,
    createdAt: Date.now(),
  };
  communityTemplates.unshift(entry);
  if (communityTemplates.length > TEMPLATE_MAX) communityTemplates.length = TEMPLATE_MAX;
  persistCommunityTemplates();
  return { entry };
}

function htmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* 只读分享页：自包含、不依赖外部站点，复用 /render.js 离线渲染 */
function renderReadOnlyPage(entry) {
  const safeXml = JSON.stringify(entry.xml).replace(/</g, '\\u003c');
  const safeComments = JSON.stringify(entry.comments || []).replace(/</g, '\\u003c');
  const title = htmlEscape(entry.title || '未命名图表');
  const counts = `${entry.vertices || 0} 个图形 · ${entry.edges || 0} 条连线`;
  const created = entry.createdAt
    ? ' · ' + new Date(entry.createdAt).toLocaleString('zh-CN')
    : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · Diagram Atelier 只读视图</title>
<script>if(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.setAttribute('data-theme','dark');</script>
<style>
:root{--ink:#24314F;--brass:#C9A961;--paper:#FBFAF7;--text:#2A2A2E;--muted:#8A857B;--line:#ECE7DC;--soft:#F4F1EA;--bar:#FFFFFF;}
[data-theme="dark"]{--ink:#D9DEEA;--brass:#D6B271;--paper:#1B202B;--text:#E6E8EF;--muted:#98A2BA;--line:#2A3040;--soft:#222838;--bar:#20262F;}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--paper);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,"PingFang SC","Microsoft YaHei",sans-serif;}
.rv{display:flex;align-items:center;gap:16px;padding:12px 20px;background:var(--bar);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5;flex-wrap:wrap}
.rv-brand{display:flex;align-items:center;gap:9px;font-weight:700;color:var(--ink);white-space:nowrap}
.rv-brand svg{width:30px;height:30px}
.rv-info{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
.rv-badge{font-size:11px;font-weight:700;color:var(--brass);border:1px solid var(--brass);border-radius:999px;padding:2px 9px;white-space:nowrap}
.rv-title{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:42vw}
.rv-sub{color:var(--muted);font-size:12.5px;white-space:nowrap}
.rv-actions{display:flex;gap:8px}
.rv-btn{text-decoration:none;font-size:13px;padding:7px 13px;border-radius:9px;border:1px solid var(--line);color:var(--ink);background:var(--soft);white-space:nowrap}
.rv-btn.primary{background:var(--ink);color:#fff;border-color:var(--ink)}
.rv-stage{padding:28px;display:flex;justify-content:center;align-items:flex-start;overflow:auto;min-height:calc(100vh - 60px)}
.rv-stage svg{max-width:100%;height:auto;filter:drop-shadow(0 6px 24px rgba(36,49,79,.08))}
.rv-canvas{position:relative;display:inline-block}
.rv-anno{position:absolute;inset:0;pointer-events:none}
.rv-pin{position:absolute;transform:translate(-50%,-50%);min-width:21px;height:21px;padding:0 6px;border-radius:999px;background:var(--brass);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(36,49,79,.32);pointer-events:auto;cursor:default}
.rv-pin.resolved{background:var(--muted)}
.rv-foot{text-align:center;color:var(--muted);font-size:12px;padding:14px}
.rv-err{color:#C0623E;font-family:monospace;padding:40px;text-align:center}
.rv-live{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--brass);white-space:nowrap}
.rv-dot{width:8px;height:8px;border-radius:50%;background:#3DA35D;box-shadow:0 0 0 0 rgba(61,163,93,.5);animation:pulse 2s infinite}
.rv-live.live-flash{color:#3DA35D}
.rv-live.live-flash .rv-dot{background:var(--brass);animation:none}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(61,163,93,.5)}70%{box-shadow:0 0 0 6px rgba(61,163,93,0)}100%{box-shadow:0 0 0 0 rgba(61,163,93,0)}}
@media (max-width:640px){.rv-sub{display:none}.rv-title{max-width:30vw}}
</style>
</head>
<body>
<header class="rv">
  <div class="rv-brand">
    <svg viewBox="0 0 40 40" width="30" height="30" aria-hidden="true">
      <rect width="40" height="40" rx="9" fill="#24314F"/>
      <g stroke="#C9A961" stroke-width="1.5" fill="none">
        <rect x="8" y="8" width="11" height="8" rx="2"/>
        <rect x="21" y="24" width="11" height="8" rx="2"/>
        <path d="M13.5 16v6h13v2"/>
      </g>
      <circle cx="13.5" cy="26" r="2.6" fill="#C9A961" opacity=".55"/>
    </svg>
    <span>Diagram Atelier</span>
  </div>
  <div class="rv-info">
    <span class="rv-badge">只读视图</span>
    <span class="rv-title">${title}</span>
    <span class="rv-sub">${counts}${created}</span>
  </div>
  <span class="rv-live" id="rvLive" title="实时同步：约每 4 秒自动拉取最新版本"><span class="rv-dot"></span>实时同步</span>
  <div class="rv-actions">
    <a class="rv-btn" href="/">在 Atelier 打开 ↗</a>
    <a class="rv-btn primary" href="/?s=${entry.id}">编辑此副本</a>
  </div>
</header>
<main class="rv-stage" id="stage"></main>
<div class="rv-foot">由 AI Diagram Atelier 生成 · 此链接为只读分享</div>
<script src="/shapes.js"></script>
<script src="/render.js"></script>
<script>
var SHARE_ID = ${JSON.stringify(entry.id)};
var currentXml = ${safeXml};
var currentComments = ${safeComments};
var liveBadge = document.getElementById('rvLive');
var flashTimer = null;

/* 渲染图表 + 批注 pin（每次图或批注变化都调用） */
function renderShare(xml, comments) {
  var stage = document.getElementById('stage');
  stage.innerHTML = '';
  try {
    var r = window.DiagramRender.render(stage, xml);
    if (!r.ok) { stage.innerHTML = '<div class="rv-err">图表渲染失败：' + (r.error || '') + '</div>'; return; }
    var svg = stage.querySelector('svg');
    var canvas = document.createElement('div'); canvas.className = 'rv-canvas';
    svg.parentNode.insertBefore(canvas, svg); canvas.appendChild(svg);
    var layer = document.createElement('div'); layer.className = 'rv-anno'; canvas.appendChild(layer);
    (comments || []).forEach(function (c, i) {
      var pin = document.createElement('div');
      pin.className = 'rv-pin' + (c.resolved ? ' resolved' : '');
      pin.style.left = ((c.x || 0) - (r.bbox.minX)) + 'px';
      pin.style.top = ((c.y || 0) - (r.bbox.minY)) + 'px';
      pin.textContent = String(i + 1);
      pin.title = (c.text || '（空批注）') + (c.resolved ? ' · 已解决' : '');
      layer.appendChild(pin);
    });
  } catch (e) {
    stage.innerHTML = '<div class="rv-err">' + (e && e.message ? e.message : e) + '</div>';
  }
}
renderShare(currentXml, currentComments);

/* 作者编辑后闪一下「实时同步」徽标 */
function flashUpdated() {
  if (!liveBadge) return;
  liveBadge.classList.add('live-flash');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(function () { liveBadge.classList.remove('live-flash'); }, 1500);
}

/* 轮询：约每 4 秒拉取最新版本，图或批注变化即重渲染 */
function poll() {
  fetch('/api/share/' + encodeURIComponent(SHARE_ID), { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) {
        document.getElementById('stage').innerHTML = '<div class="rv-err">分享链接已失效，作者可能已删除该图表。</div>';
        if (liveBadge) liveBadge.style.display = 'none';
        clearInterval(timer);
        return;
      }
      if (d.xml && d.xml !== currentXml) {
        currentXml = d.xml;
        currentComments = d.comments || [];
        renderShare(currentXml, currentComments);
        flashUpdated();
      } else if (JSON.stringify(d.comments || []) !== JSON.stringify(currentComments)) {
        currentComments = d.comments || [];
        renderShare(currentXml, currentComments);
        flashUpdated();
      }
    })
    .catch(function () { /* 网络抖动忽略，下次轮询重试 */ });
}
var timer = setInterval(poll, 4000);
</script>
</body>
</html>`;
}

function renderShareNotFound() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>分享不存在 · Diagram Atelier</title>
<style>body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#FBFAF7;color:#2A2A2E;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.box{text-align:center}.box h1{color:#24314F;margin-bottom:6px}.box p{color:#8A857B}.box a{color:#C9A961;text-decoration:none;font-weight:600;display:inline-block;margin-top:14px}</style>
</head>
<body><div class="box"><h1>分享链接已失效</h1><p>该图表可能已被删除或服务已重启。</p><a href="/">返回 Diagram Atelier →</a></div></body>
</html>`;
}

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* 云端账号体系（自托管轻量版：注册/登录 + 服务端图存储）                  */
/* ------------------------------------------------------------------ */

const accounts = createAccounts({ dataDir: SHARE_DIR });

const authAttempts = new Map(); // ip -> { count, resetAt }
function authRateOk(ip) {
  const now = Date.now();
  const rec = authAttempts.get(ip);
  if (!rec || now > rec.resetAt) {
    authAttempts.set(ip, { count: 1, resetAt: now + 60000 });
    return true;
  }
  rec.count++;
  return rec.count <= 20;
}

function clientIp(req) {
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function requireAuth(req, res) {
  const user = accounts.authUser(req);
  if (!user) {
    sendJson(res, 401, { error: '未登录或登录已过期' });
    return null;
  }
  return user;
}

/* ------------------------------------------------------------------ */
/* 工具                                                               */
/* ------------------------------------------------------------------ */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function normalizeLlmConfig(input) {
  const cfg = input && typeof input === 'object' ? input : {};
  const out = {
    protocol: cfg.protocol === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: String(cfg.baseUrl || process.env.LLM_BASE_URL || '').trim(),
    apiKey: String(cfg.apiKey || process.env.LLM_API_KEY || '').trim(),
    model: String(cfg.model || process.env.LLM_MODEL || '').trim(),
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
  };
  if (!out.baseUrl) throw new Error('尚未配置 API Base URL，请点击右上角「模型设置」填写。');
  if (!out.model) throw new Error('尚未配置模型名称，请点击右上角「模型设置」填写。');
  return out;
}

/* ------------------------------------------------------------------ */
/* 静态资源                                                            */
/* ------------------------------------------------------------------ */

async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  const target = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));

  if (!target.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { error: '禁止访问' });
  }
  try {
    const stat = await fsp.stat(target);
    if (stat.isDirectory()) return sendJson(res, 404, { error: 'Not Found' });
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-cache',
    });
    fs.createReadStream(target).pipe(res);
  } catch {
    sendJson(res, 404, { error: 'Not Found: ' + rel });
  }
}

/* ------------------------------------------------------------------ */
/* SSE：/api/chat                                                     */
/* ------------------------------------------------------------------ */

function openSse(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 2000\n\n');
}

function sse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function handleChat(req, res) {
  let payload;
  try {
    payload = await readBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  let cfg;
  try {
    cfg = normalizeLlmConfig(payload.llm);
  } catch (err) {
    return sendJson(res, 400, { error: err.message, code: 'NO_CONFIG' });
  }

  const userInput = String(payload.input || '').trim();
  if (!userInput) return sendJson(res, 400, { error: '请输入你的需求' });

  const mode = payload.mode === 'patch' ? 'patch' : 'full';
  const messages = buildMessages({
    history: Array.isArray(payload.history) ? payload.history.slice(-12) : [],
    userInput,
    currentXml: payload.currentXml,
    extraPrompt: payload.extraPrompt,
    mode,
  });

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  openSse(res);
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* noop */
    }
  }, 15000);

  const started = Date.now();
  sse(res, 'start', { model: cfg.model, protocol: cfg.protocol, at: started });

  try {
    let charCount = 0;
    const { text, usage } = await streamChat(
      cfg,
      messages,
      (chunk, kind) => {
        if (kind === 'think') {
          // 思维链增量：单独事件类型，前端渲染为可折叠的「思考过程」块
          sse(res, 'think', { t: chunk });
          return;
        }
        charCount += chunk.length;
        sse(res, 'delta', { t: chunk, n: charCount });
      },
      controller.signal
    );

    // 流结束：进入服务端校验阶段（前端据此切换过程指示）
    sse(res, 'stage', { k: 'validate', label: mode === 'patch' ? '解析增量指令' : '校验与自动修复' });

    // PATCH MODE：AI 返回 JSON patch，由前端合并到当前 XML
    if (mode === 'patch') {
      const { patch, reply: patchReply } = extractJsonPatch(text);
      if (patch) {
        sse(res, 'done', {
          mode: 'patch',
          patch,
          reply: patchReply || '图表已更新。',
          elapsedMs: Date.now() - started,
          usage: usage || null,
        });
        clearInterval(heartbeat);
        return res.end();
      }
      // 未识别到 patch 时降级为完整 XML 生成
    }

    const { xml: rawXml, reply } = extractDiagramXml(text);

    if (!rawXml) {
      sse(res, 'done', {
        reply: reply || text.slice(0, 2000),
        xml: null,
        valid: false,
        errors: ['模型本次没有返回 XML 代码块，请补充说明后重试'],
        elapsedMs: Date.now() - started,
        usage: usage || null,
      });
      clearInterval(heartbeat);
      return res.end();
    }

    const { xml, changed, validation } = normalizeDrawioXml(rawXml);
    const summary = summarizeDiagram(xml);

    sse(res, 'done', {
      reply: reply || '图表已生成。',
      xml,
      valid: validation.ok,
      errors: validation.errors,
      autofix: changed,
      summary,
      elapsedMs: Date.now() - started,
      usage: usage || null,
      chars: text.length,
    });
  } catch (err) {
    const msg = controller.signal.aborted ? '请求已取消' : err?.message || String(err);
    sse(res, 'error', { error: msg });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}

/* ------------------------------------------------------------------ */
/* 路由                                                               */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  // 实时协作：WebSocket 升级请求（部分 Node 环境不会派发 'upgrade' 事件，故在此主 handler 内拦截）
  if (req.headers.upgrade && String(req.headers.upgrade).toLowerCase() === 'websocket') {
    handleCollabUpgrade(req);
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  const p = url.pathname;

  try {
    if (p === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'AI Diagram Atelier',
        version: require('./package.json').version,
        node: process.version,
        uptimeSec: Math.round(process.uptime()),
      });
    }

    if (p === '/api/presets') {
      return sendJson(res, 200, { presets: PRESETS });
    }

    if (p === '/api/samples') {
      const key = url.searchParams.get('key');
      if (key) {
        const s = SAMPLES[key];
        if (!s) return sendJson(res, 404, { error: '示例不存在: ' + key });
        return sendJson(res, 200, { ...s, summary: summarizeDiagram(s.xml) });
      }
      return sendJson(res, 200, {
        samples: Object.values(SAMPLES).map((s) => ({
          key: s.key,
          label: s.label,
          desc: s.desc,
          summary: summarizeDiagram(s.xml),
        })),
      });
    }

    if (p === '/api/verify' && req.method === 'POST') {
      let cfg;
      try {
        cfg = normalizeLlmConfig((await readBody(req)).llm);
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message });
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const info = await verify(cfg, controller.signal);
        return sendJson(res, 200, info);
      } catch (err) {
        return sendJson(res, 200, {
          ok: false,
          error: controller.signal.aborted ? '连接超时（30s）' : err?.message || String(err),
        });
      } finally {
        clearTimeout(timer);
      }
    }

    // 从服务端拉取模型列表（规避浏览器 CORS），10s 超时
    if (p === '/api/models' && req.method === 'POST') {
      // 轻量归一化：拉取模型时 model 尚未确定，不能套用强制要求 model 的 normalizeLlmConfig
      const raw = (await readBody(req)).llm || {};
      const cfg = {
        protocol: raw.protocol === 'anthropic' ? 'anthropic' : 'openai',
        baseUrl: String(raw.baseUrl || process.env.LLM_BASE_URL || '').trim(),
        apiKey: String(raw.apiKey || process.env.LLM_API_KEY || '').trim(),
      };
      if (!cfg.baseUrl) return sendJson(res, 400, { ok: false, error: '请先填写 API Base URL' });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const info = await fetchModels(cfg, controller.signal);
        return sendJson(res, 200, { ok: true, models: info.models, endpoint: info.endpoint });
      } catch (err) {
        return sendJson(res, 200, {
          ok: false,
          error: controller.signal.aborted ? '拉取超时（10s），请检查 Base URL' : err?.message || String(err),
        });
      } finally {
        clearTimeout(timer);
      }
    }

    if (p === '/api/normalize' && req.method === 'POST') {
      const body = await readBody(req);
      const input = String(body.xml || '');
      if (!input.trim()) return sendJson(res, 400, { error: 'xml 不能为空' });
      const { xml, changed, validation } = normalizeDrawioXml(input);
      return sendJson(res, 200, {
        xml,
        autofix: changed,
        valid: validation.ok,
        errors: validation.errors,
        summary: summarizeDiagram(xml),
      });
    }

    if (p === '/api/import/visio' && req.method === 'POST') {
      try {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const buf = Buffer.concat(chunks);
        if (!buf || buf.length === 0) return sendJson(res, 400, { error: '上传文件为空' });
        const result = vsdxToDrawio(buf, { name: 'Visio 导入' });
        return sendJson(res, 200, {
          xml: result.xml,
          valid: result.validation.ok,
          errors: result.validation.errors,
          summary: result.summary,
          warnings: result.warnings,
        });
      } catch (err) {
        return sendJson(res, 500, { error: 'Visio 解析失败：' + (err && err.message ? err.message : String(err)) });
      }
    }

    /* ── Visio 反向导出：draw.io XML -> .vsdx 二进制 ── */
    if (p === '/api/export/visio' && req.method === 'POST') {
      let body;
      try {
        body = await readBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
      const xml = String((body && body.xml) || '');
      if (!xml.trim()) return sendJson(res, 400, { error: 'xml 不能为空' });
      const out = drawioToVsdx(xml, { title: body && body.title });
      if (out.error) return sendJson(res, 400, { error: out.error });
      const filename = encodeURIComponent(((body && body.title) || 'diagram').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) + '.vsdx');
      res.writeHead(200, {
        'content-type': 'application/vnd.ms-visio.drawing',
        'content-length': out.buffer.length,
        'content-disposition': `attachment; filename="diagram.vsdx"; filename*=UTF-8''${filename}`,
        'cache-control': 'no-store',
      });
      return res.end(out.buffer);
    }

    if (p === '/api/validate' && req.method === 'POST') {
      const body = await readBody(req);
      const result = validateXml(String(body.xml || ''));
      return sendJson(res, 200, { ...result, summary: summarizeDiagram(String(body.xml || '')) });
    }

    /* ── 云端账号：注册 / 登录 / 会话 ── */
    if ((p === '/api/auth/register' || p === '/api/auth/login') && req.method === 'POST') {
      if (!authRateOk(clientIp(req))) return sendJson(res, 429, { error: '尝试过于频繁，请稍后再试' });
      let body;
      try {
        body = await readBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
      const result = p.endsWith('/register') ? accounts.register(body || {}) : accounts.login(body || {});
      if (result.error) return sendJson(res, 400, { error: result.error });
      return sendJson(res, 200, { token: result.token, user: result.user });
    }
    if (p === '/api/auth/logout' && req.method === 'POST') {
      return sendJson(res, 200, accounts.logout(req));
    }
    if (p === '/api/auth/me' && req.method === 'GET') {
      const user = accounts.authUser(req);
      if (!user) return sendJson(res, 401, { error: '未登录或登录已过期' });
      return sendJson(res, 200, { user: accounts.publicUser(user) });
    }

    /* ── 云端图库：按用户隔离的图存储 ── */
    if (p === '/api/diagrams' && req.method === 'GET') {
      const user = requireAuth(req, res);
      if (!user) return;
      return sendJson(res, 200, { list: accounts.listDiagrams(user) });
    }
    if (p === '/api/diagrams' && req.method === 'POST') {
      const user = requireAuth(req, res);
      if (!user) return;
      let body;
      try {
        body = await readBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
      const result = accounts.saveDiagram(user, body || {});
      if (result.error) return sendJson(res, 400, { error: result.error });
      return sendJson(res, 200, result.entry);
    }
    if (p.startsWith('/api/diagrams/')) {
      const user = requireAuth(req, res);
      if (!user) return;
      const id = decodeURIComponent(p.slice('/api/diagrams/'.length).split('/')[0]);
      if (req.method === 'GET') {
        const entry = accounts.getDiagram(user, id);
        if (!entry) return sendJson(res, 404, { error: '图表不存在或无权限' });
        return sendJson(res, 200, entry);
      }
      if (req.method === 'PUT') {
        let body;
        try {
          body = await readBody(req);
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
        const result = accounts.saveDiagram(user, { ...(body || {}), id });
        if (result.error) return sendJson(res, 400, { error: result.error });
        return sendJson(res, 200, result.entry);
      }
      if (req.method === 'DELETE') {
        const okDel = accounts.deleteDiagram(user, id);
        if (!okDel) return sendJson(res, 404, { error: '图表不存在或无权限' });
        return sendJson(res, 200, { ok: true });
      }
    }

    if (p === '/api/chat' && req.method === 'POST') {
      return handleChat(req, res);
    }

    /* ── 分享：生成只读链接 ── */
    if (p === '/api/share' && req.method === 'POST') {
      let body;
      try {
        body = await readBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
      const xml = String((body && body.xml) || '').trim();
      if (!xml) return sendJson(res, 400, { error: '分享内容为空，无法生成链接' });
      const v = validateXml(xml);
      if (!v.ok) {
        return sendJson(res, 400, { error: '图表 XML 不合法：' + (v.errors[0] || '未知错误'), errors: v.errors });
      }
      const entry = createShare({ xml, title: body && body.title, comments: body && body.comments });
      return sendJson(res, 200, {
        id: entry.id,
        url: '/v/' + entry.id,
        title: entry.title,
        vertices: entry.vertices,
        edges: entry.edges,
      });
    }

    /* ── 分享：读取/更新单条（GET 供 ?s=ID 载入副本 + 只读页轮询；PATCH 实时同步）── */
    if (p.startsWith('/api/share/')) {
      const id = decodeURIComponent(p.slice('/api/share/'.length).split('/')[0]);
      const entry = shares[id];
      if (!entry) return sendJson(res, 404, { error: '分享不存在或已失效' });
      if (req.method === 'PATCH') {
        let body;
        try {
          body = await readBody(req);
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
        const updated = updateShare(id, body || {});
        if (!updated) return sendJson(res, 404, { error: '分享不存在或已失效' });
        if (updated.error) return sendJson(res, 400, { error: updated.error, errors: updated.errors });
        return sendJson(res, 200, updated);
      }
      return sendJson(res, 200, {
        id: entry.id,
        title: entry.title,
        xml: entry.xml,
        comments: entry.comments || [],
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt || entry.createdAt,
        vertices: entry.vertices,
        edges: entry.edges,
      });
    }

    /* ── 分享：只读渲染页 ── */
    if (p.startsWith('/v/')) {
      const id = decodeURIComponent(p.slice(3).split('/')[0]);
      const entry = shares[id];
      if (!entry) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(renderShareNotFound());
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(renderReadOnlyPage(entry));
      return;
    }

    /* ── 社区模板库 ── */
    if (p === '/api/templates' && req.method === 'GET') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);
      const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
      const list = communityTemplates.slice(offset, offset + limit).map((t) => ({
        id: t.id,
        title: t.title,
        author: t.author,
        tags: t.tags,
        vertices: t.vertices,
        edges: t.edges,
        createdAt: t.createdAt,
      }));
      return sendJson(res, 200, { list, total: communityTemplates.length });
    }
    if (p === '/api/templates' && req.method === 'POST') {
      let body;
      try {
        body = await readBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
      const result = createCommunityTemplate(body || {});
      if (result.error) return sendJson(res, 400, { error: result.error, errors: result.errors });
      return sendJson(res, 200, { id: result.entry.id, title: result.entry.title });
    }
    if (p.startsWith('/api/templates/') && req.method === 'GET') {
      const id = decodeURIComponent(p.slice('/api/templates/'.length).split('/')[0]);
      const t = communityTemplates.find((x) => x.id === id);
      if (!t) return sendJson(res, 404, { error: '模板不存在' });
      return sendJson(res, 200, { id: t.id, title: t.title, xml: t.xml, author: t.author, tags: t.tags, vertices: t.vertices, edges: t.edges, createdAt: t.createdAt });
    }

    /* ── 测试钩子：仅 ENABLE_TEST_ROUTES 时暴露，用于验证全局错误边界 ── */
    /* 关键：异常放在 setTimeout 异步回调里 throw，让它逃逸本处理器的同步 try/catch，
       真正触发 process 级 uncaughtException，而非被 500 兜底吞掉。默认不暴露。 */
    if (process.env.ENABLE_TEST_ROUTES && p === '/api/_boom') {
      res.statusCode = 200;
      res.end('boom scheduled');
      setTimeout(() => { throw new Error('intentional test boom'); }, 10);
      return;
    }

    if (p.startsWith('/api/')) {
      return sendJson(res, 404, { error: '未知接口: ' + p });
    }

    return serveStatic(req, res, p);
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: err?.message || '服务器内部错误' });
    else res.end();
  }
});

/* ------------------------------------------------------------------ */
/* MCP Server (stdio JSON-RPC) — 让 Diagram Atelier 成为 AI Agent 的绘图工具 */
/* ------------------------------------------------------------------ */

function mcpError(id, code, message, data) {
  return JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message, data } });
}

function mcpResult(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function mcpShareUrl(id) {
  return `${MCP_URL_BASE}/v/${id}`;
}

async function mcpGenerateDiagram(args) {
  const cfg = normalizeLlmConfig({});
  const prompt = String(args.prompt || '').trim();
  if (!prompt) throw new Error('prompt 不能为空');
  const typeHint = String(args.type_hint || '').trim();
  const title = String(args.title || '').trim() || undefined;
  const messages = buildMessages({
    history: [],
    userInput: prompt,
    extraPrompt: typeHint ? `图种倾向：${typeHint}` : undefined,
  });
  const { text, usage } = await streamChat(cfg, messages, () => {}, new AbortController().signal);
  const { xml: rawXml, reply } = extractDiagramXml(text);
  if (!rawXml) throw new Error('模型未返回 XML 代码块');
  const { xml, validation } = normalizeDrawioXml(rawXml);
  if (!validation.ok) throw new Error('生成的 XML 校验失败：' + (validation.errors || []).join('; '));
  const entry = createShare({ xml, title: title || '未命名图表', comments: [] });
  return {
    xml,
    reply: reply || '图表已生成。',
    share_id: entry.id,
    share_url: mcpShareUrl(entry.id),
    title: entry.title,
    summary: summarizeDiagram(xml),
    usage: usage || null,
  };
}

async function mcpEditDiagram(args) {
  const cfg = normalizeLlmConfig({});
  const id = String(args.share_id || '').trim();
  const instruction = String(args.instruction || '').trim();
  if (!id) throw new Error('share_id 不能为空');
  if (!instruction) throw new Error('instruction 不能为空');
  const entry = shares[id];
  if (!entry) throw new Error('分享链接不存在或已失效');
  const messages = buildMessages({ history: [], userInput: instruction, currentXml: entry.xml });
  const { text, usage } = await streamChat(cfg, messages, () => {}, new AbortController().signal);
  const { xml: rawXml, reply } = extractDiagramXml(text);
  if (!rawXml) throw new Error('模型未返回 XML 代码块');
  const { xml, validation } = normalizeDrawioXml(rawXml);
  if (!validation.ok) throw new Error('编辑后的 XML 校验失败：' + (validation.errors || []).join('; '));
  const updated = updateShare(id, { xml, title: entry.title });
  if (!updated || updated.error) throw new Error(updated?.error || '更新分享失败');
  return {
    xml,
    reply: reply || '图表已更新。',
    share_id: id,
    share_url: mcpShareUrl(id),
    title: updated.title,
    summary: summarizeDiagram(xml),
    usage: usage || null,
  };
}

async function mcpShareDiagram(args) {
  const xml = String(args.xml || '').trim();
  const title = String(args.title || '').trim() || '未命名图表';
  if (!xml) throw new Error('xml 不能为空');
  const v = validateXml(xml);
  if (!v.ok) throw new Error('XML 不合法：' + (v.errors || []).join('; '));
  const { xml: normalized } = normalizeDrawioXml(xml);
  const entry = createShare({ xml: normalized, title, comments: [] });
  return {
    share_id: entry.id,
    share_url: mcpShareUrl(entry.id),
    title: entry.title,
    summary: summarizeDiagram(normalized),
  };
}

async function mcpGetDiagram(args) {
  const id = String(args.share_id || '').trim();
  if (!id) throw new Error('share_id 不能为空');
  const entry = shares[id];
  if (!entry) throw new Error('分享链接不存在或已失效');
  return {
    share_id: id,
    share_url: mcpShareUrl(id),
    xml: entry.xml,
    title: entry.title,
    summary: { vertices: entry.vertices || 0, edges: entry.edges || 0 },
    created_at: entry.createdAt,
  };
}

async function mcpValidateDiagram(args) {
  const xml = String(args.xml || '').trim();
  if (!xml) throw new Error('xml 不能为空');
  const { xml: normalized, changed, validation } = normalizeDrawioXml(xml);
  return {
    valid: validation.ok,
    errors: validation.errors || [],
    autofix: changed,
    normalized_xml: normalized,
  };
}

const MCP_TOOLS = [
  {
    name: 'generate_diagram',
    description: '用自然语言生成一张 draw.io 兼容的专业图表，返回 XML 和可分享的只读链接。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '想画的图的中文描述，例如"画一个电商下单到发货的流程图"' },
        type_hint: { type: 'string', enum: ['flowchart', 'architecture', 'mindmap', 'sequence', 'er'], description: '图种提示（可选）' },
        title: { type: 'string', description: '图表标题（可选）' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'edit_diagram',
    description: '基于已有的分享图，按自然语言指令修改并返回新的分享链接。',
    inputSchema: {
      type: 'object',
      properties: {
        share_id: { type: 'string', description: '分享 ID' },
        instruction: { type: 'string', description: '修改指令，例如"把判断条件改成库存校验"' },
      },
      required: ['share_id', 'instruction'],
    },
  },
  {
    name: 'share_diagram',
    description: '把已有 draw.io XML 发布为只读分享链接，可在浏览器中打开或嵌入。',
    inputSchema: {
      type: 'object',
      properties: {
        xml: { type: 'string', description: '完整 <mxfile>...</mxfile> XML' },
        title: { type: 'string', description: '图表标题（可选）' },
      },
      required: ['xml'],
    },
  },
  {
    name: 'get_diagram',
    description: '根据分享 ID 获取图表 XML 和元数据。',
    inputSchema: {
      type: 'object',
      properties: {
        share_id: { type: 'string', description: '分享 ID' },
      },
      required: ['share_id'],
    },
  },
  {
    name: 'validate_diagram',
    description: '校验并自动修复 draw.io XML，返回标准化后的 XML 和错误列表。',
    inputSchema: {
      type: 'object',
      properties: {
        xml: { type: 'string', description: '完整 <mxfile>...</mxfile> XML' },
      },
      required: ['xml'],
    },
  },
];

async function mcpHandleCall(method, params, id) {
  if (method === 'initialize') {
    return mcpResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'diagram-atelier-mcp', version: '2.1.0' },
    });
  }
  if (method === 'notifications/initialized') {
    return null; // no response
  }
  if (method === 'tools/list') {
    return mcpResult(id, { tools: MCP_TOOLS });
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    try {
      let result;
      switch (name) {
        case 'generate_diagram': result = await mcpGenerateDiagram(args); break;
        case 'edit_diagram': result = await mcpEditDiagram(args); break;
        case 'share_diagram': result = await mcpShareDiagram(args); break;
        case 'get_diagram': result = await mcpGetDiagram(args); break;
        case 'validate_diagram': result = await mcpValidateDiagram(args); break;
        default: return mcpError(id, -32601, `未知工具: ${name}`);
      }
      return mcpResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (err) {
      return mcpError(id, -32603, err?.message || String(err));
    }
  }
  return mcpError(id, -32601, `未知方法: ${method}`);
}

function runMcpServer() {
  const rl = require('node:readline').createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  rl.on('line', async (line) => {
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      console.log(mcpError(null, -32700, 'JSON 解析失败'));
      return;
    }
    const { method, params, id } = req;
    const out = await mcpHandleCall(method, params, id);
    if (out) console.log(out);
  });
  rl.on('close', () => process.exit(0));
}

/* ------------------------------------------------------------------ */
/* 服务启动                                                            */
/* ------------------------------------------------------------------ */

if (IS_MCP) {
  runMcpServer();
} else {
  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    console.log('');
    console.log('  ╭──────────────────────────────────────────────╮');
    console.log('  │   AI Diagram Atelier  ·  智能绘图工作台        │');
    console.log('  ╰──────────────────────────────────────────────╯');
    console.log(`  ▸ 服务地址   ${url}`);
    console.log(`  ▸ 健康检查   ${url}/api/health`);
    console.log(`  ▸ Node       ${process.version}`);
    console.log('');
  });
}

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

// 全局兜底：未被请求处理器 try/catch 捕获的同步异常（如模块加载期、
// 异步回调里的同步异常）一律记录并继续服务，避免整进程因单点异常而挂掉。
// 有意识取舍：单机长驻服务没有外部 supervisor 自动重启，故采取「记录并继续」
// 而非退出；若未来接入 supervisor（如 pm2/systemd），可改为 here 后 process.exit(1)。
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});
