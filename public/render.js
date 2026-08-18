/* ════════════════════════════════════════════════════════════════
   Diagram Atelier · 离线 SVG 渲染层
   完全不依赖外部编辑器，把 draw.io 兼容的 mxGraphModel XML
   解析为与工作台同款「纸墨 / 靛蓝 / 黄铜」主题的可缩放 SVG。
   暴露：window.DiagramRender.render(container, xml)
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ─── 主题色（与 styles.css 对齐）─── */
  const PALETTE = {
    ink: '#24314F',
    ink2: '#4A5F8E',
    inkSoft: '#6E7A93',
    brass: '#C9A961',
    brassDeep: '#A6813C',
    text: '#2A2A2E',
    muted: '#8A857B',
    line: '#ECE7DC',
    paper: '#FBFAF7',
    edge: '#6E7684',
    good: '#4F9D69',
    bad: '#C0623E',
  };

  /* 暗色主题调色板：与 styles.css [data-theme="dark"] 对齐 */
  const DARK = {
    ink: '#D9DEEA',
    ink2: '#AEB8D4',
    inkSoft: '#9AA4BE',
    brass: '#D6B271',
    brassDeep: '#C9A961',
    text: '#E6E8EF',
    muted: '#98A2BA',
    line: '#2A3040',
    paper: '#1B202B',
    edge: '#8A93A8',
    good: '#5FB37E',
    bad: '#DD7A5A',
  };

  /* 按当前主题返回调色板（每次渲染实时读取，切主题后重渲染即可生效） */
  function palette() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? DARK : PALETTE;
  }

  /* ─── 工具 ─── */
  function parseStyle(style) {
    const obj = {};
    String(style || '').split(';').forEach((pair) => {
      const i = pair.indexOf('=');
      if (i < 0) {
        if (pair.trim()) obj[pair.trim()] = true;
        return;
      }
      obj[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    });
    return obj;
  }

  function decodeValue(s) {
    if (!s) return '';
    return s
      .replace(/<br\s*\/?>(?:\s*<br\s*\/?>)*/gi, '\n')
      .replace(/<div[^>]*>/gi, '\n')
      .replace(/<\/div>/gi, '')
      .replace(/<li[^>]*>/gi, '\n· ')
      .replace(/<[^>]+>/g, '')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
      .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&quot;/g, '"')
      .replace(/&nbsp;/g, ' ')
      .trim();
  }

  function linesOf(value) {
    return decodeValue(value).split('\n').map((l) => l.trim()).filter((l, i, a) => l || i === 0 || i === a.length - 1);
  }

  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ─── 解析模型 ─── */
  function parseModel(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const perr = doc.getElementsByTagName('parsererror');
    if (perr && perr.length) throw new Error('XML 解析失败');

    const cells = [];
    const map = {};
    const raw = doc.getElementsByTagName('mxCell');
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      const id = c.getAttribute('id');
      if (!id) continue;
      const style = c.getAttribute('style') || '';
      const vertex = c.getAttribute('vertex') === '1';
      const edge = c.getAttribute('edge') === '1';
      const parent = c.getAttribute('parent');
      const geo = c.getElementsByTagName('mxGeometry')[0];
      let x = 0, y = 0, w = 0, h = 0, relative = false, points = [];
      if (geo) {
        x = parseFloat(geo.getAttribute('x')) || 0;
        y = parseFloat(geo.getAttribute('y')) || 0;
        w = parseFloat(geo.getAttribute('width')) || 0;
        h = parseFloat(geo.getAttribute('height')) || 0;
        relative = geo.getAttribute('relative') === '1';
        const pts = geo.getElementsByTagName('mxPoint');
        for (let j = 0; j < pts.length; j++) {
          const as = pts[j].getAttribute('as');
          if (as === 'sourcePoint' || as === 'targetPoint') continue;
          points.push({
            x: parseFloat(pts[j].getAttribute('x')) || 0,
            y: parseFloat(pts[j].getAttribute('y')) || 0,
          });
        }
      }
      const rec = {
        id, parent, vertex, edge, style,
        st: parseStyle(style),
        value: c.getAttribute('value') || '',
        source: c.getAttribute('source') || '',
        target: c.getAttribute('target') || '',
        x, y, w, h, relative, points,
      };
      cells.push(rec);
      map[id] = rec;
    }
    return { cells, map };
  }

  /* ─── 递归解析绝对坐标（泳道容器嵌套）─── */
  function resolvePositions(cells, map) {
    const abs = {};
    function resolve(id) {
      if (abs[id]) return abs[id];
      const c = map[id];
      if (!c) { abs[id] = { x: 0, y: 0, w: 0, h: 0 }; return abs[id]; }
      let ax = 0, ay = 0;
      if (c.parent && c.parent !== '0' && map[c.parent]) {
        const p = resolve(c.parent);
        ax = p.x; ay = p.y;
      }
      abs[id] = { x: ax + c.x, y: ay + c.y, w: c.w, h: c.h };
      return abs[id];
    }
    cells.forEach((c) => resolve(c.id));
    return abs;
  }

  /* ─── 顶点形状绘制 ─── */
  function shapeOf(st) {
    if (st.shape && String(st.shape).indexOf('atos:') === 0) return 'shapeicon';
    if (st.rhombus) return 'rhombus';
    if (st.shape === 'cylinder3' || st.shape === 'cylinder') return 'cylinder';
    if (st.ellipse) return 'ellipse';
    if (st.swimlane || st.shape === 'swimlane') return 'swimlane';
    if ((st.fillColor === 'none' && st.strokeColor === 'none') || /^text;/.test(st.__raw || '')) return 'text';
    return 'rect';
  }

  function drawText(box, value, st, opts) {
    const lines = linesOf(value);
    if (!lines.length) return '';
    const fs = parseFloat(st.fontSize) || 13;
    const color = st.fontColor || palette().text;
    const bold = /(^|;)fontStyle=([^;]*\b(1)\b)?/.test('fontStyle=' + (st.fontStyle || '0')) ||
      String(st.fontStyle || '').split('').indexOf('1') >= 0;
    const weight = (st.fontStyle && String(st.fontStyle).indexOf('1') >= 0) ? 700 : 500;
    const lineH = fs * 1.28;
    const cx = box.x + box.w / 2;
    const align = st.align || 'center';
    const tx = align === 'left' ? box.x + 10 : align === 'right' ? box.x + box.w - 10 : cx;
    const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
    const totalH = lines.length * lineH;
    let startY = box.y + box.h / 2 - totalH / 2 + fs * 0.82;
    const tspans = lines.map((ln, i) =>
      `<tspan x="${tx.toFixed(1)}" y="${(startY + i * lineH).toFixed(1)}">${escAttr(ln)}</tspan>`).join('');
    return `<text font-family="Helvetica, Arial, sans-serif" font-size="${fs}" font-weight="${weight}" ` +
      `fill="${color}" text-anchor="${anchor}" dominant-baseline="auto">${tspans}</text>`;
  }

  function drawVertex(c, box) {
    const st = c.st;
    const fill = st.fillColor && st.fillColor !== 'none' ? st.fillColor : 'none';
    const stroke = st.strokeColor && st.strokeColor !== 'none' ? st.strokeColor : 'none';
    const sw = parseFloat(st.strokeWidth) || (stroke === 'none' ? 0 : 1.5);
    const kind = shapeOf(Object.assign({}, st, { __raw: c.style }));

    if (kind === 'text') {
      return `<g>${drawText(box, c.value, st)}</g>`;
    }

    if (kind === 'shapeicon') {
      const iconId = String(st.shape).slice(5); // 去掉 "atos:" 前缀
      const url = (window.DiagramShapes && window.DiagramShapes.getImageUrl)
        ? window.DiagramShapes.getImageUrl(iconId) : null;
      const hasLabel = c.value && String(c.value).trim().length > 0;
      const iconSize = Math.max(22, Math.min(box.w - 16, box.h - (hasLabel ? 22 : 8), 64));
      const ix = box.x + (box.w - iconSize) / 2;
      const iy = box.y + (box.h - iconSize) / 2 - (hasLabel ? box.h * 0.14 : 0);
      let img = '';
      if (url) {
        img = `<image x="${ix.toFixed(1)}" y="${iy.toFixed(1)}" width="${iconSize.toFixed(1)}" height="${iconSize.toFixed(1)}" ` +
          `href="${url}" preserveAspectRatio="xMidYMid meet"/>`;
      } else {
        // 图标库未加载时的降级：画一个中性圆点
        img = `<circle cx="${(ix + iconSize / 2).toFixed(1)}" cy="${(iy + iconSize / 2).toFixed(1)}" r="${(iconSize / 2).toFixed(1)}" fill="${palette().brass}" opacity="0.5"/>`;
      }
      const labelBox = { x: box.x, y: box.y + box.h * 0.58, w: box.w, h: box.h * 0.4 };
      return `<g>${img}${hasLabel ? drawText(labelBox, c.value, st) : ''}</g>`;
    }

    if (kind === 'swimlane') {
      const startSize = parseFloat(st.startSize) || 30;
      const horizontal = st.horizontal !== '0';
      const rx = parseFloat(st.arcSize) || 4;
      const inner = `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${rx}" ry="${rx}" ` +
        `fill="${fill || palette().paper}" stroke="${stroke}" stroke-width="${sw}"/>`;
      // 标题栏
      let bar;
      if (horizontal) {
        bar = `<path d="M ${box.x} ${box.y + rx} Q ${box.x} ${box.y} ${box.x + rx} ${box.y} ` +
          `L ${box.x + box.w - rx} ${box.y} Q ${box.x + box.w} ${box.y} ${box.x + box.w} ${box.y + rx} ` +
          `L ${box.x + box.w} ${box.y + startSize} L ${box.x} ${box.y + startSize} Z" ` +
          `fill="${stroke}" opacity="0.10" stroke="${stroke}" stroke-width="${sw}"/>`;
      } else {
        bar = `<rect x="${box.x}" y="${box.y}" width="${startSize}" height="${box.h}" ` +
          `fill="${stroke}" opacity="0.10" stroke="${stroke}" stroke-width="${sw}"/>`;
      }
      const titleBox = horizontal
        ? { x: box.x, y: box.y, w: box.w, h: startSize }
        : { x: box.x, y: box.y, w: startSize, h: box.h };
      const titleLines = linesOf(c.value);
      const titleText = drawText(titleBox, c.value, Object.assign({}, st, { fontSize: (parseFloat(st.fontSize) || 14) }));
      return `<g>${inner}${bar}${titleText}</g>`;
    }

    if (kind === 'rhombus') {
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      const pts = `${cx},${box.y} ${box.x + box.w},${cy} ${cx},${box.y + box.h} ${box.x},${cy}`;
      return `<g><polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>` +
        drawText(box, c.value, st) + `</g>`;
    }

    if (kind === 'ellipse') {
      return `<g><ellipse cx="${box.x + box.w / 2}" cy="${box.y + box.h / 2}" rx="${box.w / 2}" ry="${box.h / 2}" ` +
        `fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>${drawText(box, c.value, st)}</g>`;
    }

    if (kind === 'cylinder') {
      const rx = box.w / 2;
      const ry = clamp(box.h * 0.16, 10, Math.min(26, box.h / 3));
      const top = box.y + ry;
      const bot = box.y + box.h - ry;
      const body = `M ${box.x} ${top} L ${box.x} ${bot} A ${rx} ${ry} 0 0 0 ${box.x + box.w} ${bot} ` +
        `L ${box.x + box.w} ${top} A ${rx} ${ry} 0 0 1 ${box.x} ${top} Z`;
      const topEllipse = `<ellipse cx="${box.x + rx}" cy="${top}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
      return `<g><path d="${body}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>${topEllipse}` +
        drawText({ x: box.x, y: top, w: box.w, h: box.h - ry }, c.value, st) + `</g>`;
    }

    // 默认：圆角矩形
    const rx = clamp((parseFloat(st.arcSize) || 12) / 100 * box.h, 2, box.w / 2, box.h / 2);
    return `<g><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${rx}" ry="${rx}" ` +
      `fill="${fill || palette().paper}" stroke="${stroke}" stroke-width="${sw}"/>${drawText(box, c.value, st)}</g>`;
  }

  /* ─── 边绘制 ─── */
  function center(box) {
    return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  }

  function borderPoint(box, tx, ty) {
    const c = center(box);
    const dx = tx - c.x, dy = ty - c.y;
    if (dx === 0 && dy === 0) return c;
    const hw = box.w / 2 || 1, hh = box.h / 2 || 1;
    const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
    return { x: c.x + dx * scale, y: c.y + dy * scale };
  }

  function edgeAnchors(edge, srcBox, tgtBox) {
    const st = edge.st;
    let s = null, t = null;
    if (srcBox) {
      if (st.exitX != null && st.exitY != null) {
        s = { x: srcBox.x + parseFloat(st.exitX) * srcBox.w, y: srcBox.y + parseFloat(st.exitY) * srcBox.h };
      } else if (tgtBox) {
        s = borderPoint(srcBox, center(tgtBox).x, center(tgtBox).y);
      } else {
        s = center(srcBox);
      }
    }
    if (tgtBox) {
      if (st.entryX != null && st.entryY != null) {
        t = { x: tgtBox.x + parseFloat(st.entryX) * tgtBox.w, y: tgtBox.y + parseFloat(st.entryY) * tgtBox.h };
      } else if (srcBox) {
        t = borderPoint(tgtBox, center(srcBox).x, center(srcBox).y);
      } else {
        t = center(tgtBox);
      }
    }
    return { s, t };
  }

  function dirVec(st, key) {
    // 由 exit/entry 比例推断朝向（相对中心）
    const x = parseFloat(st[key + 'X']), y = parseFloat(st[key + 'Y']);
    if (x == null || y == null) return null;
    return { x: x - 0.5, y: y - 0.5 };
  }

  function buildRoute(edge, s, t) {
    const st = edge.st;
    if (!s || !t) return [s, t].filter(Boolean);
    // 显式航点优先
    if (edge.points && edge.points.length >= 2) {
      return [s].concat(edge.points, [t]);
    }
    if (st.curved === '1') {
      const dist = Math.hypot(t.x - s.x, t.y - s.y);
      const k = Math.max(30, dist * 0.42);
      let ds = dirVec(st, 'exit') || { x: t.x - s.x, y: t.y - s.y };
      let dt = dirVec(st, 'entry') || { x: s.x - t.x, y: s.y - t.y };
      const n = (v) => { const m = Math.hypot(v.x, v.y) || 1; return { x: v.x / m, y: v.y / m }; };
      ds = n(ds); dt = n(dt);
      const c1 = { x: s.x + ds.x * k, y: s.y + ds.y * k };
      const c2 = { x: t.x + dt.x * k, y: t.y + dt.y * k };
      return { curve: [s, c1, c2, t] };
    }
    if (st.edgeStyle === 'orthogonalEdgeStyle' || !st.edgeStyle) {
      const midX = (s.x + t.x) / 2, midY = (s.y + t.y) / 2;
      if (Math.abs(t.x - s.x) >= Math.abs(t.y - s.y)) {
        return [s, { x: midX, y: s.y }, { x: midX, y: t.y }, t];
      }
      return [s, { x: s.x, y: midY }, { x: t.x, y: midY }, t];
    }
    return [s, t];
  }

  function routeToPath(route) {
    if (route.curve) {
      const [s, c1, c2, t] = route.curve;
      return `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${t.x.toFixed(1)} ${t.y.toFixed(1)}`;
    }
    return 'M ' + route.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ');
  }

  function arrowHead(x, y, ang, color) {
    const size = 9;
    const a1 = ang - Math.PI / 7;
    const a2 = ang + Math.PI / 7;
    const x1 = x - size * Math.cos(a1), y1 = y - size * Math.sin(a1);
    const x2 = x - size * Math.cos(a2), y2 = y - size * Math.sin(a2);
    return `<path d="M ${x.toFixed(1)} ${y.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${color}"/>`;
  }

  function drawEdge(edge, srcBox, tgtBox) {
    const st = edge.st;
    const { s, t } = edgeAnchors(edge, srcBox, tgtBox);
    if (!s || !t) return { svg: '', pts: [] };
    const route = buildRoute(edge, s, t);
    const d = routeToPath(route);
    const color = st.strokeColor || palette().edge;
    const sw = parseFloat(st.strokeWidth) || 1.6;
    const dash = st.dashed === '1' ? `stroke-dasharray="${st.dashPattern || '6 4'}"` : '';
    const hasArrow = st.endArrow !== 'none';
    // 末端方向
    let lastSeg;
    if (route.curve) {
      const a = route.curve[2], b = route.curve[3];
      lastSeg = Math.atan2(b.y - a.y, b.x - a.x);
    } else {
      const n = route.length;
      const a = route[n - 2], b = route[n - 1];
      lastSeg = Math.atan2(b.y - a.y, b.x - a.x);
    }
    let arrow = '';
    if (hasArrow) arrow = arrowHead(t.x, t.y, lastSeg, color);
    const path = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" ${dash} stroke-linejoin="round" stroke-linecap="round"/>${arrow}`;
    // 边标签
    let label = '';
    if (edge.value && edge.value.trim()) {
      const lp = route.curve
        ? { x: (route.curve[1].x + route.curve[2].x) / 2, y: (route.curve[1].y + route.curve[2].y) / 2 }
        : (() => {
            const n = route.length;
            return { x: (route[Math.floor((n - 1) / 2)].x + route[Math.ceil((n - 1) / 2)].x) / 2,
                     y: (route[Math.floor((n - 1) / 2)].y + route[Math.ceil((n - 1) / 2)].y) / 2 };
          })();
      const fs = parseFloat(st.fontSize) || 12;
      const lc = st.fontColor || palette().inkSoft;
      label = `<rect x="${(lp.x - edge.value.length * fs * 0.32 - 4).toFixed(1)}" y="${(lp.y - fs * 0.7).toFixed(1)}" ` +
        `width="${(edge.value.length * fs * 0.64 + 8).toFixed(1)}" height="${(fs * 1.4).toFixed(1)}" rx="4" fill="${palette().paper}" opacity="0.85"/>` +
        `<text x="${lp.x.toFixed(1)}" y="${(lp.y + fs * 0.34).toFixed(1)}" font-family="Helvetica, Arial, sans-serif" ` +
        `font-size="${fs}" fill="${lc}" text-anchor="middle">${escAttr(decodeValue(edge.value))}</text>`;
    }
    return { svg: path + label, pts: route.curve ? route.curve : route };
  }

  /* ─── 主渲染 ─── */
  function render(container, xml) {
    const result = { ok: false, error: '', vertices: 0, edges: 0, svg: '', bbox: null };
    if (!container) { result.error = '容器不存在'; return result; }
    if (!xml || !xml.trim()) { result.error = 'XML 为空'; return result; }
    let parsed;
    try { parsed = parseModel(xml); }
    catch (e) { result.error = e.message || '解析失败'; container.innerHTML = ''; return result; }

    const { cells, map } = parsed;
    const abs = resolvePositions(cells, map);

    const containers = [];
    const vertices = [];
    const edges = [];
    for (const c of cells) {
      if (c.id === '0' || c.id === '1') continue;
      if (c.edge) edges.push(c);
      else if (c.vertex) {
        const kind = shapeOf(Object.assign({}, c.st, { __raw: c.style }));
        if (kind === 'swimlane') containers.push(c);
        else vertices.push(c);
      }
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const acc = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };

    const parts = [];

    // 1) 容器（泳道）
    containers.forEach((c) => {
      const box = abs[c.id];
      if (!box) return;
      acc(box.x, box.y); acc(box.x + box.w, box.y + box.h);
      parts.push(drawVertex(c, box));
    });

    // 2) 边
    const edgePts = [];
    edges.forEach((e) => {
      const sb = e.source && map[e.source] ? abs[e.source] : null;
      const tb = e.target && map[e.target] ? abs[e.target] : null;
      const { svg, pts } = drawEdge(e, sb, tb);
      if (pts) pts.forEach((p) => acc(p.x, p.y));
      parts.push(svg);
    });

    // 3) 普通顶点
    vertices.forEach((c) => {
      const box = abs[c.id];
      if (!box) return;
      acc(box.x, box.y); acc(box.x + box.w, box.y + box.h);
      parts.push(drawVertex(c, box));
    });

    if (!isFinite(minX)) { result.error = '未找到可绘制的图形'; container.innerHTML = ''; return result; }

    const pad = 36;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const W = maxX - minX, H = maxY - minY;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W)}" height="${Math.ceil(H)}" ` +
      `viewBox="${minX.toFixed(1)} ${minY.toFixed(1)} ${W.toFixed(1)} ${H.toFixed(1)}" ` +
      `font-family="Helvetica, Arial, sans-serif">` +
      `<rect x="${minX.toFixed(1)}" y="${minY.toFixed(1)}" width="${W.toFixed(1)}" height="${H.toFixed(1)}" fill="${palette().paper}"/>` +
      parts.join('') + `</svg>`;

    container.innerHTML = svg;

    result.ok = true;
    result.svg = svg;
    result.vertices = vertices.length + containers.length;
    result.edges = edges.length;
    result.bbox = { minX, minY, w: W, h: H };
    window.DiagramRender.last = result;
    return result;
  }

  window.DiagramRender = { render, PALETTE };
})();
