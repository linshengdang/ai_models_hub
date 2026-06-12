import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolveProviderApiKey } from '../providerSecrets.js';
import { detectProxy } from '../proxyDetect.js';
import { defaultProviders } from '../defaultProviders.js';
import { logUsage, estimateTokens } from './stats.js';

const execFileAsync = promisify(execFile);

import { userStorage } from '../context.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = Router();

function getConfigPath() {
  const userId = userStorage.getStore()?.userId || 'guest';
  if (userId === 'guest') {
    return path.join(__dirname, '..', 'data', 'config.json');
  }
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '');
  const userPath = path.join(__dirname, '..', 'data', `config_${safeUserId}.json`);
  if (!fs.existsSync(userPath)) {
    const defaultPath = path.join(__dirname, '..', 'data', 'config.json');
    if (fs.existsSync(defaultPath)) {
      try {
        fs.copyFileSync(defaultPath, userPath);
      } catch (err) {
        fs.writeFileSync(userPath, JSON.stringify({ providers: {} }, null, 2));
      }
    } else {
      fs.writeFileSync(userPath, JSON.stringify({ providers: {} }, null, 2));
    }
  }
  return userPath;
}

function readConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'));
    if (config && config.providers) {
      for (const [id, provider] of Object.entries(config.providers)) {
        if (defaultProviders[id]) {
          provider.accessModes = defaultProviders[id].accessModes || provider.accessModes;
          provider.oauth = defaultProviders[id].oauth || provider.oauth;
          provider.billingType = defaultProviders[id].billingType || provider.billingType;
          provider.authType = defaultProviders[id].authType || provider.authType;
          provider.authHeader = defaultProviders[id].authHeader || provider.authHeader;
        }
      }
    }
    return config;
  } catch {
    return { providers: {} };
  }
}

async function proxyFetch(url, { method = 'GET', headers = {}, body = undefined, timeoutMs = 120000 } = {}) {
  try {
    return await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // fall through to curl with proxy
  }

  const proxyUrl = await detectProxy();
  const timeoutSeconds = Math.ceil(timeoutMs / 1000);
  const attempts = proxyUrl
    ? [{ proxyArg: proxyUrl }, { noProxy: true }]
    : [{ noProxy: true }, {}];

  for (const attempt of attempts) {
    const args = ['-sS', '-i', '--max-time', String(timeoutSeconds), '-X', method, url];
    if (attempt.noProxy) {
      args.push('--noproxy', '*');
    } else if (attempt.proxyArg) {
      args.push('--proxy', attempt.proxyArg);
    }
    for (const [key, value] of Object.entries(headers)) {
      args.push('-H', `${key}: ${value}`);
    }
    if (body !== undefined && body !== null) {
      args.push('-d', body);
    }

    try {
      const { stdout } = await execFileAsync('curl', args, { maxBuffer: 10 * 1024 * 1024 });
      const parts = stdout.split(/\r?\n\r?\n/);
      const bodyPart = parts.pop() || '';
      const headerPart = [...parts].reverse().find(part => /^HTTP\//.test(part)) || '';
      const statusLine = headerPart.split(/\r?\n/)[0] || '';
      const statusCode = parseInt(statusLine.split(' ')[1], 10) || 200;
      const rawHeaders = {};
      for (const line of headerPart.split(/\r?\n/).slice(1)) {
        const index = line.indexOf(':');
        if (index > 0) rawHeaders[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
      }
      return {
        ok: statusCode >= 200 && statusCode < 300,
        status: statusCode,
        statusText: statusLine.split(' ').slice(2).join(' ') || 'OK',
        headers: { forEach: (cb) => Object.entries(rawHeaders).forEach(([key, value]) => cb(value, key)) },
        text: async () => bodyPart,
        json: async () => JSON.parse(bodyPart),
        body: bodyPart,
        _isBuffered: true,
      };
    } catch {
      // try next attempt
    }
  }

  throw new Error('网络连接失败：请检查代理设置或网络连通性');
}

function isChatModel(model) {
  return model?.type === 'text';
}

function normalizeChatModel(providerId, provider, modelId) {
  if (providerId !== 'openai_codex') {
    return provider.models?.find(model => model.id === modelId) || null;
  }

  const existing = provider.models?.find(model => model.id === modelId);
  if (existing) return existing;

  const codexModels = [
    { id: 'gpt-5-codex', name: 'GPT-5 Codex', type: 'text' },
    { id: 'gpt-5-codex-mini', name: 'GPT-5 Codex Mini', type: 'text' },
    { id: 'codex-mini-latest', name: 'Codex Mini Latest', type: 'text' },
  ];
  return codexModels.find(model => model.id === modelId) || null;
}

async function forEachResponseLine(response, onLine) {
  if (response._isBuffered) {
    for (const line of String(response.body || '').split(/\r?\n/)) {
      onLine(line);
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      onLine(line);
    }
  }

  if (buffer) onLine(buffer);
}

function getMessageText(message) {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map(part => part.text || part.content || '').filter(Boolean).join('\n');
  }
  return JSON.stringify(message.content || '');
}

function extractTextFromResponse(data) {
  if (data?.type === 'response.output_text.delta' && typeof data.delta === 'string') return data.delta;
  if (typeof data?.output_text === 'string') return data.output_text;
  const chunks = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.text === 'string') chunks.push(value.text);
    if (typeof value.content === 'string') chunks.push(value.content);
    if (Array.isArray(value.content)) value.content.forEach(visit);
    if (Array.isArray(value.output)) value.output.forEach(visit);
  };
  visit(data);
  return chunks.join('');
}

function buildHeaders(provider) {
  const headers = { 'Content-Type': 'application/json' };
  if (provider.authType === 'bearer') {
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  } else if (provider.authType === 'custom-header') {
    headers[provider.authHeader] = provider.apiKey;
    if (provider.apiFormat === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01';
    }
  }
  // Copilot-specific headers — aligned with CLIProxyAPIPlus github_copilot_executor.go
  if (provider._isCopilot) {
    headers['Accept'] = 'application/json';
    headers['User-Agent'] = 'GitHubCopilotChat/0.35.0';
    headers['Editor-Version'] = 'vscode/1.107.0';
    headers['Editor-Plugin-Version'] = 'copilot-chat/0.35.0';
    headers['Openai-Intent'] = 'conversation-edits';
    headers['Copilot-Integration-Id'] = 'vscode-chat';
    headers['X-Github-Api-Version'] = '2025-04-01';
    headers['X-Request-Id'] = randomUUID();
  }
  return headers;
}

function buildUrl(provider, endpoint) {
  // Use dynamic API endpoint from JWT response (e.g. GitHub Copilot) if available
  const base = provider._copilotApiEndpoint || provider.baseUrl;
  let url = `${base}${endpoint}`;
  if (provider.authType === 'query-key') {
    url += (url.includes('?') ? '&' : '?') + `key=${provider.apiKey}`;
  } else if (provider.authType === 'query-token') {
    url += (url.includes('?') ? '&' : '?') + `access_token=${provider.apiKey}`;
  }
  return url;
}

// Process messages to include file content for multimodal models
function processMessages(messages, provider) {
  return messages.map(msg => {
    if (msg.files && msg.files.length > 0 && typeof msg.content === 'string') {
      if (provider.apiFormat === 'openai') {
        // OpenAI multimodal format
        const content = [{ type: 'text', text: msg.content }];
        for (const file of msg.files) {
          if (file.type?.startsWith('image/')) {
            content.push({
              type: 'image_url',
              image_url: { url: file.base64 || file.url },
            });
          } else {
            // For non-image files, append as text
            content[0].text += `\n\n[附件: ${file.name}]`;
            if (file.textContent) {
              content[0].text += `\n${file.textContent}`;
            }
          }
        }
        return { role: msg.role, content };
      } else if (provider.apiFormat === 'anthropic') {
        const content = [];
        for (const file of msg.files) {
          if (file.type?.startsWith('image/') && file.base64) {
            const base64Data = file.base64.split(',')[1] || file.base64;
            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: file.type,
                data: base64Data,
              },
            });
          }
        }
        content.push({ type: 'text', text: msg.content });
        return { role: msg.role, content };
      }
    }
    // Remove files from messages before sending
    const { files, ...rest } = msg;
    return rest;
  });
}

// ===== OpenAI-compatible streaming =====
async function handleOpenAIStream(provider, model, messages, res) {
  const url = buildUrl(provider, '/chat/completions');
  const headers = buildHeaders(provider);
  const processedMsgs = processMessages(messages, provider);

  const body = JSON.stringify({
    model: model.id,
    messages: processedMsgs,
    stream: true,
  });

  const response = await proxyFetch(url, { method: 'POST', headers, body });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API ${response.status}: ${errText.slice(0, 500)}`);
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    await forEachResponseLine(response, (line) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) return;
      const data = trimmed.slice(6);
      if (data === '[DONE]') {
        res.write('data: [DONE]\n\n');
        return;
      }
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
        }
      } catch { /* skip malformed lines */ }
    });
  } finally {
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

// ===== MiniMax streaming (chatcompletion_v2) =====
// MiniMax does NOT expose /chat/completions — its endpoint is /text/chatcompletion_v2
async function handleMiniMaxStream(provider, model, messages, res) {
  const url = 'https://api.minimax.chat/v1/text/chatcompletion_v2';
  const headers = {
    Authorization: `Bearer ${provider.apiKey}`,
    'Content-Type': 'application/json',
  };
  const processedMsgs = processMessages(messages, provider);

  const body = JSON.stringify({
    model: model.id,
    messages: processedMsgs,
    stream: true,
  });

  const response = await proxyFetch(url, { method: 'POST', headers, body });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`MiniMax API ${response.status}: ${errText.slice(0, 500)}`);
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    await forEachResponseLine(response, (line) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) return;
      const data = trimmed.slice(6);
      if (data === '[DONE]') {
        res.write('data: [DONE]\n\n');
        return;
      }
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
        }
      } catch { /* skip malformed lines */ }
    });
  } finally {
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

// ===== Anthropic streaming =====
async function handleAnthropicStream(provider, model, messages, res) {
  const url = buildUrl(provider, '/messages');
  const headers = buildHeaders(provider);

  const systemMsg = messages.find(m => m.role === 'system');
  const nonSystemMsgs = messages.filter(m => m.role !== 'system');
  const processedMsgs = processMessages(nonSystemMsgs, provider);

  const requestBody = {
    model: model.id,
    max_tokens: 4096,
    messages: processedMsgs,
    stream: true,
  };
  if (systemMsg) requestBody.system = systemMsg.content;

  const response = await proxyFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API ${response.status}: ${errText.slice(0, 500)}`);
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    await forEachResponseLine(response, (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) return;
      const data = trimmed.slice(6);
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          res.write(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`);
        }
      } catch { /* skip */ }
    });
  } finally {
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

async function handleCodexChat(provider, model, messages, res) {
  const input = [];
  let instructions = '';
  messages.forEach((message, index) => {
    if (message.role === 'system') {
      instructions += `${getMessageText(message)}\n`;
    } else if (message.role === 'assistant') {
      input.push({
        type: 'message',
        role: 'assistant',
        status: 'completed',
        id: `msg_${index}`,
        content: [{ type: 'output_text', text: getMessageText(message), annotations: [] }],
      });
    } else {
      input.push({
        role: 'user',
        content: [{ type: 'input_text', text: getMessageText(message) }],
      });
    }
  });

  const response = await proxyFetch('https://chatgpt.com/backend-api/codex/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({
      model: model.id,
      input,
      instructions: instructions.trim() || 'You are a helpful coding assistant.',
      store: false,
      stream: true,
      text: { verbosity: 'medium' },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Codex API ${response.status}: ${errText.slice(0, 500)}`);
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  try {
    await forEachResponseLine(response, (line) => {
      const trimmed = line.trim();
      const data = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
      if (!data || data === '[DONE]') return;
      try {
        const text = extractTextFromResponse(JSON.parse(data));
        if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
      } catch { /* skip */ }
    });
  } finally {
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

// ===== Google Gemini (non-streaming) =====
async function handleGoogleChat(provider, model, messages, res) {
  const endpoint = `/models/${model.id}:generateContent`;
  const url = buildUrl(provider, endpoint);

  const systemMsg = messages.find(m => m.role === 'system');
  const nonSystemMsgs = messages.filter(m => m.role !== 'system');

  const contents = nonSystemMsgs.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }));

  const requestBody = { contents };
  if (systemMsg) {
    requestBody.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }

  const response = await proxyFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API ${response.status}: ${errText.slice(0, 500)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Return as SSE for consistent handling
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.write(`data: ${JSON.stringify({ text })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

// ===== Baidu chat (non-streaming) =====
async function handleBaiduChat(provider, model, messages, res) {
  const url = buildUrl(provider, `/${model.id}`);

  const nonSystemMsgs = messages.filter(m => m.role !== 'system');
  const systemMsg = messages.find(m => m.role === 'system');

  const requestBody = { messages: nonSystemMsgs };
  if (systemMsg) requestBody.system = systemMsg.content;

  const response = await proxyFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API ${response.status}: ${errText.slice(0, 500)}`);
  }

  const data = await response.json();
  if (data.error_code) {
    throw new Error(`Baidu Error ${data.error_code}: ${data.error_msg}`);
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.write(`data: ${JSON.stringify({ text: data.result || '' })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

// ===== Image generation =====
async function handleImageGeneration(provider, model, prompt, res) {
  const url = buildUrl(provider, '/images/generations');
  const headers = buildHeaders(provider);

  const response = await proxyFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: model.id,
      prompt,
      n: 1,
      size: '1024x1024',
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API ${response.status}: ${errText.slice(0, 500)}`);
  }

  const data = await response.json();
  res.json({ type: 'image', data: data.data });
}

async function handleDemoChat(providerId, modelId, messages, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const lastMessage = messages[messages.length - 1]?.content || '';
  let responseText = `你好！欢迎使用 SpaceDream 智能平台。目前您正处于【Demo 演示模式】。

这里的所有回复均为 Mock 预置数据，不会发起任何真实的 API 计费调用。
您刚刚输入的 Prompt 是："${lastMessage}"

本系统的特色功能包括：
1. **多模型适配**：平铺支持 GitHub Copilot, Gemini, Codex, DeepSeek 等主流大模型供应商。
2. **多模态融合**：支持对话、图片生成、音视频合成等功能。
3. **隔离用户配置**：注册登录后您的 key 将自动隔离加密保存。

您可以去右上角/侧边栏切换为【正常注册登录】来使用真实的 API！`;

  if (lastMessage.toLowerCase().includes('code') || lastMessage.includes('代码') || lastMessage.includes('编程')) {
    responseText = `你好！检测到您提出了有关代码/编程的问题。当前处于【Demo 演示模式】下。

这是一个 Mock 的 React 计数器组件代码示例：

\`\`\`jsx
import React, { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div className="counter-container">
      <h3>React 计数器</h3>
      <p>当前数字: {count}</p>
      <button onClick={() => setCount(count + 1)}>点击 +1</button>
    </div>
  );
}
\`\`\`

您可以通过“登录正式账号”来体验大模型真实的实时代码生成能力！`;
  }

  const words = responseText.split(/(?<=[\s\n\p{P}])|(?=[\s\n\p{P}])/u);
  let index = 0;
  
  const timer = setInterval(() => {
    if (index >= words.length) {
      clearInterval(timer);
      res.write('data: [DONE]\n\n');
      res.end();
      logUsage({
        userId: 'demo',
        providerId,
        modelId,
        type: 'text',
        tokens: estimateTokens(lastMessage) + estimateTokens(responseText),
        success: true
      });
      return;
    }
    const chunk = words[index++];
    if (chunk) {
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    }
  }, 25);
}

// ===== Main chat endpoint =====
router.post('/completions', async (req, res) => {
  let logged = false;
  const { providerId, modelId, messages } = req.body;
  const userId = userStorage.getStore()?.userId || 'guest';

  if (userId === 'demo') {
    return await handleDemoChat(providerId, modelId, messages, res);
  }

  try {
    if (!providerId || !modelId || !messages) {
      return res.status(400).json({ error: 'providerId, modelId, and messages are required' });
    }

    const config = readConfig();
    const provider = config.providers[providerId];
    if (!provider) {
      return res.status(400).json({ error: `未配置供应商: ${providerId}` });
    }

    // Intercept res.write and res.end to log usage statistics
    let fullResponseText = '';
    const originalWrite = res.write.bind(res);
    res.write = (chunk, encoding, callback) => {
      const str = chunk ? chunk.toString() : '';
      const lines = str.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]\n\n' && line !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.text) {
              fullResponseText += data.text;
            }
          } catch (e) {}
        }
      }
      return originalWrite(chunk, encoding, callback);
    };

    const originalEnd = res.end.bind(res);
    res.end = (chunk, encoding, callback) => {
      if (!logged) {
        logged = true;
        const totalPromptText = messages.map(m => getMessageText(m)).join('\n');
        logUsage({
          userId,
          providerId,
          modelId,
          type: 'text',
          tokens: estimateTokens(totalPromptText) + estimateTokens(fullResponseText),
          success: res.statusCode >= 200 && res.statusCode < 300,
        });
      }
      return originalEnd(chunk, encoding, callback);
    };

    // Determine effective auth: model-specific key > OAuth token > provider-level key
    const modelKey = provider.modelKeys?.[modelId];
    let effectiveKey = modelKey || resolveProviderApiKey(provider);
    let authOverride = null;
    const isCopilot = (providerId === 'github_copilot');
    let copilotApiEndpoint = null;

    // If OAuth tokens exist and not expired, use them
    const oauthTokens = provider.oauthTokens;
    if (!effectiveKey && oauthTokens?.accessToken) {
      const expired = oauthTokens.expiresAt > 0 && Date.now() > oauthTokens.expiresAt;
      if (!expired) {
        // For GitHub Copilot: use the Copilot API JWT, not the GitHub token
        if (isCopilot && oauthTokens.copilotToken) {
          const copilotExpired = oauthTokens.copilotTokenExpiresAt > 0 && Date.now() > oauthTokens.copilotTokenExpiresAt;
          if (!copilotExpired) {
            effectiveKey = oauthTokens.copilotToken;
          } else {
            // Auto-refresh Copilot JWT
            try {
              const refreshRes = await proxyFetch('https://api.github.com/copilot_internal/v2/token', {
                method: 'GET',
                headers: {
                  Authorization: `token ${oauthTokens.accessToken}`,
                  Accept: 'application/json',
                  'User-Agent': 'GitHubCopilotChat/0.35.0',
                },
              });
              if (refreshRes.ok) {
                const refreshData = await refreshRes.json();
                if (refreshData.token) {
                  effectiveKey = refreshData.token;
                  config.providers[providerId].oauthTokens.copilotToken = refreshData.token;
                  config.providers[providerId].oauthTokens.copilotTokenExpiresAt =
                    refreshData.expires_at ? refreshData.expires_at * 1000 : Date.now() + 30 * 60 * 1000;
                  if (refreshData.endpoints?.api) {
                    copilotApiEndpoint = refreshData.endpoints.api.replace(/\/$/, '');
                    config.providers[providerId].oauthTokens.copilotApiEndpoint = copilotApiEndpoint;
                  }
                  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
                }
              }
            } catch { /* fallback to GitHub token */ }
            if (!effectiveKey) effectiveKey = oauthTokens.accessToken;
          }
          if (!copilotApiEndpoint && oauthTokens.copilotApiEndpoint) {
            copilotApiEndpoint = oauthTokens.copilotApiEndpoint;
          }
        } else {
          effectiveKey = oauthTokens.accessToken;
        }
        authOverride = { type: oauthTokens.tokenType || 'Bearer' };
      }
    }

    if (!effectiveKey) {
      return res.status(400).json({ error: `供应商 ${provider.name} 未设置 API Key 或未完成登录授权` });
    }

    // Create a working copy with the effective key
    const workingProvider = {
      ...provider,
      apiKey: effectiveKey,
      _isCopilot: isCopilot,
      ...(copilotApiEndpoint ? { _copilotApiEndpoint: copilotApiEndpoint } : {}),
    };
    if (authOverride) {
      workingProvider.authType = 'bearer';
    }

    const model = normalizeChatModel(providerId, provider, modelId);
    if (!model) {
      return res.status(400).json({ error: `模型 ${modelId} 不存在` });
    }

    if (!isChatModel(model)) {
      return res.status(400).json({ error: `模型 ${modelId} 不是聊天模型，请选择 text 类型模型` });
    }

    // Text chat - route by provider / API format
    if (providerId === 'custom' && model.id.includes('claude')) {
      const anthropicWorkingProvider = { ...workingProvider, apiFormat: 'anthropic' };
      return await handleAnthropicStream(anthropicWorkingProvider, model, messages, res);
    }

    if (providerId === 'openai_codex') {
      return await handleCodexChat(workingProvider, model, messages, res);
    }

    if (providerId === 'minimax') {
      return await handleMiniMaxStream(workingProvider, model, messages, res);
    }

    switch (provider.apiFormat) {
      case 'anthropic':
        return await handleAnthropicStream(workingProvider, model, messages, res);
      case 'google':
        return await handleGoogleChat(workingProvider, model, messages, res);
      case 'baidu':
        return await handleBaiduChat(workingProvider, model, messages, res);
      case 'openai':
      default:
        return await handleOpenAIStream(workingProvider, model, messages, res);
    }
  } catch (error) {
    console.error('Chat error:', error.message);
    if (!logged) {
      logged = true;
      logUsage({
        userId,
        providerId,
        modelId,
        type: 'text',
        tokens: 0,
        success: false,
        errorMsg: error.message
      });
    }
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      try {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.write('data: [DONE]\n\n');
      } catch { /* already closed */ }
      res.end();
    }
  }
});

// ===== Actual Image Generation Endpoint =====
router.post('/images/generations', async (req, res) => {
  const userId = userStorage.getStore()?.userId || 'guest';
  const { providerId, modelId, prompt, style, aspect } = req.body;

  if (userId === 'demo') {
    try {
      const colors = [
        ['#FF416C', '#FF4B2B'],
        ['#4776E6', '#8E54E9'],
        ['#1D976C', '#93F9B9'],
        ['#FF8008', '#FFC837']
      ];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];
      const cleanPrompt = (prompt || 'SpaceDream Mock Image').replace(/"/g, '&quot;');
      const svgString = `<svg width="800" height="450" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${randomColor[0]};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${randomColor[1]};stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="800" height="450" fill="url(#grad)" />
  <circle cx="400" cy="180" r="60" fill="rgba(255,255,255,0.2)" />
  <text x="400" y="195" font-family="system-ui, -apple-system, sans-serif" font-size="48" fill="#ffffff" text-anchor="middle">🎨</text>
  <text x="400" y="290" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="bold" fill="#ffffff" text-anchor="middle">${cleanPrompt.slice(0, 40)}</text>
  <text x="400" y="335" font-family="system-ui, -apple-system, sans-serif" font-size="14" fill="rgba(255,255,255,0.8)" text-anchor="middle">[Demo 演示模式] 纯本地仿真生图，未发起计费请求</text>
</svg>`;
      const filename = `demo-image-${Date.now()}-${Math.floor(Math.random() * 1000)}.svg`;
      const filepath = path.join(__dirname, '..', 'uploads', filename);
      fs.writeFileSync(filepath, svgString.trim(), 'utf-8');
      
      logUsage({
        userId: 'demo',
        providerId,
        modelId,
        type: 'image',
        tokens: 0,
        success: true
      });
      
      return res.json({ success: true, url: `/uploads/${filename}` });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  try {
    if (!providerId || !modelId || !prompt) {
      return res.status(400).json({ error: 'providerId, modelId, and prompt are required' });
    }

    const config = readConfig();
    const provider = config.providers[providerId];
    if (!provider) {
      return res.status(400).json({ error: `未配置供应商: ${providerId}` });
    }

    const modelKey = provider.modelKeys?.[modelId];
    let effectiveKey = modelKey || resolveProviderApiKey(provider);
    const oauthTokens = provider.oauthTokens;
    if (!effectiveKey && oauthTokens?.accessToken) {
      const expired = oauthTokens.expiresAt > 0 && Date.now() > oauthTokens.expiresAt;
      if (!expired) {
        effectiveKey = oauthTokens.accessToken;
      }
    }

    if (!effectiveKey) {
      throw new Error('未找到 API Key 或授权 Token，请先在设置中配置');
    }

    let generatedUrl = '';

    if (provider.apiFormat === 'google') {
      const googleModel = modelId === 'imagen-4' ? 'imagen-3.0-generate-002' : modelId;
      const googleUrl = `${provider.baseUrl}/models/${googleModel}:generateImages?key=${effectiveKey}`;
      const response = await proxyFetch(googleUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: style ? `${prompt} (style: ${style})` : prompt,
          numberOfImages: 1,
          outputMimeType: 'image/jpeg',
          aspectRatio: aspect || '1:1'
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Google API 返回错误 [HTTP ${response.status}]: ${errText.slice(0, 300)}`);
      }

      const data = await response.json();
      const base64Bytes = data.generatedImages?.[0]?.image?.imageBytes;
      if (!base64Bytes) {
        throw new Error('Google API 未返回有效的图片字节数据');
      }

      const buffer = Buffer.from(base64Bytes, 'base64');
      const filename = `imagen-${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`;
      const filepath = path.join(__dirname, '..', 'uploads', filename);
      fs.writeFileSync(filepath, buffer);
      generatedUrl = `/uploads/${filename}`;
    } else {
      const url = buildUrl({ ...provider, apiKey: effectiveKey }, '/images/generations');
      const headers = buildHeaders({ ...provider, apiKey: effectiveKey });

      const sizeMapping = {
        '1:1': '1024x1024',
        '4:3': '1024x768',
        '16:9': '1024x576',
        '9:16': '576x1024'
      };
      let size = sizeMapping[aspect] || '1024x1024';

      if (modelId.includes('cogview-3-plus')) {
        const zhipuSizeMapping = {
          '1:1': '1024x1024',
          '4:3': '1024x768',
          '16:9': '1440x720',
          '9:16': '720x1440'
        };
        size = zhipuSizeMapping[aspect] || '1024x1024';
      } else if (modelId.includes('cogview')) {
        size = '1024x1024';
      }

      const response = await proxyFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelId,
          prompt: style ? `${prompt} (style: ${style})` : prompt,
          n: 1,
          size
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`供应商 API 返回错误 [HTTP ${response.status}]: ${errText.slice(0, 300)}`);
      }

      const data = await response.json();
      const remoteUrl = data.data?.[0]?.url || data.url;
      if (!remoteUrl) {
        throw new Error('供应商 API 未返回有效的图片 URL');
      }

      try {
        const imgRes = await proxyFetch(remoteUrl);
        if (imgRes.ok) {
          const arrayBuffer = await imgRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const filename = `image-${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`;
          const filepath = path.join(__dirname, '..', 'uploads', filename);
          fs.writeFileSync(filepath, buffer);
          generatedUrl = `/uploads/${filename}`;
        } else {
          generatedUrl = remoteUrl;
        }
      } catch (err) {
        console.warn('Failed to cache remote image locally:', err);
        generatedUrl = remoteUrl;
      }
    }

    logUsage({
      userId,
      providerId,
      modelId,
      type: 'image',
      tokens: 0,
      success: true
    });

    return res.json({ success: true, url: generatedUrl });
  } catch (error) {
    console.error('Image generation error, using fallback:', error);
    try {
      const styleQueries = {
        cyberpunk: 'cyberpunk style, neon glowing accents, futuristic digital art',
        anime: 'anime scene, vibrant colors, detailed illustration, key visual',
        realistic: 'photorealistic, dslr photograph, high details, sharp focus, 8k',
        'oil-painting': 'classic oil painting style, rich textures, masterwork brush strokes',
        '3d-render': 'stunning 3d render, octane render style, unreal engine 5 scene'
      };
      const { prompt, style } = req.body;
      const styleSuffix = styleQueries[style] || '';
      const fullPrompt = `${prompt}${styleSuffix ? ', ' + styleSuffix : ''}`;
      const seed = Math.floor(Math.random() * 1000000);
      const fallbackUrl = `https://image.pollinations.ai/p/${encodeURIComponent(fullPrompt)}?width=800&height=450&seed=${seed}&nologo=true`;

      const imgRes = await proxyFetch(fallbackUrl);
      if (imgRes.ok) {
        const arrayBuffer = await imgRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const filename = `image-fallback-${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`;
        const filepath = path.join(__dirname, '..', 'uploads', filename);
        fs.writeFileSync(filepath, buffer);
        
        logUsage({
          userId,
          providerId,
          modelId,
          type: 'image',
          tokens: 0,
          success: true
        });

        return res.json({ success: true, url: `/uploads/${filename}`, isFallback: true, fallbackReason: error.message });
      } else {
        throw new Error(`Fallback response was not OK [HTTP ${imgRes.status}]`);
      }
    } catch (fallbackErr) {
      console.error('Image generation fallback also failed, generating local SVG placeholder:', fallbackErr);
      try {
        const colors = [
          ['#2193b0', '#6dd5ed'],
          ['#ee9ca7', '#ffdde1'],
          ['#00c6ff', '#0072ff'],
          ['#f12711', '#f5af19'],
          ['#a8c0ff', '#3f2b96'],
          ['#11998e', '#38ef7d']
        ];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        const { prompt } = req.body;
        const cleanPrompt = (prompt || 'AI Image').replace(/"/g, '&quot;');

        const svgString = `<svg width="800" height="450" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${randomColor[0]};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${randomColor[1]};stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="800" height="450" fill="url(#grad)" />
  <circle cx="400" cy="185" r="50" fill="rgba(255,255,255,0.15)" />
  <path d="M385 185 L415 185 M400 170 L400 200" stroke="#ffffff" stroke-width="4" stroke-linecap="round" />
  <text x="400" y="290" font-family="system-ui, -apple-system, sans-serif" font-size="26" font-weight="bold" fill="#ffffff" text-anchor="middle">${cleanPrompt.slice(0, 24)}</text>
  <text x="400" y="335" font-family="system-ui, -apple-system, sans-serif" font-size="14" fill="rgba(255,255,255,0.75)" text-anchor="middle">AI 图像创作 platform (本地生成)</text>
</svg>`;

        const filename = `svg-fallback-${Date.now()}-${Math.floor(Math.random() * 1000)}.svg`;
        const filepath = path.join(__dirname, '..', 'uploads', filename);
        fs.writeFileSync(filepath, svgString.trim(), 'utf-8');

        logUsage({
          userId,
          providerId,
          modelId,
          type: 'image',
          tokens: 0,
          success: true
        });

        return res.json({ success: true, url: `/uploads/${filename}`, isLocalFallback: true });
      } catch (svgErr) {
        console.error('Failed to write local SVG fallback:', svgErr);
      }
    }

    logUsage({
      userId,
      providerId,
      modelId,
      type: 'image',
      tokens: 0,
      success: false,
      errorMsg: error.message
    });

    return res.status(500).json({ error: error.message });
  }
});

// ===== Actual Audio/TTS speech Endpoint =====
router.post('/audio/speech', async (req, res) => {
  const userId = userStorage.getStore()?.userId || 'guest';
  const { providerId, modelId, text, voice } = req.body;

  if (userId === 'demo') {
    try {
      const MOCK_MP3_BASE64 = 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU2LjM2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU2LjQxAAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAAAA//MUZAAAAAGkAAAAAAAAA0gAAAAATEFN//MUZAMAAAGkAAAAAAAAA0gAAAAARTMu//MUZAYAAAGkAAAAAAAAA0gAAAAAOTku//MUZAkAAAGkAAAAAAAAA0gAAAAANVVV';
      const filename = `demo-audio-${Date.now()}-${Math.floor(Math.random() * 1000)}.mp3`;
      const filepath = path.join(__dirname, '..', 'uploads', filename);
      fs.writeFileSync(filepath, Buffer.from(MOCK_MP3_BASE64, 'base64'));

      logUsage({
        userId: 'demo',
        providerId,
        modelId,
        type: 'audio',
        tokens: estimateTokens(text),
        success: true
      });

      return res.json({ success: true, url: `/uploads/${filename}` });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  try {
    if (!providerId || !modelId || !text) {
      return res.status(400).json({ error: 'providerId, modelId, and text are required' });
    }

    const config = readConfig();
    const provider = config.providers[providerId];
    if (!provider) {
      return res.status(400).json({ error: `未配置供应商: ${providerId}` });
    }

    const modelKey = provider.modelKeys?.[modelId];
    let effectiveKey = modelKey || resolveProviderApiKey(provider);
    const oauthTokens = provider.oauthTokens;
    if (!effectiveKey && oauthTokens?.accessToken) {
      const expired = oauthTokens.expiresAt > 0 && Date.now() > oauthTokens.expiresAt;
      if (!expired) {
        effectiveKey = oauthTokens.accessToken;
      }
    }

    if (!effectiveKey) {
      return res.status(400).json({ error: '未找到 API Key 或授权 Token，请先在设置中配置' });
    }

    const url = buildUrl({ ...provider, apiKey: effectiveKey }, '/audio/speech');
    const headers = buildHeaders({ ...provider, apiKey: effectiveKey });

    const response = await proxyFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelId,
        input: text,
        voice: voice || 'alloy'
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`供应商 API 返回错误 [HTTP ${response.status}]: ${errText.slice(0, 300)}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const filename = `tts-${Date.now()}-${Math.floor(Math.random() * 1000)}.mp3`;
    const filepath = path.join(__dirname, '..', 'uploads', filename);
    fs.writeFileSync(filepath, buffer);

    logUsage({
      userId,
      providerId,
      modelId,
      type: 'audio',
      tokens: estimateTokens(text),
      success: true
    });

    return res.json({ success: true, url: `/uploads/${filename}` });
  } catch (error) {
    console.error('Audio synthesis error:', error);
    logUsage({
      userId,
      providerId,
      modelId,
      type: 'audio',
      tokens: 0,
      success: false,
      errorMsg: error.message
    });
    return res.status(500).json({ error: error.message });
  }
});

// ===== Actual Video Generation Endpoint =====
router.post('/video/generations', async (req, res) => {
  const userId = userStorage.getStore()?.userId || 'guest';
  const { providerId, modelId, prompt, motion } = req.body;

  if (userId === 'demo') {
    logUsage({
      userId: 'demo',
      providerId,
      modelId,
      type: 'video',
      tokens: 0,
      success: true
    });
    return res.json({ success: true, url: 'https://media.w3.org/2010/05/sintel/trailer_hd.mp4' });
  }

  try {
    if (!providerId || !modelId || !prompt) {
      return res.status(400).json({ error: 'providerId, modelId, and prompt are required' });
    }

    const config = readConfig();
    const provider = config.providers[providerId];
    if (!provider) {
      return res.status(400).json({ error: `未配置供应商: ${providerId}` });
    }

    const modelKey = provider.modelKeys?.[modelId];
    let effectiveKey = modelKey || resolveProviderApiKey(provider);
    const oauthTokens = provider.oauthTokens;
    if (!effectiveKey && oauthTokens?.accessToken) {
      const expired = oauthTokens.expiresAt > 0 && Date.now() > oauthTokens.expiresAt;
      if (!expired) {
        effectiveKey = oauthTokens.accessToken;
      }
    }

    if (!effectiveKey) {
      return res.status(400).json({ error: '未找到 API Key 或授权 Token，请先在设置中配置' });
    }

    const url = buildUrl({ ...provider, apiKey: effectiveKey }, '/video/generations');
    const headers = buildHeaders({ ...provider, apiKey: effectiveKey });

    const response = await proxyFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelId,
        prompt: motion ? `${prompt} (camera: ${motion})` : prompt
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`供应商 API 返回错误 [HTTP ${response.status}]: ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const videoUrl = data.url || data.data?.[0]?.url || data.data?.url;
    if (!videoUrl) {
      throw new Error('供应商 API 未返回有效的视频 URL');
    }

    logUsage({
      userId,
      providerId,
      modelId,
      type: 'video',
      tokens: 0,
      success: true
    });

    return res.json({ success: true, url: videoUrl });
  } catch (error) {
    console.error('Video generation error:', error);
    logUsage({
      userId,
      providerId,
      modelId,
      type: 'video',
      tokens: 0,
      success: false,
      errorMsg: error.message
    });
    return res.status(500).json({ error: error.message });
  }
});

export default router;

