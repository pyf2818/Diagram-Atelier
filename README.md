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
| ☁️ **云端图库** | 自托管账号 | 注册 / 登录 + 服务端图存储，scrypt 加盐 + Bearer 会话，跨设备取用 |
| 🧠 **语义** | 中文增强 | 口语化中文描述自动推断图类型并注入排版约束（P2） |
| 📱 **移动端** | 触摸编辑 | 单指平移 + 双指捏合缩放，移动端可真编辑（P2） |
| 🎨 **图形库** | 内置图标 | 12 大分类 / 61 个内置图标（含商业办公 / 电气能源行业包），支持自定义 SVG 上传 |
| 📥 **兼容** | Visio 双向 | 零依赖解析 `.vsdx`（OOXML zip）→ draw.io XML（含组变换 / 旋转 / 胶接 / 页面尺寸几何还原）；反向导出 `.vsdx` 供 Visio 直接打开 |
| 🗂 **格式** | draw.io 原生 | 存储为 git-friendly 的 draw.io 兼容 XML；「精修」模式直接内嵌 draw.io 官方编辑器内核（embed.diagrams.net），可整图拖拽 / 对齐 / 连线 |
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

支持 OpenAI 兼容端点、Anthropic、DeepSeek、通义千问等。

**还没有 Key？** 启动后即可在画布空状态一键载入内置示例（流程图 / 架构图 / 思维导图），离线预览、精修编辑、PNG/SVG/.drawio 导出、分享链接全部可用；留空时仍可浏览 / 编辑已有图。

---

## 🖥 使用指南

1. **对话生成**：在底部输入框用中文描述，例如「画一个电商下单到发货的流程图，含库存校验和支付失败分支」。
2. **类型推断**：系统自动根据你的描述推断图类型并注入对应排版约束，输入框无需手动选择。
3. **实时协作**：点顶栏「更多 → 实时协作」生成邀请链接，发给同伴即可同图编辑；光标与成员实时可见。
4. **模板库**：「模板」抽屉含个人 / 社区 / 示例三类，一键载入。
5. **图形库**：「图形库」抽屉提供 12 类内置图标（云、网络、设备、集成接口等），也可上传自定义 SVG。
6. **Visio 双向**：点「更多 → 导入 Visio」选择 `.vsdx` 文件，自动转换为可编辑的 draw.io 图（保留组位置、旋转、连线胶接与页面尺寸）；「导出」菜单里的「.vsdx Visio 文件」可反向生成 Visio 可直接打开的文件。
7. **我的图表**：「更多 → 我的图表」可把当前画布命名保存到本机浏览器，跨对话常驻，随时载入或删除。
8. **云端图库**：点「更多 → 云端图库」注册 / 登录自托管账号，可把当前图保存到服务端，换设备登录后随时打开（数据落盘 `data/` 目录）。
9. **导出**：支持复制 / 下载 draw.io XML、`.vsdx`，或直接分享为只读链接。

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
| `POST` | `/api/export/visio` | 传 draw.io XML（JSON），返回 `.vsdx` 二进制文件 |
| `POST` | `/api/auth/register` / `/api/auth/login` | 注册 / 登录，返回 Bearer token |
| `GET` | `/api/auth/me` · `POST /api/auth/logout` | 会话信息 / 登出 |
| `GET/POST` | `/api/diagrams` | 云端图库列表 / 保存（需登录） |
| `GET/PUT/DELETE` | `/api/diagrams/:id` | 读取 / 更新 / 删除云端图（需登录，按用户隔离） |
| `GET` | `/api/export` | 导出当前图 |

> 实时协作走原生 WebSocket：`/collab?room=<id>`。
> 云端图数据落盘在 `data/` 目录（可用 `ATELIER_DATA_DIR` 环境变量重定向），整目录备份即可迁移。

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
│   ├── visio.js         # Visio/.vsdx 零依赖导入器（几何还原）
│   ├── vsdx-export.js   # draw.io XML → .vsdx 零依赖反向导出器
│   ├── accounts.js      # 自托管账号体系（scrypt + 会话 + 图存储）
│   ├── semantic.js      # 中文语义意图识别（再导出）
│   └── samples.js       # 内置示例图
├── public/
│   ├── index.html       # 工作台界面
│   ├── app.js           # 前端主逻辑（含协作 / 云端图库客户端）
│   ├── render.js        # 预览渲染
│   ├── shapes.js        # 图形库（前端 + 后端双端导出）
│   ├── semantic.js      # 浏览器端语义识别
│   └── styles.css       # 主题样式（含暗色 / 移动端）
├── test/
│   ├── smoke.mjs        # 冒烟 + 单元测试（39 项）
│   ├── mcp.mjs          # MCP 工具测试
│   ├── visio.mjs        # Visio 导入 + 几何还原测试
│   ├── vsdx-export.mjs  # .vsdx 反向导出 round-trip 测试
│   ├── collab.mjs       # 协作后端集成测试
│   ├── live-share.mjs   # 分享链路测试
│   └── auth.mjs         # 账号 / 云端图库端到端测试
├── .github/workflows/   # CI：语法检查 + npm test
├── MCP.md               # MCP Server 接入文档
└── package.json
```

---

## ✅ 测试

```bash
npm test            # 冒烟 + MCP + Visio 双向 + 协作 + 分享 + 账号（零依赖，无需 install）
```

CI（`.github/workflows/ci.yml`）在 push / PR 时自动对所有 `*.js` 做 `node --check` 语法校验并运行测试。

---

## 🗺 路线图

| 阶段 | 内容 | 状态 |
|------|------|------|
| **P0** | MCP Server + 对话即改图 | ✅ 完成 |
| **P1** | 实时协作 + 模板社区 | ✅ 完成 |
| **P2** | 中文语义增强 · 移动端编辑 · 图形库扩充 · Visio 导入 | ✅ 完成 |
| **P3** | Visio 几何还原（组变换/旋转/胶接/页面尺寸） · .vsdx 反向导出 · 云端账号体系 · 行业图形包 | ✅ 完成 |
| **后续** | Visio 多页保留 · 云端多人协作房间持久化 · 更多行业图形库 | 📋 规划中 |

---

## 📄 许可证

[Apache-2.0](./LICENSE)
