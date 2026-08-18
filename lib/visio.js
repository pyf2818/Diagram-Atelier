'use strict';

/**
 * Visio (.vsdx) 零依赖导入器。
 *
 * .vsdx 本质是一个 OOXML zip 包：
 *   [Content_Types].xml
 *   _rels/.rels
 *   visio/document.xml
 *   visio/pages/pages.xml
 *   visio/pages/p1.xml ...   <- 真正含图形（Shapes / Cell / Text）
 *   visio/masters/masters.xml
 *
 * 本模块不依赖任何第三方 zip 库，自行解析 zip 本地文件头 + 用 Node 内建
 * zlib.inflateRawSync 解压 deflate 流，再把 Visio 形状映射为 draw.io 兼容的
 * mxGraphModel XML。坐标单位：Visio 用英寸、原点在页面左下、Y 向上；
 * draw.io 用像素、原点在左上、Y 向下 —— 转换时统一换算并翻转 Y。
 */

const zlib = require('node:zlib');
const { normalizeDrawioXml, scanTags, parseAttrs } = require('./xml.js');

const PX_PER_IN = 96;

/* ------------------------------------------------------------------ */
/* 1. 零依赖 zip 解析                                                  */
/* ------------------------------------------------------------------ */

const LOCAL_SIG = 0x04034b50;

/** 解析 zip 字节流，返回 { 文件路径: Buffer(解压后内容) } */
function parseZip(buf) {
  const files = Object.create(null);
  const n = buf.length;
  let i = 0;
  while (i + 4 <= n) {
    if (buf.readUInt32LE(i) !== LOCAL_SIG) {
      i++;
      continue;
    }
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const uncompSize = buf.readUInt32LE(i + 22);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const nameStart = i + 30;
    const name = buf.toString('utf8', nameStart, nameStart + nameLen);
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compSize;

    let data;
    if (method === 0) {
      // stored
      data = buf.subarray(dataStart, dataEnd);
    } else if (method === 8) {
      // deflate (raw, 无 zlib 头)
      try {
        data = zlib.inflateRawSync(buf.subarray(dataStart, dataEnd));
      } catch (_) {
        // 解压失败兜底：原样返回（保证不崩）
        data = buf.subarray(dataStart, dataEnd);
      }
    } else {
      // 其它压缩方式：尽力返回原始字节
      data = buf.subarray(dataStart, dataEnd);
      if (!uncompSize || data.length !== uncompSize) {
        // 无法可靠解压时保留原始内容，交由上层决定
      }
    }
    // 同名文件以首个为准（避免中央目录重复）
    if (!(name in files)) files[name] = data;
    i = dataEnd > 0 ? dataEnd : i + 1;
  }
  return files;
}

/* ------------------------------------------------------------------ */
/* 2. Visio XML 形状提取                                               */
/* ------------------------------------------------------------------ */

function localName(name) {
  const idx = name.indexOf(':');
  return idx >= 0 ? name.slice(idx + 1) : name;
}

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

/** 从单个 <Shape> 块文本里取某个 Cell 的数值（N/V 顺序无关，lookahead 匹配同标签） */
function cellNum(block, name) {
  const re = new RegExp('<Cell\\b(?=[^>]*\\bN="' + name + '")(?=[^>]*\\bV="([^"]*)")[^>]*>', 'i');
  const m = block.match(re);
  if (!m) return null;
  const num = parseFloat(m[1]);
  return Number.isNaN(num) ? null : num;
}

/** 从单个 <Shape> 块文本里取 <Text> 纯文本（剥富文本标签 + 实体解码） */
function cellText(block) {
  const m = block.match(/<Text\b[^>]*>([\s\S]*?)<\/Text>/i);
  if (!m) return '';
  return decodeEntities(m[1].replace(/<[^>]+>/g, '').trim());
}

/**
 * 解析单页 XML，提取所有 <Shape>（扁平化，忽略 Group 嵌套层级）。
 * 返回 [{ id, type, text, isEdge, x, y, w, h, beginX, beginY, endX, endY, master }]
 * 其中 x/y/w/h 为页面坐标（英寸，Y 向上，原点左下）；线形(1-D)形状 isEdge=true，
 * 端点用 BeginX/BeginY/EndX/EndY（英寸）表示。
 */
function extractShapes(xml) {
  const tags = scanTags(xml);
  const stack = [];
  const blocks = [];
  for (const t of tags) {
    if (localName(t.name).toLowerCase() !== 'shape') continue;
    if (t.closing) {
      const open = stack.pop();
      if (open) blocks.push({ open, close: t });
    } else if (!t.selfClosing) {
      stack.push(t);
    }
  }

  const shapes = [];
  for (const { open, close } of blocks) {
    const block = xml.slice(open.start, close.end);
    const attrs = parseAttrs(open.attrsRaw);
    const type = (attrs.Type || '').toLowerCase();
    const master = attrs.MasterU || attrs.NameU || '';

    const pinX = cellNum(block, 'PinX');
    const pinY = cellNum(block, 'PinY');
    const width = cellNum(block, 'Width');
    const height = cellNum(block, 'Height');

    const hasBegin =
      cellNum(block, 'BeginX') !== null ||
      cellNum(block, 'BeginY') !== null ||
      cellNum(block, 'EndX') !== null ||
      cellNum(block, 'EndY') !== null;

    const isEdge = type === 'line' || (hasBegin && (width === 0 || height === 0 || (width === null && height === null)));

    shapes.push({
      id: attrs.ID || String(shapes.length + 1),
      type,
      master: master,
      text: cellText(block),
      isEdge,
      x: pinX !== null ? pinX : 0,
      y: pinY !== null ? pinY : 0,
      w: width !== null ? width : isEdge ? 0 : 1,
      h: height !== null ? height : isEdge ? 0 : 1,
      beginX: cellNum(block, 'BeginX') || 0,
      beginY: cellNum(block, 'BeginY') || 0,
      endX: cellNum(block, 'EndX') || 0,
      endY: cellNum(block, 'EndY') || 0,
    });
  }
  return shapes;
}

/* ------------------------------------------------------------------ */
/* 3. 形状 -> draw.io 样式                                            */
/* ------------------------------------------------------------------ */

function styleFor(masterName) {
  const m = String(masterName || '').toLowerCase();
  if (/diamond|decision|判定|菱形|判断/.test(m)) {
    return 'rhombus;perimeter=rhombusPerimeter;whiteSpace=wrap;html=1;fillColor=#FDF6E8;strokeColor=#A6813C;fontColor=#4A3413;';
  }
  if (/terminator|start|end|开始|结束|终端/.test(m)) {
    return 'ellipse;whiteSpace=wrap;html=1;fillColor=#24314F;strokeColor=#24314F;fontColor=#FFFFFF;fontStyle=1;';
  }
  if (/process|activity|进程|流程|活动/.test(m)) {
    return 'rounded=1;arcSize=12;whiteSpace=wrap;html=1;fillColor=#E8EEF7;strokeColor=#4A5F8E;fontColor=#1F2937;';
  }
  // 默认：圆角矩形
  return 'rounded=1;arcSize=10;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#B9B3A7;fontColor=#4A4F58;';
}

function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function r1(n) {
  return Math.round(n * 100) / 100;
}

function vertexCell(id, text, x, y, w, h, master) {
  const style = styleFor(master);
  return (
    `<mxCell id="${id}" value="${escAttr(text)}" style="${style}" vertex="1" parent="1">` +
    `<mxGeometry x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" as="geometry" />` +
    `</mxCell>`
  );
}

function edgeCell(id, text, sx, sy, ex, ey) {
  return (
    `<mxCell id="${id}" value="${escAttr(text)}" style="edgeStyle=none;html=1;endArrow=classic;strokeWidth=1.6;strokeColor=#6E7684;fontColor=#4A4F58;" edge="1" parent="1">` +
    `<mxGeometry relative="1" as="geometry">` +
    `<mxPoint x="${r1(sx)}" y="${r1(sy)}" as="sourcePoint" />` +
    `<mxPoint x="${r1(ex)}" y="${r1(ey)}" as="targetPoint" />` +
    `</mxGeometry>` +
    `</mxCell>`
  );
}

/* ------------------------------------------------------------------ */
/* 4. 顶层 API                                                         */
/* ------------------------------------------------------------------ */

/** 解析 .vsdx 字节流，返回 { files, pages:[{file,shapes}], warnings } */
function readVsdx(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const files = parseZip(buf);
  const pageFiles = Object.keys(files)
    .filter((f) => /^visio\/pages\/p[0-9]+\.xml$/i.test(f))
    .sort();
  const pages = [];
  const warnings = [];
  for (const pf of pageFiles) {
    let xml;
    try {
      xml = files[pf].toString('utf8');
    } catch (_) {
      warnings.push('无法读取页面 ' + pf);
      continue;
    }
    const shapes = extractShapes(xml);
    pages.push({ file: pf, shapes });
  }
  if (pages.length === 0) warnings.push('未在压缩包中找到 visio/pages/p*.xml 页面');
  return { files, pages, warnings };
}

/**
 * .vsdx -> draw.io 兼容 mxfile XML（已通过 normalizeDrawioXml 规范化）。
 * @returns {{xml:string, validation:object, summary:object, warnings:string[]}}
 */
function vsdxToDrawio(buffer, opts = {}) {
  const { pages, warnings } = readVsdx(buffer);
  const cells = [];
  let runningY = 0;
  let shapeCount = 0;
  let edgeCount = 0;
  let idx = 0;

  for (const page of pages) {
    const shapes = page.shapes;
    // 计算本页包围盒（页面坐标，Y 向上）
    let maxX = 0;
    let maxY = 0;
    for (const s of shapes) {
      if (!s.isEdge) {
        maxX = Math.max(maxX, s.x + s.w);
        maxY = Math.max(maxY, s.y + s.h);
      }
    }
    const pageH = Math.max(maxY, 1) + 80; // 像素，含边距

    for (const s of shapes) {
      idx++;
      if (s.isEdge) {
        const sx = s.beginX * PX_PER_IN;
        const sy = pageH - s.beginY * PX_PER_IN + runningY;
        const ex = s.endX * PX_PER_IN;
        const ey = pageH - s.endY * PX_PER_IN + runningY;
        cells.push(edgeCell('e' + idx, s.text, sx, sy, ex, ey));
        edgeCount++;
      } else {
        const cx = s.x * PX_PER_IN; // 中心 X（页面坐标）
        const cy = s.y * PX_PER_IN; // 中心 Y（页面坐标，Y 向上）
        const w = s.w * PX_PER_IN;
        const h = s.h * PX_PER_IN;
        const left = cx - w / 2;
        const top = cy + h / 2; // 页面坐标 top（Y 向上）
        const dx = left;
        const dy = pageH - top + runningY; // 翻转 Y 到 draw.io 坐标系
        cells.push(vertexCell('v' + idx, s.text, dx, dy, w, h, s.master));
        shapeCount++;
      }
    }
    runningY += pageH + 60;
  }

  const model =
    `<mxGraphModel dx="1422" dy="798" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" ` +
    `arrows="1" fold="1" page="1" pageScale="1" pageWidth="1654" pageHeight="1169" math="0" shadow="0">` +
    `<root>` +
    `<mxCell id="0" />` +
    `<mxCell id="1" parent="0" />` +
    cells.join('') +
    `</root>` +
    `</mxGraphModel>`;

  const normalized = normalizeDrawioXml(model, { name: opts.name || 'Visio 导入' });
  return {
    xml: normalized.xml,
    validation: normalized.validation,
    changed: normalized.changed,
    summary: { pages: pages.length, shapes: shapeCount, edges: edgeCount },
    warnings: warnings.concat(normalized.validation.ok ? [] : normalized.validation.errors),
  };
}

module.exports = { parseZip, readVsdx, vsdxToDrawio, extractShapes, PX_PER_IN };
