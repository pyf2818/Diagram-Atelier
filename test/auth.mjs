// 云端账号体系端到端测试：注册 → 登录 → me → 保存图 → 列表 → 更新 → 读取 → 删除 → 未授权 401
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const PORT = 7397;
const BASE = `http://127.0.0.1:${PORT}`;
// 每次测试用独立临时数据目录，保证可重复执行
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-auth-test-'));
const SAMPLE_XML = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="云端节点A" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel>';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

const server = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ATELIER_DATA_DIR: DATA_DIR },
  stdio: ['ignore', 'pipe', 'pipe'],
});
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

const j = (r) => r.json();

try {
  const ready = await waitReady();
  if (!ready) { console.error('服务未就绪:\n' + srvOut); process.exit(1); }

  // 1) 注册
  const reg = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: '绘制员甲', password: 'secret66' }),
  });
  const regData = await j(reg);
  ok('注册成功返回 token + user', reg.ok && !!regData.token && regData.user?.username === '绘制员甲', JSON.stringify(regData));
  const token = regData.token;

  // 2) 重复注册被拒
  const dup = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: '绘制员甲', password: 'secret66' }),
  });
  ok('重复用户名注册返回 400', dup.status === 400);

  // 3) 弱密码被拒
  const weak = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: '绘制员乙', password: '123' }),
  });
  ok('弱密码注册返回 400', weak.status === 400);

  // 4) 登录（正确密码）
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: '绘制员甲', password: 'secret66' }),
  });
  const loginData = await j(login);
  ok('登录成功返回新 token', login.ok && !!loginData.token);

  // 5) 错误密码
  const badLogin = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: '绘制员甲', password: 'wrong-pass' }),
  });
  ok('错误密码登录返回 400', badLogin.status === 400);

  // 6) me
  const me = await fetch(BASE + '/api/auth/me', { headers: { authorization: 'Bearer ' + token } });
  const meData = await j(me);
  ok('GET /api/auth/me 返回用户信息', me.ok && meData.user?.username === '绘制员甲', JSON.stringify(meData));

  // 7) 未授权访问图库 401
  const noauth = await fetch(BASE + '/api/diagrams');
  ok('无 token 访问图库返回 401', noauth.status === 401);

  // 8) 保存图
  const save = await fetch(BASE + '/api/diagrams', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ title: '我的架构图', xml: SAMPLE_XML }),
  });
  const saveData = await j(save);
  ok('保存图成功返回 id', save.ok && !!saveData.id, JSON.stringify(saveData));
  ok('保存图统计 vertices=1', saveData.vertices === 1, JSON.stringify(saveData));
  const diagramId = saveData.id;

  // 9) 列表
  const list = await fetch(BASE + '/api/diagrams', { headers: { authorization: 'Bearer ' + token } });
  const listData = await j(list);
  ok('图库列表包含刚保存的图', list.ok && listData.list?.length === 1 && listData.list[0].title === '我的架构图', JSON.stringify(listData));

  // 10) 读取单张
  const get = await fetch(BASE + '/api/diagrams/' + diagramId, { headers: { authorization: 'Bearer ' + token } });
  const getData = await j(get);
  ok('读取单张图返回原始 XML', get.ok && getData.xml === SAMPLE_XML);

  // 11) PUT 更新
  const updatedXml = SAMPLE_XML.replace('云端节点A', '云端节点A-改');
  const put = await fetch(BASE + '/api/diagrams/' + diagramId, {
    method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ title: '我的架构图-改', xml: updatedXml }),
  });
  const putData = await j(put);
  ok('PUT 更新成功', put.ok && putData.title === '我的架构图-改', JSON.stringify(putData));
  const get2 = await fetch(BASE + '/api/diagrams/' + diagramId, { headers: { authorization: 'Bearer ' + token } });
  const get2Data = await j(get2);
  ok('PUT 后读取返回新 XML', get2Data.xml === updatedXml);

  // 12) 用户隔离：注册另一个用户看不到第一张图
  const reg2 = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: '绘制员乙', password: 'secret88' }),
  });
  const reg2Data = await j(reg2);
  const otherList = await fetch(BASE + '/api/diagrams', { headers: { authorization: 'Bearer ' + reg2Data.token } });
  const otherListData = await j(otherList);
  ok('用户数据隔离（乙看不到甲的图）', otherList.ok && otherListData.list?.length === 0, JSON.stringify(otherListData));
  const otherGet = await fetch(BASE + '/api/diagrams/' + diagramId, { headers: { authorization: 'Bearer ' + reg2Data.token } });
  ok('乙读甲的图返回 404', otherGet.status === 404);

  // 13) DELETE
  const del = await fetch(BASE + '/api/diagrams/' + diagramId, {
    method: 'DELETE', headers: { authorization: 'Bearer ' + token },
  });
  ok('删除图成功', del.ok);
  const get3 = await fetch(BASE + '/api/diagrams/' + diagramId, { headers: { authorization: 'Bearer ' + token } });
  ok('删除后读取 404', get3.status === 404);

  // 14) 登出后 token 失效
  await fetch(BASE + '/api/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + token } });
  const meAfterLogout = await fetch(BASE + '/api/auth/me', { headers: { authorization: 'Bearer ' + token } });
  ok('登出后 me 返回 401', meAfterLogout.status === 401);

  // 15) 服务端持久化文件存在
  ok('accounts.json 已持久化', fs.existsSync(path.join(DATA_DIR, 'accounts.json')));
  ok('diagrams.json 已持久化', fs.existsSync(path.join(DATA_DIR, 'diagrams.json')));
} catch (e) {
  fail++;
  console.error('测试异常:', e);
} finally {
  server.kill('SIGKILL');
}

await sleep(200);
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
