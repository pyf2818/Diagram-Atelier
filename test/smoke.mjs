/**
 * Diagram Atelier — 冒烟 + 单测（Node 原生，零第三方依赖）
 *
 * 覆盖：
 *   单测：shapes.js / prompt.js / xml.js / samples.js 的数据完整性与契约
 *   冒烟：起真实 server 进程，验证 health / samples / normalize(含 atos)
 *         / share(含 comments 持久化与读取) / 只读页 / 失效 404 / 非法 400
 *         / 错误边界（/api/_boom 触发 uncaughtException 兜底，进程不崩）
 *
 * 运行：node test/smoke.mjs  或  npm test
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const require = createRequire(import.meta.url);

const PORT = Number(process.env.SMOKE_PORT || 7396);
const BASE = `http://127.0.0.1:${PORT}`;
const NODE = process.execPath;

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; failures.push(name + (extra ? ' :: ' + extra : '')); console.log('  \x1b[31m✗\x1b[0m ' + name + (extra ? '  → ' + extra : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(BASE + p, {
      method,
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
async function waitHealth(timeoutMs = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await req('GET', '/api/health');
      if (r.status === 200) return true;
    } catch (_) {}
    await sleep(120);
  }
  return false;
}

const ATOS_XML =
  '<mxfile><diagram><mxGraphModel><root>' +
  '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="2" value="Kubernetes" style="shape=atos:kubernetes;whiteSpace=wrap;html=1;" vertex="1" parent="1">' +
  '<mxGeometry x="40" y="40" width="120" height="80" as="geometry"/></mxCell>' +
  '</root></mxGraphModel></diagram></mxfile>';
const BAD_XML = '<not-valid>';
const COMMENTS = [
  { id: 'cmt-1', x: 100, y: 60, text: '加判断分支', author: '我', createdAt: Date.now(), resolved: false },
  { id: 'cmt-2', x: 100, y: 140, text: '已确认', author: '我', createdAt: Date.now(), resolved: true },
];

/* ----------------------------- 单测 ----------------------------- */
function unitTests() {
  console.log('\n[单测] 核心库契约');
  const L = require(path.join(ROOT, 'public', 'shapes.js'));
  ok('shapes: 图标总数 = 49', L.icons.length === 49, 'got ' + L.icons.length);
  ok('shapes: 分类数 = 10', L.categories.length === 10, 'got ' + L.categories.length);
  ok('shapes: 含「终端与设备」分类且 6 图标', (() => { const c = L.categories.find((x) => x.id === 'device'); return !!c && L.icons.filter((i) => i.category === 'device').length === 6; })());
  ok('shapes: 含「集成与接口」分类且 6 图标', (() => { const c = L.categories.find((x) => x.id === 'integration'); return !!c && L.icons.filter((i) => i.category === 'integration').length === 6; })());
  ok('shapes: 内建分类每类至少 1 个', L.categories.filter((c) => c.id !== 'custom').every((c) => L.icons.filter((i) => i.category === c.id).length >= 1));
  ok('shapes: 全部含 <svg', L.icons.every((i) => i.svg.includes('<svg')));
  ok('shapes: getImageUrl 均合法 data URL', L.icons.every((i) => {
    const u = L.getImageUrl(i.id);
    return u && u.startsWith('data:image/svg+xml,');
  }));
  const dupe = L.icons.map((i) => i.id).filter((v, idx, a) => a.indexOf(v) !== idx);
  ok('shapes: 无重复 id', dupe.length === 0, dupe.join(','));

  const P = require(path.join(ROOT, 'lib', 'prompt.js'));
  const sys = P.buildMessages({ userInput: '画一个云架构' })[0].content;
  ok('prompt: system 含 atos: 引用语法', sys.includes('atos:'));
  ok('prompt: system 含「专业图形库」段', sys.includes('专业图形库'));
  ok('prompt: system 含 kubernetes 图标名', sys.toLowerCase().includes('kubernetes'));
  ok('prompt: system 含 中文语义理解 指引', sys.includes('中文语义理解'));

  // 中文语义意图识别（零依赖，离线可测）
  const SEM = require(path.join(ROOT, 'lib', 'semantic.js'));
  ok('semantic: 可加载且 detectIntent 为函数', typeof SEM.detectIntent === 'function');
  ok('semantic: 流程图', SEM.detectIntent('画一个电商下单到发货的流程图').type === 'flowchart');
  ok('semantic: 架构图', SEM.detectIntent('设计一个典型的微服务后端架构图').type === 'architecture');
  ok('semantic: 思维导图', SEM.detectIntent('用思维导图梳理产品上线前 checklist').type === 'mindmap');
  ok('semantic: 时序图', SEM.detectIntent('画登录接口的时序图，含鉴权与数据库').type === 'sequence');
  ok('semantic: ER 图', SEM.detectIntent('设计用户与订单的 ER 图').type === 'er');
  ok('semantic: 含糊描述→auto', SEM.detectIntent('随便看看今天天气').type === 'auto');
  ok('semantic: extractHints 抽取业务实体', SEM.extractHints('下单流程包含用户、订单与支付').includes('订单'));

  const X = require(path.join(ROOT, 'lib', 'xml.js'));
  const vOk = X.validateXml('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>');
  ok('xml: validateXml 合法 → ok', vOk && vOk.ok === true);
  const vBad = X.validateXml(BAD_XML);
  ok('xml: validateXml 非法 → !ok 且 errors 数组', vBad && vBad.ok === false && Array.isArray(vBad.errors));
  const ext = X.extractDiagramXml(ATOS_XML);
  ok('xml: extractDiagramXml 返回 {xml} 且含 mxGraphModel', ext && typeof ext.xml === 'string' && ext.xml.includes('<mxGraphModel'));
  const patchText = '我帮你调整一下。\n```json\n{"ops":[{"op":"update","id":"2","value":"新文本"}]}\n```';
  const patchExt = X.extractJsonPatch(patchText);
  ok('xml: extractJsonPatch 从 ```json 提取 patch', patchExt && patchExt.patch && patchExt.patch.ops && patchExt.patch.ops.length === 1 && patchExt.patch.ops[0].id === '2');
  const sum = X.summarizeDiagram('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="A" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel>');
  ok('xml: summarizeDiagram 返回 vertices/edges', sum && typeof sum.vertices === 'number' && typeof sum.edges === 'number');
  ok('xml: normalizeDrawioXml 返回 {xml} 且不抛错含 mxGraphModel', (() => {
    try { const n = X.normalizeDrawioXml(ATOS_XML); return n && typeof n.xml === 'string' && n.xml.includes('mxGraphModel'); } catch (e) { return false; }
  })());

  const S = require(path.join(ROOT, 'lib', 'samples.js'));
  ok('samples: SAMPLES 对象非空且每项含 key/label', S.SAMPLES && typeof S.SAMPLES === 'object' && Object.keys(S.SAMPLES).length >= 1 && Object.values(S.SAMPLES).every((s) => s && s.key && s.label));
}

/* ----------------------------- 冒烟 ----------------------------- */
async function smokeTests(child) {
  console.log('\n[冒烟] 起真实 server 进程');

  ok('server 启动且 /api/health = 200', await waitHealth());

  const samples = await req('GET', '/api/samples');
  const sj = JSON.parse(samples.body);
  ok('samples 路由 = 200 且含 ≥1 示例', samples.status === 200 && (sj.samples || []).length >= 1, 'count=' + ((sj.samples || []).length));

  const norm = await req('POST', '/api/normalize', { xml: ATOS_XML });
  ok('normalize 接受 atos: 节点 = 200', norm.status === 200 && norm.body.includes('atos:kubernetes'));

  const bad = await req('POST', '/api/normalize', { xml: BAD_XML });
  const bj = JSON.parse(bad.body || '{}');
  // normalize 是 lenient 修复器：永远返回 200，但带 valid:false + errors 让前端判断
  ok('normalize 非法 XML → 200 且 valid:false 带 errors', bad.status === 200 && bj.valid === false && Array.isArray(bj.errors) && bj.errors.length > 0);

  const share = await req('POST', '/api/share', { xml: ATOS_XML, title: '图标测试', comments: COMMENTS });
  const sh = JSON.parse(share.body);
  ok('share 含 comments → 200 + id', share.status === 200 && sh.id && sh.url, JSON.stringify(sh));

  const get = await req('GET', '/api/share/' + sh.id);
  const gj = JSON.parse(get.body);
  ok('share 读取返回 comments(含 resolved)', get.status === 200 && Array.isArray(gj.comments) && gj.comments.length === 2 && gj.comments[1].resolved === true);

  const ro = await req('GET', '/v/' + sh.id);
  ok('只读页含 rv-canvas + shapes.js + atos 节点', ro.status === 200 && ro.body.includes('rv-canvas') && ro.body.includes('shapes.js') && ro.body.includes('atos:kubernetes'));

  const missing = await req('GET', '/api/share/does-not-exist');
  ok('失效分享 ID = 404', missing.status === 404);

  // 错误边界：异步 throw 逃逸同步 try/catch → 触发 uncaughtException 兜底
  const boom = await req('GET', '/api/_boom');
  ok('_boom 立即响应(200)', boom.status === 200);
  await sleep(200); // 等异步异常真正抛出
  const healthAfter = await req('GET', '/api/health');
  ok('uncaughtException 兜底生效：进程未崩，health 仍 200', healthAfter.status === 200);
}

/* ----------------------------- 备份/恢复 ----------------------------- */
const SHARE_FILE = path.join(ROOT, 'data', 'shares.json');
const BAK = SHARE_FILE + '.bak';
const hadShares = fs.existsSync(SHARE_FILE); // 记录测试前是否存在，避免用测试残留污染或留下垃圾文件
function backupShares() {
  if (hadShares) fs.copyFileSync(SHARE_FILE, BAK);
  else if (!fs.existsSync(path.dirname(SHARE_FILE))) fs.mkdirSync(path.dirname(SHARE_FILE), { recursive: true });
  if (!fs.existsSync(SHARE_FILE)) fs.writeFileSync(SHARE_FILE, '{}');
}
function restoreShares() {
  if (hadShares) {
    // 测试前已存在：用备份还原（保护用户真实分享数据，绝不丢失）
    if (fs.existsSync(BAK)) fs.copyFileSync(BAK, SHARE_FILE);
  } else {
    // 测试前不存在：清空测试产生的文件，恢复原始状态（不留下垃圾）
    fs.writeFileSync(SHARE_FILE, '{}');
  }
  // 不删除 .bak 以避免某些环境的安全删除 shim 报错；.bak 内容为空或旧备份，无害。
  if (fs.existsSync(BAK)) fs.writeFileSync(BAK, '');
}

/* ----------------------------- main ----------------------------- */
async function main() {
  backupShares();
  const child = spawn(NODE, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ENABLE_TEST_ROUTES: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverErr = '';
  child.stderr.on('data', (d) => (serverErr += d));

  try {
    unitTests();
    await smokeTests(child);
  } finally {
    try { child.kill('SIGTERM'); } catch (_) {}
    restoreShares();
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail) { console.log('失败项：\n - ' + failures.join('\n - ')); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error('测试运行器异常：', e); restoreShares(); process.exit(1); });
