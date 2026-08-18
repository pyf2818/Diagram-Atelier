# AI Diagram Atelier · 智能绘图工作台

> **World's most portable, AI-agent-ready diagramming engine — 零依赖、draw.io 原生、可私有化部署。**

AI 自然语言 → draw.io 兼容 XML 的零依赖绘图工作台。把你脑子里的流程图、架构图、思维导图直接「说」出来，AI 生成可编辑的图；支持实时协作、社区模板、图形库、Visio 导入，并提供 MCP Server 让 AI Agent 直接调用。

---

## ✨ 特性

| 类别 | 能力 | 说明 |
|------|------|------|
| 🤖 **AI 生成** | 对话即改图 | 自然语言生成流程图 / 架构图 / 思维导图，并通过「增量 patch」持续编辑（P0） |
| 🔌 **AI 集成** | MCP Server | 可被 Claude Desktop / Cursor / CodeBuddy 等 MCP 客户端直接调用（P0） |
| 👥 **协作** | 实时多人 | 零依赖原生 WebSocket，房间广播 + 远端光标 + presence（P1） |
| 📚 **模板** | 模板社区 | 个人 / 社区 / 示例 三标签模板库（P1） |
| 🧠 **语义** | 中文增强 | 输入「微服务后端架构图」自动在类型条高亮「推断」标签（P2） |
| 📱 **移动端** | 触摸编辑 | 单指平移 + 双指捏合缩放，移动端可真编辑（P2） |
| 🎨 **图形库** | 内置图标 | 10 大分类 / 49 个内置图标，支持自定义 SVG 上传（P2） |
| 📥 **兼容** | Visio 导入 | 零依赖解析 `.vsdx`（OOXML zip）→ draw.io XML（P2） |
| 🗂 **格式** | draw.io 原生 | 存储为 git-friendly 的 draw.io 兼容 XML |
| ⚡ **架构** | 零第三方依赖 | 仅用 Node 原生 `http` / `fs` / `crypto` / `zlib`，可离线私有化 |

---

## 🚀 快速开始

**无需 `npm install`**——项目没有任何第三方运行时依赖。

```bash
git clone https://github.com/pyf2818/Diagram-Atelier.git
cd Diagram-Atelier
npm start          # 等价于 node server.js
# 浏览器打开 http://localhost:7391
```

- 默认端口 `7391`，可用环境变量覆盖：`PORT=8080 npm start`
- 需要 Node **≥ 18**（推荐 22）。

### 配置大模型（生成 / 编辑图需要）

在网页右上角「设置」里填写：`Base URL`、`API Key`、`Model`；或启动时用环境变量：

```bash
LLM_BASE_URL=https://api.deepseek.com/v1 \
LLM_API_KEY=sk-xxx \
LLM_MODEL=deepseek-chat \
npm start
```

支持 OpenAI 兼容端点、Anthropic、DeepSeek、通义千问等。留空时仍可浏览 / 编辑已有图。

---

## 🖥 使用指南

1. **对话生成**：在底部输入框用中文描述，例如「画一个电商下单到发货的流程图，含库存校验和支付失败分支」。
2. **类型推断**：未手动选类型时，系统根据你描述实时高亮推测的图类型（类型条上的「推断」角标）。
3. **实时协作**：点顶栏「协作」生成邀请链接，发给同伴即可同图编辑；光标与成员实时可见。
4. **模板库**：「模板」抽屉含个人 / 社区 / 示例三类，一键载入。
5. **图形库**：「图形库」抽屉提供 10 类内置图标（云、网络、设备、集成接口等），也可上传自定义 SVG。
6. **Visio 导入**：点顶栏「导入 Visio」，选择 `.vsdx` 文件，自动转换为可编辑的 draw.io 图。
7. **导出**：支持复制 / 下载 draw.io XML，或直接分享为只读链接。

### 移动端
支持单指拖动平移、双指捏合缩放，适配窄屏布局。

---

## 🔌 MCP Server

让 AI Agent 直接帮你画图 / 改图 / 分享图。详见 [MCP.md](./MCP.md)。

```bash
# 方式 1：命令行参数
node server.js --mcp

# 方式 2：环境变量
ATELIER_MCP=1 node server.js
```

在 Claude Desktop / Cursor 的 MCP 配置里指向 `server.js --mcp` 即可，提供工具：
`generate_diagram` / `edit_diagram` / `share_diagram` / `get_diagram` / `validate_diagram`。

---

## 🌐 HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 |
| `POST` | `/api/normalize` | 校验并自动修复 draw.io XML |
| `POST` | `/api/validate` | 校验 XML 合法性 |
| `POST` | `/api/import/visio` | 上传 `.vsdx`（二进制），返回 draw.io XML + 摘要 |
| `GET` | `/api/export` | 导出当前图 |

> 实时协作走原生 WebSocket：`/collab?room=<id>`。

---

## 🧱 架构

```
┌─────────────────────────┐      ┌──────────────────────────┐
│   public/  (浏览器前端)   │      │   server.js (Node 原生)    │
│  app.js / render.js     │◄────►│  http + 原生 WebSocket     │
│  index.html / styles.css│      │  /api/* + /collab          │
│  shapes.js / semantic.js│      └───────────┬──────────────┘
└─────────────────────────┘                  │
                                             ▼
                              ┌──────────────────────────────┐
                              │  lib/  (零依赖核心引擎)        │
                              │  llm · prompt · patch · xml   │
                              │  collab · visio · semantic    │
                              │  samples                      │
                              └──────────────────────────────┘
```

**架构铁律**
- **零第三方运行时依赖**：只用 Node 内置模块，无 Express、无 `ws` 包、无 Yjs。整个项目 `npm start` 即可跑，无 `npm install`。
- **draw.io 兼容**：存储格式为 git-friendly 的 draw.io XML，自定义图标通过 `shape=atos:<id>` 引用本地 SVG 库。
- **`loadXml` 是图变更唯一 chokepoint**：预览 / AI 改图 / 撤销重做 / 实时协作合并全部经过它，保证状态一致。

---

## 📂 项目结构

```
Diagram-Atelier/
├── server.js            # 零依赖 HTTP + WebSocket 服务入口
├── lib/
│   ├── llm.js           # 大模型调用（OpenAI/Anthropic/兼容端点）
│   ├── prompt.js        # 系统提示词 + 图形库映射规则
│   ├── patch.js         # AI 改图增量 patch（经 loadXml）
│   ├── xml.js           # draw.io XML 规范化 / 校验 / 解析
│   ├── collab.js        # 实时协作后端（RFC6455 帧编解码）
│   ├── visio.js         # Visio/.vsdx 零依赖导入器
│   ├── semantic.js      # 中文语义意图识别（再导出）
│   └── samples.js       # 内置示例图
├── public/
│   ├── index.html       # 工作台界面
│   ├── app.js           # 前端主逻辑（含协作客户端）
│   ├── render.js        # 预览渲染
│   ├── shapes.js        # 图形库（前端 + 后端双端导出）
│   ├── semantic.js      # 浏览器端语义识别
│   └── styles.css       # 主题样式（含暗色 / 移动端）
├── test/
│   ├── smoke.mjs        # 冒烟 + 单元测试（37 项）
│   ├── mcp.mjs          # MCP 工具测试
│   ├── visio.mjs        # Visio 导入端到端测试
│   ├── collab.mjs       # 协作后端集成测试
│   └── live-share.mjs   # 分享链路测试
├── .github/workflows/   # CI：语法检查 + npm test
├── MCP.md               # MCP Server 接入文档
└── package.json
```

---

## ✅ 测试

```bash
npm test            # 冒烟 + MCP + Visio（零依赖，无需 install）
```

CI（`.github/workflows/ci.yml`）在 push / PR 时自动对所有 `*.js` 做 `node --check` 语法校验并运行测试。

---

## 🗺 路线图

| 阶段 | 内容 | 状态 |
|------|------|------|
| **P0** | MCP Server + 对话即改图 | ✅ 完成 |
| **P1** | 实时协作 + 模板社区 | ✅ 完成 |
| **P2** | 中文语义增强 · 移动端编辑 · 图形库扩充 · Visio 导入 | ✅ 完成 |
| **后续** | Visio 几何还原 · draw.io→.vsdx 反向导出 · 云端账号体系 · 更多图形库 | 📋 规划中 |

---

## 📄 许可证

[Apache-2.0](./LICENSE)
