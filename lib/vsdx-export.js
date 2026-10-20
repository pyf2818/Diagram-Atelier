'use strict';

/**
 * draw.io 兼容 XML -> Visio .vsdx 零依赖导出器。
 *
 * 与 visio.js（导入）互为逆操作：
 *   - draw.io 像素坐标（原点左上、Y 向下）→ Visio 英寸坐标（原点左下、Y 向上）
 *   - 顶点 → PinX/PinY/LocPinX/LocPinY/Width/Height + Text
 *   - 连线 → 1-D 形状（BeginX/BeginY/EndX/EndY + Geometry MoveTo/LineTo）+ Connect 胶接
 *   - 样式 rotation=N（顺时针度）→ Visio Angle（逆时针弧度）
 *
 * 输出为完整 OOXML 包（[Content_Types].xml / _rels / document / pages / page1），
 * 可被 Visio、LibreOffice Draw 及本项目 visio.js 直接打开。
 */

const zlib = require('node:zlib');
const { scanTags, parseAttrs } = require('./xml.js');

const PX_PER_IN = 96;
const NS = 'http://schemas.microsoft.com/office/visio/2012/main';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/* ------------------------------------------------------------------ */
/* 1. 零依赖 zip 写入                                                  */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

/** 构建 zip 包（全部 deflate），entries: [{ name, data: Buffer|string }] */
function zipSync(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const comp = zlib.deflateRawSync(raw);
    const crc = crc32(raw);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0, 6); // flags
    lh.writeUInt16LE(8, 8); // method = deflate
    lh.writeUInt16LE(0, 10); // mtime
    lh.writeUInt16LE(0, 12); // mdate
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
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
    ch.writeUInt32LE(raw.length, 24);
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

/* ------------------------------------------------------------------ */
/* 2. draw.io XML 解析                                                 */
/* ------------------------------------------------------------------ */

function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

/** draw.io 标签值 -> Visio Text：实体解码、<br> 换行、剥掉其余富文本标签 */
function labelText(value) {
  const raw = decodeEntities(String(value || ''));
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function r4(n) {
  return Math.round(n * 10000) / 10000;
}

/**
 * 解析 mxGraphModel，返回
 *   vertices: [{ id, label, style, x, y, w, h, rotation, parent }]
 *   edges:    [{ id, label, source, target, sx, sy, ex, ey }]
 * 坐标已换算为页面绝对像素（父容器链展开）。
 */
function parseModel(xml) {
  const tags = scanTags(xml);
  const cells = [];
  const stack = []; // { attrs, geometry, points, depth }
  for (const t of tags) {
    const n = t.name;
    if (n === 'mxCell') {
      if (t.closing) {
        const frame = stack.pop();
        if (frame) cells.push(frame);
      } else if (t.selfClosing) {
        cells.push({ attrs: parseAttrs(t.attrsRaw), geometry: null, points: [] });
      } else {
        stack.push({ attrs: parseAttrs(t.attrsRaw), geometry: null, points: [], inGeometry: false });
      }
      continue;
    }
    const top = stack[stack.length - 1];
    if (!top) continue;
    if (n === 'mxGeometry') {
      const a = parseAttrs(t.attrsRaw);
      top.geometry = { x: num(a.x), y: num(a.y), w: num(a.width), h: num(a.height), as: a.as || '' };
      top.inGeometry = !t.selfClosing && !t.closing;
    } else if (n === 'mxPoint' && top.geometry) {
      const a = parseAttrs(t.attrsRaw);
      top.points.push({ as: a.as || '', x: num(a.x), y: num(a.y) });
    } else if (n === 'mxGeometry' && t.closing) {
      top.inGeometry = false;
    }
  }

  // 绝对坐标：沿 parent 链累加偏移（mxGraph 子元素坐标相对父元素左上角）
  const byId = new Map();
  for (const c of cells) byId.set(c.attrs.id, c);
  const absCache = new Map();

  function absPos(cell, seen) {
    if (!cell) return { x: 0, y: 0 };
    if (absCache.has(cell)) return absCache.get(cell);
    if (seen.has(cell)) return { x: 0, y: 0 }; // 环保护
    seen.add(cell);
    const g = cell.geometry || {};
    const px = Number.isFinite(g.x) ? g.x : 0;
    const py = Number.isFinite(g.y) ? g.y : 0;
    const parent = byId.get(cell.attrs.parent);
    const pAbs = parent && parent !== cell ? absPos(parent, seen) : { x: 0, y: 0 };
    const res = { x: pAbs.x + px, y: pAbs.y + py };
    seen.delete(cell);
    absCache.set(cell, res);
    return res;
  }

  const vertices = [];
  const edges = [];
  for (const c of cells) {
    const a = c.attrs;
    if (a.vertex === '1') {
      const g = c.geometry || {};
      const pos = absPos(c, new Set());
      const rotM = /(?:^|;)rotation=(-?[\d.]+)/.exec(a.style || '');
      vertices.push({
        id: a.id,
        label: labelText(a.value),
        style: a.style || '',
        x: Number.isFinite(g.x) ? pos.x : pos.x,
        y: pos.y,
        w: Number.isFinite(g.w) ? g.w : 120,
        h: Number.isFinite(g.h) ? g.h : 60,
        rotation: rotM ? parseFloat(rotM[1]) : 0,
        parent: a.parent || '1',
      });
    } else if (a.edge === '1') {
      const g = c.geometry || {};
      const sp = (c.points || []).find((p) => p.as === 'sourcePoint');
      const tp = (c.points || []).find((p) => p.as === 'targetPoint');
      const sv = a.source ? byId.get(a.source) : null;
      const tv = a.target ? byId.get(a.target) : null;
      const svPos = sv ? absPos(sv, new Set()) : null;
      const tvPos = tv ? absPos(tv, new Set()) : null;
      const svGeo = sv && sv.geometry ? sv.geometry : null;
      const tvGeo = tv && tv.geometry ? tv.geometry : null;
      edges.push({
        id: a.id,
        label: labelText(a.value),
        source: a.source || '',
        target: a.target || '',
        sx: sp && Number.isFinite(sp.x) ? sp.x : svPos && svGeo ? svPos.x + (svGeo.w || 0) / 2 : svPos ? svPos.x : 0,
        sy: sp && Number.isFinite(sp.y) ? sp.y : svPos && svGeo ? svPos.y + (svGeo.h || 0) / 2 : svPos ? svPos.y : 0,
        ex: tp && Number.isFinite(tp.x) ? tp.x : tvPos && tvGeo ? tvPos.x + (tvGeo.w || 0) / 2 : tvPos ? tvPos.x : 0,
        ey: tp && Number.isFinite(tp.y) ? tp.y : tvPos && tvGeo ? tvPos.y + (tvGeo.h || 0) / 2 : tvPos ? tvPos.y : 0,
      });
    }
  }
  return { vertices, edges };
}

function num(v) {
  if (v === undefined || v === null || v === '') return NaN;
  const n = parseFloat(v);
  return Number.isNaN(n) ? NaN : n;
}

/* ------------------------------------------------------------------ */
/* 3. OOXML 组装                                                       */
/* ------------------------------------------------------------------ */

function cellXml(name, v, unit) {
  return '<Cell N="' + name + '" V="' + r4(v) + (unit ? '" U="' + unit : '') + '"/>';
}

function buildPageXml(page, vertices, edges, idMap) {
  const shapes = [];
  const connects = [];
  let seq = 0;

  for (const v of vertices) {
    seq++;
    const vid = seq;
    idMap.set(v.id, vid);
    const pinX = (v.x + v.w / 2) / PX_PER_IN;
    const pinY = (page.heightPx - (v.y + v.h / 2)) / PX_PER_IN;
    let body =
      cellXml('PinX', pinX, 'IN_F') +
      cellXml('PinY', pinY, 'IN_F') +
      cellXml('Width', v.w / PX_PER_IN, 'IN_F') +
      cellXml('Height', v.h / PX_PER_IN, 'IN_F') +
      cellXml('LocPinX', v.w / 2 / PX_PER_IN, 'IN_F') +
      cellXml('LocPinY', v.h / 2 / PX_PER_IN, 'IN_F');
    if (v.rotation) {
      body += cellXml('Angle', (-v.rotation * Math.PI) / 180, 'RAD');
    }
    if (v.label) body += '<Text>' + escXml(v.label) + '</Text>';
    shapes.push('<Shape ID="' + vid + '" Type="Shape" NameU="' + escXml(v.label || 'Node') + '">' + body + '</Shape>');
  }

  for (const e of edges) {
    seq++;
    const eid = seq;
    const bx = e.sx / PX_PER_IN;
    const by = (page.heightPx - e.sy) / PX_PER_IN;
    const ex = e.ex / PX_PER_IN;
    const ey = (page.heightPx - e.ey) / PX_PER_IN;
    let body =
      cellXml('PinX', (bx + ex) / 2, 'IN_F') +
      cellXml('PinY', (by + ey) / 2, 'IN_F') +
      cellXml('Width', Math.abs(ex - bx), 'IN_F') +
      cellXml('Height', Math.abs(ey - by), 'IN_F') +
      cellXml('LocPinX', Math.abs(ex - bx) / 2, 'IN_F') +
      cellXml('LocPinY', Math.abs(ey - by) / 2, 'IN_F') +
      cellXml('BeginX', bx, 'IN_F') +
      cellXml('BeginY', by, 'IN_F') +
      cellXml('EndX', ex, 'IN_F') +
      cellXml('EndY', ey, 'IN_F') +
      '<Section N="Geometry" IX="0">' +
      '<Cell N="NoFill" V="1"/>' +
      '<Cell N="NoLine" V="0"/>' +
      '<Row T="RelMoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>' +
      '<Row T="LineTo" IX="2"><Cell N="X" V="' + r4(ex - bx) + '"/><Cell N="Y" V="' + r4(ey - by) + '"/></Row>' +
      '</Section>';
    if (e.label) body += '<Text>' + escXml(e.label) + '</Text>';
    shapes.push('<Shape ID="' + eid + '" Type="Shape" NameU="Dynamic connector">' + body + '</Shape>');

    if (e.source && idMap.has(e.source)) {
      connects.push('<Connect FromSheet="' + eid + '" FromCell="BeginX" ToSheet="' + idMap.get(e.source) + '" ToCell="PinX" />');
    }
    if (e.target && idMap.has(e.target)) {
      connects.push('<Connect FromSheet="' + eid + '" FromCell="EndX" ToSheet="' + idMap.get(e.target) + '" ToCell="PinX" />');
    }
  }

  const pageHeightIn = page.heightPx / PX_PER_IN; // 供调试/日志使用
  void pageHeightIn;
  return (
    '<?xml version="1.0" encoding="utf-8" standalone="no"?>\n' +
    '<PageContents xmlns="' + NS + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">' +
    '<Shapes>' +
    shapes.join('') +
    '</Shapes>' +
    connects.join('') +
    '</PageContents>'
  );
}

function buildPackage(xml, opts) {
  const { vertices, edges } = parseModel(xml);
  if (vertices.length === 0 && edges.length === 0) {
    return { error: '未在 XML 中找到任何节点或连线' };
  }

  // 内容包围盒（像素）—— 顶点必须统计；边端点也计入，防止悬空连线出页
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of vertices) {
    minX = Math.min(minX, v.x); minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x + v.w); maxY = Math.max(maxY, v.y + v.h);
  }
  for (const e of edges) {
    minX = Math.min(minX, e.sx, e.ex); minY = Math.min(minY, e.sy, e.ey);
    maxX = Math.max(maxX, e.sx, e.ex); maxY = Math.max(maxY, e.sy, e.ey);
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 800; maxY = 600; }

  const MARGIN = 40; // 像素
  const widthPx = Math.max(8.27 * PX_PER_IN, Math.ceil((maxX - minX + MARGIN * 2) / 96) * 96);
  const heightPx = Math.max(8.27 * PX_PER_IN, Math.ceil((maxY - minY + MARGIN * 2) / 96) * 96);
  const page = { widthPx, heightPx };

  // 归一化：把内容平移到页内边距处（Visio 页面坐标不含负值）
  const offsetX = MARGIN - minX;
  const offsetY = MARGIN - minY;
  for (const v of vertices) { v.x += offsetX; v.y += offsetY; }
  for (const e of edges) { e.sx += offsetX; e.sy += offsetY; e.ex += offsetX; e.ey += offsetY; }

  const idMap = new Map();
  const page1 = buildPageXml(page, vertices, edges, idMap);

  const title = (opts && opts.title) || 'Diagram Atelier Export';
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const pageWidthIn = widthPx / PX_PER_IN;
  const pageHeightIn = heightPx / PX_PER_IN;

  const contentTypes =
    '<?xml version="1.0" encoding="utf-8" standalone="no"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>' +
    '<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>' +
    '<Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>';

  const rootRels =
    '<?xml version="1.0" encoding="utf-8" standalone="no"?>\n' +
    '<Relationships xmlns="' + PKG_REL_NS + '">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/package/2006/relationships/officeDocument" Target="visio/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    '</Relationships>';

  const documentXml =
    '<?xml version="1.0" encoding="utf-8" standalone="no"?>\n' +
    '<VisioDocument xmlns="' + NS + '" xml:space="preserve">' +
    '<DocumentSettings TopPage="0"/>' +
    '</VisioDocument>';

  const documentRels =
    '<?xml version="1.0" encoding="utf-8" standalone="no"?>\n' +
    '<Relationships xmlns="' + PKG_REL_NS + '">' +
    '<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2012/relationships/pages" Target="pages/pages.xml"/>' +
    '</Relationships>';

  const pagesXml =
    '<?xml version="1.0" encoding="utf-8" standalone="no"?>\n' +
    '<Pages xmlns="' + NS + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">' +
    '<Page ID="0" NameU="Page-1" Name="' + escXml(title) + '">' +
    '<PageSheet>' +
    '<Cell N="PageWidth" V="' + r4(pageWidthIn) + '" U="IN_F"/>' +
    '<Cell N="PageHeight" V="' + r4(pageHeightIn) + '" U="IN_F"/>' +
    '<Cell N="PageScale" V="1" U="IN_F"/>' +
    '<Cell N="DrawingScale" V="1" U="IN_F"/>' +
    '<Cell N="DrawingSizeType" V="3"/>' +
    '<Cell N="DrawingScaleType" V="0"/>' +
    '</PageSheet>' +
    '<Rel r:id="rId1"/>' +
    '</Page>' +
    '</Pages>';

  const pagesRels =
    '<?xml version="1.0" encoding="utf-8" standalone="no"?>\n' +
    '<Relationships xmlns="' + PKG_REL_NS + '">' +
    '<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2012/relationships/page" Target="page1.xml"/>' +
    '</Relationships>';

  const coreXml =
    '<?xml version="1.0" encoding="utf-8" standalone="no"?>\n' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:title>' + escXml(title) + '</dc:title>' +
    '<dc:creator>AI Diagram Atelier</dc:creator>' +
    '<cp:lastModifiedBy>AI Diagram Atelier</cp:lastModifiedBy>' +
    '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created>' +
    '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified>' +
    '</cp:coreProperties>';

  const appXml =
    '<?xml version="1.0" encoding="utf-8" standalone="no"?>\n' +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    '<Application>AI Diagram Atelier</Application>' +
    '<AppVersion>2.1.0</AppVersion>' +
    '</Properties>';

  const buffer = zipSync([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'docProps/core.xml', data: coreXml },
    { name: 'docProps/app.xml', data: appXml },
    { name: 'visio/document.xml', data: documentXml },
    { name: 'visio/_rels/document.xml.rels', data: documentRels },
    { name: 'visio/pages/pages.xml', data: pagesXml },
    { name: 'visio/pages/_rels/pages.xml.rels', data: pagesRels },
    { name: 'visio/pages/page1.xml', data: page1 },
  ]);

  return {
    buffer,
    summary: { vertices: vertices.length, edges: edges.length, pageWidthIn: r4(pageWidthIn), pageHeightIn: r4(pageHeightIn) },
    warnings: [],
  };
}

/**
 * draw.io 兼容 XML -> .vsdx 字节流
 * @param {string} xml
 * @param {{title?: string}} [opts]
 * @returns {{buffer:Buffer, summary:object, warnings:string[], error?:undefined}|{error:string}}
 */
function drawioToVsdx(xml, opts) {
  try {
    return buildPackage(String(xml || ''), opts || {});
  } catch (err) {
    return { error: '导出失败：' + (err && err.message ? err.message : String(err)) };
  }
}

module.exports = { drawioToVsdx, parseModel, zipSync, PX_PER_IN };
