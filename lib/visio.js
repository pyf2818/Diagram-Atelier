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
 * 组形状的块里嵌着子形状，取自身文本时要先截掉嵌套子树，
 * 否则组壳会吞掉第一个子形状的文本。
 */
function ownText(block) {
  // 跳过自身开标签（block 以 <Shape ...> 开头），从下标 1 起找嵌套子形状
  const m = /<Shape[\s>]/i.exec(block.slice(1));
  return cellText(m ? block.slice(0, m.index + 1) : block);
}

/**
 * 把 <Shape> 块解析为形状对象。pinX/pinY/width/height/locX/locY/angle 均为
 * 该形状所在坐标系（组内形状是父组局部坐标）的原始值；angle 为弧度（Visio 逆时针为正）。
 */
function shapeFromBlock(open, close, xml, fallbackId) {
  const block = xml.slice(open.start, close.end);
  const attrs = parseAttrs(open.attrsRaw);
  const type = (attrs.Type || '').toLowerCase();
  const master = attrs.MasterU || attrs.NameU || '';

  const pinX = cellNum(block, 'PinX');
  const pinY = cellNum(block, 'PinY');
  const width = cellNum(block, 'Width');
  const height = cellNum(block, 'Height');
  const locX = cellNum(block, 'LocPinX');
  const locY = cellNum(block, 'LocPinY');
  const angle = cellNum(block, 'Angle') || 0;

  const hasBegin =
    cellNum(block, 'BeginX') !== null ||
    cellNum(block, 'BeginY') !== null ||
    cellNum(block, 'EndX') !== null ||
    cellNum(block, 'EndY') !== null;

  // Visio 规范：BeginX/BeginY 端点单元格仅存在于 1-D（线形）形状，
  // 对角连线宽高均非零，宽高条件只作为 line 类型的兜底。
  const isEdge = type === 'line' || hasBegin;

  const w = width !== null ? width : isEdge ? 0 : 1;
  const h = height !== null ? height : isEdge ? 0 : 1;

  return {
    id: attrs.ID || fallbackId,
    type,
    master,
    text: ownText(block),
    isEdge,
    pinX: pinX !== null ? pinX : 0,
    pinY: pinY !== null ? pinY : 0,
    locX: locX !== null ? locX : w / 2,
    locY: locY !== null ? locY : h / 2,
    angle,
    w,
    h,
    beginX: cellNum(block, 'BeginX') || 0,
    beginY: cellNum(block, 'BeginY') || 0,
    endX: cellNum(block, 'EndX') || 0,
    endY: cellNum(block, 'EndY') || 0,
    children: [],
  };
}

/**
 * 按 <Shape> 开/闭标签配对构建形状树（支持 Group 嵌套），返回顶层节点数组。
 */
function buildShapeTree(xml) {
  const tags = scanTags(xml);
  const stack = []; // 元素: { open, children: [] }
  const roots = [];
  for (const t of tags) {
    if (localName(t.name).toLowerCase() !== 'shape') continue;
    if (t.closing) {
      const frame = stack.pop();
      if (!frame) continue;
      const node = { open: frame.open, close: t, children: frame.children, block: xml.slice(frame.open.start, t.end) };
      if (stack.length === 0) roots.push(node);
      else stack[stack.length - 1].children.push(node);
    } else if (!t.selfClosing) {
      stack.push({ open: t, children: [] });
    }
  }
  // 未闭合的形状兜底：直接当作顶层处理，保证不丢形状
  while (stack.length) {
    const frame = stack.pop();
    roots.push({ open: frame.open, close: { end: xml.length }, children: frame.children, block: xml.slice(frame.open.start) });
  }
  return roots;
}

/**
 * 解析单页 XML，提取所有 <Shape>（组内形状按父组变换平移到页面绝对坐标）。
 * 返回 [{ id, type, text, isEdge, x, y, w, h, angle, beginX, beginY, endX, endY, master, inGroup, hasChildren }]
 * 其中 x/y/w/h 为页面坐标（英寸，Y 向上，原点左下）；线形(1-D)形状 isEdge=true，
 * 端点用 BeginX/BeginY/EndX/EndY（英寸）表示。angle 已折算为度（draw.io 顺时针为正）。
 */
function extractShapes(xml) {
  const roots = buildShapeTree(xml);
  const shapes = [];
  let seq = 0;

  function flatten(node, parentCtx) {
    seq++;
    const s = shapeFromBlock(node.open, node.close, xml, String(seq));
    s.hasChildren = node.children.length > 0;

    if (parentCtx) {
      // 组变换（平移部分）：子形状局部坐标 + 父组页面锚点 - 父组局部锚点
      s.x = parentCtx.pinX - parentCtx.locX + s.pinX;
      s.y = parentCtx.pinY - parentCtx.locY + s.pinY;
      s.inGroup = true;
    } else {
      s.x = s.pinX;
      s.y = s.pinY;
      s.inGroup = false;
    }

    shapes.push(s);

    // 组有角度时不展开子形状（旋转矩阵合成复杂度高，先给警告由上层提示）
    if (parentCtx && Math.abs(parentCtx.angle) > 1e-6) s.skewedByRotatedGroup = true;

    for (const child of node.children) {
      flatten(child, { pinX: s.x, pinY: s.y, locX: s.locX, locY: s.locY, angle: s.angle });
    }
  }

  for (const root of roots) flatten(root, null);

  // 输出前清理：angle 折算为 draw.io 度（Visio 逆时针弧度 → draw.io 顺时针角度）
  for (const s of shapes) {
    s.angleDeg = s.angle ? Math.round(-s.angle * (180 / Math.PI) * 10) / 10 : 0;
  }
  return shapes;
}

/**
 * 解析页面 XML 里的 <Connect> 胶接关系，返回
 * [{ from, fromCell, to, toCell }]（from/to 均为 Visio Shape ID 字符串）。
 * 典型形态：<Connect FromSheet="3" FromCell="BeginX" ToSheet="1" ToCell="PinX" />
 */
function extractConnects(xml) {
  const tags = scanTags(xml);
  const out = [];
  for (const t of tags) {
    if (localName(t.name).toLowerCase() !== 'connect') continue;
    const attrs = parseAttrs(t.attrsRaw);
    const from = attrs.FromSheet || attrs.fromSheet;
    if (!from) continue;
    out.push({
      from: String(from),
      fromCell: attrs.FromCell || attrs.fromCell || '',
      to: String(attrs.ToSheet || attrs.toSheet || ''),
      toCell: attrs.ToCell || attrs.toCell || '',
    });
  }
  return out;
}

/**
 * 解析 pages.xml，返回 [{ name, width, height, pageId }]
 * width/height 单位英寸（PageSheet 里的 PageWidth / PageHeight）。
 */
function readPageLayout(pagesXml) {
  if (!pagesXml) return [];
  const out = [];
  const pageRe = /<Page\b[^>]*>([\s\S]*?)<\/Page>|<Page\b[^>]*\/>/gi;
  let m;
  while ((m = pageRe.exec(pagesXml))) {
    const block = m[0];
    const idM = block.match(/\bID="([^"]*)"/i);
    const nameM = block.match(/\sName="([^"]*)"/i) || block.match(/\bNameU="([^"]*)"/i);
    const width = cellNum(block, 'PageWidth');
    const height = cellNum(block, 'PageHeight');
    out.push({
      pageId: idM ? idM[1] : String(out.length),
      name: nameM ? nameM[1] : '第 ' + (out.length + 1) + ' 页',
      width: width || null,
      height: height || null,
    });
  }
  return out;
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

function vertexCell(id, text, x, y, w, h, master, angleDeg) {
  let style = styleFor(master);
  if (angleDeg) style += 'rotation=' + angleDeg + ';';
  return (
    `<mxCell id="${id}" value="${escAttr(text)}" style="${style}" vertex="1" parent="1">` +
    `<mxGeometry x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" as="geometry" />` +
    `</mxCell>`
  );
}

function edgeCell(id, text, sx, sy, ex, ey, source, target) {
  const wired = source ? ' source="' + escAttr(source) + '"' : '';
  const wiredT = target ? ' target="' + escAttr(target) + '"' : '';
  return (
    `<mxCell id="${id}" value="${escAttr(text)}" style="edgeStyle=none;html=1;endArrow=classic;strokeWidth=1.6;strokeColor=#6E7684;fontColor=#4A4F58;" edge="1" parent="1"${wired}${wiredT}>` +
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

/** 解析 .vsdx 字节流，返回 { files, pages:[{file,shapes}], layouts, warnings } */
function readVsdx(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const files = parseZip(buf);
  const pageFiles = Object.keys(files)
    .filter((f) => /^visio\/pages\/p(?:age)?([0-9]+)\.xml$/i.test(f))
    .sort((a, b) => {
      const na = Number(a.match(/p(?:age)?([0-9]+)\.xml/i)[1]);
      const nb = Number(b.match(/p(?:age)?([0-9]+)\.xml/i)[1]);
      return na - nb;
    });

  // 页面尺寸表（pages.xml 顺序与 pN.xml 排序号一一对应；取不到时为 null）
  let layouts = [];
  try {
    const pagesXml = files['visio/pages/pages.xml'];
    if (pagesXml) layouts = readPageLayout(pagesXml.toString('utf8'));
  } catch (_) {
    layouts = [];
  }

  const pages = [];
  const warnings = [];
  for (let i = 0; i < pageFiles.length; i++) {
    const pf = pageFiles[i];
    let xml;
    try {
      xml = files[pf].toString('utf8');
    } catch (_) {
      warnings.push('无法读取页面 ' + pf);
      continue;
    }
    const shapes = extractShapes(xml);
    const connects = extractConnects(xml);
    const layout = layouts[i] || null;
    pages.push({ file: pf, name: layout ? layout.name : pf, shapes, connects, layout });
  }
  if (pages.length === 0) warnings.push('未在压缩包中找到 visio/pages/p*.xml 页面');
  return { files, pages, layouts, warnings };
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
  const allWarnings = warnings.slice();

  for (const page of pages) {
    const shapes = page.shapes.filter(
      (s) => s.isEdge || !s.hasChildren || s.text // 空组壳（无文本的纯容器组）跳过
    );
    const glue = {};
    for (const c of page.connects || []) {
      if (!c.to) continue;
      if (/^begin/i.test(c.fromCell || '')) glue[c.from] = { ...(glue[c.from] || {}), source: c.to };
      else if (/^end/i.test(c.fromCell || '')) glue[c.from] = { ...(glue[c.from] || {}), target: c.to };
    }

    // 页面高度：优先用 pages.xml 里的 PageHeight（英寸），否则按内容包围盒估算
    let pageH;
    if (page.layout && page.layout.height) {
      pageH = page.layout.height * PX_PER_IN;
    } else {
      let maxY = 0;
      for (const s of shapes) {
        if (!s.isEdge) maxY = Math.max(maxY, s.y + s.h);
      }
      pageH = Math.max(maxY, 1) * PX_PER_IN + 80; // 像素，含边距
    }

    // Visio Shape ID -> draw.io cell id 映射（供胶接连线 source/target 引用）
    const idMap = Object.create(null);

    for (const s of shapes) {
      idx++;
      if (s.isEdge) {
        const g = glue[s.id] || {};
        const resolve = (vid) => (idMap[vid] ? idMap[vid] : undefined);
        const sx = s.beginX * PX_PER_IN;
        const sy = pageH - s.beginY * PX_PER_IN + runningY;
        const ex = s.endX * PX_PER_IN;
        const ey = pageH - s.endY * PX_PER_IN + runningY;
        cells.push(edgeCell('e' + idx, s.text, sx, sy, ex, ey, resolve(g.source), resolve(g.target)));
        edgeCount++;
      } else {
        if (s.skewedByRotatedGroup) {
          allWarnings.push('形状 ' + s.id + ' 位于带旋转的组内，仅还原平移位置');
        }
        const cx = s.x * PX_PER_IN; // 中心 X（页面坐标）
        const cy = s.y * PX_PER_IN; // 中心 Y（页面坐标，Y 向上）
        const w = s.w * PX_PER_IN;
        const h = s.h * PX_PER_IN;
        const left = cx - w / 2;
        const top = cy + h / 2; // 页面坐标 top（Y 向上）
        const dx = left;
        const dy = pageH - top + runningY; // 翻转 Y 到 draw.io 坐标系
        const cellId = 'v' + idx;
        idMap[s.id] = cellId;
        cells.push(vertexCell(cellId, s.text, dx, dy, w, h, s.master, s.angleDeg));
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

module.exports = {
  parseZip,
  readVsdx,
  vsdxToDrawio,
  extractShapes,
  extractConnects,
  readPageLayout,
  PX_PER_IN,
};
