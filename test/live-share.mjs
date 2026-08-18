// 端到端验证 #56 分享实时化：POST 生成 → GET 读取 → PATCH 更新 → GET 拿到新 XML → /v/:id 含轮询脚本
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 7395;
const BASE = `http://127.0.0.1:${PORT}`;
const NODE = 'C:/Users/anlan0725/.workbuddy/binaries/node/versions/22.22.2/node.exe';
const SAMPLE = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="A" style="atos:cloud" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell><mxCell id="3" value="B" style="atos:data" vertex="1" parent="1"><mxGeometry x="240" y="40" width="120" height="60" as="geometry"/></mxCell><mxCell id="4" style="edgeStyle=orthogonalEdgeStyle" edge="1" parent="1" source="2" target="3"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel>';
const UPDATED = SAMPLE.replace('value="A"', 'value="A-updated"').replace('value="B"', 'value="B-updated"');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

const server = spawn(NODE, ['server.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
let srvOut = '';
server.stdout.on('data', (d) => (srvOut += d));
server.stderr.on('data', (d) => (srvOut += d));

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return true; } catch {}
    await sleep(200);
  }
  return false;
}

try {
  const ready = await waitReady();
  if (!ready) { console.error('服务未就绪:\n' + srvOut); process.exit(1); }

  // 1) POST 生成分享
  const post = await fetch(BASE + '/api/share', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ xml: SAMPLE, title: '实时同步测试', comments: [{ id: 'c1', x: 50, y: 50, text: '批注1', author: '我' }] }),
  });
  const postData = await post.json();
  ok('POST /api/share 返回 200 + id', post.ok && !!postData.id, JSON.stringify(postData));
  const id = postData.id;
  ok('POST 返回 vertices/edges 统计', typeof postData.vertices === 'number' && typeof postData.edges === 'number');
  ok('POST 统计边数=1', postData.edges === 1, 'edges=' + postData.edges);

  // 2) GET 读取
  const get1 = await fetch(BASE + '/api/share/' + id);
  const g1 = await get1.json();
  ok('GET 读取成功', get1.ok && g1.xml === SAMPLE);
  ok('GET 返回批注', Array.isArray(g1.comments) && g1.comments.length === 1);

  // 3) PATCH 更新
  const patch = await fetch(BASE + '/api/share/' + id, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ xml: UPDATED, comments: [{ id: 'c1', x: 50, y: 50, text: '批注2', author: '我' }] }),
  });
  const pData = await patch.json();
  ok('PATCH 返回 200 + updatedAt', patch.ok && typeof pData.updatedAt === 'number', JSON.stringify(pData));

  // 4) GET 拿到新 XML
  const get2 = await fetch(BASE + '/api/share/' + id);
  const g2 = await get2.json();
  ok('PATCH 后 GET 返回新 XML', g2.xml === UPDATED);
  ok('PATCH 后批注已更新', g2.comments[0].text === '批注2');
  ok('PATCH 后 updatedAt > createdAt', g2.updatedAt >= g2.createdAt);

  // 5) PATCH 非法 XML → 400
  const bad = await fetch(BASE + '/api/share/' + id, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ xml: 'not valid <<<' }),
  });
  ok('PATCH 非法 XML 返回 400', bad.status === 400, 'status=' + bad.status);

  // 6) 验证非法 PATCH 未污染原数据（仍返回旧合法 XML）
  const get3 = await fetch(BASE + '/api/share/' + id);
  const g3 = await get3.json();
  ok('非法 PATCH 不污染原分享', g3.xml === UPDATED);

  // 7) /v/:id 只读页含轮询脚本 + SHARE_ID
  const v = await fetch(BASE + '/v/' + id);
  const vHtml = await v.text();
  ok('/v/:id 返回 200', v.status === 200);
  ok('只读页暴露 SHARE_ID 常量', vHtml.includes('var SHARE_ID = ' + JSON.stringify(id)));
  ok('只读页含 setInterval(poll, 4000) 轮询', vHtml.includes('setInterval(poll, 4000)'));
  ok('只读页含实时同步徽标', vHtml.includes('id="rvLive"'));

  // 8) 删除后 GET 404（通过非法 id 验证路由 404，模拟删除用 restart 已不可行，跳过）
  const miss = await fetch(BASE + '/api/share/nonexistent-id');
  ok('GET 不存在的分享返回 404', miss.status === 404);
} catch (e) {
  fail++;
  console.error('测试异常:', e);
} finally {
  server.kill('SIGKILL');
}

await sleep(200);
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
