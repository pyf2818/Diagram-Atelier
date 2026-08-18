'use strict';

/**
 * XML 增量补丁应用器。
 * AI 返回结构化 patch（add/update/delete），在服务端合并到当前 XML，
 * 避免整图重写，保留未改动节点的手动微调。
 */

function parseXml(xml) {
  if (typeof DOMParser !== 'undefined') {
    return new DOMParser().parseFromString(xml, 'application/xml');
  }
  // Node 无内置 DOMParser；server.js 端由 lib/xml.js 提供，patch 目前主要在前端/测试桩用。
  throw new Error('当前环境缺少 DOMParser');
}

function serializeXml(doc) {
  if (typeof XMLSerializer !== 'undefined') {
    return new XMLSerializer().serializeToString(doc);
  }
  throw new Error('当前环境缺少 XMLSerializer');
}

function rootOf(doc) {
  const model = doc.querySelector('mxGraphModel');
  if (!model) throw new Error('找不到 <mxGraphModel>');
  const root = model.querySelector('root');
  if (!root) throw new Error('找不到 <root>');
  return root;
}

function findCell(root, id) {
  return Array.from(root.children).find((c) => c.getAttribute('id') === id) || null;
}

function createCell(doc, id) {
  const cell = doc.createElement('mxCell');
  cell.setAttribute('id', id);
  return cell;
}

function ensureGeometry(doc, cell) {
  let geo = cell.querySelector(':scope > mxGeometry');
  if (!geo) {
    geo = doc.createElement('mxGeometry');
    geo.setAttribute('as', 'geometry');
    cell.appendChild(geo);
  }
  return geo;
}

function setGeoAttr(geo, key, val) {
  if (val === undefined || val === null) return;
  geo.setAttribute(key, String(val));
}

function applyOp(doc, root, op) {
  const type = String(op.op || '').trim();
  const id = String(op.id || '').trim();
  if (!id) throw new Error('patch op 缺少 id');

  if (type === 'add') {
    const existing = findCell(root, id);
    if (existing) throw new Error(`id ${id} 已存在，不能 add`);
    const cellType = String(op.type || '').trim();
    if (cellType !== 'vertex' && cellType !== 'edge') throw new Error(`add 类型必须是 vertex 或 edge，got ${cellType}`);
    const cell = createCell(doc, id);
    cell.setAttribute(cellType === 'vertex' ? 'vertex' : 'edge', '1');
    cell.setAttribute('parent', String(op.parent || '1'));
    if (op.value !== undefined) cell.setAttribute('value', String(op.value));
    if (op.style !== undefined) cell.setAttribute('style', String(op.style));
    if (cellType === 'edge') {
      if (op.source) cell.setAttribute('source', String(op.source));
      if (op.target) cell.setAttribute('target', String(op.target));
      const geo = ensureGeometry(doc, cell);
      geo.setAttribute('relative', '1');
    } else {
      const geo = ensureGeometry(doc, cell);
      setGeoAttr(geo, 'x', op.x);
      setGeoAttr(geo, 'y', op.y);
      setGeoAttr(geo, 'width', op.width);
      setGeoAttr(geo, 'height', op.height);
    }
    root.appendChild(cell);
    return;
  }

  if (type === 'update') {
    const cell = findCell(root, id);
    if (!cell) throw new Error(`id ${id} 不存在，无法 update`);
    if (op.value !== undefined) cell.setAttribute('value', String(op.value));
    if (op.style !== undefined) cell.setAttribute('style', String(op.style));
    if (op.source !== undefined) cell.setAttribute('source', String(op.source));
    if (op.target !== undefined) cell.setAttribute('target', String(op.target));
    if (op.parent !== undefined) cell.setAttribute('parent', String(op.parent));
    if (cell.getAttribute('vertex') === '1') {
      const geo = ensureGeometry(doc, cell);
      setGeoAttr(geo, 'x', op.x);
      setGeoAttr(geo, 'y', op.y);
      setGeoAttr(geo, 'width', op.width);
      setGeoAttr(geo, 'height', op.height);
    }
    return;
  }

  if (type === 'delete') {
    const cell = findCell(root, id);
    if (!cell) throw new Error(`id ${id} 不存在，无法 delete`);
    // 级联删除以该节点为 source/target 的边
    const isVertex = cell.getAttribute('vertex') === '1';
    if (isVertex) {
      Array.from(root.children).forEach((c) => {
        if (c.getAttribute('edge') === '1' && (c.getAttribute('source') === id || c.getAttribute('target') === id)) {
          root.removeChild(c);
        }
      });
    }
    root.removeChild(cell);
    return;
  }

  throw new Error(`未知 patch op: ${type}`);
}

/**
 * 应用 JSON patch 到 draw.io XML。
 * @param {string} xml 当前完整 <mxfile> XML
 * @param {object} patch { ops: [{op, id, ...}, ...] }
 * @returns {string} 新的完整 XML
 */
function applyXmlPatch(xml, patch) {
  if (!patch || !Array.isArray(patch.ops)) throw new Error('patch 必须包含 ops 数组');
  const doc = parseXml(xml);
  const root = rootOf(doc);
  const applied = [];
  const errors = [];
  for (const op of patch.ops) {
    try {
      applyOp(doc, root, op);
      applied.push(op.id);
    } catch (err) {
      errors.push({ id: op.id, error: err.message });
    }
  }
  return {
    xml: serializeXml(doc),
    applied,
    errors,
    ok: errors.length === 0,
  };
}

module.exports = { applyXmlPatch };
