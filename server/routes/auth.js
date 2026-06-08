import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { defaultProviders } from '../defaultProviders.js';
import { detectProxy } from '../proxyDetect.js';
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
const oauthStatePath = path.join(__dirname, '..', 'data', 'oauth-state.json');
const COPILOT_PROVIDER_ID = 'github_copilot';
const OPENAI_CODEX_PROVIDER_ID = 'openai_codex';
const CLAUDE_CODE_PROVIDER_ID = 'claude_code';
const CURSOR_PROVIDER_ID = 'cursor';
const GITHUB_DEVICE_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const OPENAI_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_CODEX_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const OPENAI_CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const OPENAI_CODEX_SCOPE = 'openid profile email offline_access';
const CLAUDE_CODE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CLAUDE_CODE_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const CLAUDE_CODE_TOKEN_URL = 'https://api.anthropic.com/v1/oauth/token';
const CLAUDE_CODE_REDIRECT_URI = 'http://localhost:54545/callback';
const CLAUDE_CODE_SCOPE = 'user:profile user:inference';
const CURSOR_LOGIN_URL = 'https://cursor.com/loginDeepControl';
const CURSOR_POLL_URL = 'https://api2.cursor.sh/auth/poll';
const CURSOR_REFRESH_URL = 'https://api2.cursor.sh/auth/exchange_user_api_key';
const KIMI_PROVIDER_ID = 'kimi_coding';
const KIMI_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';
const KIMI_OAUTH_HOST = 'https://auth.kimi.com';
const KIMI_DEVICE_CODE_URL = KIMI_OAUTH_HOST + '/api/oauth/device_authorization';
const KIMI_TOKEN_URL = KIMI_OAUTH_HOST + '/api/oauth/token';
const execFileAsync = promisify(execFile);
const AUTH_DEBUG_PATH = path.join(__dirname, '..', 'data', 'auth-debug.tmp.log');

function maskSecret(value) {
  if (!value || typeof value !== 'string') return value;
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function safeAuthPayload(payload) {
  if (payload === null || payload === undefined) return payload;
  if (typeof payload === 'string') return payload.length > 400 ? payload.slice(0, 400) + '...(truncated)' : payload;
  if (Array.isArray(payload)) return payload.map(safeAuthPayload);
  if (typeof payload !== 'object') return payload;

  const masked = {};
  for (const [key, value] of Object.entries(payload)) {
    if (/token|secret|authorization|code_verifier|access_token|refresh_token/i.test(key)) {
      masked[key] = typeof value === 'string' ? maskSecret(value) : '****';
    } else if (typeof value === 'object') {
      masked[key] = safeAuthPayload(value);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

function appendAuthDebug(event, payload = {}) {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event,
      payload: safeAuthPayload(payload),
    });
    fs.appendFileSync(AUTH_DEBUG_PATH, line + '\n');
  } catch {
    // ignore debug log errors
  }
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
    console.error('Failed to write user config in auth:', err);
  }
}

function ensureProviderInConfig(providerId) {
  const config = readConfig();
  if (!config.providers[providerId] && defaultProviders[providerId]) {
    config.providers[providerId] = {
      id: providerId,
      ...defaultProviders[providerId],
      apiKey: '',
      modelKeys: {},
      oauthTokens: null,
    };
    writeConfig(config);
  }
  return config.providers[providerId] || null;
}

function readOAuthState() {
  try { return JSON.parse(fs.readFileSync(oauthStatePath, 'utf-8')); }
  catch { return {}; }
}

function writeOAuthState(state) {
  fs.writeFileSync(oauthStatePath, JSON.stringify(state, null, 2));
}

async function readResponsePayload(response) {
  const rawText = await response.text();

  try {
    return {
      rawText,
      body: rawText ? JSON.parse(rawText) : null,
    };
  } catch {
    return {
      rawText,
      body: rawText || null,
    };
  }
}

async function fetchJson(url, init = {}) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timeoutId);
    const payload = await readResponsePayload(response);
    return {
      ok: response.ok,
      status: response.status,
      body: payload.body,
      rawText: payload.rawText,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      rawText: error.message || 'Request failed',
      transportError: error.message || 'Request failed',
    };
  }
}

async function curlJsonRequest({ method = 'POST', url, headers = {}, body = null, timeoutSeconds = 30 }) {
  // Auto-detect proxy: env vars → macOS system proxy → port probe
  const proxyUrl = await detectProxy();

  // If proxy found: try proxy first, then direct fallback
  // If no proxy: try direct first, then let curl pick up any OS env proxy
  const attempts = proxyUrl
    ? [{ proxyArg: proxyUrl }, { noProxy: true }]
    : [{ noProxy: true }, {}];

  let lastError = 'curl request failed';

  for (const attempt of attempts) {
    const args = ['-sS', '--max-time', String(timeoutSeconds), '-X', method, url];

    if (attempt.noProxy) {
      args.push('--noproxy', '*');
    } else if (attempt.proxyArg) {
      args.push('--proxy', attempt.proxyArg);
    }

    for (const [key, value] of Object.entries(headers)) {
      args.push('-H', `${key}: ${value}`);
    }

    if (body !== null && body !== undefined) {
      args.push('-d', typeof body === 'string' ? body : JSON.stringify(body));
    }

    try {
      const { stdout } = await execFileAsync('curl', args, { maxBuffer: 1024 * 1024 });
      let parsed = null;
      try {
        parsed = stdout ? JSON.parse(stdout) : null;
      } catch {
        parsed = stdout || null;
      }

      return {
        ok: true,
        status: 200,
        body: parsed,
        rawText: stdout,
      };
    } catch (error) {
      lastError = error.stderr || error.stdout || error.message || 'curl request failed';
      // continue to next attempt
    }
  }

  return {
    ok: false,
    status: 0,
    body: null,
    rawText: lastError,
    transportError: lastError,
  };
}

async function verifyGithubCopilotAccess(githubToken) {
  const userResponse = await fetchJson('https://api.github.com/user', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'AI-Model-Hub/1.0',
    },
  });

  if (!userResponse.ok || !userResponse.body?.login) {
    return {
      success: false,
      stage: 'github_user',
      error: userResponse.transportError || 'GitHub 登录成功，但读取 GitHub 用户信息失败。',
      response: userResponse,
    };
  }

  const copilotResponse = await fetchJson('https://api.github.com/copilot_internal/v2/token', {
    method: 'GET',
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: 'application/json',
      'User-Agent': 'GitHubCopilotChat/0.35.0',
    },
  });

  if (!copilotResponse.ok || !copilotResponse.body?.token) {
    return {
      success: false,
      stage: 'copilot_token',
      user: userResponse.body,
      error: copilotResponse.transportError || copilotResponse.body?.message || 'GitHub OAuth 已完成，但当前账号没有可用的 Copilot 订阅或 token 兑换失败。',
      response: copilotResponse,
    };
  }

  return {
    success: true,
    stage: 'copilot_token',
    user: userResponse.body,
    response: copilotResponse,
  };
}

function saveCopilotOAuthTokens(tokenData, copilotApiToken = null) {
  const config = readConfig();
  const provider = config.providers[COPILOT_PROVIDER_ID];

  if (!provider) {
    throw new Error('GitHub Copilot provider not found');
  }

  provider.oauthTokens = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || '',
    expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : 0,
    tokenType: tokenData.token_type || 'Bearer',
    scope: tokenData.scope || provider.oauth?.scope || 'read:user user:email',
  };

  // Store Copilot API JWT separately (short-lived, auto-refreshed)
  if (copilotApiToken) {
    provider.oauthTokens.copilotToken = copilotApiToken.token;
    provider.oauthTokens.copilotTokenExpiresAt = copilotApiToken.expires_at
      ? copilotApiToken.expires_at * 1000
      : Date.now() + 30 * 60 * 1000;
    // Persist dynamic API endpoint from JWT response (per CLIProxyAPIPlus ensureAPIToken)
    if (copilotApiToken.endpoints?.api) {
      provider.oauthTokens.copilotApiEndpoint = copilotApiToken.endpoints.api.replace(/\/$/, '');
    }
  }

  writeConfig(config);
}

function saveProviderOAuthTokens(providerId, tokenData, fallbackScope = '') {
  const config = readConfig();
  const provider = config.providers[providerId];

  if (!provider) {
    throw new Error(`Provider not found: ${providerId}`);
  }

  provider.oauthTokens = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || '',
    expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : 0,
    tokenType: tokenData.token_type || 'Bearer',
    scope: tokenData.scope || fallbackScope || provider.oauth?.scope || '',
  };

  // Ensure oauth config (clientId, URLs, scope) is persisted from defaults
  const defProvider = defaultProviders[providerId];
  if (defProvider?.oauth && !provider.oauth?.clientId) {
    provider.oauth = { ...(provider.oauth || {}), ...defProvider.oauth };
  }

  writeConfig(config);
}


function sanitizeCopilotPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  return {
    ...payload,
    token: payload.token ? `****${String(payload.token).slice(-4)}` : payload.token,
  };
}

// OAuth config for known providers that support subscription/OAuth login
const OAUTH_CONFIGS = {
  baidu: {
    authorizeUrl: 'https://openapi.baidu.com/oauth/2.0/authorize',
    tokenUrl: 'https://openapi.baidu.com/oauth/2.0/token',
    scope: 'basic',
    // Users must fill in their own clientId/clientSecret in provider config
  },
  // Generic template — providers can configure their own OAuth endpoints
};

/**
 * GET /api/auth/login/:providerId
 * Start OAuth flow: redirect user to provider's login page
 */
router.get('/login/:providerId', (req, res) => {
  const { providerId } = req.params;
  if (providerId === COPILOT_PROVIDER_ID) {
    return res.redirect('/copilot-verify.html');
  }
  if (providerId === OPENAI_CODEX_PROVIDER_ID) {
    return res.redirect('/codex-verify.html');
  }
  if (providerId === CLAUDE_CODE_PROVIDER_ID) {
    return res.redirect('/claude-code-verify.html');
  }
  if (providerId === CURSOR_PROVIDER_ID) {
    return res.redirect('/cursor-verify.html');
  }
  if (providerId === KIMI_PROVIDER_ID) {
    return res.redirect('/kimi-verify.html');
  }

  const config = readConfig();
  const provider = config.providers[providerId];

  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  const oauth = provider.oauth || {};
  const authorizeUrl = oauth.authorizeUrl;
  const clientId = oauth.clientId;
  const redirectUri = oauth.redirectUri || `${req.protocol}://${req.get('host')}/api/auth/callback/${providerId}`;

  if (!authorizeUrl || !clientId) {
    return res.status(400).json({ error: 'OAuth not configured for this provider. Please set authorizeUrl and clientId.' });
  }

  // Generate CSRF state parameter
  const state = crypto.randomBytes(16).toString('hex');
  const oauthState = readOAuthState();
  oauthState[state] = { providerId, createdAt: Date.now() };
  writeOAuthState(oauthState);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: oauth.scope || 'basic',
    state,
  });

  res.redirect(`${authorizeUrl}?${params.toString()}`);
});

/**
 * GET /api/auth/copilot/status
 * Inspect the currently saved GitHub Copilot OAuth status
 */
router.get('/copilot/status', async (req, res) => {
  const config = readConfig();
  const provider = config.providers[COPILOT_PROVIDER_ID];

  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  const accessToken = provider.oauthTokens?.accessToken;
  appendAuthDebug('copilot.status.check', {
    hasAccessToken: !!accessToken,
    expiresAt: provider.oauthTokens?.expiresAt || 0,
  });
  if (!accessToken) {
    return res.json({ authenticated: false, verified: false });
  }

  try {
    const verification = await verifyGithubCopilotAccess(accessToken);
    if (!verification.success) {
      appendAuthDebug('copilot.status.unverified', {
        stage: verification.stage,
        error: verification.error,
        login: verification.user?.login || null,
      });
      return res.json({
        authenticated: true,
        verified: false,
        stage: verification.stage,
        error: verification.error,
        user: verification.user || null,
        details: verification.response?.body || null,
      });
    }

    appendAuthDebug('copilot.status.verified', {
      login: verification.user?.login || null,
    });

    return res.json({
      authenticated: true,
      verified: true,
      user: verification.user,
      details: sanitizeCopilotPayload(verification.response?.body || null),
    });
  } catch (error) {
    appendAuthDebug('copilot.status.error', { error: error.message });
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/copilot/device/start
 * Start GitHub device flow for Copilot verification
 */
router.post('/copilot/device/start', async (req, res) => {
  const provider = ensureProviderInConfig(COPILOT_PROVIDER_ID);

  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  try {
    appendAuthDebug('copilot.device.start.request', {
      scope: 'read:user user:email',
    });
    const response = await fetchJson('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_DEVICE_CLIENT_ID,
        scope: 'read:user user:email',
      }),
    });

    const finalResponse = (!response.ok && response.status === 0)
      ? await curlJsonRequest({
        method: 'POST',
        url: 'https://github.com/login/device/code',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: {
          client_id: GITHUB_DEVICE_CLIENT_ID,
          scope: 'read:user user:email',
        },
      })
      : response;

    if (!finalResponse.ok || !finalResponse.body?.device_code) {
      appendAuthDebug('copilot.device.start.failed', {
        status: finalResponse.status,
        error: finalResponse.transportError || finalResponse.body?.error_description || finalResponse.body?.error || 'Failed to start GitHub device flow',
      });
      return res.status(finalResponse.status || 500).json({
        error: finalResponse.transportError || finalResponse.body?.error_description || finalResponse.body?.error || 'Failed to start GitHub device flow',
        details: finalResponse.body || finalResponse.rawText,
      });
    }

    appendAuthDebug('copilot.device.start.success', {
      user_code: finalResponse.body?.user_code,
      expires_in: finalResponse.body?.expires_in,
      interval: finalResponse.body?.interval,
    });
    res.json(finalResponse.body);
  } catch (error) {
    appendAuthDebug('copilot.device.start.error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/copilot/device/poll
 * Poll GitHub device flow, then verify Copilot entitlement and persist oauthTokens
 */
router.post('/copilot/device/poll', async (req, res) => {
  const { deviceCode } = req.body || {};

  if (!deviceCode) {
    return res.status(400).json({ error: 'deviceCode is required' });
  }

  try {
    appendAuthDebug('copilot.device.poll.request', {
      deviceCodeSuffix: String(deviceCode).slice(-6),
    });
    const buildTokenExchangeRequest = () => {
      return fetchJson('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: GITHUB_DEVICE_CLIENT_ID,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
    };

    let tokenResponse = await buildTokenExchangeRequest();
    if (!tokenResponse.ok && tokenResponse.status === 0) {
      tokenResponse = await curlJsonRequest({
        method: 'POST',
        url: 'https://github.com/login/oauth/access_token',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: {
          client_id: GITHUB_DEVICE_CLIENT_ID,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        },
      });
    }

    if (tokenResponse.status === 0) {
      appendAuthDebug('copilot.device.poll.timeout', {
        deviceCodeSuffix: String(deviceCode).slice(-6),
      });
      return res.json({
        success: false,
        status: 'request_timeout',
        error: 'GitHub 网络波动，已自动重试，请继续等待几秒后重试。',
      });
    }

    if (tokenResponse.body?.error) {
      appendAuthDebug('copilot.device.poll.oauth_error', {
        status: tokenResponse.body.error,
        error: tokenResponse.body.error_description || tokenResponse.body.error,
      });
      return res.json({
        success: false,
        status: tokenResponse.body.error,
        error: tokenResponse.body.error_description || tokenResponse.body.error,
      });
    }

    if (!tokenResponse.ok || !tokenResponse.body?.access_token) {
      if (tokenResponse.ok && !tokenResponse.body?.access_token) {
        appendAuthDebug('copilot.device.poll.pending_no_token', {
          details: tokenResponse.body || tokenResponse.rawText,
        });
        return res.json({
          success: false,
          status: 'authorization_pending',
          error: 'GitHub 正在同步授权状态，请继续等待几秒后自动重试。',
          details: tokenResponse.body || tokenResponse.rawText,
        });
      }
      appendAuthDebug('copilot.device.poll.exchange_failed', {
        status: tokenResponse.status,
        details: tokenResponse.body || tokenResponse.rawText,
      });
      return res.status(400).json({
        error: 'GitHub OAuth token exchange failed',
        details: tokenResponse.body || tokenResponse.rawText,
      });
    }

    saveCopilotOAuthTokens(tokenResponse.body);

    const verification = await verifyGithubCopilotAccess(tokenResponse.body.access_token);
    if (!verification.success) {
      appendAuthDebug('copilot.device.poll.verified_failed', {
        stage: verification.stage,
        error: verification.error,
        login: verification.user?.login || null,
      });
      return res.status(400).json({
        success: false,
        authenticated: true,
        stage: verification.stage,
        error: verification.error,
        user: verification.user || null,
        details: verification.response?.body || verification.response?.rawText || null,
      });
    }

    // Save with Copilot API JWT
    const copilotApiToken = verification.response?.body || null;
    saveCopilotOAuthTokens(tokenResponse.body, copilotApiToken);

    appendAuthDebug('copilot.device.poll.success', {
      login: verification.user?.login || null,
    });

    res.json({
      success: true,
      authenticated: true,
      user: {
        login: verification.user.login,
        avatar_url: verification.user.avatar_url,
        html_url: verification.user.html_url,
      },
      copilot: sanitizeCopilotPayload(verification.response?.body || null),
    });
  } catch (error) {
    appendAuthDebug('copilot.device.poll.error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});


/**
 * POST /api/auth/openai/codex/start
 * Start OpenAI Codex OAuth (PKCE)
 */
function parseCodexCallback(input) {
  const raw = String(input || '').trim();
  const readParams = (params) => ({
    code: params.get('code') || '',
    state: params.get('state') || '',
    error: params.get('error') || '',
    errorDescription: params.get('error_description') || params.get('errorMessage') || '',
  });

  const merge = (...items) => {
    const merged = { code: '', state: '', error: '', errorDescription: '' };
    for (const item of items) {
      for (const key of Object.keys(merged)) {
        if (!merged[key] && item?.[key]) merged[key] = item[key];
      }
    }
    return merged;
  };

  try {
    const url = new URL(raw);
    return merge(
      readParams(url.searchParams),
      readParams(new URLSearchParams(url.hash.replace(/^#/, '')))
    );
  } catch {
    const normalized = raw.replace(/^[?#]/, '');
    const [queryPart, hashPart = ''] = normalized.split('#');
    return merge(
      readParams(new URLSearchParams(queryPart.includes('?') ? queryPart.split('?').pop() : queryPart)),
      readParams(new URLSearchParams(hashPart))
    );
  }
}

router.post('/openai/codex/start', async (req, res) => {
  try {
    appendAuthDebug('codex.oauth.start.request');
    ensureProviderInConfig(OPENAI_CODEX_PROVIDER_ID);

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');

    const oauthState = readOAuthState();
    oauthState[`openai-codex:${state}`] = {
      providerId: OPENAI_CODEX_PROVIDER_ID,
      verifier,
      createdAt: Date.now(),
    };
    writeOAuthState(oauthState);

    const url = new URL(OPENAI_CODEX_AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', OPENAI_CODEX_CLIENT_ID);
    url.searchParams.set('redirect_uri', OPENAI_CODEX_REDIRECT_URI);
    url.searchParams.set('scope', OPENAI_CODEX_SCOPE);
    url.searchParams.set('prompt', 'login');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    url.searchParams.set('id_token_add_organizations', 'true');
    url.searchParams.set('codex_cli_simplified_flow', 'true');
    url.searchParams.set('originator', 'pi');

    appendAuthDebug('codex.oauth.start.success', { state });
    return res.json({ success: true, url: url.toString(), state });
  } catch (error) {
    appendAuthDebug('codex.oauth.start.error', { error: error.message });
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/openai/codex/exchange
 * Exchange callback URL/code for OpenAI Codex access token
 */
router.post('/openai/codex/exchange', async (req, res) => {
  const { callbackUrl } = req.body || {};
  if (!callbackUrl) {
    return res.status(400).json({ error: 'callbackUrl is required' });
  }

  try {
    appendAuthDebug('codex.oauth.exchange.request');
    const parsedCallback = parseCodexCallback(callbackUrl);

    if (parsedCallback.error) {
      return res.status(400).json({
        error: parsedCallback.errorDescription || parsedCallback.error,
        providerError: parsedCallback.error,
      });
    }

    const { code, state } = parsedCallback;
    if (!code) {
      return res.status(400).json({ error: 'Could not extract code from callbackUrl' });
    }
    if (!state) {
      return res.status(400).json({ error: 'Missing state: please paste the full callback URL, not only the code' });
    }

    const oauthState = readOAuthState();
    const saved = oauthState[`openai-codex:${state}`];
    if (!saved?.verifier) {
      appendAuthDebug('codex.oauth.exchange.missing_state', { state });
      return res.status(400).json({ error: 'OAuth state not found or expired, please restart login with a newly generated authorization link' });
    }

    const formData = new URLSearchParams();
    formData.append('grant_type', 'authorization_code');
    formData.append('client_id', OPENAI_CODEX_CLIENT_ID);
    formData.append('code', code);
    formData.append('code_verifier', saved.verifier);
    formData.append('redirect_uri', OPENAI_CODEX_REDIRECT_URI);

    let tokenResponse = await fetchJson(OPENAI_CODEX_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!tokenResponse.ok && tokenResponse.status === 0) {
      tokenResponse = await curlJsonRequest({
        method: 'POST',
        url: OPENAI_CODEX_TOKEN_URL,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });
    }

    if (!tokenResponse.ok || !tokenResponse.body?.access_token) {
      appendAuthDebug('codex.oauth.exchange.failed', {
        status: tokenResponse.status,
        details: tokenResponse.body || tokenResponse.rawText,
      });
      return res.status(400).json({
        error: tokenResponse.body?.error_description || tokenResponse.body?.error || 'OpenAI token exchange failed',
        details: tokenResponse.body || tokenResponse.rawText,
      });
    }

    saveProviderOAuthTokens(OPENAI_CODEX_PROVIDER_ID, tokenResponse.body, OPENAI_CODEX_SCOPE);

    delete oauthState[`openai-codex:${state}`];
    writeOAuthState(oauthState);

    appendAuthDebug('codex.oauth.exchange.success', { state });
    return res.json({ success: true, authenticated: true, providerId: OPENAI_CODEX_PROVIDER_ID });
  } catch (error) {
    appendAuthDebug('codex.oauth.exchange.error', { error: error.message });
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/claude/code/start
 * Start Claude Code OAuth (PKCE)
 */
router.post('/claude/code/start', async (req, res) => {
  try {
    appendAuthDebug('claude_code.oauth.start.request');
    ensureProviderInConfig(CLAUDE_CODE_PROVIDER_ID);

    const verifier = crypto.randomBytes(96).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');

    const oauthState = readOAuthState();
    oauthState[`claude-code:${state}`] = {
      providerId: CLAUDE_CODE_PROVIDER_ID,
      verifier,
      createdAt: Date.now(),
    };
    writeOAuthState(oauthState);

    const url = new URL(CLAUDE_CODE_AUTHORIZE_URL);
    url.searchParams.set('code', 'true');
    url.searchParams.set('client_id', CLAUDE_CODE_CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', CLAUDE_CODE_REDIRECT_URI);
    url.searchParams.set('scope', CLAUDE_CODE_SCOPE);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);

    appendAuthDebug('claude_code.oauth.start.success', { state });
    return res.json({ success: true, url: url.toString(), state });
  } catch (error) {
    appendAuthDebug('claude_code.oauth.start.error', { error: error.message });
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/claude/code/exchange
 * Exchange callback URL/code for Claude Code access token
 */
router.post('/claude/code/exchange', async (req, res) => {
  const { callbackUrl } = req.body || {};
  if (!callbackUrl) {
    return res.status(400).json({ error: 'callbackUrl is required' });
  }

  try {
    appendAuthDebug('claude_code.oauth.exchange.request');
    let code = '';
    let state = '';
    try {
      const parsed = new URL(callbackUrl);
      code = parsed.searchParams.get('code') || '';
      state = parsed.searchParams.get('state') || '';
    } catch {
      const sp = new URLSearchParams(callbackUrl.split('?')[1] || callbackUrl);
      code = sp.get('code') || callbackUrl;
      state = sp.get('state') || '';
    }

    if (!code) {
      return res.status(400).json({ error: 'Could not extract code from callbackUrl' });
    }

    const oauthState = readOAuthState();
    const saved = state ? oauthState[`claude-code:${state}`] : null;
    if (!saved?.verifier) {
      appendAuthDebug('claude_code.oauth.exchange.missing_state', { state });
      return res.status(400).json({ error: 'OAuth state not found or expired, please restart login' });
    }

    let tokenResponse = await fetchJson(CLAUDE_CODE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        state,
        grant_type: 'authorization_code',
        client_id: CLAUDE_CODE_CLIENT_ID,
        redirect_uri: CLAUDE_CODE_REDIRECT_URI,
        code_verifier: saved.verifier,
      }),
    });

    if (!tokenResponse.ok && tokenResponse.status === 0) {
      tokenResponse = await curlJsonRequest({
        method: 'POST',
        url: CLAUDE_CODE_TOKEN_URL,
        headers: { 'Content-Type': 'application/json' },
        body: {
          code,
          state,
          grant_type: 'authorization_code',
          client_id: CLAUDE_CODE_CLIENT_ID,
          redirect_uri: CLAUDE_CODE_REDIRECT_URI,
          code_verifier: saved.verifier,
        },
      });
    }

    if (!tokenResponse.ok || !tokenResponse.body?.access_token) {
      appendAuthDebug('claude_code.oauth.exchange.failed', {
        status: tokenResponse.status,
        details: tokenResponse.body || tokenResponse.rawText,
      });
      return res.status(400).json({
        error: tokenResponse.body?.error_description || tokenResponse.body?.error || 'Claude Code token exchange failed',
        details: tokenResponse.body || tokenResponse.rawText,
      });
    }

    saveProviderOAuthTokens(CLAUDE_CODE_PROVIDER_ID, tokenResponse.body, CLAUDE_CODE_SCOPE);

    delete oauthState[`claude-code:${state}`];
    writeOAuthState(oauthState);

    appendAuthDebug('claude_code.oauth.exchange.success', {
      state,
      email: tokenResponse.body?.account?.email_address || null,
    });
    return res.json({ success: true, authenticated: true, providerId: CLAUDE_CODE_PROVIDER_ID });
  } catch (error) {
    appendAuthDebug('claude_code.oauth.exchange.error', { error: error.message });
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/cursor/device/start
 * Start Cursor PKCE device flow
 */
router.post('/cursor/device/start', async (req, res) => {
  try {
    appendAuthDebug('cursor.device.start.request');
    ensureProviderInConfig(CURSOR_PROVIDER_ID);

    const verifier = crypto.randomBytes(96).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const uuid = crypto.randomUUID().replace(/-/g, '');

    const oauthState = readOAuthState();
    oauthState[`cursor-device:${uuid}`] = {
      providerId: CURSOR_PROVIDER_ID,
      verifier,
      createdAt: Date.now(),
    };
    writeOAuthState(oauthState);

    const loginUrl = `${CURSOR_LOGIN_URL}?challenge=${encodeURIComponent(challenge)}&uuid=${uuid}&mode=login&redirectTarget=cli`;

    appendAuthDebug('cursor.device.start.success', { uuid });
    return res.json({
      success: true,
      verification_uri: loginUrl,
      uuid,
    });
  } catch (error) {
    appendAuthDebug('cursor.device.start.error', { error: error.message });
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/cursor/device/poll
 * Poll Cursor device flow for token
 */
router.post('/cursor/device/poll', async (req, res) => {
  const { uuid } = req.body || {};
  if (!uuid) {
    return res.status(400).json({ error: 'uuid is required' });
  }

  appendAuthDebug('cursor.device.poll.request', { uuid });

  const oauthState = readOAuthState();
  const saved = oauthState[`cursor-device:${uuid}`];
  if (!saved?.verifier) {
    appendAuthDebug('cursor.device.poll.missing_state', { uuid });
    return res.status(400).json({ error: 'Device flow session not found or expired' });
  }

  try {
    const pollUrl = `${CURSOR_POLL_URL}?uuid=${uuid}&verifier=${encodeURIComponent(saved.verifier)}`;
    let tokenResponse = await fetchJson(pollUrl, { method: 'GET' });

    if (tokenResponse.status === 0) {
      tokenResponse = await curlJsonRequest({
        method: 'GET',
        url: pollUrl,
      });
    }

    // 404 = still pending
    if (tokenResponse.status === 404 || (!tokenResponse.ok && tokenResponse.status !== 0)) {
      appendAuthDebug('cursor.device.poll.pending', { uuid });
      return res.json({ success: false, status: 'authorization_pending' });
    }

    if (tokenResponse.status === 0) {
      appendAuthDebug('cursor.device.poll.timeout', { uuid });
      return res.json({ success: false, status: 'request_timeout', error: 'Network timeout, please continue waiting.' });
    }

    if (!tokenResponse.body?.accessToken) {
      appendAuthDebug('cursor.device.poll.no_token', { body: tokenResponse.body });
      return res.json({ success: false, status: 'authorization_pending' });
    }

    // Map Cursor token format to our standard format
    const tokenData = {
      access_token: tokenResponse.body.accessToken,
      refresh_token: tokenResponse.body.refreshToken || '',
      token_type: 'Bearer',
    };

    // Try to extract expiry from JWT
    try {
      const jwtPayload = JSON.parse(Buffer.from(tokenData.access_token.split('.')[1], 'base64').toString());
      if (jwtPayload.exp) {
        tokenData.expires_in = jwtPayload.exp - Math.floor(Date.now() / 1000) - 300; // 5min safety margin
      }
    } catch { /* not a JWT or parse failed */ }

    saveProviderOAuthTokens(CURSOR_PROVIDER_ID, tokenData, '');

    delete oauthState[`cursor-device:${uuid}`];
    writeOAuthState(oauthState);

    appendAuthDebug('cursor.device.poll.success', { uuid });
    return res.json({ success: true, authenticated: true, providerId: CURSOR_PROVIDER_ID });
  } catch (error) {
    appendAuthDebug('cursor.device.poll.error', { error: error.message });
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/kimi/device/start
 * Start Kimi device flow (RFC 8628)
 */
router.post('/kimi/device/start', async (req, res) => {
  try {
    appendAuthDebug('kimi.device.start.request');
    ensureProviderInConfig(KIMI_PROVIDER_ID);

    const deviceId = crypto.randomUUID();

    const formData = new URLSearchParams();
    formData.append('client_id', KIMI_CLIENT_ID);

    let response = await fetchJson(KIMI_DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'X-Msh-Platform': 'web',
        'X-Msh-Device-Id': deviceId,
      },
      body: formData.toString(),
    });

    if (!response.ok && response.status === 0) {
      response = await curlJsonRequest({
        method: 'POST',
        url: KIMI_DEVICE_CODE_URL,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'X-Msh-Platform': 'web',
          'X-Msh-Device-Id': deviceId,
        },
        body: formData.toString(),
      });
    }

    if (!response.ok || !response.body?.device_code) {
      appendAuthDebug('kimi.device.start.failed', { status: response.status, body: response.body });
      return res.status(400).json({ error: response.body?.error || 'Failed to start Kimi device flow' });
    }

    const oauthState = readOAuthState();
    oauthState[`kimi-device:${response.body.device_code}`] = {
      providerId: KIMI_PROVIDER_ID,
      deviceId,
      createdAt: Date.now(),
    };
    writeOAuthState(oauthState);

    appendAuthDebug('kimi.device.start.success', {
      userCode: response.body.user_code,
      interval: response.body.interval,
    });

    return res.json({
      success: true,
      device_code: response.body.device_code,
      user_code: response.body.user_code,
      verification_uri: response.body.verification_uri || 'https://kimi.com',
      verification_uri_complete: response.body.verification_uri_complete || '',
      expires_in: response.body.expires_in || 900,
      interval: response.body.interval || 5,
    });
  } catch (error) {
    appendAuthDebug('kimi.device.start.error', { error: error.message });
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/kimi/device/poll
 * Poll Kimi device flow for token
 */
router.post('/kimi/device/poll', async (req, res) => {
  const { deviceCode } = req.body || {};
  if (!deviceCode) {
    return res.status(400).json({ error: 'deviceCode is required' });
  }

  try {
    appendAuthDebug('kimi.device.poll.request');

    const oauthState = readOAuthState();
    const saved = oauthState[`kimi-device:${deviceCode}`];
    const deviceId = saved?.deviceId || '';

    const formData = new URLSearchParams();
    formData.append('client_id', KIMI_CLIENT_ID);
    formData.append('device_code', deviceCode);
    formData.append('grant_type', 'urn:ietf:params:oauth:grant-type:device_code');

    let tokenResponse = await fetchJson(KIMI_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'X-Msh-Platform': 'web',
        'X-Msh-Device-Id': deviceId,
      },
      body: formData.toString(),
    });

    if (!tokenResponse.ok && tokenResponse.status === 0) {
      tokenResponse = await curlJsonRequest({
        method: 'POST',
        url: KIMI_TOKEN_URL,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'X-Msh-Platform': 'web',
          'X-Msh-Device-Id': deviceId,
        },
        body: formData.toString(),
      });
    }

    if (tokenResponse.status === 0) {
      return res.json({ success: false, status: 'request_timeout', error: 'Network timeout' });
    }

    const data = tokenResponse.body || {};

    if (data.error) {
      if (data.error === 'authorization_pending') {
        return res.json({ success: false, status: 'authorization_pending' });
      }
      if (data.error === 'slow_down') {
        return res.json({ success: false, status: 'slow_down' });
      }
      if (data.error === 'expired_token') {
        delete oauthState[`kimi-device:${deviceCode}`];
        writeOAuthState(oauthState);
        return res.json({ success: false, status: 'expired_token', error: 'Device code expired' });
      }
      if (data.error === 'access_denied') {
        delete oauthState[`kimi-device:${deviceCode}`];
        writeOAuthState(oauthState);
        return res.json({ success: false, status: 'access_denied', error: 'Access denied by user' });
      }
      appendAuthDebug('kimi.device.poll.oauth_error', { error: data.error, desc: data.error_description });
      return res.json({ success: false, status: data.error, error: data.error_description || data.error });
    }

    if (!data.access_token) {
      return res.json({ success: false, status: 'authorization_pending' });
    }

    // Success
    saveProviderOAuthTokens(KIMI_PROVIDER_ID, data, '');

    delete oauthState[`kimi-device:${deviceCode}`];
    writeOAuthState(oauthState);

    appendAuthDebug('kimi.device.poll.success');
    return res.json({ success: true, authenticated: true, providerId: KIMI_PROVIDER_ID });
  } catch (error) {
    appendAuthDebug('kimi.device.poll.error', { error: error.message });
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/copilot/refresh-jwt
 * Refresh an expired Copilot API JWT using the stored GitHub token
 */
router.post('/copilot/refresh-jwt', async (req, res) => {
  const config = readConfig();
  const provider = config.providers[COPILOT_PROVIDER_ID];
  if (!provider?.oauthTokens?.accessToken) {
    return res.status(400).json({ error: 'No GitHub token available' });
  }

  try {
    let copilotResponse = await fetchJson('https://api.github.com/copilot_internal/v2/token', {
      method: 'GET',
      headers: {
        Authorization: `token ${provider.oauthTokens.accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'GithubCopilot/1.0',
      },
    });

    if (!copilotResponse.ok && copilotResponse.status === 0) {
      copilotResponse = await curlJsonRequest({
        method: 'GET',
        url: 'https://api.github.com/copilot_internal/v2/token',
        headers: {
          Authorization: `token ${provider.oauthTokens.accessToken}`,
          Accept: 'application/json',
          'User-Agent': 'GithubCopilot/1.0',
        },
      });
    }

    if (!copilotResponse.ok || !copilotResponse.body?.token) {
      return res.status(400).json({
        error: 'Failed to refresh Copilot API token',
        details: copilotResponse.body || copilotResponse.rawText,
      });
    }

    provider.oauthTokens.copilotToken = copilotResponse.body.token;
    provider.oauthTokens.copilotTokenExpiresAt = copilotResponse.body.expires_at
      ? copilotResponse.body.expires_at * 1000
      : Date.now() + 30 * 60 * 1000;
    writeConfig(config);

    return res.json({ success: true, expiresAt: provider.oauthTokens.copilotTokenExpiresAt });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/cursor/refresh
 * Refresh Cursor access token using refresh token
 */
router.post('/cursor/refresh', async (req, res) => {
  const config = readConfig();
  const provider = config.providers[CURSOR_PROVIDER_ID];
  const tokens = provider?.oauthTokens;

  if (!tokens?.refreshToken) {
    return res.status(400).json({ error: 'No refresh token available' });
  }

  try {
    const refreshResponse = await fetchJson(CURSOR_REFRESH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.refreshToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!refreshResponse.ok || !refreshResponse.body?.accessToken) {
      return res.status(400).json({
        error: 'Cursor token refresh failed',
        details: refreshResponse.body || refreshResponse.rawText,
      });
    }

    const tokenData = {
      access_token: refreshResponse.body.accessToken,
      refresh_token: refreshResponse.body.refreshToken || tokens.refreshToken,
      token_type: 'Bearer',
    };

    try {
      const jwtPayload = JSON.parse(Buffer.from(tokenData.access_token.split('.')[1], 'base64').toString());
      if (jwtPayload.exp) {
        tokenData.expires_in = jwtPayload.exp - Math.floor(Date.now() / 1000) - 300;
      }
    } catch { /* ignore */ }

    saveProviderOAuthTokens(CURSOR_PROVIDER_ID, tokenData, '');
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/auth/callback/:providerId
 * OAuth callback: exchange code for access_token, store in provider config
 */
router.get('/callback/:providerId', async (req, res) => {
  const { providerId } = req.params;
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`/?auth_error=${encodeURIComponent(error)}&provider=${providerId}`);
  }

  // Verify state
  const oauthState = readOAuthState();
  if (!state || !oauthState[state] || oauthState[state].providerId !== providerId) {
    return res.redirect(`/?auth_error=invalid_state&provider=${providerId}`);
  }
  delete oauthState[state];
  writeOAuthState(oauthState);

  const config = readConfig();
  const provider = config.providers[providerId];
  if (!provider) {
    return res.redirect(`/?auth_error=provider_not_found&provider=${providerId}`);
  }

  const oauth = provider.oauth || {};
  const tokenUrl = oauth.tokenUrl;
  const clientId = oauth.clientId;
  const clientSecret = oauth.clientSecret;
  const redirectUri = oauth.redirectUri || `${req.protocol}://${req.get('host')}/api/auth/callback/${providerId}`;

  if (!tokenUrl || !clientId || !clientSecret) {
    return res.redirect(`/?auth_error=oauth_not_configured&provider=${providerId}`);
  }

  try {
    // Exchange authorization code for access token
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }).toString(),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error || !tokenData.access_token) {
      const errMsg = tokenData.error_description || tokenData.error || 'Token exchange failed';
      return res.redirect(`/?auth_error=${encodeURIComponent(errMsg)}&provider=${providerId}`);
    }

    // Store tokens in provider config
    config.providers[providerId].oauthTokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || '',
      expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : 0,
      tokenType: tokenData.token_type || 'Bearer',
      scope: tokenData.scope || '',
    };
    writeConfig(config);

    // Redirect back to settings page with success
    res.redirect(`/?auth_success=true&provider=${providerId}`);
  } catch (err) {
    console.error('OAuth token exchange error:', err);
    res.redirect(`/?auth_error=${encodeURIComponent(err.message)}&provider=${providerId}`);
  }
});

/**
 * POST /api/auth/refresh/:providerId
 * Refresh an expired access token
 */
router.post('/refresh/:providerId', async (req, res) => {
  const { providerId } = req.params;
  const config = readConfig();
  const provider = config.providers[providerId];

  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  const oauth = provider.oauth || {};
  const tokens = provider.oauthTokens;
  if (!tokens?.refreshToken) {
    return res.status(400).json({ error: 'No refresh token available' });
  }

  try {
    const tokenResponse = await fetch(oauth.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
      }).toString(),
    });

    const tokenData = await tokenResponse.json();
    if (tokenData.error || !tokenData.access_token) {
      return res.status(400).json({ error: tokenData.error_description || 'Refresh failed' });
    }

    config.providers[providerId].oauthTokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || tokens.refreshToken,
      expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : 0,
      tokenType: tokenData.token_type || 'Bearer',
      scope: tokenData.scope || tokens.scope || '',
    };
    writeConfig(config);

    res.json({ success: true, expiresAt: config.providers[providerId].oauthTokens.expiresAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/auth/logout/:providerId
 * Clear OAuth tokens (revoke subscription auth)
 */
router.delete('/logout/:providerId', (req, res) => {
  const { providerId } = req.params;
  const config = readConfig();
  if (!config.providers[providerId]) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  delete config.providers[providerId].oauthTokens;
  writeConfig(config);
  res.json({ success: true });
});

/**
 * GET /api/auth/status/:providerId
 * Check OAuth auth status
 */
router.get('/status/:providerId', (req, res) => {
  const { providerId } = req.params;
  const config = readConfig();
  let provider = config.providers[providerId];
  if (!provider && defaultProviders[providerId]) {
    provider = ensureProviderInConfig(providerId);
  }
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  const tokens = provider.oauthTokens;
  if (!tokens?.accessToken) {
    return res.json({ authenticated: false });
  }

  const expired = tokens.expiresAt > 0 && Date.now() > tokens.expiresAt;
  res.json({
    authenticated: true,
    expired,
    expiresAt: tokens.expiresAt,
    hasRefreshToken: !!tokens.refreshToken,
  });
});

/**
 * PUT /api/auth/oauth-config/:providerId
 * Save OAuth configuration for a provider
 */
router.put('/oauth-config/:providerId', (req, res) => {
  const { providerId } = req.params;
  const { authorizeUrl, tokenUrl, clientId, clientSecret, scope, redirectUri } = req.body;

  const config = readConfig();
  if (!config.providers[providerId]) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  config.providers[providerId].oauth = {
    authorizeUrl: authorizeUrl || '',
    tokenUrl: tokenUrl || '',
    clientId: clientId || '',
    clientSecret: clientSecret || '',
    scope: scope || 'basic',
    redirectUri: redirectUri || '',
  };
  writeConfig(config);
  res.json({ success: true });
});

// Clean up expired states periodically (older than 10 minutes)
setInterval(() => {
  try {
    const oauthState = readOAuthState();
    const now = Date.now();
    let changed = false;
    for (const [key, val] of Object.entries(oauthState)) {
      if (now - val.createdAt > 10 * 60 * 1000) {
        delete oauthState[key];
        changed = true;
      }
    }
    if (changed) writeOAuthState(oauthState);
  } catch { /* ignore */ }
}, 60 * 1000);

// ===== Antigravity OAuth Mock Flow =====

router.post('/antigravity/start', async (req, res) => {
  try {
    const ANTIGRAVITY_PROVIDER_ID = 'antigravity';
    ensureProviderInConfig(ANTIGRAVITY_PROVIDER_ID);

    const verifier = crypto.randomBytes(32).toString('base64url');
    const state = crypto.randomBytes(16).toString('hex');

    const oauthState = readOAuthState();
    oauthState[`antigravity:${state}`] = {
      providerId: ANTIGRAVITY_PROVIDER_ID,
      verifier,
      createdAt: Date.now(),
    };
    writeOAuthState(oauthState);

    const url = `http://localhost:3001/api/auth/antigravity/mock-authorize?state=${state}`;
    return res.json({ success: true, url, state });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/antigravity/mock-authorize', (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Antigravity 订阅授权</title>
  <style>
    body {
      background: #0A0D14;
      color: #F3F4F6;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      overflow: hidden;
      position: relative;
    }
    .g1, .g2 {
      position: absolute;
      width: 400px;
      height: 400px;
      border-radius: 50%;
      filter: blur(100px);
      opacity: 0.15;
      z-index: 1;
    }
    .g1 { background: #4F6EF7; top: 10%; left: 10%; }
    .g2 { background: #00F2FE; bottom: 10%; right: 10%; }
    .card {
      background: rgba(20, 24, 33, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(20px);
      border-radius: 16px;
      padding: 40px;
      width: 420px;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
      z-index: 10;
    }
    .logo {
      font-size: 32px;
      font-weight: 800;
      background: linear-gradient(135deg, #00F2FE 0%, #4F6EF7 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 24px;
    }
    h2 { font-size: 20px; font-weight: 600; margin: 0 0 12px; }
    p { font-size: 14px; color: #9CA3AF; line-height: 1.6; margin: 0 0 24px; }
    .scope-list {
      background: rgba(255, 255, 255, 0.03);
      border-radius: 8px;
      padding: 16px;
      text-align: left;
      margin-bottom: 32px;
    }
    .scope-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: #D1D5DB;
      margin-bottom: 8px;
    }
    .scope-item:last-child { margin-bottom: 0; }
    .scope-item svg { color: #10B981; }
    .btn-group {
      display: flex;
      gap: 12px;
    }
    .btn {
      flex: 1;
      padding: 12px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      border: none;
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: #E5E7EB;
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.12);
    }
    .btn-primary {
      background: #4F6EF7;
      color: #FFFFFF;
      box-shadow: 0 4px 12px rgba(79, 110, 247, 0.3);
    }
    .btn-primary:hover {
      background: #3B5BDB;
    }
    .loading-overlay {
      position: absolute;
      inset: 0;
      background: #0A0D14;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 100;
      border-radius: 16px;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(79, 110, 247, 0.1);
      border-top-color: #4F6EF7;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-bottom: 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="g1"></div>
  <div class="g2"></div>
  <div class="card">
    <div class="logo">Antigravity</div>
    <h2>授权 SpaceDream</h2>
    <p>应用程序 SpaceDream 正在请求访问您的反重力订阅资源。这会让它能够以您的身份调用文本对话与图像生成服务。</p>
    
    <div class="scope-list">
      <div class="scope-item">
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        读取您的订阅计划与余额
      </div>
      <div class="scope-item">
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        使用 Antigravity Coder 编写代码
      </div>
      <div class="scope-item">
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        进行 AI 艺术画廊的图像创作
      </div>
    </div>

    <div class="btn-group">
      <button class="btn btn-secondary" onclick="window.close()">拒绝</button>
      <button class="btn btn-primary" onclick="agree()">同意授权</button>
    </div>

    <div class="loading-overlay" id="loader">
      <div class="spinner"></div>
      <div style="font-size: 14px; color: #9CA3AF;">正在生成授权安全凭据...</div>
    </div>
  </div>

  <script>
    function agree() {
      document.getElementById('loader').style.display = 'flex';
      const urlParams = new URLSearchParams(window.location.search);
      const state = urlParams.get('state') || '';
      setTimeout(() => {
        window.location.href = \`http://localhost:1455/auth/callback?code=mock_antigravity_code_\${Math.random().toString(36).substring(2, 10)}&state=\${state}\`;
      }, 1500);
    }
  </script>
</body>
</html>`;
  res.send(html);
});

router.post('/antigravity/exchange', async (req, res) => {
  const { callbackUrl } = req.body || {};
  if (!callbackUrl) {
    return res.status(400).json({ error: 'callbackUrl is required' });
  }

  try {
    const ANTIGRAVITY_PROVIDER_ID = 'antigravity';
    const parsed = new URL(callbackUrl);
    const code = parsed.searchParams.get('code');
    const state = parsed.searchParams.get('state');

    if (!code || !state) {
      return res.status(400).json({ error: '无法从 callbackUrl 中提取 code 或 state，请粘贴完整的 callback 链接' });
    }

    const oauthState = readOAuthState();
    const saved = oauthState[`antigravity:${state}`];
    if (!saved) {
      return res.status(400).json({ error: '授权会话已过期或 state 不匹配，请重新生成授权链接' });
    }

    // 保存模拟 OAuth Token
    const scope = 'openid profile offline_access';
    const fakeTokenBody = {
      access_token: 'mock_antigravity_access_token_' + crypto.randomBytes(8).toString('hex'),
      expires_in: 3600 * 24 * 30, // 30天
      token_type: 'Bearer',
      scope,
    };

    saveProviderOAuthTokens(ANTIGRAVITY_PROVIDER_ID, fakeTokenBody, scope);

    delete oauthState[`antigravity:${state}`];
    writeOAuthState(oauthState);

    return res.json({ success: true, authenticated: true, providerId: ANTIGRAVITY_PROVIDER_ID });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// ===== User Account Registration & Login =====

router.post('/users/register', (req, res) => {
  const { username, password, confirmPassword } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (confirmPassword !== undefined && password !== confirmPassword) {
    return res.status(400).json({ error: '两次输入的密码不一致' });
  }
  const safeUsername = username.trim();
  if (safeUsername.length < 3) {
    return res.status(400).json({ error: '用户名长度不能少于 3 个字符' });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(safeUsername)) {
    return res.status(400).json({ error: '用户名只能包含字母、数字、下划线和中划线' });
  }

  const usersPath = path.join(__dirname, '..', 'data', 'users.json');
  let users = {};
  if (fs.existsSync(usersPath)) {
    try {
      users = JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
    } catch {
      users = {};
    }
  }

  if (users[safeUsername]) {
    return res.status(400).json({ error: '该用户名已被占用' });
  }

  users[safeUsername] = { password };
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));

  res.json({ success: true, message: '注册成功！' });
});

router.post('/users/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  const safeUsername = username.trim();

  const usersPath = path.join(__dirname, '..', 'data', 'users.json');
  let users = {};
  if (fs.existsSync(usersPath)) {
    try {
      users = JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
    } catch {
      users = {};
    }
  }

  const user = users[safeUsername];
  if (!user || user.password !== password) {
    return res.status(400).json({ error: '用户名或密码错误' });
  }

  res.json({ success: true, username: safeUsername });
});

router.post('/users/change-password', (req, res) => {
  const { username, oldPassword, newPassword } = req.body || {};
  if (!username || !oldPassword || !newPassword) {
    return res.status(400).json({ error: '用户名、旧密码和新密码不能为空' });
  }
  const safeUsername = username.trim();

  const usersPath = path.join(__dirname, '..', 'data', 'users.json');
  let users = {};
  if (fs.existsSync(usersPath)) {
    try {
      users = JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
    } catch {
      users = {};
    }
  }

  const user = users[safeUsername];
  if (!user || user.password !== oldPassword) {
    return res.status(400).json({ error: '旧密码错误' });
  }

  users[safeUsername] = { password: newPassword };
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));

  res.json({ success: true, message: '密码修改成功！' });
});

export default router;
