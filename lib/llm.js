'use strict';

/**
 * 大模型适配层。支持两种协议：
 *   - openai    : OpenAI 兼容 /chat/completions（DeepSeek / Kimi / 通义 / 智谱 / SiliconFlow / Ollama / vLLM ...）
 *   - anthropic : Anthropic Messages API /v1/messages
 * 均支持 SSE 流式输出。
 */

const PRESETS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    hint: '性价比高，长 XML 输出稳定，推荐首选。',
  },
  {
    id: 'moonshot',
    label: 'Kimi / Moonshot',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-turbo-preview', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    hint: '长上下文友好，适合大图迭代。',
  },
  {
    id: 'dashscope',
    label: '通义千问（阿里云）',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-max', 'qwen-plus', 'qwen3-235b-a22b'],
    hint: '使用 DashScope 的 OpenAI 兼容模式。',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.6', 'glm-4-plus', 'glm-4-air'],
    hint: '国内直连，响应快。',
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow 硅基流动',
    protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
    hint: '聚合多家开源模型。',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4.1', 'gpt-4o-mini'],
    hint: '官方端点，需可访问。',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-latest'],
    hint: '排版审美强，图表结构质量高。',
  },
  {
    id: 'ollama',
    label: 'Ollama 本地',
    protocol: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    models: ['qwen2.5:14b', 'llama3.1:8b'],
    hint: '本地推理，apiKey 可留空。小模型生成大图能力有限。',
  },
  {
    id: 'custom',
    label: '自定义端点',
    protocol: 'openai',
    baseUrl: '',
    models: [],
    hint: '任何 OpenAI 兼容的 /chat/completions 服务。',
  },
];

/* ------------------------------------------------------------------ */

function normalizeBase(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function chatEndpoint(baseUrl) {
  const base = normalizeBase(baseUrl);
  if (!base) throw new Error('未配置 API Base URL');
  if (/\/chat\/completions$/.test(base)) return base;
  if (/\/v\d+(?:[a-z-]*)?$/.test(base) || /compatible-mode\/v1$/.test(base) || /\/paas\/v4$/.test(base)) {
    return base + '/chat/completions';
  }
  return base + '/v1/chat/completions';
}

function messagesEndpoint(baseUrl) {
  const base = normalizeBase(baseUrl);
  if (!base) throw new Error('未配置 API Base URL');
  if (/\/messages$/.test(base)) return base;
  if (/\/v\d+$/.test(base)) return base + '/messages';
  return base + '/v1/messages';
}

function modelsEndpoint(baseUrl, protocol) {
  const base = normalizeBase(baseUrl);
  if (!base) throw new Error('未配置 API Base URL');
  if (/\/models$/.test(base)) return base;
  if (protocol === 'anthropic') {
    if (/\/v\d+$/.test(base)) return base + '/models';
    return base + '/v1/models';
  }
  return base + '/models';
}

/** 把各家 /models 返回结构归一化为去重排序的模型 id 列表 */
function parseModelList(json) {
  const arr = Array.isArray(json) ? json
    : Array.isArray(json?.data) ? json.data
    : Array.isArray(json?.models) ? json.models
    : Array.isArray(json?.data?.models) ? json.data.models
    : [];
  const ids = arr
    .map((m) => (typeof m === 'string' ? m : m?.id || m?.name || m?.model || ''))
    .filter(Boolean)
    .map(String);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/**
 * 拉取服务端可用模型列表（GET {base}/models）。
 * OpenAI 兼容：Bearer 鉴权；Anthropic：x-api-key + anthropic-version。
 * @returns {Promise<{models: string[], endpoint: string}>}
 */
async function fetchModels(cfg, signal) {
  const isAnthropic = cfg.protocol === 'anthropic';
  const url = modelsEndpoint(cfg.baseUrl, cfg.protocol);
  const headers = { accept: 'application/json' };
  if (isAnthropic) {
    if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (cfg.apiKey) {
    headers.authorization = 'Bearer ' + cfg.apiKey;
  }
  const res = await fetch(url, { headers, signal });
  if (!res.ok) throw new Error(await readError(res));
  let json = null;
  try { json = await res.json(); } catch { throw new Error('模型列表响应不是合法 JSON'); }
  return { models: parseModelList(json), endpoint: url };
}

/* ------------------------------------------------------------------ */
/* SSE 行解析                                                          */
/* ------------------------------------------------------------------ */

async function* iterateSse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (!line || line.startsWith(':')) continue;
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === '[DONE]') return;
      try {
        yield JSON.parse(data);
      } catch {
        /* 忽略半包/心跳 */
      }
    }
  }
  if (buffer.trim().startsWith('data:')) {
    const data = buffer.trim().slice(5).trim();
    if (data && data !== '[DONE]') {
      try {
        yield JSON.parse(data);
      } catch {
        /* noop */
      }
    }
  }
}

/* ------------------------------------------------------------------ */

function buildOpenAiBody(cfg, messages, stream) {
  const body = { model: cfg.model, messages, stream };
  if (cfg.temperature !== undefined && cfg.temperature !== null && cfg.temperature !== '') {
    body.temperature = Number(cfg.temperature);
  }
  const mt = Number(cfg.maxTokens);
  if (Number.isFinite(mt) && mt > 0) body.max_tokens = mt;
  if (stream) body.stream_options = { include_usage: true };
  return body;
}

function buildAnthropicBody(cfg, messages, stream) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const rest = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
  const mt = Number(cfg.maxTokens);
  const body = {
    model: cfg.model,
    max_tokens: Number.isFinite(mt) && mt > 0 ? mt : 16000,
    messages: rest,
    stream,
  };
  if (system) body.system = system;
  if (cfg.temperature !== undefined && cfg.temperature !== null && cfg.temperature !== '') {
    body.temperature = Number(cfg.temperature);
  }
  return body;
}

async function readError(res) {
  let text = '';
  try {
    text = await res.text();
  } catch {
    /* noop */
  }
  let detail = text;
  try {
    const j = JSON.parse(text);
    detail = j?.error?.message || j?.message || j?.error || text;
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
  } catch {
    /* 保留原文 */
  }
  return `HTTP ${res.status} ${res.statusText || ''} ${String(detail || '').slice(0, 600)}`.trim();
}

/**
 * 流式对话。onDelta(textChunk, kind) 会被逐块调用：
 *   kind='text'  正文增量（含 XML / JSON 输出）
 *   kind='think' 思维链增量（reasoning_content / thinking_delta），不计入正文
 * @returns {Promise<{text: string, reasoning: string, usage: object|null}>}
 */
async function streamChat(cfg, messages, onDelta, signal) {
  const protocol = cfg.protocol === 'anthropic' ? 'anthropic' : 'openai';
  const isAnthropic = protocol === 'anthropic';
  const url = isAnthropic ? messagesEndpoint(cfg.baseUrl) : chatEndpoint(cfg.baseUrl);

  const headers = { 'content-type': 'application/json', accept: 'text/event-stream' };
  if (isAnthropic) {
    if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (cfg.apiKey) {
    headers.authorization = 'Bearer ' + cfg.apiKey;
  }

  const attempt = async (body) =>
    fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });

  let body = isAnthropic ? buildAnthropicBody(cfg, messages, true) : buildOpenAiBody(cfg, messages, true);
  let res = await attempt(body);

  // 常见兼容性回退
  if (!res.ok && !isAnthropic) {
    const err = await readError(res);
    if (/max_tokens/i.test(err) && body.max_tokens) {
      const retry = { ...body };
      retry.max_completion_tokens = retry.max_tokens;
      delete retry.max_tokens;
      res = await attempt(retry);
      body = retry;
    } else if (/temperature/i.test(err) && body.temperature !== undefined) {
      const retry = { ...body };
      delete retry.temperature;
      res = await attempt(retry);
      body = retry;
    } else if (/stream_options/i.test(err) && body.stream_options) {
      const retry = { ...body };
      delete retry.stream_options;
      res = await attempt(retry);
      body = retry;
    } else {
      throw new Error(err);
    }
  }

  if (!res.ok) throw new Error(await readError(res));
  if (!res.body) throw new Error('响应没有可读流，服务端可能不支持 SSE 流式输出');

  let full = '';
  let reasoning = '';
  let usage = null;

  for await (const evt of iterateSse(res)) {
    if (isAnthropic) {
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        full += evt.delta.text;
        onDelta?.(evt.delta.text, 'text');
      } else if (evt.type === 'content_block_delta' && evt.delta?.type === 'thinking_delta') {
        reasoning += evt.delta.thinking || '';
        onDelta?.(evt.delta.thinking || '', 'think');
      } else if (evt.type === 'message_delta' && evt.usage) {
        usage = { ...(usage || {}), ...evt.usage };
      } else if (evt.type === 'message_start' && evt.message?.usage) {
        usage = { ...(usage || {}), ...evt.message.usage };
      } else if (evt.type === 'error') {
        throw new Error(evt.error?.message || '模型返回错误');
      }
    } else {
      if (evt.usage) usage = evt.usage;
      const choice = evt.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      // 思维链增量：DeepSeek reasoner / GLM / 通义等用 reasoning_content，OpenRouter 等用 reasoning
      const think = typeof delta.reasoning_content === 'string' ? delta.reasoning_content
        : typeof delta.reasoning === 'string' ? delta.reasoning : '';
      if (think) {
        reasoning += think;
        onDelta?.(think, 'think');
      }
      const piece = delta.content;
      if (typeof piece === 'string' && piece) {
        full += piece;
        onDelta?.(piece, 'text');
      } else if (Array.isArray(piece)) {
        for (const p of piece) {
          if (p?.type === 'text' && p.text) {
            full += p.text;
            onDelta?.(p.text, 'text');
          } else if ((p?.type === 'thinking' || p?.type === 'reasoning') && p.thinking) {
            reasoning += p.thinking;
            onDelta?.(p.thinking, 'think');
          }
        }
      }
      if (evt.error) throw new Error(evt.error.message || '模型返回错误');
    }
  }

  if (!full.trim()) throw new Error('模型返回了空内容，请检查模型名称与账户额度');
  return { text: full, reasoning, usage };
}

/** 连通性验证：发一个极小请求 */
async function verify(cfg, signal) {
  const messages = [
    { role: 'system', content: 'You are a connectivity probe. Reply with the single word: OK' },
    { role: 'user', content: 'ping' },
  ];
  const isAnthropic = cfg.protocol === 'anthropic';
  const url = isAnthropic ? messagesEndpoint(cfg.baseUrl) : chatEndpoint(cfg.baseUrl);
  const headers = { 'content-type': 'application/json' };
  if (isAnthropic) {
    if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (cfg.apiKey) {
    headers.authorization = 'Bearer ' + cfg.apiKey;
  }

  const body = isAnthropic
    ? { model: cfg.model, max_tokens: 16, messages }
    : { model: cfg.model, messages, max_tokens: 16 };

  const started = Date.now();
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(await readError(res));
  const json = await res.json();
  const text = isAnthropic
    ? json?.content?.map((c) => c.text).join('') || ''
    : json?.choices?.[0]?.message?.content || '';
  return { ok: true, latencyMs: Date.now() - started, endpoint: url, sample: String(text).slice(0, 60) };
}

module.exports = { PRESETS, streamChat, verify, fetchModels, parseModelList, chatEndpoint, messagesEndpoint, modelsEndpoint };
