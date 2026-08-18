import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';

const SERVER = path.resolve('server.js');
const SHARE_FILE = path.resolve('data', 'shares.json');
const MINI_XML = `<mxfile host="atelier" version="1.0"><diagram id="test" name="test"><mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0"><root><mxCell id="0" /><mxCell id="1" parent="0" /><mxCell id="2" value="开始" style="rounded=1;arcSize=40;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="120" y="120" width="120" height="60" as="geometry" /></mxCell></root></mxGraphModel></diagram></mxfile>`;

const tests = [];
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function check(name, fn) {
  tests.push({ name, fn });
}

async function runMcpSession(actions) {
  const proc = spawn(process.execPath, [SERVER, '--mcp'], { env: { ...process.env, ATELIER_URL: 'http://127.0.0.1:7391' } });
  const rl = createInterface({ input: proc.stdout });
  const pending = [];
  let id = 1;

  rl.on('line', (line) => {
    const res = JSON.parse(line);
    const p = pending.find((x) => x.id === res.id);
    if (p) {
      p.resolve(res);
      pending.splice(pending.indexOf(p), 1);
    }
  });

  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = id++;
      pending.push({ id: mid, resolve, reject });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: mid, method, params }) + '\n');
    });

  const notify = (method, params = {}) => {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  };

  // initialize handshake
  const init = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } });
  assert(init.result.protocolVersion === '2024-11-05', 'initialize protocolVersion');
  notify('notifications/initialized');

  const result = await actions({ call, notify });

  proc.stdin.end();
  await new Promise((resolve) => proc.on('close', resolve));
  return result;
}

check('tools/list 返回 5 个工具', async ({ call }) => {
  const res = await call('tools/list');
  const tools = res.result.tools;
  assert(Array.isArray(tools) && tools.length === 5, `tools.length=${tools?.length}`);
  const names = tools.map((t) => t.name).sort();
  assert(JSON.stringify(names) === JSON.stringify(['edit_diagram', 'generate_diagram', 'get_diagram', 'share_diagram', 'validate_diagram'].sort()), 'tool names mismatch');
});

check('validate_diagram 校验通过', async ({ call }) => {
  const res = await call('tools/call', { name: 'validate_diagram', arguments: { xml: MINI_XML } });
  assert(!res.error, res.error?.message);
  const text = res.result.content[0].text;
  const data = JSON.parse(text);
  assert(data.valid === true, 'valid should be true');
  assert(data.errors.length === 0, 'errors should be empty');
});

check('share_diagram 创建分享并 get_diagram 可读回', async ({ call }) => {
  const res = await call('tools/call', { name: 'share_diagram', arguments: { xml: MINI_XML, title: 'MCP 测试图' } });
  assert(!res.error, res.error?.message);
  const data = JSON.parse(res.result.content[0].text);
  assert(data.share_id && data.share_url, 'missing share_id/url');
  assert(data.share_url.includes(`/v/${data.share_id}`), 'share_url format');
  assert(data.title === 'MCP 测试图', 'title');

  const get = await call('tools/call', { name: 'get_diagram', arguments: { share_id: data.share_id } });
  assert(!get.error, get.error?.message);
  const got = JSON.parse(get.result.content[0].text);
  assert(got.xml === data.normalized_xml || got.xml === MINI_XML, 'xml roundtrip');
  assert(got.title === 'MCP 测试图', 'roundtrip title');
});

check('generate_diagram 无 LLM 配置时返回配置错误', async ({ call }) => {
  const res = await call('tools/call', { name: 'generate_diagram', arguments: { prompt: '画一个流程图' } });
  assert(res.error, 'expected error for missing LLM config');
  assert(res.error.message.includes('API Base URL') || res.error.message.includes('模型名称'), `error message: ${res.error.message}`);
});

async function main() {
  let passed = 0;
  let failed = 0;
  const hadShares = fs.existsSync(SHARE_FILE);
  const backup = hadShares ? fs.readFileSync(SHARE_FILE, 'utf8') : '{}';
  fs.writeFileSync(SHARE_FILE, '{}');

  for (const t of tests) {
    try {
      await runMcpSession(t.fn);
      console.log(`✓ ${t.name}`);
      passed++;
    } catch (err) {
      console.error(`✗ ${t.name}: ${err.message}`);
      failed++;
    }
  }

  // restore shares
  fs.writeFileSync(SHARE_FILE, backup || '{}');

  console.log(`\nMCP 测试: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
