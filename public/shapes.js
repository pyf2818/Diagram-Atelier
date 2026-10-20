/* ════════════════════════════════════════════════════════════════
   Diagram Atelier · 专业图形库（云架构图标集）
   用 shape=atos:<id> 约定引用。render.js 把 atos:<id> 映射为本地图标
   的 SVG（data: URL 内嵌），AI 生成与手动插入都走同一套。
   暴露：window.DiagramShapes（前端）/ module.exports（后端 Node 校验）
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // 品牌色（与工作台调色板协调）
  const C = {
    blue: '#3B82C4',   // 云 / 容器
    indigo: '#4A5F8E', // K8s / AI
    purple: '#7C6BA0', // 数据
    teal: '#2E8B9E',   // 网络
    green: '#4F9D69',  // 服务
    brass: '#C9A961',  // 身份
    rust: '#C0623E',   // 运维 / 安全
    slate: '#5B7DB1',  // 商业 / 办公
    amber: '#B08325',  // 电气 / 能源
  };

  const wrap = (color, inner) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

  const ICONS = [
    // ── 云与容器 ──
    {
      id: 'cloud', label: '云', category: 'cloud', color: C.blue,
      keywords: ['cloud', '云', '公有云', 'saas'],
      svg: wrap(C.blue, '<path d="M7 18a4 4 0 0 1 .5-7.97A5 5 0 0 1 17 9.5 3.5 3.5 0 0 1 16.5 18z"/>'),
    },
    {
      id: 'server', label: '服务器', category: 'cloud', color: C.blue,
      keywords: ['server', '服务器', 'vm', '主机', 'ecs'],
      svg: wrap(C.blue, '<rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><circle cx="8" cy="7.5" r="0.9"/><circle cx="8" cy="16.5" r="0.9"/><line x1="12" y1="7.5" x2="16" y2="7.5"/><line x1="12" y1="16.5" x2="16" y2="16.5"/>'),
    },
    {
      id: 'kubernetes', label: 'Kubernetes', category: 'cloud', color: C.indigo,
      keywords: ['k8s', 'kubernetes', '容器编排', '集群'],
      svg: wrap(C.indigo, '<path d="M12 3l7.5 4.3v8.6L12 21l-7.5-4.1V7.3z"/><circle cx="12" cy="12" r="2.6"/><path d="M12 9.4V5.4M12 14.6v4M14.5 10.8l4.2-2.4M9.5 13.2l-4.2 2.4M14.5 13.2l4.2 2.4M9.5 10.8l-4.2-2.4"/>'),
    },
    // ── 数据 ──
    {
      id: 'database', label: '数据库', category: 'data', color: C.purple,
      keywords: ['database', '数据库', 'db', 'rds', 'mysql', 'pg'],
      svg: wrap(C.purple, '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6"/><path d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3"/>'),
    },
    {
      id: 'storage', label: '对象存储', category: 'data', color: C.purple,
      keywords: ['storage', 'bucket', 's3', '对象存储', 'oss', 'cos'],
      svg: wrap(C.purple, '<path d="M5 7l2-3h10l2 3"/><rect x="5" y="7" width="14" height="13" rx="1.5"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="13" y2="15"/>'),
    },
    {
      id: 'queue', label: '消息队列', category: 'data', color: C.purple,
      keywords: ['queue', 'kafka', 'mq', '消息队列', '消息'],
      svg: wrap(C.purple, '<rect x="3" y="8" width="5" height="8" rx="1"/><rect x="9.5" y="8" width="5" height="8" rx="1"/><rect x="16" y="8" width="5" height="8" rx="1"/><path d="M8 12h1.5M14.5 12h1.5"/>'),
    },
    // ── 网络 ──
    {
      id: 'apigw', label: 'API 网关', category: 'network', color: C.teal,
      keywords: ['api', 'gateway', '网关', 'apigw', 'ingress'],
      svg: wrap(C.teal, '<rect x="3" y="9" width="18" height="6" rx="3"/><path d="M5 12h2M17 12h2M9 10l3 2-3 2M15 10l-3 2 3 2"/>'),
    },
    {
      id: 'cdn', label: 'CDN', category: 'network', color: C.teal,
      keywords: ['cdn', '边缘', '分发', '加速'],
      svg: wrap(C.teal, '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/>'),
    },
    {
      id: 'firewall', label: '防火墙', category: 'network', color: C.rust,
      keywords: ['firewall', '防火墙', '安全组', 'waf'],
      svg: wrap(C.rust, '<path d="M4 8h16M4 16h16M9 4v4M15 4v4M6 8v8M12 8v8M18 8v8M9 12v4M15 12v4"/>'),
    },
    // ── 服务 ──
    {
      id: 'web', label: 'Web 应用', category: 'service', color: C.green,
      keywords: ['web', '网站', '前端', 'browser', '应用'],
      svg: wrap(C.green, '<rect x="3" y="5" width="18" height="14" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><circle cx="6" cy="7" r="0.7"/><circle cx="8.5" cy="7" r="0.7"/><path d="M9 13l2 2 4-4"/>'),
    },
    {
      id: 'micro', label: '微服务', category: 'service', color: C.green,
      keywords: ['micro', 'microservice', '微服务', 'service'],
      svg: wrap(C.green, '<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="12" cy="18" r="2.2"/><path d="M7.7 7.2 11 16M16.3 7.2 13 16M8.2 6h7.6"/>'),
    },
    {
      id: 'lambda', label: '函数计算', category: 'service', color: C.brass,
      keywords: ['lambda', 'function', '函数', 'serverless', '无服务器'],
      svg: wrap(C.brass, '<path d="M6 5 11 19 17 5M11 5 8 19"/>'),
    },
    // ── 身份 ──
    {
      id: 'user', label: '用户', category: 'identity', color: C.brass,
      keywords: ['user', '用户', '人', 'person', 'client'],
      svg: wrap(C.brass, '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-4 3.5-6 7-6s7 2 7 6"/>'),
    },
    {
      id: 'lock', label: '安全', category: 'identity', color: C.brass,
      keywords: ['lock', 'security', '安全', '加密', 'auth'],
      svg: wrap(C.brass, '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1.2"/>'),
    },
    {
      id: 'group', label: '用户组', category: 'identity', color: C.brass,
      keywords: ['group', '团队', '组织', 'org', 'iam'],
      svg: wrap(C.brass, '<circle cx="9" cy="9" r="2.6"/><path d="M4 19c0-3 2.4-4.5 5-4.5s5 1.5 5 4.5"/><circle cx="17" cy="10" r="2.1"/><path d="M15 19c0-2 1.4-3.5 4-3.5"/>'),
    },
    // ── 运维 ──
    {
      id: 'monitor', label: '监控', category: 'ops', color: C.rust,
      keywords: ['monitor', '监控', 'metrics', 'dashboard', '观测'],
      svg: wrap(C.rust, '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4"/><path d="M6.5 13l3-3 2.5 2 4-5"/>'),
    },
    {
      id: 'pipeline', label: '流水线', category: 'ops', color: C.rust,
      keywords: ['pipeline', 'ci', 'cd', '流水线', '构建'],
      svg: wrap(C.rust, '<circle cx="5" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M7.2 12h1.6M15.2 12h1.6"/>'),
    },
    {
      id: 'log', label: '日志', category: 'ops', color: C.rust,
      keywords: ['log', '日志', 'logging', '记录'],
      svg: wrap(C.rust, '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
    },
    // ── 智能 ──
    {
      id: 'ai', label: 'AI / ML', category: 'ai', color: C.indigo,
      keywords: ['ai', 'ml', '智能', '模型', '推理', '训练'],
      svg: wrap(C.indigo, '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/><circle cx="12" cy="12" r="2.4"/>'),
    },
    {
      id: 'msg', label: '消息', category: 'ai', color: C.indigo,
      keywords: ['message', '消息', 'chat', '通知', 'notify'],
      svg: wrap(C.indigo, '<path d="M5 5h14v10H10l-4 4v-4H5z"/><line x1="8" y1="9" x2="15" y2="9"/><line x1="8" y1="12" x2="13" y2="12"/>'),
    },
    {
      id: 'mail', label: '邮件', category: 'ai', color: C.indigo,
      keywords: ['mail', 'email', '邮件', '通知'],
      svg: wrap(C.indigo, '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M4 8l8 6 8-6"/>'),
    },
    // ── 云与容器（扩充）──
    {
      id: 'container', label: '容器', category: 'cloud', color: C.blue,
      keywords: ['container', '容器', 'docker', 'pod'],
      svg: wrap(C.blue, '<rect x="4" y="7" width="7" height="5" rx="1"/><rect x="13" y="7" width="7" height="5" rx="1"/><rect x="8.5" y="14" width="7" height="5" rx="1"/>'),
    },
    {
      id: 'loadbalancer', label: '负载均衡', category: 'cloud', color: C.blue,
      keywords: ['lb', 'loadbalancer', '负载均衡', 'slb', '流量分发'],
      svg: wrap(C.blue, '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v4M12 11H5v6M12 11v6M12 11h7v6"/>'),
    },
    {
      id: 'dns', label: 'DNS', category: 'cloud', color: C.blue,
      keywords: ['dns', '域名', '解析', 'nameserver'],
      svg: wrap(C.blue, '<circle cx="7" cy="12" r="3"/><circle cx="17" cy="12" r="3"/><path d="M10 12h4"/>'),
    },
    // ── 数据（扩充）──
    {
      id: 'cache', label: '缓存', category: 'data', color: C.purple,
      keywords: ['cache', '缓存', 'redis', 'memcached', '提速'],
      svg: wrap(C.purple, '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M13 7l-4 6h3l-1 4 4-6h-3z"/>'),
    },
    {
      id: 'warehouse', label: '数据仓库', category: 'data', color: C.purple,
      keywords: ['warehouse', '数仓', 'datalake', '湖仓', 'olap'],
      svg: wrap(C.purple, '<path d="M4 21V8l8-4 8 4v13"/><path d="M4 12h16M9 8v13M15 8v13"/>'),
    },
    // ── 网络（扩充）──
    {
      id: 'router', label: '路由器', category: 'network', color: C.teal,
      keywords: ['router', '路由', '网关', '交换机', 'vpc'],
      svg: wrap(C.teal, '<rect x="3" y="10" width="18" height="8" rx="1.5"/><circle cx="7" cy="14" r="1"/><circle cx="11" cy="14" r="1"/><path d="M14 14h4M9 10V6M15 10V6"/>'),
    },
    {
      id: 'proxy', label: '代理', category: 'network', color: C.teal,
      keywords: ['proxy', '代理', '反向代理', 'nginx', '转发'],
      svg: wrap(C.teal, '<rect x="3" y="8" width="6" height="8" rx="1"/><rect x="15" y="8" width="6" height="8" rx="1"/><path d="M9 12h6M13 9l3 3-3 3"/>'),
    },
    // ── 服务（扩充）──
    {
      id: 'cron', label: '定时任务', category: 'service', color: C.green,
      keywords: ['cron', 'schedule', '定时', '调度', 'job'],
      svg: wrap(C.green, '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2M12 4v2M12 18v2"/>'),
    },
    {
      id: 'worker', label: '工作进程', category: 'service', color: C.green,
      keywords: ['worker', '进程', '后台', 'consumer', 'job'],
      svg: wrap(C.green, '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.5 5.5l2 2M16.5 16.5l2 2M18.5 5.5l-2 2M7.5 16.5l-2 2"/>'),
    },
    // ── 身份与安全（扩充）──
    {
      id: 'iam', label: 'IAM 角色', category: 'identity', color: C.brass,
      keywords: ['iam', '角色', '权限', '策略', 'rbac'],
      svg: wrap(C.brass, '<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/><path d="M9 12l2 2 4-4"/>'),
    },
    {
      id: 'key', label: '密钥', category: 'identity', color: C.brass,
      keywords: ['key', '密钥', '凭证', 'token', 'secret', 'apikey'],
      svg: wrap(C.brass, '<circle cx="8" cy="8" r="4"/><path d="M11 11l8 8M16 16l2-2M14 18l2-2"/>'),
    },
    // ── 运维与观测（扩充）──
    {
      id: 'alert', label: '告警', category: 'ops', color: C.rust,
      keywords: ['alert', '告警', '报警', '通知', 'incident'],
      svg: wrap(C.rust, '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    },
    {
      id: 'trace', label: '链路追踪', category: 'ops', color: C.rust,
      keywords: ['trace', '链路', '拓扑', 'span', '调用链', 'observability'],
      svg: wrap(C.rust, '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M6.5 7.5 11 16M17.5 7.5 13 16M7 6h10"/>'),
    },
    // ── 智能与通信（扩充）──
    {
      id: 'vector', label: '向量库', category: 'ai', color: C.indigo,
      keywords: ['vector', '向量', 'embedding', '向量数据库', 'pinecone'],
      svg: wrap(C.indigo, '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9h16M4 14h16M9 4v16M14 4v16"/>'),
    },
    {
      id: 'rag', label: '知识库', category: 'ai', color: C.indigo,
      keywords: ['rag', '知识库', '检索', '文档', 'kb', 'retrieval'],
      svg: wrap(C.indigo, '<path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3z"/><path d="M5 4v16"/>'),
    },
    {
      id: 'mlmodel', label: '模型服务', category: 'ai', color: C.indigo,
      keywords: ['model', '模型', '推理', 'llm', 'serving', '大模型'],
      svg: wrap(C.indigo, '<path d="M9 5a3 3 0 0 0-3 3 3 3 0 0 0-1 5 3 3 0 0 0 4 4 3 3 0 0 0 5 0 3 3 0 0 0 4-4 3 3 0 0 0-1-5 3 3 0 0 0-3-3 3 3 0 0 0-5 0z"/><path d="M12 5v14M9 9h6M9 14h6"/>'),
    },
    // ── 终端与设备 ──
    {
      id: 'laptop', label: '笔记本', category: 'device', color: C.teal,
      keywords: ['laptop', '笔记本', '电脑', '终端', 'client'],
      svg: wrap(C.teal, '<rect x="4" y="6" width="16" height="11" rx="1.5"/><path d="M2 19h20"/><path d="M10 17h4"/>'),
    },
    {
      id: 'desktop', label: '台式机', category: 'device', color: C.teal,
      keywords: ['desktop', '台式机', '显示器', 'pc', 'monitor'],
      svg: wrap(C.teal, '<rect x="4" y="4" width="16" height="11" rx="1"/><path d="M9 19h6M12 15v4"/>'),
    },
    {
      id: 'mobile', label: '手机', category: 'device', color: C.teal,
      keywords: ['mobile', '手机', 'phone', 'app', '客户端'],
      svg: wrap(C.teal, '<rect x="8" y="3" width="8" height="18" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/>'),
    },
    {
      id: 'tablet', label: '平板', category: 'device', color: C.teal,
      keywords: ['tablet', '平板', 'ipad', 'pad'],
      svg: wrap(C.teal, '<rect x="3" y="6" width="18" height="12" rx="2"/><line x1="11" y1="16" x2="13" y2="16"/>'),
    },
    {
      id: 'printer', label: '打印机', category: 'device', color: C.teal,
      keywords: ['printer', '打印机', '打印', '输出'],
      svg: wrap(C.teal, '<rect x="5" y="9" width="14" height="9" rx="1"/><path d="M8 9V5h8v4"/><rect x="8" y="12" width="8" height="3" rx="0.5"/>'),
    },
    {
      id: 'sensor', label: '传感器', category: 'device', color: C.teal,
      keywords: ['sensor', '传感器', 'iot', '物联网', '设备', '采集'],
      svg: wrap(C.teal, '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.5 5.5l2 2M16.5 16.5l2 2M18.5 5.5l-2 2M7.5 16.5l-2 2"/>'),
    },
    // ── 集成与接口 ──
    {
      id: 'rest', label: 'REST API', category: 'integration', color: C.indigo,
      keywords: ['rest', 'api', 'http', '接口', 'restful'],
      svg: wrap(C.indigo, '<rect x="3" y="9" width="18" height="6" rx="3"/><path d="M6 12h2M16 12h2"/><circle cx="12" cy="12" r="1"/>'),
    },
    {
      id: 'grpc', label: 'gRPC', category: 'integration', color: C.indigo,
      keywords: ['grpc', 'rpc', '微服务', '接口', 'protobuf'],
      svg: wrap(C.indigo, '<circle cx="12" cy="12" r="8"/><path d="M5 19 19 5M19 19 5 5"/><circle cx="12" cy="12" r="2.6"/>'),
    },
    {
      id: 'graphql', label: 'GraphQL', category: 'integration', color: C.indigo,
      keywords: ['graphql', '接口', 'api', '查询'],
      svg: wrap(C.indigo, '<circle cx="12" cy="12" r="8"/><path d="M12 5 18.5 16 5.5 16z"/>'),
    },
    {
      id: 'webhook', label: 'Webhook', category: 'integration', color: C.indigo,
      keywords: ['webhook', '回调', '事件', '通知', 'hook'],
      svg: wrap(C.indigo, '<path d="M5 9a7 7 0 0 1 12-3l2 2"/><path d="M19 15a7 7 0 0 1-12 3l-2-2"/><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="18" r="1.6"/>'),
    },
    {
      id: 'websocket', label: 'WebSocket', category: 'integration', color: C.indigo,
      keywords: ['websocket', 'ws', '实时', '推送', '长连接'],
      svg: wrap(C.indigo, '<path d="M3 12h3l2-5 3 10 3-10 2 5h3"/>'),
    },
    {
      id: 'sdk', label: 'SDK/客户端', category: 'integration', color: C.indigo,
      keywords: ['sdk', '客户端', '代码', '集成', 'library'],
      svg: wrap(C.indigo, '<rect x="4" y="6" width="16" height="12" rx="1.5"/><path d="M9 10l-2 2 2 2M15 10l2 2-2 2M12 9v6"/>'),
    },
    // ── 商业与办公 ──
    {
      id: 'doc', label: '文档', category: 'business', color: C.slate,
      keywords: ['doc', 'document', '文档', '文件', '报告', '说明'],
      svg: wrap(C.slate, '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>'),
    },
    {
      id: 'report', label: '报表', category: 'business', color: C.slate,
      keywords: ['report', '报表', '图表', '统计', '数据看板', 'bi'],
      svg: wrap(C.slate, '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 15v-4M12 15V8M16 15v-2"/>'),
    },
    {
      id: 'money', label: '资金', category: 'business', color: C.slate,
      keywords: ['money', '资金', '支付', '财务', '结算', '账户'],
      svg: wrap(C.slate, '<circle cx="12" cy="12" r="8"/><path d="M9 8l3 4 3-4M12 12v6M9.5 13.5h5M9.5 15.5h5"/>'),
    },
    {
      id: 'meeting', label: '会议', category: 'business', color: C.slate,
      keywords: ['meeting', '会议', '评审', '讨论', '协作', '视频会'],
      svg: wrap(C.slate, '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M7 21h10M12 17v4"/><circle cx="9" cy="9.5" r="1.8"/><circle cx="15" cy="9.5" r="1.8"/>'),
    },
    {
      id: 'org', label: '组织架构', category: 'business', color: C.slate,
      keywords: ['org', '组织', '架构', '部门', '汇报线', ' hierarchy'],
      svg: wrap(C.slate, '<rect x="9" y="3" width="6" height="4" rx="1"/><rect x="2.5" y="17" width="6" height="4" rx="1"/><rect x="15.5" y="17" width="6" height="4" rx="1"/><path d="M12 7v3M5.5 17v-4h13v4M12 10v7"/>'),
    },
    {
      id: 'contract', label: '合同签批', category: 'business', color: C.slate,
      keywords: ['contract', '合同', '签批', '审批', 'oa', '用印'],
      svg: wrap(C.slate, '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 18l2 1 4.5-4.5a1.4 1.4 0 0 0-2-2L9 17z"/>'),
    },
    // ── 电气与能源 ──
    {
      id: 'battery', label: '电池', category: 'electrical', color: C.amber,
      keywords: ['battery', '电池', 'ups', '储能', 'bms'],
      svg: wrap(C.amber, '<rect x="2.5" y="9" width="17" height="7" rx="1.5"/><path d="M21.5 11.5v2M6.5 12.5h3M12 12.5h3"/>'),
    },
    {
      id: 'power', label: '电网/电站', category: 'electrical', color: C.amber,
      keywords: ['power', '电网', '电站', '高压', '配电', 'energy'],
      svg: wrap(C.amber, '<path d="M13 3 5 13h5l-1 8 8-11h-5z"/>'),
    },
    {
      id: 'motor', label: '电机', category: 'electrical', color: C.amber,
      keywords: ['motor', '电机', '马达', '驱动', '设备'],
      svg: wrap(C.amber, '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 5V2.5M12 21.5V19M5 12H2.5M21.5 12H19"/>'),
    },
    {
      id: 'switch', label: '开关', category: 'electrical', color: C.amber,
      keywords: ['switch', '开关', '断路器', '继电器', '回路'],
      svg: wrap(C.amber, '<circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h10M12 4v3M12 17v3"/>'),
    },
    {
      id: 'solar', label: '光伏', category: 'electrical', color: C.amber,
      keywords: ['solar', '光伏', '太阳能', '面板', '新能源'],
      svg: wrap(C.amber, '<rect x="4" y="4" width="16" height="11" rx="1"/><path d="M4 9.5h16M9.3 4v11M14.6 4v11M12 15v4M8 21h8"/>'),
    },
    {
      id: 'chip', label: '芯片/PLC', category: 'electrical', color: C.amber,
      keywords: ['chip', '芯片', 'plc', '控制器', '单片机', 'mcu'],
      svg: wrap(C.amber, '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 7V3M14 7V3M10 21v-4M14 21v-4M7 10H3M7 14H3M21 10h-4M21 14h-4"/>'),
    },
  ];

  const CATEGORIES = [
    { id: 'cloud', label: '云与容器' },
    { id: 'data', label: '数据' },
    { id: 'network', label: '网络' },
    { id: 'service', label: '服务' },
    { id: 'identity', label: '身份与安全' },
    { id: 'ops', label: '运维与观测' },
    { id: 'ai', label: '智能与通信' },
    { id: 'device', label: '终端与设备' },
    { id: 'integration', label: '集成与接口' },
    { id: 'business', label: '商业与办公' },
    { id: 'electrical', label: '电气与能源' },
    { id: 'custom', label: '我的图标' },
  ];

  /* ─── 用户自定义图标（localStorage 持久化）─── */
  const CUSTOM_KEY = 'atelier.shapes.custom.v1';
  let customList = [];
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage && window.localStorage.getItem(CUSTOM_KEY);
      const arr = raw && JSON.parse(raw);
      if (Array.isArray(arr)) customList = arr.filter((i) => i && i.id && i.svg);
    } catch (e) { customList = []; }
  }

  function persistCustom() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try { window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(customList)); } catch (e) {}
  }

  // 基础清洗：剔除脚本 / foreignObject / 事件属性 / javascript: 伪协议，
  // 补 xmlns 与 viewBox，保证可安全作为 <img> 或 SVG <image> 渲染。
  function sanitizeSvg(input) {
    if (typeof input !== 'string') return null;
    let s = input.trim();
    if (!/<svg[\s>]/i.test(s)) return null;
    s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
    s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
    s = s.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
    s = s.replace(/\son\w+\s*=\s*'[^']*'/gi, '');
    s = s.replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=""');
    if (!/xmlns\s*=/.test(s)) s = s.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    if (!/viewBox\s*=/.test(s)) {
      const w = s.match(/<svg[^>]*\bwidth\s*=\s*["']?\s*([\d.]+)/i);
      const h = s.match(/<svg[^>]*\bheight\s*=\s*["']?\s*([\d.]+)/i);
      if (w && h) s = s.replace(/<svg/i, '<svg viewBox="0 0 ' + w[1] + ' ' + h[1] + '"');
      else s = s.replace(/<svg/i, '<svg viewBox="0 0 24 24"');
    }
    return s;
  }

  function slugify(s) {
    return String(s || '').trim().toLowerCase()
      .replace(/[^a-z0-9一-龥]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'icon';
  }

  function addCustom(def) {
    if (!def || typeof def !== 'object') return { ok: false, error: '参数无效' };
    const label = String(def.label || '').trim();
    if (!label) return { ok: false, error: '请填写图标名称' };
    const svg = sanitizeSvg(def.svg);
    if (!svg) return { ok: false, error: 'SVG 内容无效（需以 <svg 开头，且不含脚本）' };
    const base = 'custom:' + slugify(label);
    let id = base, n = 1;
    const taken = {};
    ICONS.concat(customList).forEach((i) => { taken[i.id] = true; });
    while (taken[id]) { n++; id = base + '-' + n; }
    const rec = {
      id,
      label,
      category: 'custom',
      color: (def.color || C.brass),
      keywords: Array.isArray(def.keywords) ? def.keywords : [label],
      svg,
      createdAt: Date.now(),
    };
    customList.unshift(rec);
    persistCustom();
    return { ok: true, id, rec };
  }

  function removeCustom(id) {
    if (!id || id.indexOf('custom:') !== 0) return false;
    const before = customList.length;
    customList = customList.filter((i) => i.id !== id);
    if (customList.length !== before) { persistCustom(); return true; }
    return false;
  }

  function listCustom() { return customList.slice(); }

  // 合并内建 + 自定义，供面板 / 渲染器统一查找（render.js 走 atos:<id>）
  function mergedById() {
    const m = {};
    ICONS.forEach((i) => { m[i.id] = i; });
    customList.forEach((i) => { m[i.id] = i; });
    return m;
  }

  function getSvg(id) {
    const it = mergedById()[id];
    return it ? it.svg : null;
  }

  function getImageUrl(id) {
    const svg = getSvg(id);
    if (!svg) return null;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  const LIB = {
    categories: CATEGORIES,
    get icons() { return ICONS.concat(customList); },
    get byId() { return mergedById(); },
    get count() { return ICONS.length + customList.length; },
    getSvg,
    getImageUrl,
    addCustom,
    removeCustom,
    listCustom,
  };

  if (typeof window !== 'undefined') window.DiagramShapes = LIB;
  if (typeof module !== 'undefined' && module.exports) module.exports = LIB;
})();
