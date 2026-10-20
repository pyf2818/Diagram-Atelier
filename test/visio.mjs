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
    <Shape ID="4" Type="Shape" NameU="Decision">
      <Cell N="PinX" V="8.0"/>
      <Cell N="PinY" V="4.0"/>
      <Cell N="Width" V="1.5"/>
      <Cell N="Height" V="1.5"/>
      <Cell N="Angle" V="0.2617991666666667"/>
      <Text><cp ix="0"/><pp ix="0"/><tp ix="0"/>判定</Text>
    </Shape>
    <Shape ID="5" Type="Group" NameU="Group">
      <Cell N="PinX" V="2.0"/>
      <Cell N="PinY" V="1.0"/>
      <Cell N="LocPinX" V="1.0"/>
      <Cell N="LocPinY" V="0.5"/>
      <Cell N="Width" V="2.0"/>
      <Cell N="Height" V="1.0"/>
      <Shapes>
        <Shape ID="6" Type="Shape" NameU="Child">
          <Cell N="PinX" V="1.0"/>
          <Cell N="PinY" V="0.5"/>
          <Cell N="LocPinX" V="1.0"/>
          <Cell N="LocPinY" V="0.5"/>
          <Cell N="Width" V="2.0"/>
          <Cell N="Height" V="1.0"/>
          <Text><cp ix="0"/><pp ix="0"/><tp ix="0"/>子節點</Text>
        </Shape>
      </Shapes>
    </Shape>
  </Shapes>
  <Connect FromSheet="3" FromCell="BeginX" ToSheet="1" ToCell="PinX" />
  <Connect FromSheet="3" FromCell="EndX" ToSheet="2" ToCell="PinX" />
</PageContents>`;

const DOC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main"/>`;

const PAGES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main">
  <Page ID="0" NameU="Flow" Name="流程页">
    <PageSheet>
      <Cell N="PageWidth" V="8.26771653543307"/>
      <Cell N="PageHeight" V="11.69291338582677"/>
    </PageSheet>
  </Page>
</Pages>`;

const vsdx = buildZip([
  { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types/>') },
  { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0"?><Relationships/>') },
  { name: 'visio/document.xml', data: Buffer.from(DOC_XML) },
  { name: 'visio/pages/pages.xml', data: Buffer.from(PAGES_XML) },
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
ok('页面含 6 个形状(含组展开)', pages[0].shapes.length === 6, String(pages[0].shapes.length));
const shapes = pages[0].shapes;
ok('形状1 文本=開始', shapes[0].text === '開始', shapes[0].text);
ok('形状2 文本=處理資料', shapes[1].text === '處理資料', shapes[1].text);
ok('形状3 被识别为连线(isEdge)', shapes[2].isEdge === true);
ok('形状3 端点 BeginX=3/EndX=4', shapes[2].beginX === 3 && shapes[2].endX === 4);
ok('无解析警告', warnings.length === 0, warnings.join(';'));

console.log('\n— 几何还原（页面尺寸 / 组变换 / 旋转 / 胶接）—');
const layout = pages[0].layout;
ok('pages.xml 解析出页面名「流程页」', layout && layout.name === '流程页', layout && layout.name);
ok('PageHeight 识别为 A4 竖版', layout && Math.abs(layout.height - 11.6929) < 0.001, layout && String(layout.height));
ok('PageWidth 识别为 A4 竖版', layout && Math.abs(layout.width - 8.2677) < 0.001, layout && String(layout.width));
const child = shapes[5];
ok('组内子形状平移到页面绝对坐标(2,1)', child.inGroup === true && child.x === 2 && child.y === 1, JSON.stringify({ x: child.x, y: child.y }));
ok('旋转角折算为 draw.io 度(-15)', shapes[3].angleDeg === -15, String(shapes[3].angleDeg));
ok('空组壳被标记(hasChildren)', shapes[4].hasChildren === true && shapes[4].text === '');
ok('胶接关系解析出 2 条', pages[0].connects.length === 2, JSON.stringify(pages[0].connects));

console.log('\n— vsdxToDrawio —');
const res = visio.vsdxToDrawio(vsdx, { name: '测试导入' });
ok('输出含 <mxfile', res.xml.includes('<mxfile'));
ok('输出含 <mxGraphModel', res.xml.includes('<mxGraphModel'));
ok('输出含顶点 v1', res.xml.includes('id="v1"'));
ok('输出含连线 e3', res.xml.includes('id="e3"'));
ok('开始 文本进入 draw.io', res.xml.includes('開始'));
ok('處理資料 文本进入 draw.io', res.xml.includes('處理資料'));
ok('連線 文本进入 draw.io', res.xml.includes('連線'));
ok('子節點 文本进入 draw.io', res.xml.includes('子節點'));
ok('summary: 4 顶点 + 1 连线（空组壳不输出）', res.summary.shapes === 4 && res.summary.edges === 1, JSON.stringify(res.summary));

const v = validateXml(res.xml);
ok('normalize 后 validateXml 通过', v.ok, JSON.stringify(v.errors));

console.log('\n— vsdxToDrawio 几何还原 —');
ok('连线 e3 胶接 source=v1', /id="e3"[^>]*\ssource="v1"/.test(res.xml));
ok('连线 e3 胶接 target=v2', /id="e3"[^>]*\starget="v2"/.test(res.xml));
ok('旋转形状 v4 带 rotation=-15 样式', /id="v4"[^>]*style="[^"]*rotation=-15;/.test(res.xml));
ok('顶点 v1 定位到页面绝对坐标 x=96', /id="v1"[\s\S]{0,500}?<mxGeometry x="96" y="690\.52"/.test(res.xml), res.xml.match(/id="v1"[\s\S]{0,500}?<mxGeometry[^/]*\/>/)?.[0]);
ok('顶点 v5(组内子形状) 定位 y=978.52', /id="v5"[\s\S]{0,500}?y="978\.52"/.test(res.xml));
ok('连线端点使用页面尺寸换算 y=786.52', /id="e3"[\s\S]{0,500}?y="786\.52"/.test(res.xml));

console.log('\n— 非 vsdx 输入健壮性 —');
const bad = visio.vsdxToDrawio(Buffer.from('not a zip at all'));
ok('非 zip 输入不崩溃且给出警告', bad.warnings.length > 0 && typeof bad.xml === 'string');

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
