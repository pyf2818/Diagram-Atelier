# Diagram Atelier MCP Server

让 Claude Desktop、Cursor、CodeBuddy 等支持 MCP 的 AI Agent 直接调用 Diagram Atelier 生成/编辑/分享 draw.io 图表。

## 启动方式

```bash
# 方式 1：命令行参数
node server.js --mcp

# 方式 2：环境变量
ATELIER_MCP=1 node server.js
```

## 配置大模型

`generate_diagram` / `edit_diagram` 需要调用 LLM，通过环境变量配置：

| 变量 | 说明 | 示例 |
|---|---|---|
| `LLM_API_KEY` | API Key | `sk-...` |
| `LLM_BASE_URL` | OpenAI 兼容端点 | `https://api.deepseek.com/v1` |
| `LLM_MODEL` | 模型名 | `deepseek-chat` |

推荐：`deepseek-chat` / `claude-sonnet-4-20250514` / `qwen-max`。

可选：`ATELIER_URL` 控制分享链接前缀（默认 `http://127.0.0.1:7391`）。

## Claude Desktop 配置示例

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）或 `%APPDATA%\Claude\claude_desktop_config.json`（Windows）：

```json
{
  "mcpServers": {
    "diagram-atelier": {
      "command": "node",
      "args": [
        "/absolute/path/to/diagram-atelier/server.js",
        "--mcp"
      ],
      "env": {
        "LLM_API_KEY": "your-api-key",
        "LLM_BASE_URL": "https://api.deepseek.com/v1",
        "LLM_MODEL": "deepseek-chat",
        "ATELIER_URL": "http://127.0.0.1:7391"
      }
    }
  }
}
```

## Cursor 配置示例

编辑 `~/.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "diagram-atelier": {
      "command": "node",
      "args": [
        "/absolute/path/to/diagram-atelier/server.js",
        "--mcp"
      ],
      "env": {
        "LLM_API_KEY": "your-api-key",
        "LLM_BASE_URL": "https://api.deepseek.com/v1",
        "LLM_MODEL": "deepseek-chat"
      }
    }
  }
}
```

## 可用工具

| 工具 | 用途 |
|---|---|
| `generate_diagram(prompt, type_hint?, title?)` | 自然语言生成图表，返回 XML + 分享链接 |
| `edit_diagram(share_id, instruction)` | 按指令修改已有分享图 |
| `share_diagram(xml, title?)` | 把已有 XML 发布为只读链接 |
| `get_diagram(share_id)` | 根据 ID 获取 XML |
| `validate_diagram(xml)` | 校验并自动修复 XML |

## 使用示例

对 Claude 说：

> "用 diagram-atelier 画一个电商下单到发货的流程图。"

Agent 会调用 `generate_diagram`，然后返回一个可在浏览器打开的分享链接，链接里的图是 draw.io 兼容、可继续编辑的。

## 测试

```bash
node test/mcp.mjs
```
