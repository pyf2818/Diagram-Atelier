'use strict';

/**
 * 内置示例图。三个作用：
 *  1) 无 API Key 时也能跑通「前端 → 后端 → draw.io 渲染」闭环，便于连通性自检；
 *  2) 作为用户的一键起步模板；
 *  3) 作为排版风格的事实基准（与 prompt.js 的配方保持一致）。
 */

const MODEL_ATTRS =
  'dx="1422" dy="798" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" ' +
  'arrows="1" fold="1" page="1" pageScale="1" pageWidth="1654" pageHeight="1169" math="0" shadow="0"';

const FONT = 'fontFamily=Helvetica;fontSize=13;';

const S = {
  title:
    'text;html=1;align=center;verticalAlign=middle;fontSize=20;fontStyle=1;fontColor=#24314F;fontFamily=Helvetica;strokeColor=none;fillColor=none;',
  sub: 'text;html=1;align=center;verticalAlign=middle;fontSize=12;fontColor=#8A9099;fontFamily=Helvetica;strokeColor=none;fillColor=none;',
  terminal: `rounded=1;arcSize=40;whiteSpace=wrap;html=1;fillColor=#F3E8D8;strokeColor=#A6813C;fontColor=#4A3413;fontStyle=1;${FONT}shadow=0;`,
  process: `rounded=1;arcSize=8;whiteSpace=wrap;html=1;fillColor=#E8EEF7;strokeColor=#4A5F8E;fontColor=#1F2937;${FONT}shadow=0;`,
  decision: `rhombus;perimeter=rhombusPerimeter;whiteSpace=wrap;html=1;fillColor=#FDF6E8;strokeColor=#A6813C;fontColor=#4A3413;${FONT}shadow=0;`,
  warn: `rounded=1;arcSize=8;whiteSpace=wrap;html=1;fillColor=#F7E4E2;strokeColor=#B06A62;fontColor=#4A211D;${FONT}shadow=0;`,
  ok: `rounded=1;arcSize=8;whiteSpace=wrap;html=1;fillColor=#E4EFE4;strokeColor=#6F9268;fontColor=#24351F;${FONT}shadow=0;`,
  store: `shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=12;whiteSpace=wrap;html=1;fillColor=#EAE6F2;strokeColor=#7C6BA0;fontColor=#2E2542;${FONT}shadow=0;`,
  node: `rounded=1;arcSize=8;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#B9B3A7;fontColor=#4A4F58;${FONT}shadow=0;`,
  edge: `edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=classic;strokeWidth=1.6;strokeColor=#6E7684;fontFamily=Helvetica;fontSize=12;fontColor=#4A4F58;`,
  edgeDash: `edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=classic;dashed=1;dashPattern=6 4;strokeWidth=1.4;strokeColor=#9AA0AA;fontFamily=Helvetica;fontSize=12;fontColor=#4A4F58;`,
  lane: `swimlane;html=1;startSize=34;horizontal=1;rounded=1;arcSize=4;whiteSpace=wrap;fillColor=#F7F5F1;strokeColor=#B9B3A7;fontColor=#4A4F58;fontFamily=Helvetica;fontSize=14;fontStyle=1;shadow=0;`,
  center: `rounded=1;arcSize=50;whiteSpace=wrap;html=1;fillColor=#24314F;strokeColor=#24314F;fontColor=#FFFFFF;fontSize=16;fontStyle=1;fontFamily=Helvetica;shadow=0;`,
  mmEdgeR: `edgeStyle=none;curved=1;html=1;endArrow=none;strokeWidth=2;rounded=1;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;`,
  mmEdgeL: `edgeStyle=none;curved=1;html=1;endArrow=none;strokeWidth=2;rounded=1;exitX=0;exitY=0.5;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;`,
};

function pill(fill, stroke, font, bold) {
  return `rounded=1;arcSize=40;whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=${stroke};fontColor=${font};${FONT}${
    bold ? 'fontStyle=1;' : ''
  }shadow=0;`;
}

function v(id, value, style, x, y, w, h, parent) {
  return (
    `        <mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="${parent || '1'}">\n` +
    `          <mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry" />\n` +
    `        </mxCell>`
  );
}

function e(id, value, style, source, target) {
  return (
    `        <mxCell id="${id}" value="${value}" style="${style}" edge="1" parent="1" source="${source}" target="${target}">\n` +
    `          <mxGeometry relative="1" as="geometry" />\n` +
    `        </mxCell>`
  );
}

function wrap(name, cells) {
  return [
    '<mxfile host="atelier-diagram-studio" agent="AI Diagram Atelier" version="31.1.8" type="device">',
    `  <diagram id="${name.replace(/[^\w-]/g, '') || 'page'}-1" name="${name}">`,
    `    <mxGraphModel ${MODEL_ATTRS}>`,
    '      <root>',
    '        <mxCell id="0" />',
    '        <mxCell id="1" parent="0" />',
    cells.join('\n'),
    '      </root>',
    '    </mxGraphModel>',
    '  </diagram>',
    '</mxfile>',
  ].join('\n');
}

/* --------------------------- 1. 流程图 --------------------------- */

const flowchart = wrap('登录鉴权流程', [
  v('t1', '用户登录鉴权流程', S.title, 160, 24, 700, 40),
  v('t2', '示例图 · 可直接在右侧画布上编辑', S.sub, 160, 62, 700, 20),

  v('a', '开始', S.terminal, 440, 110, 140, 50),
  v('b', '输入账号密码', S.process, 430, 200, 160, 60),
  v('c', '校验凭据', S.decision, 440, 300, 140, 80),
  v('d', '生成 JWT 令牌', S.process, 430, 420, 160, 60),
  v('f', '写入会话缓存', S.store, 430, 520, 160, 60),
  v('g', '登录成功', S.ok, 440, 620, 140, 50),
  v('h', '失败次数 &gt; 5 ?', S.decision, 730, 300, 140, 80),
  v('i', '提示凭据错误', S.warn, 720, 200, 160, 60),
  v('j', '锁定账号 15 分钟', S.warn, 720, 420, 160, 60),

  e('e1', '', S.edge, 'a', 'b'),
  e('e2', '', S.edge, 'b', 'c'),
  e('e3', '通过', S.edge, 'c', 'd'),
  e('e4', '失败', S.edge, 'c', 'h'),
  e('e5', '否', S.edge, 'h', 'i'),
  e('e6', '是', S.edge, 'h', 'j'),
  e('e7', '重试', S.edgeDash, 'i', 'b'),
  e('e8', '', S.edge, 'd', 'f'),
  e('e9', '', S.edge, 'f', 'g'),
]);

/* --------------------------- 2. 架构图 --------------------------- */

const architecture = wrap('系统架构分层', [
  v('t1', '电商平台系统架构', S.title, 40, 24, 1160, 40),
  v('t2', '五层分层架构 · 泳道容器可整体拖动', S.sub, 40, 62, 1160, 20),

  v('L1', '接入层  Access', S.lane, 40, 100, 1160, 120),
  v('a1', 'Web 前端', S.node, 40, 54, 200, 50, 'L1'),
  v('a2', '移动 App', S.node, 280, 54, 200, 50, 'L1'),
  v('a3', '开放 API', S.node, 520, 54, 200, 50, 'L1'),
  v('a4', 'CDN / WAF', pill('#F3E8D8', '#A6813C', '#4A3413'), 760, 54, 200, 50, 'L1'),

  v('L2', '网关层  Gateway', S.lane, 40, 250, 1160, 120),
  v('b1', 'API Gateway', pill('#E8EEF7', '#4A5F8E', '#1F2937', true), 40, 54, 260, 50, 'L2'),
  v('b2', '统一鉴权 / 限流', S.node, 340, 54, 260, 50, 'L2'),
  v('b3', '灰度路由', S.node, 640, 54, 260, 50, 'L2'),

  v('L3', '业务服务层  Services', S.lane, 40, 400, 1160, 130),
  v('c1', '用户服务', S.process, 40, 54, 200, 56, 'L3'),
  v('c2', '商品服务', S.process, 280, 54, 200, 56, 'L3'),
  v('c3', '订单服务', S.process, 520, 54, 200, 56, 'L3'),
  v('c4', '支付服务', S.process, 760, 54, 200, 56, 'L3'),
  v('c5', '风控服务', S.warn, 1000, 54, 130, 56, 'L3'),

  v('L4', '数据层  Data', S.lane, 40, 560, 1160, 130),
  v('d1', 'MySQL 主从', S.store, 40, 54, 200, 56, 'L4'),
  v('d2', 'Redis 集群', S.store, 280, 54, 200, 56, 'L4'),
  v('d3', 'Elasticsearch', S.store, 520, 54, 200, 56, 'L4'),
  v('d4', 'Kafka', S.store, 760, 54, 200, 56, 'L4'),
  v('d5', 'OSS 对象存储', S.store, 1000, 54, 130, 56, 'L4'),

  v('L5', '基础设施层  Infrastructure', S.lane, 40, 720, 1160, 110),
  v('f1', 'Kubernetes', S.node, 40, 50, 260, 44, 'L5'),
  v('f2', '可观测性 (Prometheus / Grafana)', S.node, 340, 50, 380, 44, 'L5'),
  v('f3', 'CI / CD Pipeline', S.node, 760, 50, 260, 44, 'L5'),

  e('x1', '', S.edge, 'L1', 'L2'),
  e('x2', '', S.edge, 'L2', 'L3'),
  e('x3', '', S.edge, 'L3', 'L4'),
  e('x4', '异步事件', S.edgeDash, 'c3', 'd4'),
]);

/* -------------------------- 3. 思维导图 -------------------------- */

const mindmap = wrap('产品增长思维导图', [
  v('t1', '产品增长策略', S.title, 340, 24, 620, 40),

  v('root', '产品增长', S.center, 550, 350, 200, 64),

  v('r1', '获客 Acquisition', pill('#E8EEF7', '#4A5F8E', '#1F2937', true), 830, 180, 180, 48),
  v('r2', '转化 Conversion', pill('#F3E8D8', '#A6813C', '#4A3413', true), 830, 300, 180, 48),
  v('r3', '留存 Retention', pill('#E4EFE4', '#6F9268', '#24351F', true), 830, 420, 180, 48),
  v('r4', '变现 Revenue', pill('#EAE6F2', '#7C6BA0', '#2E2542', true), 830, 540, 180, 48),

  v('l1', '内容 SEO', pill('#F7F5F1', '#B9B3A7', '#4A4F58', true), 290, 220, 180, 48),
  v('l2', '私域运营', pill('#F7F5F1', '#B9B3A7', '#4A4F58', true), 290, 340, 180, 48),
  v('l3', '数据度量', pill('#F7F5F1', '#B9B3A7', '#4A4F58', true), 290, 460, 180, 48),

  v('r1a', '投放渠道矩阵', S.node, 1060, 150, 170, 38),
  v('r1b', '邀请裂变', S.node, 1060, 198, 170, 38),
  v('r2a', '落地页 A/B 测试', S.node, 1060, 276, 170, 38),
  v('r2b', '注册漏斗优化', S.node, 1060, 324, 170, 38),
  v('r3a', 'Push / 邮件召回', S.node, 1060, 396, 170, 38),
  v('r3b', '会员权益体系', S.node, 1060, 444, 170, 38),
  v('r4a', '订阅制定价', S.node, 1060, 516, 170, 38),
  v('r4b', 'LTV / CAC 建模', S.node, 1060, 564, 170, 38),

  v('l1a', '关键词布局', S.node, 70, 196, 170, 38),
  v('l1b', '外链建设', S.node, 70, 244, 170, 38),
  v('l2a', '社群分层', S.node, 70, 316, 170, 38),
  v('l2b', '内容日历', S.node, 70, 364, 170, 38),
  v('l3a', '北极星指标', S.node, 70, 436, 170, 38),
  v('l3b', '归因分析', S.node, 70, 484, 170, 38),

  e('m1', '', S.mmEdgeR + 'strokeColor=#4A5F8E;', 'root', 'r1'),
  e('m2', '', S.mmEdgeR + 'strokeColor=#A6813C;', 'root', 'r2'),
  e('m3', '', S.mmEdgeR + 'strokeColor=#6F9268;', 'root', 'r3'),
  e('m4', '', S.mmEdgeR + 'strokeColor=#7C6BA0;', 'root', 'r4'),
  e('m5', '', S.mmEdgeL + 'strokeColor=#B9B3A7;', 'root', 'l1'),
  e('m6', '', S.mmEdgeL + 'strokeColor=#B9B3A7;', 'root', 'l2'),
  e('m7', '', S.mmEdgeL + 'strokeColor=#B9B3A7;', 'root', 'l3'),

  e('m11', '', S.mmEdgeR + 'strokeColor=#8FA3C8;strokeWidth=1.4;', 'r1', 'r1a'),
  e('m12', '', S.mmEdgeR + 'strokeColor=#8FA3C8;strokeWidth=1.4;', 'r1', 'r1b'),
  e('m21', '', S.mmEdgeR + 'strokeColor=#CBAE79;strokeWidth=1.4;', 'r2', 'r2a'),
  e('m22', '', S.mmEdgeR + 'strokeColor=#CBAE79;strokeWidth=1.4;', 'r2', 'r2b'),
  e('m31', '', S.mmEdgeR + 'strokeColor=#9CBE95;strokeWidth=1.4;', 'r3', 'r3a'),
  e('m32', '', S.mmEdgeR + 'strokeColor=#9CBE95;strokeWidth=1.4;', 'r3', 'r3b'),
  e('m41', '', S.mmEdgeR + 'strokeColor=#A896C4;strokeWidth=1.4;', 'r4', 'r4a'),
  e('m42', '', S.mmEdgeR + 'strokeColor=#A896C4;strokeWidth=1.4;', 'r4', 'r4b'),
  e('m51', '', S.mmEdgeL + 'strokeColor=#CBC6BB;strokeWidth=1.4;', 'l1', 'l1a'),
  e('m52', '', S.mmEdgeL + 'strokeColor=#CBC6BB;strokeWidth=1.4;', 'l1', 'l1b'),
  e('m61', '', S.mmEdgeL + 'strokeColor=#CBC6BB;strokeWidth=1.4;', 'l2', 'l2a'),
  e('m62', '', S.mmEdgeL + 'strokeColor=#CBC6BB;strokeWidth=1.4;', 'l2', 'l2b'),
  e('m71', '', S.mmEdgeL + 'strokeColor=#CBC6BB;strokeWidth=1.4;', 'l3', 'l3a'),
  e('m72', '', S.mmEdgeL + 'strokeColor=#CBC6BB;strokeWidth=1.4;', 'l3', 'l3b'),
]);

/* --------------------------- 4. 空白页 --------------------------- */

const blank = wrap('空白画布', [
  v('t1', '双击画布空白处即可添加图形，或直接在左侧告诉 AI 你想画什么', S.sub, 300, 300, 700, 30),
]);

const SAMPLES = {
  flowchart: { key: 'flowchart', label: '流程图', desc: '登录鉴权流程 · 含判断分支与异常路径', xml: flowchart },
  architecture: { key: 'architecture', label: '架构图', desc: '五层分层架构 · 泳道容器', xml: architecture },
  mindmap: { key: 'mindmap', label: '思维导图', desc: '产品增长策略 · 左右对称辐射', xml: mindmap },
  blank: { key: 'blank', label: '空白画布', desc: '从零开始', xml: blank },
};

module.exports = { SAMPLES, STYLES: S };
