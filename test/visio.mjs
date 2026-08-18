'use strict';

/**
 * Visio (.vsdx) 导入器端到端测试。
 * 不依赖任何第三方库：用 Node 内建 zlib 手工构造一个最小合法 .vsdx（zip 包），
 * 内含 visio/pages/p1.xml（3 个形状：2 个顶点 + 1 条 1-D 连线），端到端验证
 * parseZip -> readVsdx -> vsdxToDrawio -> validateXml 全链路。
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const visio = require(path.join(ROOT, 'lib', 'visio.js'));
const { validateXml } = require(path.join(ROOT, 'lib', 'xml.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.log('  ✗ ' + name + (extra ? '  -> ' + extra : ''));
  }
}

/* ----------------- 构造最小 .vsdx（zip） ----------------- */

function crc32(buf) {
  const table =
    crc32._t ||
    (crc32._t = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const comp = zlib.deflateRawSync(e.data);
    const crc = crc32(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8); // method = deflate
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    chunks.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt32LE(0, 36);
    ch.writeUInt16LE(0, 40);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);

    offset += 30 + nameBuf.length + comp.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, ...central, eocd]);
}

const PAGE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.microsoft.com/office/visio/2012/relationships">
  <Shapes>
    <Shape ID="1" Type="Shape" NameU="Process">
      <Cell N="PinX" V="2.0"/>
      <Cell N="PinY" V="4.0"/>
      <Cell N="Width" V="2.0"/>
      <Cell N="Height" V="1.0"/>
      <Text><cp ix="0"/><pp ix="0"/><tp ix="0"/>開始</Text>
    </Shape>
    <Shape ID="2" Type="Shape" NameU="Process">
      <Cell N="PinX" V="5.0"/>
      <Cell N="PinY" V="4.0"/>
      <Cell N="Width" V="2.0"/>
      <Cell N="Height" V="1.0"/>
      <Text><cp ix="0"/><pp ix="0"/><tp ix="0"/>處理資料</Text>
    </Shape>
    <Shape ID="3" Type="Shape" NameU="Dynamic connector">
      <Cell N="PinX" V="3.5"/>
      <Cell N="PinY" V="2.0"/>
      <Cell N="Width" V="0"/>
      <Cell N="Height" V="0"/>
      <Cell N="BeginX" V="3.0"/>
      <Cell N="BeginY" V="3.5"/>
      <Cell N="EndX" V="4.0"/>
      <Cell N="EndY" V="3.5"/>
      <Text><cp ix="0"/><pp ix="0"/><tp ix="0"/>連線</Text>
    </Shape>
  </Shapes>
</PageContents>`;

const DOC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main"/>`;

const vsdx = buildZip([
  { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types/>') },
  { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0"?><Relationships/>') },
  { name: 'visio/document.xml', data: Buffer.from(DOC_XML) },
  { name: 'visio/pages/pages.xml', data: Buffer.from('<?xml version="1.0"?><Pages/>') },
  { name: 'visio/pages/p1.xml', data: Buffer.from(PAGE_XML) },
]);

/* ----------------- 测试执行 ----------------- */

console.log('\n[Visio 导入器]');

console.log('\n— parseZip —');
const files = visio.parseZip(vsdx);
ok('zip 解析出 5 个文件', Object.keys(files).length === 5, String(Object.keys(files).length));
ok('可定位 visio/pages/p1.xml', Boolean(files['visio/pages/p1.xml']));
const pageXml = files['visio/pages/p1.xml'].toString('utf8');
ok('p1.xml 内容以 <PageContents 开头', pageXml.includes('<PageContents'));

console.log('\n— readVsdx —');
const { pages, warnings } = visio.readVsdx(vsdx);
ok('识别到 1 个页面', pages.length === 1, String(pages.length));
ok('页面含 3 个形状', pages[0].shapes.length === 3, String(pages[0].shapes.length));
const shapes = pages[0].shapes;
ok('形状1 文本=開始', shapes[0].text === '開始', shapes[0].text);
ok('形状2 文本=處理資料', shapes[1].text === '處理資料', shapes[1].text);
ok('形状3 被识别为连线(isEdge)', shapes[2].isEdge === true);
ok('形状3 端点 BeginX=3/EndX=4', shapes[2].beginX === 3 && shapes[2].endX === 4);
ok('无解析警告', warnings.length === 0, warnings.join(';'));

console.log('\n— vsdxToDrawio —');
const res = visio.vsdxToDrawio(vsdx, { name: '测试导入' });
ok('输出含 <mxfile', res.xml.includes('<mxfile'));
ok('输出含 <mxGraphModel', res.xml.includes('<mxGraphModel'));
ok('输出含顶点 v1', res.xml.includes('id="v1"'));
ok('输出含连线 e3', res.xml.includes('id="e3"'));
ok('开始 文本进入 draw.io', res.xml.includes('開始'));
ok('處理資料 文本进入 draw.io', res.xml.includes('處理資料'));
ok('連線 文本进入 draw.io', res.xml.includes('連線'));
ok('summary: 2 顶点 + 1 连线', res.summary.shapes === 2 && res.summary.edges === 1, JSON.stringify(res.summary));

const v = validateXml(res.xml);
ok('normalize 后 validateXml 通过', v.ok, JSON.stringify(v.errors));

console.log('\n— 非 vsdx 输入健壮性 —');
const bad = visio.vsdxToDrawio(Buffer.from('not a zip at all'));
ok('非 zip 输入不崩溃且给出警告', bad.warnings.length > 0 && typeof bad.xml === 'string');

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
