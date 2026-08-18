/**
 * Diagram Atelier — 实时协作集成测试（零第三方依赖）
 * 起真实 server，用两个原生 WS 客户端（自实现掩码帧）验证：
 *   - 握手 101 + welcome / peer-join 事件
 *   - 一端发 doc，另一端收到
 *   - presence（cursor）广播
 * 结果同步写入 _collab_result.json（避免 stdout 缓冲在进程退出前丢失）。
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrames } from '../lib/collab.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const PORT = 7400 + Math.floor(Math.random() * 200);
const RESULT = path.join(ROOT, '_collab_result.json');

const result = { pass: 0, fail: 0, failures: [], logs: [] };
function log(s) { result.logs.push(s); }
function ok(name, cond, extra) {
  if (cond) { result.pass++; log('  ✓ ' + name); }
  else { result.fail++; result.failures.push(name + (extra ? ' :: ' + extra : '')); log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function flush() { fs.writeFileSync(RESULT, JSON.stringify(result, null, 2)); }
process.on('unhandledRejection', (e) => { log('UNHANDLED_REJECTION: ' + (e && e.message)); result.fail++; result.failures.push('unhandled:' + (e && e.message)); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function maskFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  const mask = crypto.randomBytes(4);
  let header;
  if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

function wsConnect(room, name) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(PORT, '127.0.0.1', () => {
      sock.write(
        `GET /collab?room=${room} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${PORT}\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\n` +
        'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });
    let handshook = false;
    let buf = Buffer.alloc(0);
    const handlers = [];
    sock.on('data', (chunk) => {
      if (!handshook) {
        if (chunk.toString('latin1').includes('101')) { handshook = true; sock.write(maskFrame(JSON.stringify({ type: 'hello', name }))); resolve(api); }
        return;
      }
      buf = Buffer.concat([buf, chunk]);
      let parsed;
      try { parsed = parseFrames(buf); } catch (e) { return; }
      buf = parsed.rest;
      for (const f of parsed.frames) {
        if (f.opcode !== 0x1) continue;
        let msg; try { msg = JSON.parse(f.payload.toString('utf8')); } catch (_) { continue; }
        handlers.forEach((h) => h(msg));
      }
    });
    sock.on('error', reject);
    const api = {
      send: (obj) => sock.write(maskFrame(JSON.stringify(obj))),
      onMessage: (cb) => handlers.push(cb),
      waitFor: (type, timeout = 3000) => new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout waiting ' + type)), timeout);
        const h = (m) => { if (m.type === type) { clearTimeout(t); const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); res(m); } };
        handlers.push(h);
      }),
      close: () => sock.end(),
    };
  });
}

async function main() {
  const child = spawn(NODE, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => log('[srv] ' + d.toString().trim()));
  const killChild = () => { try { child.kill('SIGKILL'); } catch (_) {} };
  process.on('exit', killChild);
  setTimeout(() => { log('HARD_TIMEOUT port=' + PORT); flush(); process.exit(1); }, 9000).unref();
  await sleep(900);
  result.logs.push('after sleep; port=' + PORT);
  flush();

  try {
    const A = await wsConnect('room1', 'Alice');
    const welcomeA = await A.waitFor('welcome');
    ok('A 收到 welcome 且 clientId 存在', !!welcomeA.clientId, 'clientId=' + welcomeA.clientId);
    ok('A 初始 peers 为空', Array.isArray(welcomeA.peers) && welcomeA.peers.length === 0);

    const joinP = A.waitFor('peer-join');
    const B = await wsConnect('room1', 'Bob');
    const welcomeB = await B.waitFor('welcome');
    const pj = await joinP;
    ok('B 收到 welcome 且 peers 含 A', welcomeB.peers.length === 1 && welcomeB.peers[0].name === 'Alice');
    ok('A 收到 B 的 peer-join 事件', pj.name === 'Bob' && !!pj.color, 'pj=' + JSON.stringify(pj));

    const docP = B.waitFor('doc');
    A.send({ type: 'doc', xml: '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>' });
    const doc = await docP;
    ok('B 收到 A 广播的 doc', doc.type === 'doc' && doc.xml.includes('mxGraphModel'), 'xml=' + (doc.xml || '').slice(0, 30));
    ok('doc 带 from 字段', !!doc.from);

    const curP = A.waitFor('cursor');
    B.send({ type: 'cursor', x: 120, y: 80 });
    const cur = await curP;
    ok('A 收到 B 的 cursor presence', cur.type === 'cursor' && cur.x === 120 && cur.y === 80 && cur.name === undefined ? false : cur.name === 'Bob');

    const leaveP = A.waitFor('peer-leave');
    B.close();
    const lv = await leaveP;
    ok('B 断开后 A 收到 peer-leave', lv.type === 'peer-leave');

    A.close();
  } catch (e) {
    ok('异常: ' + e.message, false);
  } finally {
    killChild();
    flush();
  }
}

main();
