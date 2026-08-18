'use strict';

/**
 * draw.io (mxGraphModel) XML 提取 / 规范化 / 校验工具。
 *
 * 依据 draw.io 官方 "Style reference for AI diagram generation" 规范：
 *   mxfile > diagram > mxGraphModel > root > mxCell
 *   - id="0" 根容器（无 parent）
 *   - id="1" parent="0" 默认图层
 *   - 业务单元格 parent="1"，vertex="1" / edge="1" 互斥
 *   - 始终使用未压缩 XML
 */

const BARE_AMP_RE = /&(?!#\d+;|#x[0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]{0,31};)/g;

/* ------------------------------------------------------------------ */
/* 1. 从模型自由文本中抽取 XML                                          */
/* ------------------------------------------------------------------ */

/** 去掉 markdown ``` 围栏，返回其中最长的 xml 代码块（若有） */
function pickFencedBlock(text) {
  if (!text) return null;
  const re = /```(?:xml|drawio|mxfile|XML)?\s*\n([\s\S]*?)```/g;
  let m;
  let best = null;
  while ((m = re.exec(text))) {
    const body = m[1];
    if (!/<mx(file|GraphModel)\b/i.test(body)) continue;
    if (!best || body.length > best.length) best = body;
  }
  return best ? best.trim() : null;
}

/** 在纯文本里按标签边界抽取 */
function pickByTag(text, tag) {
  if (!text) return null;
  const openIdx = text.search(new RegExp('<' + tag + '\\b', 'i'));
  if (openIdx === -1) return null;
  const closeTag = '</' + tag + '>';
  const closeIdx = text.toLowerCase().lastIndexOf(closeTag.toLowerCase());
  if (closeIdx === -1 || closeIdx < openIdx) return null;
  return text.slice(openIdx, closeIdx + closeTag.length).trim();
}

/**
 * 从 LLM 回复中抽取图表 XML。
 * @returns {{xml: string|null, reply: string}} reply 为剔除 XML 后的自然语言说明
 */
function extractDiagramXml(text) {
  const raw = String(text || '');
  let xml = pickFencedBlock(raw);

  if (!xml) xml = pickByTag(raw, 'mxfile');
  if (!xml) xml = pickByTag(raw, 'mxGraphModel');

  let reply = raw;
  if (xml) {
    // 去掉 ```xml ... ``` 整块
    reply = raw.replace(/```(?:xml|drawio|mxfile|XML)?\s*\n[\s\S]*?```/g, '').trim();
    if (!reply) {
      // 没有围栏的情况：直接把 XML 片段抠掉
      reply = raw.split(xml).join('').trim();
    }
  }
  reply = reply.replace(/\n{3,}/g, '\n\n').trim();
  return { xml: xml || null, reply };
}

/**
 * 从 LLM 回复中抽取 JSON patch（对话即改图模式）。
 * @returns {{patch: object|null, reply: string}}
 */
function extractJsonPatch(text) {
  const raw = String(text || '');
  const re = /```(?:json)?\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(raw))) {
    try {
      const obj = JSON.parse(m[1]);
      if (obj && Array.isArray(obj.ops)) {
        let reply = raw.replace(/```(?:json)?\s*\n[\s\S]*?```/g, '').trim();
        reply = reply.replace(/\n{3,}/g, '\n\n').trim();
        return { patch: obj, reply };
      }
    } catch {
      // continue scanning
    }
  }
  return { patch: null, reply: raw };
}

/* ------------------------------------------------------------------ */
/* 2. 标签扫描器（正确处理引号内的 ">"）                                */
/* ------------------------------------------------------------------ */

/**
 * 扫描出所有标签。返回 [{start, end, name, attrsRaw, closing, selfClosing}]
 * end 为 ">" 之后的下标（exclusive）。
 */
function scanTags(xml) {
  const out = [];
  let i = 0;
  const len = xml.length;

  while (i < len) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) break;

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt);
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt);
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt);
      i = end === -1 ? len : end + 2;
      continue;
    }
    if (xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt);
      i = end === -1 ? len : end + 1;
      continue;
    }

    // 普通标签：扫描到匹配的 ">"，跳过引号内内容
    let j = lt + 1;
    let quote = null;
    while (j < len) {
      const c = xml[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
      j++;
    }
    if (j >= len) break; // 未闭合的 "<"

    const inner = xml.slice(lt + 1, j);
    const closing = inner.startsWith('/');
    const selfClosing = inner.endsWith('/');
    const body = inner.replace(/^\//, '').replace(/\/$/, '');
    const nameMatch = body.match(/^([A-Za-z_][\w.:-]*)/);
    if (nameMatch) {
      out.push({
        start: lt,
        end: j + 1,
        name: nameMatch[1],
        attrsRaw: body.slice(nameMatch[1].length),
        closing,
        selfClosing,
      });
    }
    i = j + 1;
  }
  return out;
}

/** 解析属性串 -> { key: value } */
function parseAttrs(attrsRaw) {
  const attrs = {};
  const re = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(attrsRaw))) {
    attrs[m[1]] = m[3] !== undefined ? m[3] : m[4];
  }
  return attrs;
}

/* ------------------------------------------------------------------ */
/* 3. 校验                                                            */
/* ------------------------------------------------------------------ */

const VOID_OK = new Set(); // mxGraph 里没有真正的 void 元素

function validateXml(xml) {
  const errors = [];
  if (!xml || !xml.trim()) {
    return { ok: false, errors: ['XML 为空'] };
  }

  const tags = scanTags(xml);
  if (!tags.length) return { ok: false, errors: ['未找到任何 XML 标签'] };

  const stack = [];
  for (const t of tags) {
    if (t.closing) {
      if (!stack.length) {
        errors.push(`多余的闭合标签 </${t.name}>`);
      } else if (stack[stack.length - 1].name !== t.name) {
        errors.push(`标签错配：期望 </${stack[stack.length - 1].name}>，实际 </${t.name}>`);
        // 尝试容错回退
        const idx = [...stack].reverse().findIndex((s) => s.name === t.name);
        if (idx >= 0) stack.length = stack.length - idx - 1;
      } else {
        stack.pop();
      }
    } else if (!t.selfClosing && !VOID_OK.has(t.name)) {
      stack.push(t);
    }
    if (errors.length > 6) break;
  }
  if (stack.length && errors.length <= 6) {
    errors.push('存在未闭合标签：' + stack.map((s) => `<${s.name}>`).join(', '));
  }

  // 结构性检查
  if (!/<mxGraphModel\b/i.test(xml)) errors.push('缺少 <mxGraphModel> 节点');
  if (!/<root\b/i.test(xml)) errors.push('缺少 <root> 节点');

  // 边的 source/target 必须指向已存在的 id
  const ids = new Set();
  const edges = [];
  for (const t of tags) {
    if (t.closing || t.name !== 'mxCell') continue;
    const a = parseAttrs(t.attrsRaw);
    if (a.id) ids.add(a.id);
    if (a.edge === '1') edges.push(a);
  }
  for (const e of edges) {
    if (e.source && !ids.has(e.source)) errors.push(`边 ${e.id || '?'} 的 source="${e.source}" 不存在`);
    if (e.target && !ids.has(e.target)) errors.push(`边 ${e.id || '?'} 的 target="${e.target}" 不存在`);
    if (errors.length > 10) break;
  }

  return { ok: errors.length === 0, errors: errors.slice(0, 10) };
}

/* ------------------------------------------------------------------ */
/* 4. 规范化 / 自动修复                                                */
/* ------------------------------------------------------------------ */

function stripComments(xml) {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

function escapeBareAmp(xml) {
  // 避免破坏 CDATA
  const parts = xml.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/g);
  return parts
    .map((p, i) => (i % 2 === 1 ? p : p.replace(BARE_AMP_RE, '&amp;')))
    .join('');
}

/** 给缺 parent 的业务 mxCell 补 parent="1" */
function ensureCellParents(xml) {
  const tags = scanTags(xml).filter((t) => !t.closing && t.name === 'mxCell');
  let result = xml;
  // 从后往前改，避免下标位移
  for (let i = tags.length - 1; i >= 0; i--) {
    const t = tags[i];
    const a = parseAttrs(t.attrsRaw);
    if (a.id === '0') continue;
    if (a.parent !== undefined) continue;
    const insertAt = t.start + 1 + t.name.length;
    result = result.slice(0, insertAt) + ' parent="1"' + result.slice(insertAt);
  }
  return result;
}

/** 确保 <root> 下存在 id="0" 与 id="1" 两个结构性单元格 */
function ensureStructuralCells(xml) {
  const rootOpen = xml.match(/<root\b[^>]*>/i);
  if (!rootOpen) return xml;

  const tags = scanTags(xml).filter((t) => !t.closing && t.name === 'mxCell');
  const attrs = tags.map((t) => parseAttrs(t.attrsRaw));
  const has0 = attrs.some((a) => a.id === '0');
  const has1 = attrs.some((a) => a.id === '1');
  if (has0 && has1) return xml;

  const insertAt = xml.indexOf(rootOpen[0]) + rootOpen[0].length;
  let inject = '';
  if (!has0) inject += '\n        <mxCell id="0" />';
  if (!has1) inject += '\n        <mxCell id="1" parent="0" />';
  return xml.slice(0, insertAt) + inject + xml.slice(insertAt);
}

const DEFAULT_MODEL_ATTRS =
  'dx="1422" dy="798" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" ' +
  'arrows="1" fold="1" page="1" pageScale="1" pageWidth="1654" pageHeight="1169" math="0" shadow="0"';

/**
 * 规范化为可被 draw.io 直接 load 的完整 mxfile。
 * @param {string} input
 * @param {{name?: string}} [opts]
 */
function normalizeDrawioXml(input, opts = {}) {
  let xml = String(input || '').trim();
  if (!xml) return { xml: '', changed: [], validation: { ok: false, errors: ['XML 为空'] } };

  const changed = [];

  // 去 BOM / XML 声明
  xml = xml.replace(/^\uFEFF/, '');
  if (/^<\?xml[^>]*\?>/i.test(xml)) {
    xml = xml.replace(/^<\?xml[^>]*\?>\s*/i, '');
    changed.push('移除 XML 声明');
  }

  if (/<!--/.test(xml)) {
    xml = stripComments(xml);
    changed.push('移除 XML 注释（draw.io 解析器不接受）');
  }

  if (/compressed\s*=\s*["']true["']/i.test(xml)) {
    xml = xml.replace(/\s*compressed\s*=\s*["']true["']/gi, '');
    changed.push('关闭 compressed 属性');
  }

  const before = xml;
  xml = escapeBareAmp(xml);
  if (xml !== before) changed.push('转义裸 & 字符');

  // 只有 mxGraphModel -> 包 diagram
  if (!/<mxfile\b/i.test(xml)) {
    const model = pickByTag(xml, 'mxGraphModel') || xml;
    const id = 'dg-' + Math.random().toString(36).slice(2, 10);
    xml =
      `<mxfile host="atelier-diagram-studio" agent="AI Diagram Atelier" version="31.1.8" type="device">\n` +
      `  <diagram id="${id}" name="${escapeAttr(opts.name || 'Page-1')}">\n` +
      `    ${model.trim()}\n` +
      `  </diagram>\n` +
      `</mxfile>`;
    changed.push('补全 <mxfile>/<diagram> 外层结构');
  } else if (!/<diagram\b/i.test(xml)) {
    const model = pickByTag(xml, 'mxGraphModel');
    if (model) {
      const id = 'dg-' + Math.random().toString(36).slice(2, 10);
      xml = xml.replace(
        model,
        `<diagram id="${id}" name="${escapeAttr(opts.name || 'Page-1')}">\n    ${model}\n  </diagram>`
      );
      changed.push('补全 <diagram> 节点');
    }
  }

  // mxGraphModel 缺少常规属性时补全（不覆盖已有）
  xml = xml.replace(/<mxGraphModel\b([^>]*)>/i, (full, attrs) => {
    if (/\bpageWidth\s*=/.test(attrs)) return full;
    changed.push('补全 mxGraphModel 画布属性');
    return `<mxGraphModel ${DEFAULT_MODEL_ATTRS}${attrs.trim() ? ' ' + attrs.trim() : ''}>`;
  });

  const beforeStruct = xml;
  xml = ensureStructuralCells(xml);
  if (xml !== beforeStruct) changed.push('补全 id="0" / id="1" 结构单元格');

  const beforeParent = xml;
  xml = ensureCellParents(xml);
  if (xml !== beforeParent) changed.push('为缺失 parent 的单元格补 parent="1"');

  const validation = validateXml(xml);
  return { xml, changed, validation };
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ------------------------------------------------------------------ */
/* 5. 统计摘要                                                        */
/* ------------------------------------------------------------------ */

function summarizeDiagram(xml) {
  const tags = scanTags(String(xml || ''));
  let vertices = 0;
  let edges = 0;
  let containers = 0;
  let pages = 0;
  const labels = [];

  for (const t of tags) {
    if (t.closing) continue;
    if (t.name === 'diagram') pages++;
    if (t.name !== 'mxCell' && t.name !== 'object' && t.name !== 'UserObject') continue;
    const a = parseAttrs(t.attrsRaw);
    if (a.vertex === '1') {
      vertices++;
      if (/swimlane|container=1|group/.test(a.style || '')) containers++;
      const label = (a.value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (label && labels.length < 40) labels.push(label);
    } else if (a.edge === '1') {
      edges++;
    }
  }
  return { vertices, edges, containers, pages: pages || 1, labels };
}

module.exports = {
  extractDiagramXml,
  extractJsonPatch,
  normalizeDrawioXml,
  validateXml,
  summarizeDiagram,
  scanTags,
  parseAttrs,
};
