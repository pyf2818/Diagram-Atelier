# Diagram Atelier · 智能绘图工作台 — 市场同类产品调研与对比评估报告

> 调研日期：2026-08-18 · 目的：量化本项目与 2026 年主流同类产品的差距，给出优化优先级
> 评估范围：AI 原生绘图 / 可编辑白板 / 代码即图 / AI Agent 工作流 四大类共 15+ 产品

---

## 一、执行摘要（TL;DR）

**结论先说：** Diagram Atelier 在「零依赖离线架构 + draw.io 兼容 + 专业图形库 + 智能诊断」这条差异化主线上已经做到世界一流，但在 2026 年行业最关键的两条主航道上明显掉队——

1. **AI Agent / MCP 集成**（行业头号趋势）：我们只有"侧边栏聊天式 AI"，没有把"绘图能力"做成可被 Cursor / Claude Code 等外部 Agent 调用的标准协议。draw.io 官方已发布 `@drawio/mcp`，tldraw / Excalidraw 的 MCP 生态已成型。
2. **实时多人协作 + 云端账号/团队/模板社区**：我们只有"分享只读 + 移动端查看"，没有 CRDT/OT 实时共编，没有组织/团队/模板市场。

**综合成熟度评分（10 维度加权，满分 100）：**

| 产品 | 评分 | 定位 |
|---|---|---|
| Miro / tldraw | ~88 | 企业级实时白板天花板 |
| 亿图 EdrawMax / ProcessOn | ~82 | 国内全功能 + 中文语义 + 模板生态 |
| **Diagram Atelier（当前）** | **~63** | **离线零依赖 + 专业图形 + AI 助手，缺协作/MCP** |
| Mermaid / Eraser / D2 | ~71 | 代码即图，开发者向，非可视化编辑器 |

> 差距不是"差一个数量级"，而是**差在 2 个战略维度 + 3 个体验维度**。补上后（见第六章路线图）可摸高到 ~82 分，进入"专业级一流"区间。

---

## 二、竞品分类与方法论

2026 年"AI 绘图"市场已分化为四个清晰赛道，彼此边界正在融合：

| 赛道 | 代表产品 | 核心范式 | 对 Diagram Atelier 的参考价值 |
|---|---|---|---|
| **① 静态图输出** | Napkin AI | 文字 → 一次性示意图（PNG/SVG） | 低。我们本就是可编辑画布，不在同一层 |
| **② 可编辑白板/画布** | Excalidraw / tldraw / Miro / Lucidchart / Whimsical / FigJam / boardmix | 手绘或精确图形 + 实时协作 + AI | 高。直接竞品，尤其是协作与 AI 能力 |
| **③ 代码即图** | Mermaid / D2 / PlantUML / Eraser DiagramGPT | 文本 DSL → 图 | 中。我们的 draw.io XML 可双向桥接 |
| **④ AI 实时编辑 / MCP** | Excalidraw via MCP / tldraw MCP / Nimbalyst / draw.io @drawio/mcp | Agent 直接读写画布 | **最高。决定 2026 年之后生死线** |

**战略拐点（关键洞察）：** 行业正从"在软件里加一个 AI 助手"转向"让软件成为 AI Agent 手里的工具"。标志事件：draw.io 官方发布 `@drawio/mcp`（Cursor / Claude Code 可调用，支持 Mermaid/CSV/XML → draw.io URL），而第三方评测（shyft.ai）给 draw.io 自身"内置 AI readiness"仅 **11/100**——它靠开放 MCP 协议补足，而非自研聊天框。

---

## 三、特性矩阵对比（Diagram Atelier vs 关键竞品）

图例：✓ 完整支持 · ◐ 部分/受限 · ✗ 不支持 · — 不适用

| 能力维度 | Diagram Atelier | tldraw | Excalidraw | Miro | Lucidchart | ProcessOn | 亿图 EdrawMax | 畅图 | Mermaid |
|---|---|---|---|---|---|---|---|---|---|
| 零依赖 / 离线可用 | ✓ | ✗(云) | ◐(自托管) | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| draw.io 兼容 XML | ✓ | ✗ | ✗ | ✗ | ◐(.vsdx) | ◐ | ✓(.vsdx) | ✗ | ✗ |
| 专业图形库 / 渲染质量 | ✓(atos 库) | ◐ | ◐(手绘) | ✓ | ✓ | ✓ | ✓(280+类) | ◐ | ✗(代码) |
| 智能诊断 / a11y | ✓(#57) | ✗ | ✗ | ◐ | ◐ | ✗ | ✗ | ✗ | ✗ |
| AI 助手（聊天改图） | ◐(侧边栏) | ◐(插件) | ◐(MCP) | ✓ | ✓ | ✓(星火) | ✓(DeepSeek-V4) | ✓(原生对话) | ◐(Eraser) |
| **AI Agent / MCP 协议** | **✗** | **✓** | **✓** | ◐ | ◐ | ✗ | ✗ | ✗ | ◐ |
| **实时多人协作** | **✗(仅只读分享)** | **✓** | **✓** | **✓** | **✓** | **✓** | ◐ | ✗ | ✗ |
| 云端账号 / 团队 / 组织 | ✗ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| 模板社区 / 市场 | ◐(本地模板) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓(10万+) | ◐ | ◐ |
| Visio / .vsdx 兼容 | ✗ | ✗ | ✗ | ◐ | ✓ | ◐ | ✓ | ✗ | ✗ |
| 移动端查看 | ✓(#56) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 命令面板 / 快捷键 | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ◐ | ✗ | — |
| 撤销重做 / 差异对比 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| 自定义图形上传 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |

---

## 四、差距量化分析（按维度）

### 4.1 致命差距（决定产品代际）

| 维度 | 行业水位 | 本项目水位 | 差距 | 影响 |
|---|---|---|---|---|
| **AI Agent / MCP 可调用** | 头部产品已发布官方 MCP Server | 无外部协议面，仅内部侧边栏聊天 | **代际差（~2 年）** | 错失"AI 原生"入口，被 Agent 工作流排除 |
| **实时多人协作** | CRDT/OT 已成标配 | 仅"分享只读 + 轮询" | **代际差** | 团队场景无法落地，B 端门槛 |

### 4.2 显著差距（体验层）

| 维度 | 行业水位 | 本项目 | 差距 |
|---|---|---|---|
| 云端账号 / 团队 / 权限 | 多产品支持组织/共享空间 | 仅本地 + 内存分享 | 中 |
| 模板社区 / 市场 | 10 万+ 模板、可交易 | 本地模板抽屉 | 中 |
| Visio / .vsdx 兼容 | 亿图/ProcessOn/Lucid 支持 | 不支持 | 中（政企刚需） |

### 4.3 本项目的相对优势（护城河）

| 维度 | 说明 | 竞品对比 |
|---|---|---|
| 零依赖离线 | Node 原生、无运行时依赖、可私有化 | 绝大多数竞品强依赖云端 |
| draw.io 兼容 | git-friendly XML，可被 draw.io 生态直接消费 | 仅 draw.io 系共享此底座 |
| 智能诊断 | #57 a11y/结构诊断，竞品普遍缺失 | Miro/Lucid 仅浅层检查 |
| 轻量高性能 | 无重型框架，首屏快 | tldraw/Miro 客户端较重 |
| 可移植 / 自托管 | 一份 XML 走天下 | 云产品锁定严重 |

---

## 五、竞品亮点速记（可借鉴的具体功能）

- **畅图（国内）**：原生"对话即改图"——用户用自然语言描述，画布实时增量更新，而非"生成一张新图"。
- **亿图 EdrawMax**：280+ 图形类型、10 万模板、已接 DeepSeek-V4、完整 Visio .vsdx 兼容——政企迁移刚需。
- **ProcessOn**：2023 接讯飞星火，中文语义理解精准，WPS 生态合作，实时协作成熟。
- **tldraw**：把画布做成 SDK + 官方 MCP，开发者可直接嵌入自家产品并让 Agent 操控。
- **draw.io @drawio/mcp**：Mermaid/CSV/XML → draw.io URL，证明"用现有 XML 底座做 MCP Server"路径可行——**与我们架构完美契合**。

---

## 六、优化路线图（按优先级）

### 🔴 P0 — 战略级（直接补齐代际差，建议本季度）

1. **发布 Diagram Atelier MCP Server**
   - 复用现有 `loadXml` / `server.js` 导出能力，暴露标准 MCP 工具：`generate_diagram(prompt)`、`edit_diagram(xml_patch)`、`export(format)`。
   - 对标 `@drawio/mcp`，支持自然语言 → draw.io XML URL / 文件。
   - *价值*：让 Cursor / Claude Code / CodeBuddy 直接调用本项目绘图，从"被排除"变"被集成"。
   - *工作量*：中（架构已就绪，主要是协议封装 + 鉴权）。

2. **把"侧边栏 AI 聊天"升级为"对话即改图"**
   - 借鉴畅图：AI 返回结构化 patch，经 `loadXml` 增量应用，画布实时变化，而非整图替换。
   - 复用现有 `loadXml` chokepoint，零架构改动。

### 🟠 P1 — 体验级（补齐团队/B 端门槛，建议下季度）

3. **实时多人协作（CRDT）**
   - 引入轻量 CRDT（如 Yjs）做节点级合并，复用 `loadXml` 作为应用入口。
   - 分享页从"只读轮询"升级为"可邀请协作者共编"。

4. **账号 / 团队 / 组织（轻云）**
   - 可选的自托管账号体系，保存 diagrams 到服务端，支持团队空间与权限。

5. **模板社区 / 市场**
   - 现有 `atelier.templates.v1` 本地模板 → 导出/导入 + 可选云端共享。

### 🟢 P2 — 增强级（护城河加固，持续）

6. **Visio / .vsdx 导入导出**（政企刚需，对标亿图）。
7. **中文语义增强**：本地化提示词 + 术语库，对标 ProcessOn 星火级中文理解。
8. **移动端编辑**（当前仅查看）：响应式画布交互。
9. **图形库持续扩充**（延续 #58）：行业包（网络/电气/云架构）一键加载。

---

## 七、战略结论

- **不要去和 Miro / 亿图拼"功能堆叠"**——那是它们的主场，且需重资源。
- **要打"AI 原生 + 零依赖私有化 + draw.io 兼容"的错位组合拳**：这是 2026 年头部云产品普遍放弃的缝隙，却是开发者、政企、隐私敏感场景的真实刚需。
- **最短超车路径**：先做 P0-1（MCP Server）。它几乎不增加前端复杂度，却能让 Diagram Atelier 成为"AI Agent 工作流里的绘图标准件"，直接接入最大的增量流量入口。
- **一句话定位**：*World's most portable, AI-agent-ready diagramming engine — zero-dependency, draw.io-native, runs anywhere.*

---

## 附：调研来源

- 海外 2026 AI 绘图四类格局（Napkin / Excalidraw / tldraw / Miro / Lucidchart / Whimsical / FigJam / boardmix / Mermaid / D2 / PlantUML / Eraser）
- 国内：ProcessOn（讯飞星火）、亿图 EdrawMax（DeepSeek-V4 / .vsdx）、畅图（原生对话改图）、NuromBoard、MindMaster AI
- draw.io 官方 `@drawio/mcp` 能力与 shyft.ai AI readiness 评测（11/100）
- tldraw / Excalidraw MCP 生态现状
