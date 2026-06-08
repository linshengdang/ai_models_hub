const API_BASE = '/api';

const originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
  const userId = localStorage.getItem('hub-user-id') || 'guest';
  const headers = {
    ...(options?.headers || {}),
    'X-User-Id': userId
  };
  return originalFetch(url, { ...options, headers });
};

export async function fetchProviders() {
  const res = await fetch(`${API_BASE}/providers`);
  return res.json();
}

export async function fetchDefaultProviders() {
  const res = await fetch(`${API_BASE}/providers/defaults`);
  return res.json();
}

export async function saveProvider(provider) {
  const res = await fetch(`${API_BASE}/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(provider),
  });
  return res.json();
}

export async function updateApiKey(providerId, apiKey) {
  const res = await fetch(`${API_BASE}/providers/${providerId}/key`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  return res.json();
}

export async function updateModelKey(providerId, modelId, apiKey) {
  const res = await fetch(`${API_BASE}/providers/${providerId}/model-key`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId, apiKey }),
  });
  return res.json();
}

export async function addModel(providerId, modelId, name, type) {
  const res = await fetch(`${API_BASE}/providers/${providerId}/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId, name, type }),
  });
  return res.json();
}

export async function removeModel(providerId, modelId) {
  const res = await fetch(`${API_BASE}/providers/${providerId}/models/${encodeURIComponent(modelId)}`, {
    method: 'DELETE',
  });
  return res.json();
}

export async function deleteProvider(providerId) {
  const res = await fetch(`${API_BASE}/providers/${providerId}`, {
    method: 'DELETE',
  });
  return res.json();
}

export async function verifyProvider(providerId, payload) {
  const res = await fetch(`${API_BASE}/providers/${providerId}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  return res.json();
}

export async function verifyProviderModels(providerId) {
  const res = await fetch(`${API_BASE}/providers/${providerId}/verify-models`, {
    method: 'POST',
  });
  return res.json();
}

export async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/files/upload`, {
    method: 'POST',
    body: formData,
  });
  return res.json();
}

export async function uploadFiles(files) {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  const res = await fetch(`${API_BASE}/files/upload-multiple`, {
    method: 'POST',
    body: formData,
  });
  return res.json();
}

// ===== OAuth / Subscription Auth =====

export function getOAuthLoginUrl(providerId) {
  return `${API_BASE}/auth/login/${providerId}`;
}

export async function saveOAuthConfig(providerId, oauthConfig) {
  const res = await fetch(`${API_BASE}/auth/oauth-config/${providerId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(oauthConfig),
  });
  return res.json();
}

export async function refreshOAuthToken(providerId) {
  const res = await fetch(`${API_BASE}/auth/refresh/${providerId}`, {
    method: 'POST',
  });
  return res.json();
}

export async function logoutOAuth(providerId) {
  const res = await fetch(`${API_BASE}/auth/logout/${providerId}`, {
    method: 'DELETE',
  });
  return res.json();
}

export async function getOAuthStatus(providerId) {
  const res = await fetch(`${API_BASE}/auth/status/${providerId}`);
  return res.json();
}

export async function getCopilotStatus() {
  const res = await fetch(`${API_BASE}/auth/copilot/status`);
  return res.json();
}

export async function startCopilotDeviceFlow() {
  const res = await fetch(`${API_BASE}/auth/copilot/device/start`, {
    method: 'POST',
  });
  return res.json();
}

export async function startCodexOAuth() {
  const res = await fetch(`${API_BASE}/auth/openai/codex/start`, {
    method: 'POST',
  });
  return res.json();
}

export async function exchangeCodexCallback(callbackUrl) {
  const res = await fetch(`${API_BASE}/auth/openai/codex/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callbackUrl }),
  });
  return res.json();
}

export async function pollCopilotDeviceFlow(deviceCode) {
  const res = await fetch(`${API_BASE}/auth/copilot/device/poll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceCode }),
  });
  return res.json();
}

// Streaming chat - returns a reader
export async function sendChatMessage({ providerId, modelId, messages }) {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, modelId, messages }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `请求失败: ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const data = await res.json();
    throw new Error(data.error || '聊天接口返回了非流式响应');
  }

  return { type: 'stream', body: res.body };
}

// Parse SSE stream and call onText for each chunk
export async function parseSSEStream(body, onText, onDone, onError) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);

        if (data === '[DONE]') {
          onDone?.();
          return;
        }

        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            onError?.(parsed.error);
            return;
          }
          if (parsed.text) {
            onText(parsed.text);
          }
        } catch { /* skip malformed */ }
      }
    }
    onDone?.();
  } catch (err) {
    onError?.(err.message);
  }
}

// Convert file to base64 for multimodal
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function registerUser(username, password, confirmPassword) {
  const res = await fetch(`${API_BASE}/auth/users/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, confirmPassword }),
  });
  return res.json();
}

export async function loginUser(username, password) {
  const res = await fetch(`${API_BASE}/auth/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return res.json();
}

export async function changePassword(username, oldPassword, newPassword) {
  const res = await fetch(`${API_BASE}/auth/users/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, oldPassword, newPassword }),
  });
  return res.json();
}

export async function startAntigravityOAuth() {
  const res = await fetch(`${API_BASE}/auth/antigravity/start`, {
    method: 'POST',
  });
  return res.json();
}

export async function exchangeAntigravityCallback(callbackUrl) {
  const res = await fetch(`${API_BASE}/auth/antigravity/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callbackUrl }),
  });
  return res.json();
}

// ===== Real-time Media Generations =====
export async function generateImageApi(providerId, modelId, prompt, style, aspect) {
  const res = await fetch(`${API_BASE}/chat/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, modelId, prompt, style, aspect }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `生图失败: ${res.status}`);
  }
  return res.json();
}

export async function generateAudioApi(providerId, modelId, text, voice) {
  const res = await fetch(`${API_BASE}/chat/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, modelId, text, voice }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `合成音频失败: ${res.status}`);
  }
  return res.json();
}

export async function generateVideoApi(providerId, modelId, prompt, motion) {
  const res = await fetch(`${API_BASE}/chat/video/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, modelId, prompt, motion }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `生成视频失败: ${res.status}`);
  }
  return res.json();
}

export async function fetchStats() {
  const res = await fetch(`${API_BASE}/stats`);
  return res.json();
}

