'use strict';

/**
 * Diagram Atelier — 中文语义理解（零依赖）
 *
 * 职责：把用户口语化 / 简略的中文描述，识别为「图类型意图」与「业务实体候选」。
 * 用途：
 *   1. 输入框实时联想 —— 用户打字时高亮类型条上推断的图类型（.chip.inferred）。
 *   2. 提示词增强 —— 让 AI 在生成前先理解中文诉求，输出中文标签图。
 *
 * 设计：纯词典 + 加权子串计分，无模型、无依赖、可离线、可在 Node 与浏览器双侧运行。
 *
 * 注意：本文件同时被浏览器（index.html 引用 ./semantic.js = public/semantic.js）
 * 与 Node（测试 / 未来服务端语义增强，经 lib/semantic.js 再导出）加载，
 * 因此必须保持「单一真相来源」，改动请同步两者。
 */

/* 关键词分两档：
 *   strong —— 明确的「图类型原名」或高区分度词，权重高，决定主意图；
 *   weak   —— 业务/上下文词（如「登录」「支付」「数据库」），可能跨类型出现，权重低，仅作辅助。 */
const TYPE_KEYWORDS = {
  flowchart: {
    strong: ['流程图', '流程', '步骤图', '工作流', '业务流'],
    weak: ['步骤', '审批', '流转', '环节', '下单', '发货', '退款', '退货', '登录', '注册', '支付', '办理', '报销', '提现', '入库', '出库', '审核', '排班', '请假'],
  },
  architecture: {
    strong: ['架构图', '架构', '系统架构', '微服务', '拓扑', '云架构', '系统拓扑'],
    weak: ['分布式', '技术栈', '部署', '服务端', '后端', '前端', '组件', '模块', '平台架构', '基础设施', '中台', '网关'],
  },
  mindmap: {
    strong: ['思维导图', '脑图', '心智图', '概念图'],
    weak: ['梳理', '总结', '要点', '清单', 'checklist', '发散', '结构化', '归纳', '回顾', '复盘', '知识树', '大纲'],
  },
  sequence: {
    strong: ['时序图', '序列图', '顺序图'],
    weak: ['交互', '调用链', '消息流', '请求响应', 'api调用', '调用关系', '报文', '请求-响应', '接口交互', '握手'],
  },
  er: {
    strong: ['er图', 'er 图', '实体关系', '数据库设计', '类图'],
    weak: ['表结构', '关系图', '数据模型', '实体', '数据库', '建表', 'er关系'],
  },
};

const TYPE_LABELS = {
  flowchart: '流程图',
  architecture: '架构图',
  mindmap: '思维导图',
  sequence: '时序图',
  er: 'ER 图',
  auto: '自动判断',
};

function normalizeText(t) {
  return String(t || '').toLowerCase().replace(/\s+/g, '');
}

/**
 * 识别图类型意图（强词权重 3、弱词权重 1）。
 * @param {string} text 用户描述
 * @returns {{type:string,label:string,score:number,matched:string[]}}
 *   type 为 'auto' 表示未识别到明确类型。
 */
function detectIntent(text) {
  const t = normalizeText(text);
  if (!t) return { type: 'auto', label: TYPE_LABELS.auto, score: 0, matched: [] };
  let best = { type: 'auto', label: TYPE_LABELS.auto, score: 0, matched: [] };
  for (const type of Object.keys(TYPE_KEYWORDS)) {
    const cfg = TYPE_KEYWORDS[type];
    let score = 0;
    const matched = [];
    for (const kw of cfg.strong) {
      const k = kw.toLowerCase();
      if (t.includes(k)) { score += 3; matched.push(kw); }
    }
    for (const kw of cfg.weak) {
      const k = kw.toLowerCase();
      if (t.includes(k)) { score += 1; matched.push(kw); }
    }
    if (score > best.score) best = { type, label: TYPE_LABELS[type], score, matched };
  }
  return best.score > 0 ? best : { type: 'auto', label: TYPE_LABELS.auto, score: 0, matched: [] };
}

/**
 * 从中文描述抽取业务实体候选（轻量：停用词 + 标点/连词切分后的短片段）。
 * 用于提示图里「应该出现哪些节点」。
 * @param {string} text
 * @returns {string[]}
 */
function extractHints(text) {
  const t = String(text || '');
  if (!t) return [];
  const segs = t
    .split(/[，。；、,.;\s与及和/：:包含有等]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const stop = /^(的|了|吗|呢|吧|请|帮我|画|一个|一张|生成|设计|梳理|做|来|张|份|要|需要|我想|给我|这|那)$/;
  const hints = [];
  for (const s of segs) {
    if (stop.test(s)) continue;
    if (s.length >= 2 && s.length <= 12) hints.push(s);
  }
  return Array.from(new Set(hints)).slice(0, 12);
}

const api = { TYPE_KEYWORDS, TYPE_LABELS, detectIntent, extractHints, normalizeText };

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.DiagramSemantic = api;
