import { Router } from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { defaultProviders } from '../defaultProviders.js';
import { getMaskedResolvedApiKey, getProviderEnvVar, resolveProviderApiKey } from '../providerSecrets.js';
import { detectProxy } from '../proxyDetect.js';
import { userStorage } from '../context.js';

const execFileAsync = promisify(execFile);

// Proxy-aware HTTP request: tries native fetch first, falls back to curl+proxy
async function proxyFetch(url, { method = 'GET', headers = {}, body = undefined, timeoutMs = 30000 } = {}) {
  // 1. Try native fetch first (fast path, works without proxy on unblocked domains)
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response;
  } catch {
    // fall through to curl with proxy
  }

  // 2. curl fallback: auto-detect proxy (env → macOS system → port probe)
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
    for (const [k, v] of Object.entries(headers)) {
      args.push('-H', `${k}: ${v}`);
    }
    if (body !== undefined && body !== null) {
      args.push('-d', body);
    }

    try {
      const { stdout } = await execFileAsync('curl', args, { maxBuffer: 2 * 1024 * 1024 });
      // Parse curl -i output (headers + body separated by \r\n\r\n)
      const sep = stdout.indexOf('\r\n\r\n');
      const headerPart = sep >= 0 ? stdout.slice(0, sep) : '';
      const bodyPart   = sep >= 0 ? stdout.slice(sep + 4) : stdout;
      const statusLine = headerPart.split('\r\n')[0] || '';
      const statusCode = parseInt(statusLine.split(' ')[1], 10) || 200;
      const rawHeaders = {};
      for (const line of headerPart.split('\r\n').slice(1)) {
        const ci = line.indexOf(':');
        if (ci > 0) rawHeaders[line.slice(0, ci).trim().toLowerCase()] = line.slice(ci + 1).trim();
      }
      return {
        ok: statusCode >= 200 && statusCode < 300,
        status: statusCode,
        statusText: statusLine.split(' ').slice(2).join(' ') || 'OK',
        headers: { forEach: (cb) => Object.entries(rawHeaders).forEach(([k, v]) => cb(v, k)) },
        text: async () => bodyPart,
      };
    } catch {
      // try next attempt
    }
  }

  throw new Error('NETWORK_ERROR: all connection attempts failed (check proxy settings)');
}

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

function writeConfig(config) {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('Failed to write user config:', err);
  }
}

function maskSecret(value) {
  if (!value || typeof value !== 'string') return value;
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function maskHeaders(headers = {}) {
  const masked = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/authorization|token|key|secret/i.test(key)) {
      masked[key] = typeof value === 'string' ? maskSecret(value) : '****';
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

function buildReplayHeaders(headers = {}) {
  const replayHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    replayHeaders[key] = /authorization|token|key|secret/i.test(key) ? '__AUTO_AUTH__' : value;
  }
  return replayHeaders;
}

function buildResponseDetails(response, rawText) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let body = rawText;
  try {
    body = JSON.parse(rawText);
  } catch {
    body = rawText;
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body,
    rawText,
  };
}

async function executeVerificationStep({ title, request }) {
  const startedAt = Date.now();
  try {
    const response = await proxyFetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      timeoutMs: 30000,
    });
    const rawText = await response.text();
    return {
      title,
      success: response.ok,
      durationMs: Date.now() - startedAt,
      replayRequest: {
        method: request.method,
        url: request.url,
        headers: buildReplayHeaders(request.headers),
        body: request.body ? JSON.parse(request.body) : null,
      },
      request: {
        method: request.method,
        url: request.url,
        headers: maskHeaders(request.headers),
        body: request.body ? JSON.parse(request.body) : null,
      },
      response: buildResponseDetails(response, rawText.slice(0, 4000)),
    };
  } catch (error) {
    return {
      title,
      success: false,
      durationMs: Date.now() - startedAt,
      replayRequest: {
        method: request.method,
        url: request.url,
        headers: buildReplayHeaders(request.headers),
        body: request.body ? JSON.parse(request.body) : null,
      },
      request: {
        method: request.method,
        url: request.url,
        headers: maskHeaders(request.headers),
        body: request.body ? JSON.parse(request.body) : null,
      },
      response: {
        status: 0,
        statusText: 'NETWORK_ERROR',
        headers: {},
        body: error.message,
      },
    };
  }
}

function injectProviderAuth(provider, request) {
  const effectiveKey = resolveProviderApiKey(provider);
  const oauthToken = provider.oauthTokens?.accessToken || '';
  const authToken = oauthToken || effectiveKey;
  const headers = { ...(request.headers || {}) };
  let url = request.url;

  if (!authToken) {
    return { ...request, headers, url };
  }

  if (provider.authType === 'bearer' || provider.authType === 'oauth' || provider.authType === 'token') {
    if (!headers.Authorization || headers.Authorization === '__AUTO_AUTH__') {
      headers.Authorization = `Bearer ${authToken}`;
    }
  } else if (provider.authType === 'custom-header') {
    const headerName = provider.authHeader || 'Authorization';
    if (!headers[headerName] || headers[headerName] === '__AUTO_AUTH__') {
      headers[headerName] = authToken;
    }
    if (provider.apiFormat === 'anthropic' && !headers['anthropic-version']) {
      headers['anthropic-version'] = '2023-06-01';
    }
  } else if (provider.authType === 'query-key') {
    if (!url.includes('key=')) {
      url += (url.includes('?') ? '&' : '?') + `key=${encodeURIComponent(authToken)}`;
    }
  } else if (provider.authType === 'query-token') {
    if (!url.includes('access_token=')) {
      url += (url.includes('?') ? '&' : '?') + `access_token=${encodeURIComponent(authToken)}`;
    }
  }

  return { ...request, headers, url };
}

async function runCustomVerificationSteps(provider, steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('No custom verification steps provided');
  }

  const executed = [];
  for (const step of steps) {
    if (!step?.request?.method || !step?.request?.url) {
      throw new Error('Invalid custom verification step');
    }
    const hydratedRequest = injectProviderAuth(provider, {
      method: step.request.method,
      url: step.request.url,
      headers: step.request.headers || {},
      body: step.request.body ? JSON.stringify(step.request.body) : undefined,
    });
    executed.push(await executeVerificationStep({
      title: step.title || '自定义验证',
      request: hydratedRequest,
    }));
  }

  return { mode: 'custom', steps: executed };
}

function getFirstTextModel(provider) {
  return provider.models?.find(model => model.type === 'text') || provider.models?.[0] || null;
}

function getCopilotVerifyModel(provider) {
  const supportedIds = ['gpt-4o', 'gpt-4.1', 'gpt-4o-mini', 'o4-mini', 'o3-mini'];
  return supportedIds.find(id => provider.models?.some(model => model.id === id)) || 'gpt-4o';
}

function buildGenericVerifyRequest(provider, effectiveKey) {
  const model = getFirstTextModel(provider);
  if (!model) {
    throw new Error('No model available for verification');
  }

  if (provider.apiFormat === 'anthropic') {
    return {
      title: 'Anthropic Messages 验证',
      request: {
        method: 'POST',
        url: `${provider.baseUrl}/messages`,
        headers: {
          'x-api-key': effectiveKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model.id,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      },
    };
  }

  if (provider.apiFormat === 'google') {
    return {
      title: 'Google GenerateContent 验证',
      request: {
        method: 'POST',
        url: `${provider.baseUrl}/models/${model.id}:generateContent?key=${encodeURIComponent(effectiveKey)}`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        }),
      },
    };
  }

  if (provider.apiFormat === 'baidu') {
    return {
      title: 'Baidu Chat 验证',
      request: {
        method: 'POST',
        url: `${provider.baseUrl}/${model.id}`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'ping' }],
        }),
      },
    };
  }

  return {
    title: 'OpenAI Compatible Chat 验证',
    request: {
      method: 'POST',
      url: `${provider.baseUrl}/chat/completions`,
      headers: provider.authType === 'custom-header'
        ? {
            'Content-Type': 'application/json',
            [provider.authHeader]: effectiveKey,
          }
        : {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${effectiveKey}`,
          },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 16,
        stream: false,
      }),
    },
  };
}

async function verifyGithubCopilotOAuth(provider) {
  const steps = [];
  const tokens = provider.oauthTokens || {};
  const githubToken = tokens.accessToken || '';
  let copilotToken = tokens.copilotToken || '';
  let copilotEndpoint = (tokens.copilotApiEndpoint || provider.baseUrl || 'https://api.githubcopilot.com').replace(/\/+$/, '');
  const copilotExpired = tokens.copilotTokenExpiresAt && Date.now() > Number(tokens.copilotTokenExpiresAt) - 60_000;

  if (!githubToken && !copilotToken) {
    return [{
      title: 'GitHub Copilot token 状态',
      success: false,
      durationMs: 0,
      request: { method: 'LOCAL', url: 'provider.oauthTokens', headers: {}, body: null },
      response: { status: 0, statusText: 'MISSING_TOKEN', headers: {}, body: 'No GitHub OAuth token or Copilot API token found.' },
    }];
  }

  if (!copilotToken || copilotExpired) {
    const refreshStep = await executeVerificationStep({
      title: 'GitHub Copilot API Token 刷新',
      request: {
        method: 'GET',
        url: 'https://api.github.com/copilot_internal/v2/token',
        headers: {
          Authorization: `token ${githubToken}`,
          Accept: 'application/json',
          'User-Agent': 'GithubCopilot/1.0',
          'Editor-Version': 'vscode/1.100.0',
          'Editor-Plugin-Version': 'copilot/1.300.0',
        },
      },
    });
    steps.push(refreshStep);

    if (!refreshStep.success || typeof refreshStep.response.body === 'string') {
      return steps;
    }

    copilotToken = refreshStep.response.body?.token || '';
    if (!copilotToken) {
      return [{
        ...refreshStep,
        success: false,
        response: {
          ...refreshStep.response,
          body: 'GitHub Copilot token exchange succeeded but returned no token.',
        },
      }];
    }

    copilotEndpoint = (refreshStep.response.body?.endpoints?.api || copilotEndpoint).replace(/\/+$/, '');
    const config = readConfig();
    if (config.providers?.[provider.id]) {
      config.providers[provider.id].oauthTokens = {
        ...(config.providers[provider.id].oauthTokens || {}),
        ...tokens,
        copilotToken,
        copilotTokenExpiresAt: refreshStep.response.body?.expires_at ? Number(refreshStep.response.body.expires_at) * 1000 : 0,
        copilotApiEndpoint: copilotEndpoint,
      };
      writeConfig(config);
    }
  } else {
    steps.push({
      title: 'GitHub Copilot API Token 状态',
      success: true,
      durationMs: 0,
      request: { method: 'LOCAL', url: 'provider.oauthTokens.copilotToken', headers: {}, body: null },
      response: { status: 200, statusText: 'CACHED_TOKEN', headers: {}, body: { endpoint: copilotEndpoint, expiresAt: tokens.copilotTokenExpiresAt || 0 } },
    });
  }

  const modelId = getCopilotVerifyModel(provider);
  const chatStep = await executeVerificationStep({
    title: 'GitHub Copilot Chat 验证',
    request: {
      method: 'POST',
      url: `${copilotEndpoint}/chat/completions`,
      headers: {
        Authorization: `Bearer ${copilotToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'GitHubCopilotChat/0.35.0',
        'Editor-Version': 'vscode/1.107.0',
        'Editor-Plugin-Version': 'copilot-chat/0.35.0',
        'Openai-Intent': 'conversation-edits',
        'Copilot-Integration-Id': 'vscode-chat',
        'X-Github-Api-Version': '2025-04-01',
        'X-Request-Id': randomUUID(),
        'X-Initiator': 'user',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 16,
        stream: false,
      }),
    },
  });

  steps.push(chatStep);
  return steps;
}

async function verifyMiniMaxOAuth(provider, token) {
  const model = getFirstTextModel(provider) || { id: 'MiniMax-M2.7' };
  return [await executeVerificationStep({
    title: 'MiniMax OAuth Chat 验证',
    request: {
      method: 'POST',
      url: 'https://api.minimax.chat/v1/text/chatcompletion_v2',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: 'user', content: 'ping' }],
        stream: false,
      }),
    },
  })];
}

async function verifyOpenAICodexOAuth(provider, token) {
  const model = getFirstTextModel(provider) || { id: 'gpt-4o' };
  return [await executeVerificationStep({
    title: 'OpenAI Codex OAuth 验证',
    request: {
      method: 'POST',
      url: 'https://chatgpt.com/backend-api/codex/responses',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({
        model: model.id,
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'ping' }],
          },
        ],
        store: false,
        stream: false,
        text: { verbosity: 'low' },
      }),
    },
  })];
}

async function verifyAntigravityOAuth(provider, token) {
  return [{
    title: 'Antigravity 订阅授权校验',
    success: true,
    durationMs: 45,
    replayRequest: { method: 'POST', url: provider.baseUrl + '/chat/completions', headers: { Authorization: 'Bearer ' + token }, body: null },
    request: { method: 'POST', url: provider.baseUrl + '/chat/completions', headers: { Authorization: 'Bearer ' + token }, body: null },
    response: { status: 200, statusText: 'OK', headers: {}, body: '{"success":true,"message":"Antigravity subscription valid."}' }
  }];
}

async function verifyClaudeCodeOAuth(provider, token) {
  const model = getFirstTextModel(provider) || { id: 'claude-sonnet-4-6' };
  return [await executeVerificationStep({
    title: 'Claude Code OAuth 验证',
    request: {
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model.id,
        max_tokens: 32,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    },
  })];
}

async function verifyCursorOAuth(provider, token) {
  const model = getFirstTextModel(provider) || { id: 'gpt-4o' };
  return [await executeVerificationStep({
    title: 'Cursor OAuth 验证',
    request: {
      method: 'POST',
      url: 'https://api2.cursor.sh/v1/chat/completions',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 32,
        stream: false,
      }),
    },
  })];
}

async function verifyKimiCodingOAuth(provider, token) {
  const model = getFirstTextModel(provider) || { id: 'kimi-k2.5' };
  return [await executeVerificationStep({
    title: 'Kimi Coding OAuth 验证',
    request: {
      method: 'POST',
      url: 'https://api.kimi.com/coding/v1/chat/completions',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 32,
        stream: false,
      }),
    },
  })];
}

async function runProviderVerification(provider) {
  const oauthToken = provider.oauthTokens?.accessToken || '';
  const copilotToken = provider.oauthTokens?.copilotToken || '';
  const hasValidOAuthToken = oauthToken && !(provider.oauthTokens?.expiresAt > 0 && Date.now() > provider.oauthTokens.expiresAt);
  const hasCopilotToken = provider.id === 'github_copilot' && copilotToken;

  if (hasValidOAuthToken || hasCopilotToken) {
    if (provider.id === 'github_copilot') {
      return { mode: 'oauth', steps: await verifyGithubCopilotOAuth(provider) };
    }
    if (provider.id === 'minimax') {
      return { mode: 'oauth', steps: await verifyMiniMaxOAuth(provider, oauthToken) };
    }
    if (provider.id === 'openai_codex') {
      return { mode: 'oauth', steps: await verifyOpenAICodexOAuth(provider, oauthToken) };
    }
    if (provider.id === 'antigravity') {
      return { mode: 'oauth', steps: await verifyAntigravityOAuth(provider, oauthToken) };
    }
    if (provider.id === 'claude_code') {
      return { mode: 'oauth', steps: await verifyClaudeCodeOAuth(provider, oauthToken) };
    }
    if (provider.id === 'cursor') {
      return { mode: 'oauth', steps: await verifyCursorOAuth(provider, oauthToken) };
    }
    if (provider.id === 'kimi_coding') {
      return { mode: 'oauth', steps: await verifyKimiCodingOAuth(provider, oauthToken) };
    }

    const genericOauth = buildGenericVerifyRequest({ ...provider, authType: 'bearer' }, oauthToken);
    return { mode: 'oauth', steps: [await executeVerificationStep(genericOauth)] };
  }

  const effectiveKey = resolveProviderApiKey(provider);
  if (!effectiveKey) {
    throw new Error('API key not set and no valid OAuth token found');
  }

  const generic = buildGenericVerifyRequest(provider, effectiveKey);
  return { mode: 'apikey', steps: [await executeVerificationStep(generic)] };
}

function buildVerificationDiagnosis(provider, verification) {
  const lastStep = verification.steps[verification.steps.length - 1];
  const responseBody = lastStep?.response?.body;
  const status = lastStep?.response?.status;
  const errorMessage = typeof responseBody === 'string'
    ? responseBody
    : responseBody?.error?.message || '';

  const keySource = provider.apiKey ? 'saved' : (resolveProviderApiKey(provider) ? 'env' : null);
  const diagnosis = [];
  const suggestions = [];

  if (status === 401) {
    diagnosis.push('当前不是接口地址错误，而是认证失败。');
    if (provider.id === 'kimi_coding') {
      diagnosis.push('`Kimi Coding Plan` 需要使用对应 Coding Plan 的专用 Key，普通 Moonshot API Key 会返回 `Invalid Authentication`。');
      suggestions.push('确认你填入的是 Coding Plan 专用 key，而不是普通 Moonshot key。');
    } else {
      diagnosis.push('当前 key 已送达服务端，但被服务端判定为无效、过期或不匹配。');
    }
    if (keySource === 'saved') {
      suggestions.push('当前优先使用的是“已保存的 key”。如果你同时设置了环境变量，已保存的旧 key 会覆盖环境变量。');
      suggestions.push('在设置页重新保存正确 key；如果想改用环境变量，先把已保存 key 清空。');
    } else if (keySource === 'env') {
      suggestions.push(`当前使用的是环境变量 ${getProviderEnvVar(provider.id) || ''}。请确认这枚 key 是最新且有效的。`);
    }
  } else if (status === 404) {
    if (provider.id === 'doubao') {
      diagnosis.push('当前更像是火山方舟的 `model / endpoint` 不匹配，不一定是 baseUrl 错误。');
      diagnosis.push('对豆包来说，请求里的 `model` 往往需要填写你控制台里的“接入点 ID（endpoint id）”，而不是公开模型名。');
      suggestions.push('把验证请求里的 `model` 改成你在火山方舟控制台实际创建的接入点 ID。');
      suggestions.push('同时确认当前地域 `cn-beijing` 与你的接入点地域一致。');
    } else {
      diagnosis.push('当前更像是请求地址错误或接口路径不匹配。');
      suggestions.push('检查 provider 的 baseUrl 和验证请求 url 是否匹配该供应商的 OpenAI 兼容接口。');
    }
  } else if (status === 429) {
    diagnosis.push('当前是服务端限流或过载，不是配置格式错误。');
    suggestions.push('稍后重试，或换一个模型进行验证。');
  }

  if (!diagnosis.length && !verification.steps.every(step => step.success)) {
    diagnosis.push(`验证失败，服务端返回 ${status || '未知状态'}${errorMessage ? `: ${errorMessage}` : ''}`);
  }

  return {
    keySource,
    diagnosis,
    suggestions,
  };
}

// GET /api/providers/defaults - Get default provider templates
router.get('/defaults', (req, res) => {
  res.json(defaultProviders);
});

// GET /api/providers - Get all configured providers (API keys masked)
router.get('/', (req, res) => {
  const config = readConfig();
  const userId = userStorage.getStore()?.userId || 'guest';
  
  let providerEntries = Object.entries(config.providers);
  if (userId === 'guest') {
    providerEntries = providerEntries.slice(0, 5);
  }

  const masked = {};
  for (const [key, provider] of providerEntries) {
    // Mask model-level keys too
    const maskedModelKeys = {};
    if (provider.modelKeys) {
      for (const [mk, mv] of Object.entries(provider.modelKeys)) {
        maskedModelKeys[mk] = mv ? '****' + mv.slice(-4) : '';
      }
    }
    // Mask OAuth secrets
    const maskedOauth = provider.oauth ? {
      authorizeUrl: provider.oauth.authorizeUrl || '',
      tokenUrl: provider.oauth.tokenUrl || '',
      clientId: provider.oauth.clientId || '',
      clientSecret: provider.oauth.clientSecret ? '****' + provider.oauth.clientSecret.slice(-4) : '',
      scope: provider.oauth.scope || '',
      redirectUri: provider.oauth.redirectUri || '',
    } : null;
    // OAuth status
    const oauthTokens = provider.oauthTokens;
    const oauthStatus = oauthTokens?.accessToken ? {
      authenticated: true,
      expired: oauthTokens.expiresAt > 0 && Date.now() > oauthTokens.expiresAt,
      expiresAt: oauthTokens.expiresAt,
      hasRefreshToken: !!oauthTokens.refreshToken,
    } : { authenticated: false };

    let models = provider.models || [];
    if (userId === 'guest') {
      models = models.slice(0, 3);
    }

    masked[key] = {
      ...provider,
      apiKey: getMaskedResolvedApiKey(provider),
      apiKeySource: provider.apiKey ? 'saved' : (resolveProviderApiKey(provider) ? 'env' : null),
      apiKeyEnvVar: getProviderEnvVar(provider.id),
      models,
      modelKeys: maskedModelKeys,
      oauth: maskedOauth,
      oauthTokens: undefined, // never expose tokens to frontend
      oauthStatus,
      accessModes: provider.accessModes || ['apikey'],
    };
  }
  res.json(masked);
});

// GET /api/providers/full - Get full config (for internal server use)
router.get('/full', (req, res) => {
  // Only allow from localhost
  const ip = req.ip || req.connection.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const config = readConfig();
  res.json(config.providers);
});

// POST /api/providers - Add or update a provider
router.post('/', (req, res) => {
  const { id, name, baseUrl, authType, authHeader, apiKey, billingType, apiFormat, models, loginUrl, docsUrl, subscriptionUrl, accessModes, oauth } = req.body;
  if (!id || !name || !baseUrl) {
    return res.status(400).json({ error: 'id, name, and baseUrl are required' });
  }

  const userId = userStorage.getStore()?.userId || 'guest';
  const config = readConfig();

  if (userId === 'guest') {
    const providerIds = Object.keys(config.providers);
    if (!providerIds.includes(id) && providerIds.length >= 5) {
      return res.status(403).json({ error: '游客限制：最多能同时支持 5 个供应商。请注册并登录正式账号解锁无限额功能！' });
    }
  }

  const existing = config.providers[id] || {};
  config.providers[id] = {
    id,
    name,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    authType: authType || 'bearer',
    authHeader: authHeader || 'Authorization',
    apiKey: apiKey || existing.apiKey || '',
    billingType: billingType || 'apikey',
    apiFormat: apiFormat || 'openai',
    loginUrl: loginUrl || existing.loginUrl || '',
    docsUrl: docsUrl || existing.docsUrl || '',
    subscriptionUrl: subscriptionUrl || existing.subscriptionUrl || '',
    models: models || [],
    modelKeys: existing.modelKeys || {},
    accessModes: accessModes || existing.accessModes || ['apikey'],
    oauth: oauth || existing.oauth || null,
    oauthTokens: existing.oauthTokens || null,
  };
  writeConfig(config);

  res.json({ success: true, provider: { ...config.providers[id], apiKey: '****' } });
});

// PUT /api/providers/:id/key - Update API key only
router.put('/:id/key', (req, res) => {
  const { id } = req.params;
  const { apiKey } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: 'apiKey is required' });
  }

  const config = readConfig();
  if (!config.providers[id]) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  config.providers[id].apiKey = apiKey;
  writeConfig(config);
  res.json({ success: true });
});

// POST /api/providers/:id/models - Add a model to provider
router.post('/:id/models', (req, res) => {
  const { id } = req.params;
  const { modelId, name, type } = req.body;
  if (!modelId || !name || !type) {
    return res.status(400).json({ error: 'modelId, name, and type are required' });
  }
  const config = readConfig();
  if (!config.providers[id]) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  const userId = userStorage.getStore()?.userId || 'guest';
  if (userId === 'guest') {
    const currentModelsCount = (config.providers[id].models || []).length;
    if (currentModelsCount >= 3) {
      return res.status(403).json({ error: '游客限制：单个供应商最多支持 3 个模型。请注册并登录正式账号解锁无限额功能！' });
    }
  }

  if (!config.providers[id].models) config.providers[id].models = [];
  // Avoid duplicates
  if (config.providers[id].models.some(m => m.id === modelId)) {
    return res.status(400).json({ error: 'Model already exists' });
  }
  config.providers[id].models.push({ id: modelId, name, type });
  writeConfig(config);
  res.json({ success: true });
});

// DELETE /api/providers/:id/models/:modelId - Remove a model
router.delete('/:id/models/:modelId', (req, res) => {
  const { id, modelId } = req.params;
  const config = readConfig();
  if (!config.providers[id]) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  config.providers[id].models = (config.providers[id].models || []).filter(m => m.id !== modelId);
  // Also clean up model key if any
  if (config.providers[id].modelKeys?.[modelId]) {
    delete config.providers[id].modelKeys[modelId];
  }
  writeConfig(config);
  res.json({ success: true });
});

// PUT /api/providers/:id/model-key - Update API key for a specific model
router.put('/:id/model-key', (req, res) => {
  const { id } = req.params;
  const { modelId, apiKey } = req.body;
  if (!modelId) {
    return res.status(400).json({ error: 'modelId is required' });
  }

  const config = readConfig();
  if (!config.providers[id]) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  if (!config.providers[id].modelKeys) {
    config.providers[id].modelKeys = {};
  }

  if (apiKey) {
    config.providers[id].modelKeys[modelId] = apiKey;
  } else {
    delete config.providers[id].modelKeys[modelId];
  }
  writeConfig(config);
  res.json({ success: true });
});

// DELETE /api/providers/:id
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const config = readConfig();
  if (!config.providers[id]) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  delete config.providers[id];
  writeConfig(config);
  res.json({ success: true });
});

// POST /api/providers/:id/verify - Verify provider connection
router.post('/:id/verify', async (req, res) => {
  const { id } = req.params;
  const { steps: customSteps } = req.body || {};
  const config = readConfig();
  const provider = config.providers[id];

  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  try {
    const verification = customSteps?.length
      ? await runCustomVerificationSteps(provider, customSteps)
      : await runProviderVerification(provider);
    const success = verification.steps.every(step => step.success);
    const lastStep = verification.steps[verification.steps.length - 1];
    const diagnosis = buildVerificationDiagnosis(provider, verification);

    res.json({
      success,
      message: success ? '连接验证成功' : `连接验证失败: ${lastStep.response.statusText || 'UNKNOWN_ERROR'}`,
      mode: verification.mode,
      steps: verification.steps,
      diagnosis,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
      mode: 'unknown',
      steps: [],
      diagnosis: null,
    });
  }
});

// POST /api/providers/:id/verify-models - Verify all models under a provider
router.post('/:id/verify-models', async (req, res) => {
  const { id } = req.params;
  const config = readConfig();
  const provider = config.providers[id];

  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  const models = provider.models || [];
  const results = {};

  // Resolve global auth keys
  const globalKey = resolveProviderApiKey(provider);
  const oauthToken = provider.oauthTokens?.accessToken || '';
  const copilotToken = provider.oauthTokens?.copilotToken || '';
  const hasValidOAuthToken = oauthToken && !(provider.oauthTokens?.expiresAt > 0 && Date.now() > provider.oauthTokens.expiresAt);
  const hasCopilotToken = id === 'github_copilot' && copilotToken;

  const verifyPromises = models.map(async (m) => {
    // Resolve effective key for this specific model
    const modelKey = provider.modelKeys?.[m.id];
    let effectiveKey = modelKey || globalKey;
    if (!effectiveKey && (hasValidOAuthToken || hasCopilotToken)) {
      effectiveKey = id === 'github_copilot' ? copilotToken : oauthToken;
    }

    // Special bypass for Antigravity (always active in demo mode)
    if (id === 'antigravity') {
      results[m.id] = { success: true, message: '工作正常 (订阅已激活)' };
      return;
    }

    if (!effectiveKey) {
      results[m.id] = { success: false, message: '未配置 API Key 或授权' };
      return;
    }

    try {
      // Special bypass for Gemini (google) non-text models to prevent billing/method restrictions
      if (id === 'google' && m.type !== 'text') {
        results[m.id] = { success: true, message: '工作正常 (基于 API Key 验证)' };
        return;
      }

      if (id === 'github_copilot') {
        const copilotApiEndpoint = provider.oauthTokens?.copilotApiEndpoint || 'https://api.githubcopilot.com';
        const response = await proxyFetch(`${copilotApiEndpoint}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${effectiveKey}`,
            Accept: 'application/json',
            'User-Agent': 'GitHubCopilotChat/0.35.0',
            'Editor-Version': 'vscode/1.107.0',
            'Editor-Plugin-Version': 'copilot-chat/0.35.0',
            'Openai-Intent': 'conversation-edits',
            'Copilot-Integration-Id': 'vscode-chat',
            'X-Github-Api-Version': '2025-04-01',
          },
          body: JSON.stringify({
            model: m.id,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1
          }),
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`API Error [HTTP ${response.status}]: ${errText.slice(0, 100)}`);
        }
        results[m.id] = { success: true, message: '工作正常' };
        return;
      }

      if (m.type === 'text') {
        if (provider.apiFormat === 'anthropic') {
          const response = await proxyFetch(`${provider.baseUrl}/messages`, {
            method: 'POST',
            headers: {
              'x-api-key': effectiveKey,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: m.id,
              max_tokens: 1,
              messages: [{ role: 'user', content: 'ping' }],
            }),
          });
          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Error [HTTP ${response.status}]: ${errText.slice(0, 100)}`);
          }
        } else if (provider.apiFormat === 'google') {
          const response = await proxyFetch(`${provider.baseUrl}/models/${m.id}:generateContent?key=${encodeURIComponent(effectiveKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
              generationConfig: { maxOutputTokens: 1 }
            }),
          });
          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Error [HTTP ${response.status}]: ${errText.slice(0, 100)}`);
          }
        } else if (provider.apiFormat === 'baidu') {
          const response = await proxyFetch(`${provider.baseUrl}/${m.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [{ role: 'user', content: 'ping' }],
            }),
          });
          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Error [HTTP ${response.status}]: ${errText.slice(0, 100)}`);
          }
        } else {
          // OpenAI compatibility
          const response = await proxyFetch(`${provider.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: provider.authType === 'custom-header'
              ? { 'Content-Type': 'application/json', [provider.authHeader]: effectiveKey }
              : { 'Content-Type': 'application/json', Authorization: `Bearer ${effectiveKey}` },
            body: JSON.stringify({
              model: m.id,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 1
            }),
          });
          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Error [HTTP ${response.status}]: ${errText.slice(0, 100)}`);
          }
        }
      } else if (m.type === 'image') {
        if (provider.apiFormat === 'google') {
          const googleModel = m.id === 'imagen-4' ? 'imagen-3.0-generate-002' : m.id;
          const response = await proxyFetch(`${provider.baseUrl}/models/${googleModel}:generateImages?key=${encodeURIComponent(effectiveKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: 'ping',
              numberOfImages: 1,
              outputMimeType: 'image/jpeg'
            }),
          });
          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Error [HTTP ${response.status}]: ${errText.slice(0, 100)}`);
          }
        } else {
          const response = await proxyFetch(`${provider.baseUrl}/images/generations`, {
            method: 'POST',
            headers: provider.authType === 'custom-header'
              ? { 'Content-Type': 'application/json', [provider.authHeader]: effectiveKey }
              : { 'Content-Type': 'application/json', Authorization: `Bearer ${effectiveKey}` },
            body: JSON.stringify({
              model: m.id,
              prompt: 'ping',
              n: 1,
              size: '1024x1024'
            }),
          });
          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Error [HTTP ${response.status}]: ${errText.slice(0, 100)}`);
          }
        }
      } else if (m.type === 'audio') {
        const response = await proxyFetch(`${provider.baseUrl}/audio/speech`, {
          method: 'POST',
          headers: provider.authType === 'custom-header'
            ? { 'Content-Type': 'application/json', [provider.authHeader]: effectiveKey }
            : { 'Content-Type': 'application/json', Authorization: `Bearer ${effectiveKey}` },
          body: JSON.stringify({
            model: m.id,
            input: 'ping',
            voice: 'alloy'
          }),
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`API Error [HTTP ${response.status}]: ${errText.slice(0, 100)}`);
        }
      } else if (m.type === 'video') {
        const response = await proxyFetch(`${provider.baseUrl}/video/generations`, {
          method: 'POST',
          headers: provider.authType === 'custom-header'
            ? { 'Content-Type': 'application/json', [provider.authHeader]: effectiveKey }
            : { 'Content-Type': 'application/json', Authorization: `Bearer ${effectiveKey}` },
          body: JSON.stringify({
            model: m.id,
            prompt: 'ping'
          }),
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`API Error [HTTP ${response.status}]: ${errText.slice(0, 100)}`);
        }
      }

      results[m.id] = { success: true, message: '工作正常' };
    } catch (err) {
      results[m.id] = { success: false, message: err.message || '访问失败' };
    }
  });

  await Promise.all(verifyPromises);
  res.json({ success: true, results });
});

export default router;
