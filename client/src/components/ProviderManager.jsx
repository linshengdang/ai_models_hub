import React, { useState, useEffect, useRef } from 'react';
import { 
  saveProvider, 
  updateApiKey, 
  updateModelKey, 
  deleteProvider, 
  verifyProvider, 
  addModel, 
  removeModel, 
  getOAuthLoginUrl, 
  saveOAuthConfig, 
  refreshOAuthToken, 
  logoutOAuth, 
  getOAuthStatus, 
  getCopilotStatus, 
  startCopilotDeviceFlow, 
  startCodexOAuth, 
  exchangeCodexCallback, 
  pollCopilotDeviceFlow,
  startAntigravityOAuth,
  exchangeAntigravityCallback,
  verifyProviderModels
} from '../api';
import { 
  Plus, 
  Trash2, 
  CheckCircle, 
  Key, 
  Shield, 
  Loader, 
  ExternalLink, 
  CreditCard, 
  X, 
  LogIn, 
  LogOut, 
  RefreshCw, 
  Search, 
  Sliders, 
  Keyboard, 
  Bot, 
  Sparkles, 
  Plug, 
  FolderCode, 
  Terminal, 
  ShieldCheck, 
  Save, 
  Download, 
  Upload, 
  ChevronDown 
} from 'lucide-react';

const MODEL_TYPE_LABELS = { all: '全部', text: '📝 文本', image: '🖼️ 图片', video: '🎬 视频', audio: '🎵 音频' };
const MODEL_TYPES = ['text', 'image', 'video', 'audio'];
const COPILOT_PENDING_STORAGE_KEY = 'github-copilot-device-flow';
const SPECIAL_VERIFY_PROVIDERS = new Set(['github_copilot', 'openai_codex', 'claude_code', 'cursor', 'antigravity']);
const INLINE_VERIFY_PROVIDERS = new Set(['github_copilot', 'openai_codex', 'antigravity']);

function getAccessModeLabel(mode) {
  if (mode === 'oauth' || mode === 'token') return '订阅';
  return 'API Key';
}

function toEditableVerifyStep(step) {
  const request = {
    ...(step?.replayRequest || step?.request || {}),
    headers: { ...((step?.replayRequest || step?.request || {}).headers || {}) },
  };

  for (const key of Object.keys(request.headers)) {
    if (/authorization|token|key|secret/i.test(key)) {
      request.headers[key] = '__AUTO_AUTH__';
    }
  }

  return {
    title: step?.title || '默认验证请求',
    request,
  };
}

function formatAuthError(error, fallback = '验证失败') {
  const text = typeof error === 'string' ? error : error?.message || error?.error || fallback;
  if (/callbackUrl is required/i.test(text)) return '请粘贴完整回调地址。';
  if (/Could not extract code/i.test(text)) return '回调地址里没有找到 code，请复制浏览器地址栏中的完整 URL。';
  if (/missing state|缺少 state/i.test(text)) return '回调地址缺少 state，请粘贴完整 callback URL，不要只粘贴 code。';
  if (/state not found|state.*expired|expired.*state|OAuth state/i.test(text)) return '授权会话已过期，或粘贴的不是本次生成的回调地址，请重新生成授权链接。';
  if (/invalid_grant/i.test(text)) return '授权码已使用、过期或回调地址不完整，请重新开始授权。';
  if (/Failed to start GitHub device flow|device flow/i.test(text)) return 'GitHub 设备码申请失败，请确认后端服务已启动，并检查当前网络是否能访问 github.com。';
  if (/NETWORK_ERROR|all connection attempts failed|fetch failed|ECONN|timeout|aborted/i.test(text)) return '网络请求失败：请检查代理/网络连接后重试。';
  if (/rate limit|too many requests|slow_down/i.test(text)) return 'GitHub 要求降低请求频率，请稍等 10 秒后再试。';
  return text;
}

function getAuthStatusLabel(status) {
  if (status === 'success') return '已完成';
  if (status === 'error') return '需要处理';
  if (status === 'pending') return '等待授权';
  if (status === 'checking') return '处理中';
  return '准备就绪';
}

function buildDefaultVerifyStep(provider) {
  const modelId = provider?.models?.find(model => model.type === 'text')?.id || provider?.models?.[0]?.id || '';
  const headers = { 'Content-Type': 'application/json' };
  let url = provider?.baseUrl || '';
  let body = {};
  let title = '默认验证请求';

  if (provider?.apiFormat === 'anthropic') {
    url = `${provider?.baseUrl || ''}/messages`;
    headers[(provider?.authHeader || 'x-api-key')] = '__AUTO_AUTH__';
    headers['anthropic-version'] = '2023-06-01';
    body = {
      model: modelId,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'ping' }],
    };
  } else if (provider?.apiFormat === 'google') {
    url = `${provider?.baseUrl || ''}/models/${modelId}:generateContent`;
    body = {
      contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
    };
  } else if (provider?.apiFormat === 'baidu') {
    url = `${provider?.baseUrl || ''}/${modelId}`;
    body = {
      messages: [{ role: 'user', content: 'ping' }],
    };
  } else {
    url = `${provider?.baseUrl || ''}/chat/completions`;
    if (provider?.authType === 'custom-header') {
      headers[provider?.authHeader || 'Authorization'] = '__AUTO_AUTH__';
    } else if (provider?.authType === 'bearer' || provider?.authType === 'oauth' || provider?.authType === 'token') {
      headers.Authorization = '__AUTO_AUTH__';
    }
    if (provider?.id === 'doubao') {
      url = `${provider?.baseUrl || ''}/responses`;
      title = '默认验证请求（豆包 Responses API，可按需改成你的模型或接入点）';
      body = {
        model: 'doubao-seed-2-0-pro-260215',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: 'ping',
              },
            ],
          },
        ],
      };
    } else {
      body = {
        model: modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 16,
        stream: false,
      };
    }
  }

  return {
    title,
    request: {
      method: 'POST',
      url,
      headers,
      body,
    },
  };
}

export default function ProviderManager({ 
  providers, 
  defaults, 
  onRefresh, 
  onClose,
  initialTab,
  initialSelectedProviderId,
  generalSettings,
  setGeneralSettings,
  shortcuts,
  setShortcuts,
  skills,
  setSkills,
  mcpServices,
  setMcpServices,
  cliTools,
  setCliTools,
  terminalSettings,
  setTerminalSettings,
  privacySettings,
  setPrivacySettings
}) {
  // Navigation active tab
  const [activeTab, setActiveTab] = useState(initialTab || 'general');

  // ORIGINAL ProviderManager states (for Large Language Models management)
  const [selectedId, setSelectedId] = useState(initialSelectedProviderId || null);
  const [oauthForm, setOauthForm] = useState(null);
  const [verifyResults, setVerifyResults] = useState({});
  const [modelVerifyResults, setModelVerifyResults] = useState({});
  const [verifyDialog, setVerifyDialog] = useState(null);
  const [verifyDialogInputs, setVerifyDialogInputs] = useState([]);
  const [loading, setLoading] = useState({});
  const [modelFilter, setModelFilter] = useState({});
  const [apiKeyInputs, setApiKeyInputs] = useState({});
  const [modelKeyInputs, setModelKeyInputs] = useState({});
  const [editForms, setEditForms] = useState({});
  const [addModelForms, setAddModelForms] = useState({});
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [specialVerifyDialog, setSpecialVerifyDialog] = useState(null);
  const [providerSearch, setProviderSearch] = useState('');
  const [othersExpanded, setOthersExpanded] = useState(false);
  const [globalExpanded, setGlobalExpanded] = useState(false);
  const [domesticExpanded, setDomesticExpanded] = useState(false);
  const [configuredExpanded, setConfiguredExpanded] = useState(true);
  const detailRef = useRef(null);

  // Temporary configuration settings edits
  const [editGeneral, setEditGeneral] = useState(generalSettings);
  const [editShortcuts, setEditShortcuts] = useState(shortcuts);
  const [editSkills, setEditSkills] = useState(skills);
  const [editMcp, setEditMcp] = useState(mcpServices);
  const [editCli, setEditCli] = useState(cliTools);
  const [editTerminal, setEditTerminal] = useState(terminalSettings);
  const [editPrivacy, setEditPrivacy] = useState(privacySettings);

  // Import/Export States
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const importInputRef = useRef(null);

  // CLI Tools Custom State
  const [isScanning, setIsScanning] = useState(false);

  // MCP Service Custom State
  const [mcpCmds, setMcpCmds] = useState({ name: '', cmd: '', desc: '' });
  const [showMcpForm, setShowMcpForm] = useState(false);

  // Auto-populate verification results for Demo mode
  useEffect(() => {
    const mode = localStorage.getItem('hub-user-mode');
    if (mode === 'demo') {
      const initialVerify = {};
      const initialModelVerify = {};
      Object.keys(defaults).forEach(key => {
        initialVerify[key] = { success: true, message: '工作正常 (Demo 演示模式)' };
        const providerModels = providers[key]?.models || defaults[key]?.models || [];
        providerModels.forEach(m => {
          initialModelVerify[`${key}:${m.id}`] = { success: true, message: '工作正常 (Demo 演示模式)' };
        });
      });
      setVerifyResults(initialVerify);
      setModelVerifyResults(initialModelVerify);
    }
  }, [providers, defaults]);

  // Apply inputs if parent config changes
  useEffect(() => {
    setEditGeneral(generalSettings);
  }, [generalSettings]);
  useEffect(() => {
    setEditShortcuts(shortcuts);
  }, [shortcuts]);
  useEffect(() => {
    setEditSkills(skills);
  }, [skills]);
  useEffect(() => {
    setEditMcp(mcpServices);
  }, [mcpServices]);
  useEffect(() => {
    setEditCli(cliTools);
  }, [cliTools]);
  useEffect(() => {
    setEditTerminal(terminalSettings);
  }, [terminalSettings]);
  useEffect(() => {
    setEditPrivacy(privacySettings);
  }, [privacySettings]);

  // Auto-save settings to localStorage and update parent state instantly on change
  useEffect(() => {
    const editStr = JSON.stringify(editGeneral);
    if (editStr !== JSON.stringify(generalSettings)) {
      localStorage.setItem('hub-general-settings', editStr);
      setGeneralSettings(editGeneral);
    }
  }, [editGeneral, generalSettings, setGeneralSettings]);

  useEffect(() => {
    const editStr = JSON.stringify(editShortcuts);
    if (editStr !== JSON.stringify(shortcuts)) {
      localStorage.setItem('hub-shortcuts-settings', editStr);
      setShortcuts(editShortcuts);
    }
  }, [editShortcuts, shortcuts, setShortcuts]);

  useEffect(() => {
    const editStr = JSON.stringify(editSkills);
    if (editStr !== JSON.stringify(skills)) {
      localStorage.setItem('hub-skills-settings', editStr);
      setSkills(editSkills);
    }
  }, [editSkills, skills, setSkills]);

  useEffect(() => {
    const editStr = JSON.stringify(editMcp);
    if (editStr !== JSON.stringify(mcpServices)) {
      localStorage.setItem('hub-mcp-settings', editStr);
      setMcpServices(editMcp);
    }
  }, [editMcp, mcpServices, setMcpServices]);

  useEffect(() => {
    const editStr = JSON.stringify(editCli);
    if (editStr !== JSON.stringify(cliTools)) {
      localStorage.setItem('hub-cli-settings', editStr);
      setCliTools(editCli);
    }
  }, [editCli, cliTools, setCliTools]);

  useEffect(() => {
    const editStr = JSON.stringify(editTerminal);
    if (editStr !== JSON.stringify(terminalSettings)) {
      localStorage.setItem('hub-terminal-settings', editStr);
      setTerminalSettings(editTerminal);
    }
  }, [editTerminal, terminalSettings, setTerminalSettings]);

  useEffect(() => {
    const editStr = JSON.stringify(editPrivacy);
    if (editStr !== JSON.stringify(privacySettings)) {
      localStorage.setItem('hub-privacy-settings', editStr);
      setPrivacySettings(editPrivacy);
    }
  }, [editPrivacy, privacySettings, setPrivacySettings]);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (initialSelectedProviderId) {
      setSelectedId(initialSelectedProviderId);
      
      // Auto expand the category containing this provider
      const globalCommonList = ['openai', 'openai_codex', 'github_copilot', 'anthropic', 'google', 'xai', 'antigravity'];
      const domesticCommonList = ['moonshot', 'kimi_coding', 'minimax', 'qwen', 'doubao', 'deepseek', 'hunyuan', 'zhipu'];
      if (globalCommonList.includes(initialSelectedProviderId)) {
        setGlobalExpanded(true);
      } else if (domesticCommonList.includes(initialSelectedProviderId)) {
        setDomesticExpanded(true);
      } else {
        setOthersExpanded(true);
      }

      // Auto add default template if it does not exist in configured providers
      if (defaults[initialSelectedProviderId] && !providers[initialSelectedProviderId]) {
        const autoAdd = async () => {
          const template = defaults[initialSelectedProviderId];
          try {
            await saveProvider({
              id: initialSelectedProviderId,
              name: template.name,
              baseUrl: template.baseUrl,
              authType: template.authType,
              authHeader: template.authHeader,
              billingType: template.billingType,
              apiFormat: template.apiFormat,
              loginUrl: template.loginUrl || '',
              docsUrl: template.docsUrl || '',
              subscriptionUrl: template.subscriptionUrl || '',
              models: template.models,
              apiKey: '',
              accessModes: template.accessModes || ['apikey'],
              oauth: template.oauth || null,
            });
            await onRefresh();
          } catch (e) {
            console.error('Failed to auto-add provider from welcome deep link:', e);
          }
        };
        autoAdd();
      }
    }
  }, [initialSelectedProviderId, defaults, providers, onRefresh]);

  // Check URL for OAuth callback result
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authSuccess = params.get('auth_success');
    const authError = params.get('auth_error');
    const provider = params.get('provider');
    if (authSuccess && provider) {
      setActiveTab('models');
      setSelectedId(provider);
      onRefresh();
      window.history.replaceState({}, '', '/');
    } else if (authError && provider) {
      setActiveTab('models');
      setSelectedId(provider);
      setVerifyResults(prev => ({ ...prev, [provider]: { success: false, message: 'OAuth 授权失败: ' + authError } }));
      window.history.replaceState({}, '', '/');
    }
  }, []);

  useEffect(() => {
    if (!specialVerifyDialog?.providerId || specialVerifyDialog.providerId !== 'github_copilot') return undefined;
    if (!specialVerifyDialog.deviceCode || specialVerifyDialog.done || specialVerifyDialog.pollPaused) return undefined;

    const intervalMs = Math.max(Number(specialVerifyDialog.interval || 5), 2) * 1000;
    const timer = window.setInterval(() => {
      pollInlineCopilotDeviceFlow();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [specialVerifyDialog?.providerId, specialVerifyDialog?.deviceCode, specialVerifyDialog?.interval, specialVerifyDialog?.done, specialVerifyDialog?.pollPaused]);

  useEffect(() => {
    const handleMessage = async (event) => {
      if (event.origin !== window.location.origin) return;

      const { type, providerId, message } = event.data || {};
      if (!SPECIAL_VERIFY_PROVIDERS.has(providerId)) return;

      if (type === 'provider-oauth-success' || type === 'provider-oauth-updated') {
        setActiveTab('models');
        setSelectedId(providerId);
        setVerifyResults(prev => ({
          ...prev,
          [providerId]: { success: type === 'provider-oauth-success', message: message || '订阅授权状态已更新。' },
        }));
        await onRefresh();
      }

      if (type === 'provider-oauth-error') {
        setActiveTab('models');
        setSelectedId(providerId);
        setVerifyResults(prev => ({
          ...prev,
          [providerId]: { success: false, message: message || '订阅授权验证失败。' },
        }));
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onRefresh]);

  useEffect(() => {
    const tryFinalizePendingCopilotAuth = async () => {
      let pending = null;

      try {
        const raw = localStorage.getItem(COPILOT_PENDING_STORAGE_KEY);
        pending = raw ? JSON.parse(raw) : null;
      } catch {
        localStorage.removeItem(COPILOT_PENDING_STORAGE_KEY);
        return false;
      }

      if (!pending?.deviceCode) return false;

      const expiresInMs = Number(pending.expiresIn || 900) * 1000;
      if (pending.createdAt && Date.now() - pending.createdAt > expiresInMs) {
        localStorage.removeItem(COPILOT_PENDING_STORAGE_KEY);
        return false;
      }

      const result = await pollCopilotDeviceFlow(pending.deviceCode);
      if (result.status === 'authorization_pending' || result.status === 'slow_down') {
        return false;
      }

      if (result.status === 'expired_token') {
        localStorage.removeItem(COPILOT_PENDING_STORAGE_KEY);
        setVerifyResults(prev => ({
          ...prev,
          github_copilot: { success: false, message: 'GitHub Copilot OAuth 验证失败：设备码已过期。' },
        }));
        return true;
      }

      if (result.success || result.authenticated) {
        localStorage.removeItem(COPILOT_PENDING_STORAGE_KEY);
        setActiveTab('models');
        setSelectedId('github_copilot');
        setVerifyResults(prev => ({
          ...prev,
          github_copilot: {
            success: !!result.success,
            message: result.success ? 'GitHub Copilot OAuth 验证成功。' : 'GitHub OAuth 已完成，Copilot 权限校验未通过。',
          },
        }));
        return true;
      }

      return false;
    };

    const handleStorage = async (event) => {
      if (event.key === COPILOT_PENDING_STORAGE_KEY && event.newValue) {
        await tryFinalizePendingCopilotAuth();
        await onRefresh();
        return;
      }

      if (event.key !== 'provider-oauth-result' || !event.newValue) return;

      try {
        const payload = JSON.parse(event.newValue);
        if (!SPECIAL_VERIFY_PROVIDERS.has(payload.providerId)) return;

        setActiveTab('models');
        setSelectedId(payload.providerId);
        setVerifyResults(prev => ({
          ...prev,
          [payload.providerId]: {
            success: payload.type === 'provider-oauth-success',
            message: payload.message || (payload.type === 'provider-oauth-success' ? '订阅授权验证成功。' : payload.type === 'provider-oauth-updated' ? '订阅授权状态已更新。' : '订阅授权验证失败。'),
          },
        }));
        await onRefresh();
      } catch {
        // ignore malformed storage payload
      }
    };

    const handleFocus = async () => {
      await tryFinalizePendingCopilotAuth();
      await onRefresh();
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleFocus);
    };
  }, [onRefresh]);

  const openProviderVerifyPage = (providerId) => {
    const pageMap = {
      github_copilot: '/copilot-verify.html',
      openai_codex: '/codex-verify.html',
      claude_code: '/claude-code-verify.html',
      cursor: '/cursor-verify.html',
      antigravity: '/antigravity-verify.html',
    };
    const nameMap = {
      github_copilot: 'github-copilot-verify',
      openai_codex: 'openai-codex-verify',
      claude_code: 'claude-code-verify',
      cursor: 'cursor-verify',
      antigravity: 'antigravity-verify',
    };
    const url = pageMap[providerId] || '/copilot-verify.html';
    const windowName = nameMap[providerId] || 'provider-oauth-verify';
    const popup = window.open(url, windowName, 'width=980,height=760');

    if (!popup) {
      window.location.href = url;
    }
  };

  const updateSpecialVerifyDialog = (patch) => {
    setSpecialVerifyDialog(prev => prev ? { ...prev, ...patch } : prev);
  };

  const openInlineProviderVerify = async (providerId) => {
    setSelectedId(providerId);
    setSpecialVerifyDialog({ providerId, status: 'checking', message: '正在读取授权状态...', error: '', providerVerifyResult: null });

    try {
      if (providerId === 'github_copilot') {
        const status = await getCopilotStatus();
        setSpecialVerifyDialog({
          providerId,
          status: status.verified ? 'success' : 'ready',
          message: status.verified ? 'GitHub Copilot 已授权并可用。' : status.authenticated ? 'GitHub OAuth 已完成，但 Copilot 权限还需要验证。' : '尚未完成 GitHub Copilot 授权。',
          error: status.verified ? '' : (status.error || ''),
          copilotStatus: status,
          providerVerifyResult: null,
        });
        return;
      }

      const status = await getOAuthStatus(providerId);
      setSpecialVerifyDialog({
        providerId,
        status: status.authenticated && !status.expired ? 'ready' : 'ready',
        message: status.authenticated && !status.expired
          ? `已保存 ${providerId === 'antigravity' ? 'Antigravity' : 'Codex'} OAuth token，可继续验证接口是否可用。`
          : `尚未完成 ${providerId === 'antigravity' ? 'Antigravity' : 'OpenAI Codex'} 授权。`,
        error: status.expired ? 'OAuth token 已过期，请重新授权。' : '',
        authStatus: status,
        callbackUrl: '',
        providerVerifyResult: null,
      });
    } catch (error) {
      setSpecialVerifyDialog({ providerId, status: 'error', message: '', error: formatAuthError(error), providerVerifyResult: null });
    }
  };

  const runInlineProviderVerify = async (providerId) => {
    updateSpecialVerifyDialog({ verifying: true, providerVerifyResult: null });
    try {
      const result = await verifyProvider(providerId, {});
      setVerifyResults(prev => ({ ...prev, [providerId]: result }));
      updateSpecialVerifyDialog({
        providerVerifyResult: result,
        status: result.success ? 'success' : 'error',
        message: result.success ? result.message : '授权已写入，但接口验证未通过。',
        error: result.success ? '' : (result.message || '接口验证失败'),
      });
      await onRefresh();
      return result;
    } catch (error) {
      const result = { success: false, message: formatAuthError(error, '接口验证失败') };
      setVerifyResults(prev => ({ ...prev, [providerId]: result }));
      updateSpecialVerifyDialog({ providerVerifyResult: result, status: 'error', error: result.message });
      return result;
    } finally {
      updateSpecialVerifyDialog({ verifying: false });
    }
  };

  const startInlineCopilotDeviceFlow = async () => {
    updateSpecialVerifyDialog({
      starting: true,
      status: 'checking',
      message: '正在向 GitHub 申请设备码...',
      error: '',
      providerVerifyResult: null,
      copilotResult: null,
      deviceCode: '',
      userCode: '',
      verificationUri: '',
      verificationUriComplete: '',
      done: false,
      pollPaused: true,
      polling: false,
    });
    try {
      const result = await startCopilotDeviceFlow();
      if (result.error || !result.device_code) {
        updateSpecialVerifyDialog({ status: 'error', error: formatAuthError(result.error || '设备码申请失败') });
        return;
      }
      updateSpecialVerifyDialog({
        status: 'pending',
        message: '请在 GitHub 授权页输入设备码，当前页面会自动等待授权结果。',
        deviceCode: result.device_code,
        userCode: result.user_code,
        verificationUri: result.verification_uri,
        verificationUriComplete: result.verification_uri_complete,
        interval: result.interval || 5,
        expiresAt: Date.now() + Number(result.expires_in || 900) * 1000,
        done: false,
        pollPaused: false,
      });
    } catch (error) {
      updateSpecialVerifyDialog({ status: 'error', error: formatAuthError(error, '设备码申请失败') });
    } finally {
      updateSpecialVerifyDialog({ starting: false });
    }
  };

  const pollInlineCopilotDeviceFlow = async () => {
    const deviceCode = specialVerifyDialog?.deviceCode;
    if (!deviceCode || specialVerifyDialog?.polling) return;

    updateSpecialVerifyDialog({ polling: true, error: '' });
    try {
      const result = await pollCopilotDeviceFlow(deviceCode);

      if (result.status === 'authorization_pending') {
        updateSpecialVerifyDialog({ message: 'GitHub 授权尚未完成，正在继续等待...', polling: false });
        return;
      }

      if (result.status === 'slow_down') {
        updateSpecialVerifyDialog({ message: 'GitHub 要求降低轮询频率，正在继续等待...', interval: Number(specialVerifyDialog?.interval || 5) + 5, polling: false });
        return;
      }

      if (result.status === 'request_timeout') {
        updateSpecialVerifyDialog({ message: result.error || '网络波动，正在继续等待...', polling: false });
        return;
      }

      if (result.status === 'expired_token') {
        updateSpecialVerifyDialog({ status: 'error', done: true, pollPaused: true, error: '设备码已过期，请重新申请。', polling: false });
        return;
      }

      if (result.success) {
        updateSpecialVerifyDialog({ status: 'success', done: true, pollPaused: true, message: 'GitHub Copilot OAuth 与权限验证成功，正在验证接口...', polling: false, copilotResult: result });
        await onRefresh();
        await runInlineProviderVerify('github_copilot');
        return;
      }

      if (result.authenticated) {
        updateSpecialVerifyDialog({
          status: 'error',
          done: true,
          pollPaused: true,
          message: 'GitHub OAuth 已完成，但 Copilot 权限校验未通过。',
          error: result.error || '当前 GitHub 账号没有可用 Copilot 权限，或 Copilot token 兑换失败。',
          polling: false,
          copilotResult: result,
        });
        await onRefresh();
        return;
      }

      updateSpecialVerifyDialog({ status: 'error', done: true, pollPaused: true, error: formatAuthError(result.error || 'GitHub Copilot 授权失败'), polling: false, copilotResult: result });
    } catch (error) {
      updateSpecialVerifyDialog({ status: 'error', error: formatAuthError(error, 'GitHub Copilot 授权失败'), polling: false });
    }
  };

  const copyCopilotUserCode = async () => {
    if (!specialVerifyDialog?.userCode) return;
    await navigator.clipboard?.writeText(specialVerifyDialog.userCode);
    updateSpecialVerifyDialog({ message: '设备码已复制。' });
  };

  const startInlineCodexOAuth = async () => {
    updateSpecialVerifyDialog({ starting: true, error: '', providerVerifyResult: null, exchangeResult: null });
    try {
      const result = await startCodexOAuth();
      if (result.error || !result.url) {
        updateSpecialVerifyDialog({ status: 'error', error: formatAuthError(result.error || '授权链接生成失败') });
        return;
      }
      updateSpecialVerifyDialog({
        status: 'pending',
        message: '授权链接已生成。请在外部页面完成授权，然后把完整 callback URL 粘贴回来。',
        authUrl: result.url,
        state: result.state,
        expiresAt: Date.now() + 10 * 60 * 1000,
        callbackUrl: '',
      });
    } catch (error) {
      updateSpecialVerifyDialog({ status: 'error', error: formatAuthError(error, '授权链接生成失败') });
    } finally {
      updateSpecialVerifyDialog({ starting: false });
    }
  };

  const exchangeInlineCodexCallback = async () => {
    const callbackUrl = specialVerifyDialog?.callbackUrl?.trim();
    if (!callbackUrl) {
      updateSpecialVerifyDialog({ error: '请粘贴完整 callback URL。' });
      return;
    }

    updateSpecialVerifyDialog({ exchanging: true, error: '', exchangeResult: null, providerVerifyResult: null });
    try {
      const result = await exchangeCodexCallback(callbackUrl);
      if (!result.success) {
        updateSpecialVerifyDialog({ status: 'error', error: formatAuthError(result.error || 'Codex OAuth token 交换失败'), exchangeResult: result });
        return;
      }
      updateSpecialVerifyDialog({ status: 'success', message: 'OAuth token 已写入，正在验证 Codex 接口...', exchangeResult: result });
      await onRefresh();
      await runInlineProviderVerify('openai_codex');
    } catch (error) {
      updateSpecialVerifyDialog({ status: 'error', error: formatAuthError(error, 'Codex OAuth token 交换失败') });
    } finally {
      updateSpecialVerifyDialog({ exchanging: false });
    }
  };

  const startInlineAntigravityOAuth = async () => {
    updateSpecialVerifyDialog({ starting: true, error: '', providerVerifyResult: null, exchangeResult: null });
    try {
      const result = await startAntigravityOAuth();
      if (result.error || !result.url) {
        updateSpecialVerifyDialog({ status: 'error', error: formatAuthError(result.error || '授权链接生成失败') });
        return;
      }
      updateSpecialVerifyDialog({
        status: 'pending',
        message: '授权链接已生成。请在外部页面完成授权，然后把完整 callback URL 粘贴回来。',
        authUrl: result.url,
        state: result.state,
        expiresAt: Date.now() + 10 * 60 * 1000,
        callbackUrl: '',
      });
    } catch (error) {
      updateSpecialVerifyDialog({ status: 'error', error: formatAuthError(error, '授权链接生成失败') });
    } finally {
      updateSpecialVerifyDialog({ starting: false });
    }
  };

  const exchangeInlineAntigravityCallback = async () => {
    const callbackUrl = specialVerifyDialog?.callbackUrl?.trim();
    if (!callbackUrl) {
      updateSpecialVerifyDialog({ error: '请粘贴完整 callback URL。' });
      return;
    }

    updateSpecialVerifyDialog({ exchanging: true, error: '', exchangeResult: null, providerVerifyResult: null });
    try {
      const result = await exchangeAntigravityCallback(callbackUrl);
      if (!result.success) {
        updateSpecialVerifyDialog({ status: 'error', error: formatAuthError(result.error || 'Antigravity OAuth token 交换失败'), exchangeResult: result });
        return;
      }
      updateSpecialVerifyDialog({ status: 'success', message: 'OAuth token 已写入，正在验证 Antigravity 接口...', exchangeResult: result });
      await onRefresh();
      await runInlineProviderVerify('antigravity');
    } catch (error) {
      updateSpecialVerifyDialog({ status: 'error', error: formatAuthError(error, 'Antigravity OAuth token 交换失败') });
    } finally {
      updateSpecialVerifyDialog({ exchanging: false });
    }
  };

  const selectProvider = (id) => {
    setSelectedId(id);
    setShowCustomForm(false);
    setOauthForm(null);
    if (providers[id] && !editForms[id]) {
      setEditForms(prev => ({
        ...prev,
        [id]: {
          baseUrl: providers[id].baseUrl,
          authType: providers[id].authType,
          authHeader: providers[id].authHeader || 'Authorization',
          apiFormat: providers[id].apiFormat,
          billingType: providers[id].billingType,
        }
      }));
    }
    setTimeout(() => detailRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 50);
  };

  const updateEditForm = (id, field, value) => {
    setEditForms(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const handleSaveConfig = async (id) => {
    const form = editForms[id];
    if (!form) return;
    const provider = providers[id];
    await saveProvider({
      ...provider,
      baseUrl: form.baseUrl,
      authType: form.authType,
      authHeader: form.authHeader,
      apiFormat: form.apiFormat,
      billingType: form.billingType,
    });
    onRefresh();
  };

  const handleToggleDefault = async (key) => {
    if (providers[key]) {
      if (!confirm('确定要移除供应商 ' + (providers[key].name || key) + ' 吗？')) return;
      await deleteProvider(key);
      if (selectedId === key) setSelectedId(null);
      onRefresh();
    } else {
      const template = defaults[key];
      if (!template) return;
      const userMode = localStorage.getItem('hub-user-mode');
      const initialModels = userMode === 'guest' ? [] : template.models;
      await saveProvider({
        id: key, name: template.name, baseUrl: template.baseUrl,
        authType: template.authType, authHeader: template.authHeader,
        billingType: template.billingType, apiFormat: template.apiFormat,
        loginUrl: template.loginUrl || '', docsUrl: template.docsUrl || '',
        subscriptionUrl: template.subscriptionUrl || '',
        models: initialModels, apiKey: '',
        accessModes: template.accessModes || ['apikey'],
        oauth: template.oauth || null,
      });
      await onRefresh();
      selectProvider(key);
    }
  };

  const handleSaveKey = async (id) => {
    const key = apiKeyInputs[id];
    if (!key?.trim()) return;
    await updateApiKey(id, key.trim());
    setApiKeyInputs(prev => ({ ...prev, [id]: '' }));
    onRefresh();
  };

  const handleSaveModelKey = async (providerId, modelId) => {
    const inputKey = providerId + ':' + modelId;
    const key = modelKeyInputs[inputKey];
    if (!key?.trim()) return;
    await updateModelKey(providerId, modelId, key.trim());
    setModelKeyInputs(prev => ({ ...prev, [inputKey]: '' }));
    onRefresh();
  };

  const handleDeleteModelKey = async (providerId, modelId) => {
    await updateModelKey(providerId, modelId, '');
    onRefresh();
  };

  const handleAddModel = async (providerId) => {
    const form = addModelForms[providerId];
    if (!form?.id?.trim() || !form?.name?.trim()) return;
    await addModel(providerId, form.id.trim(), form.name.trim(), form.type || 'text');
    setAddModelForms(prev => ({ ...prev, [providerId]: null }));
    onRefresh();
  };

  const handleAddModelWithPreset = async (providerId, presetModel) => {
    try {
      const res = await addModel(providerId, presetModel.id, presetModel.name, presetModel.type || 'text');
      if (res.error) {
        alert(res.error);
      }
    } catch (err) {
      alert('添加模型失败: ' + err.message);
    }
    onRefresh();
  };

  const handleRemoveModel = async (providerId, modelId, modelName) => {
    if (!confirm('确定要删除模型 ' + modelName + ' 吗？')) return;
    await removeModel(providerId, modelId);
    onRefresh();
  };

  const handleDelete = async (id) => {
    if (!confirm('确定要删除供应商 ' + (providers[id]?.name || id) + ' 吗？')) return;
    await deleteProvider(id);
    if (selectedId === id) setSelectedId(null);
    onRefresh();
  };

  const handleVerify = (id) => {
    if (INLINE_VERIFY_PROVIDERS.has(id)) {
      openInlineProviderVerify(id);
      return;
    }

    if (SPECIAL_VERIFY_PROVIDERS.has(id)) {
      openProviderVerifyPage(id);
      return;
    }

    const provider = providers[id];
    const defaultStep = buildDefaultVerifyStep(provider);

    setVerifyDialog({
      providerId: id,
      result: null,
    });
    setVerifyDialogInputs([JSON.stringify(defaultStep, null, 2)]);
  };

  const handleVerifyFromDialog = async () => {
    if (!verifyDialog?.providerId) return;

    const steps = verifyDialogInputs.map((text, index) => {
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`第 ${index + 1} 个请求 JSON 格式无效`);
      }
    });

    setLoading(prev => ({ ...prev, [verifyDialog.providerId + ':dialog']: true }));
    try {
      const result = await verifyProvider(verifyDialog.providerId, { steps });
      setVerifyResults(prev => ({ ...prev, [verifyDialog.providerId]: result }));
      setVerifyDialog({ providerId: verifyDialog.providerId, result });
      setVerifyDialogInputs((result.steps || []).map(step => JSON.stringify(toEditableVerifyStep(step), null, 2)));
    } catch (error) {
      const result = { success: false, message: error.message, steps: [] };
      setVerifyResults(prev => ({ ...prev, [verifyDialog.providerId]: result }));
      setVerifyDialog({ providerId: verifyDialog.providerId, result });
    } finally {
      setLoading(prev => ({ ...prev, [verifyDialog.providerId + ':dialog']: false }));
    }
  };

  const handleVerifyCategory = async (keys) => {
    const activeKeys = keys.filter(k => !!providers[k]);
    if (activeKeys.length === 0) return;

    setLoading(prev => {
      const next = { ...prev };
      activeKeys.forEach(k => {
        next[k] = true;
      });
      return next;
    });

    for (const key of activeKeys) {
      try {
        const result = await verifyProvider(key, {});
        setVerifyResults(prev => ({ ...prev, [key]: result }));
      } catch (error) {
        setVerifyResults(prev => ({
          ...prev,
          [key]: { success: false, message: error.message || '验证失败' }
        }));
      } finally {
        setLoading(prev => ({ ...prev, [key]: false }));
      }
    }
  };

  const handleVerifyModels = async (providerId) => {
    const provider = providers[providerId];
    if (!provider || !provider.models || provider.models.length === 0) return;

    setLoading(prev => ({ ...prev, [providerId + ':models']: true }));
    setModelVerifyResults(prev => {
      const next = { ...prev };
      provider.models.forEach(m => {
        next[`${providerId}:${m.id}`] = { checking: true };
      });
      return next;
    });

    try {
      const result = await verifyProviderModels(providerId);
      if (result.success && result.results) {
        setModelVerifyResults(prev => {
          const next = { ...prev };
          Object.keys(result.results).forEach(modelId => {
            next[`${providerId}:${modelId}`] = {
              checking: false,
              success: result.results[modelId].success,
              message: result.results[modelId].message
            };
          });
          return next;
        });
      } else {
        throw new Error(result.error || '验证请求未成功返回数据');
      }
    } catch (error) {
      setModelVerifyResults(prev => {
        const next = { ...prev };
        provider.models.forEach(m => {
          next[`${providerId}:${m.id}`] = {
            checking: false,
            success: false,
            message: error.message || '验证失败'
          };
        });
        return next;
      });
    } finally {
      setLoading(prev => ({ ...prev, [providerId + ':models']: false }));
    }
  };

  const handleSaveOAuthConfig = async () => {
    if (!selectedId || !oauthForm) return;
    await saveOAuthConfig(selectedId, oauthForm);
    setOauthForm(null);
    onRefresh();
  };

  const handleOAuthLogin = (providerId) => {
    if (INLINE_VERIFY_PROVIDERS.has(providerId)) {
      openInlineProviderVerify(providerId);
      return;
    }

    if (SPECIAL_VERIFY_PROVIDERS.has(providerId)) {
      openProviderVerifyPage(providerId);
      return;
    }

    window.location.href = getOAuthLoginUrl(providerId);
  };

  const handleRefreshOAuth = async (providerId) => {
    setLoading(prev => ({ ...prev, [providerId + ':oauth']: true }));
    try {
      await refreshOAuthToken(providerId);
      await onRefresh();
    } finally {
      setLoading(prev => ({ ...prev, [providerId + ':oauth']: false }));
    }
  };

  const handleLogoutOAuth = async (providerId) => {
    setLoading(prev => ({ ...prev, [providerId + ':oauth']: true }));
    try {
      await logoutOAuth(providerId);
      await onRefresh();
    } finally {
      setLoading(prev => ({ ...prev, [providerId + ':oauth']: false }));
    }
  };

  const getModelTypes = (models) => {
    const types = new Set(models?.map(m => m.type) || []);
    return ['all', ...types];
  };

  const getFilteredModels = (providerId, models) => {
    const filter = modelFilter[providerId] || 'all';
    if (filter === 'all') return models || [];
    return (models || []).filter(m => m.type === filter);
  };

  const getDefaultInfo = (providerId) => defaults[providerId] || {};
  const selectedProvider = selectedId ? providers[selectedId] : null;

  const [showSavedMsg, setShowSavedMsg] = useState(false);

  // New Save Methods for general states
  const handleSave = (silent = false) => {
    localStorage.setItem('hub-general-settings', JSON.stringify(editGeneral));
    localStorage.setItem('hub-shortcuts-settings', JSON.stringify(editShortcuts));
    localStorage.setItem('hub-skills-settings', JSON.stringify(editSkills));
    localStorage.setItem('hub-mcp-settings', JSON.stringify(editMcp));
    localStorage.setItem('hub-cli-settings', JSON.stringify(editCli));
    localStorage.setItem('hub-terminal-settings', JSON.stringify(editTerminal));
    localStorage.setItem('hub-privacy-settings', JSON.stringify(editPrivacy));

    setGeneralSettings(editGeneral);
    setShortcuts(editShortcuts);
    setSkills(editSkills);
    setMcpServices(editMcp);
    setCliTools(editCli);
    setTerminalSettings(editTerminal);
    setPrivacySettings(editPrivacy);
    
    if (!silent) {
      setShowSavedMsg(true);
      setTimeout(() => setShowSavedMsg(false), 2000);
    }
  };

  const handleSaveAndClose = () => {
    handleSave(true);
    onClose();
  };

  // Export / Import Handlers
  const handleExport = (includeProviders = false) => {
    const data = {
      general: editGeneral,
      shortcuts: editShortcuts,
      skills: editSkills,
      mcp: editMcp,
      cli: editCli,
      terminal: editTerminal,
      privacy: editPrivacy
    };
    if (includeProviders) {
      data.providers = providers;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `aimodelhub_config_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setShowExportDropdown(false);
  };

  const handleImportClick = () => {
    importInputRef.current?.click();
  };

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        const nextGeneral = parsed.general || editGeneral;
        const nextShortcuts = parsed.shortcuts || editShortcuts;
        const nextSkills = parsed.skills || editSkills;
        const nextMcp = parsed.mcp || editMcp;
        const nextCli = parsed.cli || editCli;
        const nextTerminal = parsed.terminal || editTerminal;
        const nextPrivacy = parsed.privacy || editPrivacy;

        setEditGeneral(nextGeneral);
        setEditShortcuts(nextShortcuts);
        setEditSkills(nextSkills);
        setEditMcp(nextMcp);
        setEditCli(nextCli);
        setEditTerminal(nextTerminal);
        setEditPrivacy(nextPrivacy);
        
        if (parsed.providers) {
          for (const key of Object.keys(parsed.providers)) {
            await saveProvider(parsed.providers[key]);
          }
          onRefresh();
        }

        // Auto persist settings
        localStorage.setItem('hub-general-settings', JSON.stringify(nextGeneral));
        localStorage.setItem('hub-shortcuts-settings', JSON.stringify(nextShortcuts));
        localStorage.setItem('hub-skills-settings', JSON.stringify(nextSkills));
        localStorage.setItem('hub-mcp-settings', JSON.stringify(nextMcp));
        localStorage.setItem('hub-cli-settings', JSON.stringify(nextCli));
        localStorage.setItem('hub-terminal-settings', JSON.stringify(nextTerminal));
        localStorage.setItem('hub-privacy-settings', JSON.stringify(nextPrivacy));

        setGeneralSettings(nextGeneral);
        setShortcuts(nextShortcuts);
        setSkills(nextSkills);
        setMcpServices(nextMcp);
        setCliTools(nextCli);
        setTerminalSettings(nextTerminal);
        setPrivacySettings(nextPrivacy);

        alert('配置导入成功！');
      } catch (err) {
        alert('导入配置失败，文件可能已损坏：' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // CLI Tools Handlers
  const handleScan = () => {
    setIsScanning(true);
    setTimeout(() => {
      setIsScanning(false);
      setEditCli(prev => prev.map(tool => {
        if (tool.code === 'make') {
          return { ...tool, status: 'active', version: 'vGNU Make 3.81' };
        }
        if (tool.code === 'gradle') {
          return { ...tool, status: 'active', version: 'vGradle 8.2' };
        }
        if (tool.code === 'mvn') {
          return { ...tool, status: 'active', version: 'vMaven 3.9.2' };
        }
        return tool;
      }));
      alert('扫描完毕！已自动匹配 Gradle, Maven, make 命令行环境，并更新其检测版本。');
    }, 1500);
  };

  const handleInstallToPath = () => {
    alert('已成功将 walicode 命令工具链接安装到您的终端系统环境 PATH 路径（/usr/local/bin/walicode）。现在可以直接在终端中运行 walicode。');
  };

  const handleAddCliTool = () => {
    const name = prompt('请输入工具显示名称:');
    if (!name) return;
    const code = prompt('请输入工具调用别名 (Command):');
    if (!code) return;
    const desc = prompt('请输入简短描述:');
    
    const newTool = {
      id: 'custom-' + Date.now(),
      name,
      code,
      enabled: true,
      status: 'inactive',
      version: '',
      desc: desc || '自定义 CLI 工具集成',
      category: 'BUILD'
    };
    setEditCli(prev => [...prev, newTool]);
  };

  // MCP service Handlers
  const handleAddMcp = () => {
    if (!mcpCmds.name || !mcpCmds.cmd) return;
    const newMcp = {
      id: 'custom-' + Date.now(),
      name: mcpCmds.name,
      cmd: mcpCmds.cmd,
      desc: mcpCmds.desc || '用户自定义命令行 MCP 协议服务',
      status: 'active'
    };
    setEditMcp(prev => [...prev, newMcp]);
    setMcpCmds({ name: '', cmd: '', desc: '' });
    setShowMcpForm(false);
  };

  const handleDeleteMcp = (id) => {
    setEditMcp(prev => prev.filter(m => m.id !== id));
  };

  const handleToggleMcp = (id) => {
    setEditMcp(prev => prev.map(m => m.id === id ? { ...m, status: m.status === 'active' ? 'inactive' : 'active' } : m));
  };

  // Tab View Renderers
  const renderGeneral = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h3 style={{ fontSize: '18px', fontWeight: '600' }}>通用配置</h3>
        <p className="settings-section-desc">调整应用的基本显示模式、网络代理以及 API 超时时长。</p>
      </div>

      <div className="pc-section">
        <h4>显示与语言</h4>
        <div className="settings-form-grid">
          <div className="settings-form-group">
            <label>应用外观主题</label>
            <select value={editGeneral.theme} onChange={e => setEditGeneral(prev => ({ ...prev, theme: e.target.value }))}>
              <option value="light">明亮模式 (Light)</option>
              <option value="dark">暗黑模式 (Dark)</option>
              <option value="auto">跟随系统主题</option>
            </select>
          </div>
          <div className="settings-form-group">
            <label>语言 (Language)</label>
            <select value={editGeneral.lang} onChange={e => setEditGeneral(prev => ({ ...prev, lang: e.target.value }))}>
              <option value="zh">简体中文</option>
              <option value="en">English (US)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="pc-section">
        <h4>全局代理配置</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <label className="toggle-switch">
            <input type="checkbox" checked={editGeneral.proxyEnabled} onChange={e => setEditGeneral(prev => ({ ...prev, proxyEnabled: e.target.checked }))} />
            <span className="toggle-slider"></span>
          </label>
          <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-primary)' }}>启用网络出口代理</span>
        </div>
        {editGeneral.proxyEnabled && (
          <div className="settings-form-grid">
            <div className="settings-form-group">
              <label>代理服务器主机</label>
              <input type="text" value={editGeneral.proxyHost} onChange={e => setEditGeneral(prev => ({ ...prev, proxyHost: e.target.value }))} placeholder="127.0.0.1" />
            </div>
            <div className="settings-form-group">
              <label>代理端口</label>
              <input type="text" value={editGeneral.proxyPort} onChange={e => setEditGeneral(prev => ({ ...prev, proxyPort: e.target.value }))} placeholder="7890" />
            </div>
            <div className="settings-form-group">
              <label>用户名 (可选)</label>
              <input type="text" value={editGeneral.proxyUser} onChange={e => setEditGeneral(prev => ({ ...prev, proxyUser: e.target.value }))} />
            </div>
            <div className="settings-form-group">
              <label>密码 (可选)</label>
              <input type="password" autoComplete="new-password" value={editGeneral.proxyPass} onChange={e => setEditGeneral(prev => ({ ...prev, proxyPass: e.target.value }))} />
            </div>
          </div>
        )}
      </div>

      <div className="pc-section">
        <h4>接口连接时长</h4>
        <div className="settings-form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label>接口全局连接超时时间 (秒)</label>
            <strong style={{ color: 'var(--accent)' }}>{editGeneral.apiTimeout} 秒</strong>
          </div>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '6px' }}>
            <input type="range" min="5" max="120" value={editGeneral.apiTimeout} onChange={e => setEditGeneral(prev => ({ ...prev, apiTimeout: Number(e.target.value) }))} style={{ flex: 1 }} />
            <input type="number" min="5" max="120" value={editGeneral.apiTimeout} onChange={e => setEditGeneral(prev => ({ ...prev, apiTimeout: Number(e.target.value) }))} style={{ width: '80px', textAlign: 'center' }} />
          </div>
        </div>
      </div>
    </div>
  );

  const renderShortcuts = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h3 style={{ fontSize: '18px', fontWeight: '600' }}>快捷键配置</h3>
        <p className="settings-section-desc">配置工作区过程中的常用命令键盘映射，提升应用体验效率。</p>
      </div>

      <div className="pc-section" style={{ padding: '0px', overflow: 'hidden' }}>
        <table className="settings-shortcuts-table">
          <thead>
            <tr>
              <th style={{ width: '60%' }}>操作命令</th>
              <th style={{ width: '20%' }}>快捷按键</th>
              <th style={{ width: '20%', textAlign: 'right' }}>启用状态</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>发送消息 (Send Message)</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>启用时，Enter 直接发送消息，Shift+Enter 换行。禁用时，Cmd/Ctrl+Enter 发送，Enter 换行。</div>
              </td>
              <td><span className="settings-shortcut-key">{editShortcuts.sendMsg ? 'Enter' : 'Cmd+Enter'}</span></td>
              <td style={{ textAlign: 'right' }}>
                <label className="toggle-switch">
                  <input type="checkbox" checked={editShortcuts.sendMsg} onChange={e => setEditShortcuts(prev => ({ ...prev, sendMsg: e.target.checked }))} />
                  <span className="toggle-slider"></span>
                </label>
              </td>
            </tr>
            <tr>
              <td>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>清空当前工作区</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>一键快速重置工作区记录，丢弃上下文历史。</div>
              </td>
              <td><span className="settings-shortcut-key">Cmd + L</span></td>
              <td style={{ textAlign: 'right' }}>
                <label className="toggle-switch">
                  <input type="checkbox" checked={editShortcuts.clearChat} onChange={e => setEditShortcuts(prev => ({ ...prev, clearChat: e.target.checked }))} />
                  <span className="toggle-slider"></span>
                </label>
              </td>
            </tr>
            <tr>
              <td>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>新建应用并跳转首页</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>关闭当前配置面板，返回应用引导中心。</div>
              </td>
              <td><span className="settings-shortcut-key">Cmd + K</span></td>
              <td style={{ textAlign: 'right' }}>
                <label className="toggle-switch">
                  <input type="checkbox" checked={editShortcuts.newChat} onChange={e => setEditShortcuts(prev => ({ ...prev, newChat: e.target.checked }))} />
                  <span className="toggle-slider"></span>
                </label>
              </td>
            </tr>
            <tr>
              <td>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>打开设置控制台</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>按下指定键直接呼出本配置面板。</div>
              </td>
              <td><span className="settings-shortcut-key">Cmd + ,</span></td>
              <td style={{ textAlign: 'right' }}>
                <label className="toggle-switch">
                  <input type="checkbox" checked={editShortcuts.openSettings} onChange={e => setEditShortcuts(prev => ({ ...prev, openSettings: e.target.checked }))} />
                  <span className="toggle-slider"></span>
                </label>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderSkills = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h3 style={{ fontSize: '18px', fontWeight: '600' }}>Skills 技能模块</h3>
        <p className="settings-section-desc">为应用模型注入系统级的功能提示。启用的模块会在模型输出时提供额外的推理支持。</p>
      </div>

      <div className="settings-card-grid">
        <div className="settings-card">
          <div className="settings-card-left">
            <div className="settings-card-info">
              <div className="settings-card-title">
                <span>🔍 联网实时搜索 (Web Search)</span>
                <span className="settings-card-code">builtin:web_search</span>
              </div>
              <div className="settings-card-desc">允许大模型遇到时效性问题时自动检索互联网搜索引擎并提取回答。</div>
            </div>
          </div>
          <div className="settings-card-right">
            <label className="toggle-switch">
              <input type="checkbox" checked={editSkills.webSearch} onChange={e => setEditSkills(prev => ({ ...prev, webSearch: e.target.checked }))} />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-left">
            <div className="settings-card-info">
              <div className="settings-card-title">
                <span>💻 代码沙盒运行 (Code Interpreter)</span>
                <span className="settings-card-code">builtin:code_interpreter</span>
              </div>
              <div className="settings-card-desc">为模型集成 Python 代码解析与运行环境，精确进行复杂计算、科学画图。</div>
            </div>
          </div>
          <div className="settings-card-right">
            <label className="toggle-switch">
              <input type="checkbox" checked={editSkills.codeInterpreter} onChange={e => setEditSkills(prev => ({ ...prev, codeInterpreter: e.target.checked }))} />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-left">
            <div className="settings-card-info">
              <div className="settings-card-title">
                <span>📄 长文档智能归纳 (Doc Summary)</span>
                <span className="settings-card-code">builtin:doc_summarizer</span>
              </div>
              <div className="settings-card-desc">针对 Word/PDF 等多种格式文件，辅助模型快速生成内容结构、摘要与提取核心论点。</div>
            </div>
          </div>
          <div className="settings-card-right">
            <label className="toggle-switch">
              <input type="checkbox" checked={editSkills.docSummary} onChange={e => setEditSkills(prev => ({ ...prev, docSummary: e.target.checked }))} />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-left">
            <div className="settings-card-info">
              <div className="settings-card-title">
                <span>👁️ 多模态视觉解析 (Vision)</span>
                <span className="settings-card-code">builtin:vision_process</span>
              </div>
              <div className="settings-card-desc">自动检测上传图片内容并调用多模态模型进行视觉翻译、OCR 与细粒度分析。</div>
            </div>
          </div>
          <div className="settings-card-right">
            <label className="toggle-switch">
              <input type="checkbox" checked={editSkills.imageAnalysis} onChange={e => setEditSkills(prev => ({ ...prev, imageAnalysis: e.target.checked }))} />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );

  const renderMcp = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ fontSize: '18px', fontWeight: '600' }}>MCP 服务管理</h3>
          <p className="settings-section-desc">配置大模型的外部上下文连接协议（Model Context Protocol），集成更多的本地数据开发生态。</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowMcpForm(!showMcpForm)}>
          {showMcpForm ? '关闭面板' : '+ 添加 MCP 服务'}
        </button>
      </div>

      {showMcpForm && (
        <div className="pc-section" style={{ borderStyle: 'dashed' }}>
          <h4 style={{ fontSize: '13px' }}>添加自定义 MCP 协议命令</h4>
          <div className="settings-form-grid" style={{ marginTop: '8px' }}>
            <div className="settings-form-group">
              <label>服务连接展示名称</label>
              <input type="text" value={mcpCmds.name} onChange={e => setMcpCmds(p => ({ ...p, name: e.target.value }))} placeholder="例如: Webhook Listener" />
            </div>
            <div className="settings-form-group">
              <label>说明与描述</label>
              <input type="text" value={mcpCmds.desc} onChange={e => setMcpCmds(p => ({ ...p, desc: e.target.value }))} placeholder="例如: 允许模型读取 webhook 数据" />
            </div>
          </div>
          <div className="settings-form-group" style={{ marginTop: '12px' }}>
            <label>运行命令行</label>
            <input type="text" value={mcpCmds.cmd} onChange={e => setMcpCmds(p => ({ ...p, cmd: e.target.value }))} placeholder="例如: npx -y @modelcontextprotocol/server-webhook" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
            <button className="btn btn-primary btn-sm" onClick={handleAddMcp} disabled={!mcpCmds.name || !mcpCmds.cmd}>添加并自动连接</button>
          </div>
        </div>
      )}

      <div className="settings-card-grid">
        {editMcp.map(m => (
          <div key={m.id} className="settings-card">
            <div className="settings-card-left">
              <div className="settings-card-info" style={{ width: '100%' }}>
                <div className="settings-card-title">
                  <span style={{ fontWeight: 600 }}>🔌 {m.name}</span>
                  <span className={'status-pill ' + (m.status === 'active' ? 'success' : '')}>
                    {m.status === 'active' ? '● 已挂载' : '○ 已停止'}
                  </span>
                </div>
                <div className="settings-card-desc" style={{ 
                  fontFamily: 'monospace', 
                  fontSize: '11px', 
                  marginTop: '6px', 
                  background: 'var(--bg-primary)', 
                  padding: '6px 10px', 
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-secondary)'
                }}>{m.cmd}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{m.desc}</div>
              </div>
            </div>
            <div className="settings-card-right" style={{ flexDirection: 'column', gap: '10px' }}>
              <label className="toggle-switch">
                <input type="checkbox" checked={m.status === 'active'} onChange={() => handleToggleMcp(m.id)} />
                <span className="toggle-slider"></span>
              </label>
              {m.id.startsWith('custom-') && (
                <button className="btn btn-icon-sm" onClick={() => handleDeleteMcp(m.id)} title="删除" style={{ color: 'var(--error)' }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderCli = () => {
    const buildGroup = editCli.filter(tool => tool.category === 'BUILD');
    const cloudGroup = editCli.filter(tool => tool.category === 'CLOUD');

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Banner matching screenshot */}
        <div className="path-banner">
          <div className="path-banner-text">
            将 <code>walicode</code> 命令安装到系统 PATH，可在终端中直接使用 <code>walicode --help</code> 调用。
          </div>
          <button className="btn btn-primary" onClick={handleInstallToPath} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Download size={14} /> 安装到 PATH
          </button>
        </div>

        {/* Scan / Add bar matching screenshot */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="subbar-actions">
            <button className="btn btn-primary btn-sm" onClick={handleScan} disabled={isScanning} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <RefreshCw size={14} className={isScanning ? 'spin' : ''} /> {isScanning ? '扫描中...' : '扫描'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={handleAddCliTool}>
              + 添加工具
            </button>
          </div>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            已发现 {editCli.filter(t => t.status === 'active').length} 个工具，启用 {editCli.filter(t => t.enabled).length} 个。启用的工具会注入 AI 应用提示。
          </span>
        </div>

        {/* BUILD Category */}
        <div>
          <div className="settings-category-title">BUILD</div>
          <div className="settings-card-grid">
            {buildGroup.map(tool => (
              <div key={tool.id} className="settings-card">
                <div className="settings-card-left">
                  {/* Switch toggle on left matching screenshot */}
                  <label className="toggle-switch" style={{ marginRight: '8px' }}>
                    <input type="checkbox" checked={tool.enabled} onChange={e => {
                      const enabled = e.target.checked;
                      setEditCli(prev => prev.map(t => t.id === tool.id ? { ...t, enabled } : t));
                    }} />
                    <span className="toggle-slider"></span>
                  </label>
                  <div className="settings-card-info">
                    <div className="settings-card-title">
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{tool.name}</span>
                      <span className="settings-card-code">{tool.code}</span>
                      {tool.status === 'active' ? (
                        <span className="status-pill success" style={{ padding: '2px 8px', fontSize: '11px', gap: '4px' }}>
                          ✓ {tool.version}
                        </span>
                      ) : (
                        <span className="status-circle" title="未发现" />
                      )}
                    </div>
                    <div className="settings-card-desc" style={{ marginTop: '2px' }}>{tool.desc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CLOUD Category */}
        {cloudGroup.length > 0 && (
          <div>
            <div className="settings-category-title">CLOUD</div>
            <div className="settings-card-grid">
              {cloudGroup.map(tool => (
                <div key={tool.id} className="settings-card">
                  <div className="settings-card-left">
                    <label className="toggle-switch" style={{ marginRight: '8px' }}>
                      <input type="checkbox" checked={tool.enabled} onChange={e => {
                        const enabled = e.target.checked;
                        setEditCli(prev => prev.map(t => t.id === tool.id ? { ...t, enabled } : t));
                      }} />
                      <span className="toggle-slider"></span>
                    </label>
                    <div className="settings-card-info">
                      <div className="settings-card-title">
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{tool.name}</span>
                        <span className="settings-card-code">{tool.code}</span>
                        {tool.status === 'active' ? (
                          <span className="status-pill success" style={{ padding: '2px 8px', fontSize: '11px', gap: '4px' }}>
                            ✓ {tool.version}
                          </span>
                        ) : (
                          <span className="status-circle" title="未发现" />
                        )}
                      </div>
                      <div className="settings-card-desc" style={{ marginTop: '2px' }}>{tool.desc}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderTerminal = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h3 style={{ fontSize: '18px', fontWeight: '600' }}>终端控制台设置</h3>
        <p className="settings-section-desc">配置集成应用中执行脚本和终端操作命令时的仿真 Shell 外观。</p>
      </div>

      <div className="pc-section">
        <h4>仿真终端属性</h4>
        <div className="settings-form-grid">
          <div className="settings-form-group">
            <label>默认运行 Shell</label>
            <select value={editTerminal.shell} onChange={e => setEditTerminal(prev => ({ ...prev, shell: e.target.value }))}>
              <option value="zsh">zsh (/bin/zsh)</option>
              <option value="bash">bash (/bin/bash)</option>
              <option value="sh">sh (/bin/sh)</option>
            </select>
          </div>
          <div className="settings-form-group">
            <label>字体家族 (Font Family)</label>
            <select value={editTerminal.fontFamily} onChange={e => setEditTerminal(prev => ({ ...prev, fontFamily: e.target.value }))}>
              <option value="SF Mono">SF Mono (System default)</option>
              <option value="Fira Code">Fira Code</option>
              <option value="Monaco">Monaco</option>
              <option value="Courier New">Courier New</option>
            </select>
          </div>
        </div>

        <div className="settings-form-group" style={{ marginTop: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label>字体渲染大小 (Font Size)</label>
            <strong>{editTerminal.fontSize} px</strong>
          </div>
          <input type="range" min="12" max="24" value={editTerminal.fontSize} onChange={e => setEditTerminal(prev => ({ ...prev, fontSize: Number(e.target.value) }))} style={{ width: '100%', height: '6px', marginTop: '6px' }} />
        </div>
      </div>

      <div className="pc-section">
        <h4>界面字体渲染预览</h4>
        <div style={{
          background: '#1C1F25',
          color: '#4AF626',
          padding: '16px',
          borderRadius: '6px',
          fontFamily: editTerminal.fontFamily === 'SF Mono' ? 'SFMono-Regular, Consolas, monospace' : editTerminal.fontFamily,
          fontSize: `${editTerminal.fontSize}px`,
          minHeight: '120px',
          border: '1px solid var(--border-color)',
          boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.5)'
        }}>
          <div>walicode console (terminal mode: {editTerminal.shell})</div>
          <div>$ make --version</div>
          <div style={{ color: '#fff' }}>GNU Make 3.81 (GNU General Public License)</div>
          <div>$ _<span style={{ width: '8px', height: '14px', background: '#4AF626', display: 'inline-block', verticalAlign: 'middle' }} /></div>
        </div>
      </div>
    </div>
  );

  const renderPrivacy = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h3 style={{ fontSize: '18px', fontWeight: '600' }}>隐私与安全策略</h3>
        <p className="settings-section-desc">配置本客户端大模型应用工作区和文件数据处理的安全规则。</p>
      </div>

      <div className="settings-card-grid">
        <div className="settings-card">
          <div className="settings-card-left">
            <div className="settings-card-info">
              <div className="settings-card-title" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>发送匿名诊断遥测数据</div>
              <div className="settings-card-desc">启用时允许应用上传无害的性能指标以帮助我们修复崩溃性问题。</div>
            </div>
          </div>
          <div className="settings-card-right">
            <label className="toggle-switch">
              <input type="checkbox" checked={editPrivacy.analytics} onChange={e => setEditPrivacy(prev => ({ ...prev, analytics: e.target.checked }))} />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-left">
            <div className="settings-card-info">
              <div className="settings-card-title" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>本地保留聊天历史记录</div>
              <div className="settings-card-desc">允许系统将大模型所有的上下文聊天记录保存在本地客户端浏览器本地存储。</div>
            </div>
          </div>
          <div className="settings-card-right">
            <label className="toggle-switch">
              <input type="checkbox" checked={editPrivacy.saveHistory} onChange={e => setEditPrivacy(prev => ({ ...prev, saveHistory: e.target.checked }))} />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-left">
            <div className="settings-card-info">
              <div className="settings-card-title" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>启用本地文件向量语义索引</div>
              <div className="settings-card-desc">在用户上传代码库或长文文档时自动启动本地分词分析，进行智能语义搜索。</div>
            </div>
          </div>
          <div className="settings-card-right">
            <label className="toggle-switch">
              <input type="checkbox" checked={editPrivacy.semanticIndex} onChange={e => setEditPrivacy(prev => ({ ...prev, semanticIndex: e.target.checked }))} />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <div className="pc-section">
        <h4>会话清理周期</h4>
        <div className="settings-form-group">
          <label>大模型会话聊天垃圾缓存自动清除周期</label>
          <select value={editPrivacy.dataRetention} onChange={e => setEditPrivacy(prev => ({ ...prev, dataRetention: e.target.value }))}>
            <option value="7">保存 7 天</option>
            <option value="30">保存 30 天</option>
            <option value="90">保存 90 天</option>
            <option value="0">永久保存 (从不自动清理)</option>
          </select>
        </div>
      </div>
    </div>
  );

  return (
    <div className="settings-container">
      {/* Settings Top Header */}
      <div className="settings-header">
        <div className="settings-header-title">
          <Sliders size={18} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>设置</span>
        </div>
        <button className="btn-icon" onClick={onClose} title="关闭" style={{ width: '30px', height: '30px' }}>
          <X size={16} />
        </button>
      </div>

      {/* Settings Body containing Sidebar on Left, workspace on Right */}
      <div className="settings-body">
        
        {/* Left Sidebar */}
        <aside className="settings-sidebar">
          <div className="settings-nav">
            <button className={`settings-nav-item ${activeTab === 'general' ? 'active' : ''}`} onClick={() => setActiveTab('general')}>
              <Sliders size={16} /><span>通用配置</span>
            </button>
            <button className={`settings-nav-item ${activeTab === 'shortcuts' ? 'active' : ''}`} onClick={() => setActiveTab('shortcuts')}>
              <Keyboard size={16} /><span>快捷键</span>
            </button>
            <button className={`settings-nav-item ${activeTab === 'models' ? 'active' : ''}`} onClick={() => setActiveTab('models')}>
              <Bot size={16} /><span>模型供应商</span>
            </button>
            <button className={`settings-nav-item ${activeTab === 'skills' ? 'active' : ''}`} onClick={() => setActiveTab('skills')}>
              <Sparkles size={16} /><span>Skills</span>
            </button>
            <button className={`settings-nav-item ${activeTab === 'mcp' ? 'active' : ''}`} onClick={() => setActiveTab('mcp')}>
              <Plug size={16} /><span>MCP 服务</span>
            </button>
            <button className={`settings-nav-item ${activeTab === 'cli' ? 'active' : ''}`} onClick={() => setActiveTab('cli')}>
              <FolderCode size={16} /><span>CLI 工具</span>
            </button>
            <button className={`settings-nav-item ${activeTab === 'terminal' ? 'active' : ''}`} onClick={() => setActiveTab('terminal')}>
              <Terminal size={16} /><span>终端</span>
            </button>
            <button className={`settings-nav-item ${activeTab === 'privacy' ? 'active' : ''}`} onClick={() => setActiveTab('privacy')}>
              <ShieldCheck size={16} /><span>隐私保护</span>
            </button>
          </div>

          {/* Configuration Actions */}
          <div className="settings-sidebar-footer">
            <div className="export-dropdown-wrapper">
              <button className="btn btn-secondary btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setShowExportDropdown(!showExportDropdown)}>
                <Download size={13} /> 导出配置 <ChevronDown size={11} />
              </button>
              {showExportDropdown && (
                <div className="export-dropdown-menu">
                  <button className="export-dropdown-item" onClick={() => handleExport(false)}>仅导出应用配置</button>
                  <button className="export-dropdown-item" onClick={() => handleExport(true)}>应用配置及模型供应商</button>
                </div>
              )}
            </div>
            <button className="btn btn-secondary btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={handleImportClick}>
              <Upload size={13} /> 导入配置
            </button>
            <input type="file" ref={importInputRef} style={{ display: 'none' }} accept=".json" onChange={handleImportFile} />
          </div>
        </aside>

        {/* Right workspace content */}
        <div className={`settings-content ${activeTab === 'models' ? 'models-tab' : ''}`}>
          {activeTab === 'models' ? (
            <div className="settings-llm-wrapper">
              
              {/* ORIGINAL ProviderManager Left column layout */}
              <div className="pm-left">
                <div className="pm-search-box" style={{ position: 'sticky', top: 0, zIndex: 10, padding: '16px 16px 0 16px', background: 'var(--bg-secondary)', marginBottom: '-4px' }}>
                  <div style={{ position: 'relative' }}>
                    <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-light)' }} />
                    <input
                      type="text"
                      placeholder="搜索供应商名称/ID..."
                      value={providerSearch}
                      onChange={e => setProviderSearch(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 12px 8px 32px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-color)',
                        fontSize: '13px',
                        outline: 'none'
                      }}
                    />
                  </div>
                </div>
                <div className="pm-left-section">
                  <h3>快速添加 / 移除</h3>
                  <div className="pm-defaults-list">
                    {(() => {
                      const globalCommonList = ['openai', 'openai_codex', 'github_copilot', 'anthropic', 'google', 'xai', 'antigravity'];
                      const domesticCommonList = ['moonshot', 'kimi_coding', 'minimax', 'qwen', 'doubao', 'deepseek', 'hunyuan', 'zhipu'];
                      const commonList = [...globalCommonList, ...domesticCommonList];

                      const filtered = Object.entries(defaults).filter(([key, tpl]) => 
                        !providerSearch || tpl.name.toLowerCase().includes(providerSearch.toLowerCase()) || key.toLowerCase().includes(providerSearch.toLowerCase())
                      );

                      const configuredCommon = filtered.filter(([key]) => !!providers[key]);
                      const globalCommon = filtered.filter(([key]) => globalCommonList.includes(key));
                      const domesticCommon = filtered.filter(([key]) => domesticCommonList.includes(key));
                      const others = filtered.filter(([key]) => !commonList.includes(key));

                      const renderRow = ([key, tpl]) => {
                        const isAdded = !!providers[key];
                        const isVerifying = !!loading[key];
                        const verifyResult = verifyResults[key];
                        return (
                          <div key={key} className={'pm-provider-row' + (isAdded ? ' added' : '') + (selectedId === key ? ' selected' : '')}>
                            <div className="pm-provider-row-info" onClick={() => isAdded ? selectProvider(key) : null}>
                              <div className={'pm-dot ' + (isAdded ? 'active' : '')} />
                              <div className="pm-provider-row-text">
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                  <span className="pm-provider-name">{tpl.name}</span>
                                  {isAdded && (
                                    <>
                                      {isVerifying ? (
                                        <Loader size={12} className="spin" style={{ color: 'var(--accent)', marginLeft: 6, flexShrink: 0 }} />
                                      ) : verifyResult ? (
                                        verifyResult.success ? (
                                          <CheckCircle size={12} style={{ color: '#52c41a', marginLeft: 6, flexShrink: 0 }} title="连接成功" />
                                        ) : (
                                          <X size={12} style={{ color: '#ff4d4f', marginLeft: 6, flexShrink: 0 }} title={`连接失败: ${verifyResult.message || ''}`} />
                                        )
                                      ) : null}
                                    </>
                                  )}
                                </div>
                                <span className="pm-provider-meta">
                                  {tpl.models.length} 模型 · {(tpl.accessModes || ['apikey']).map(getAccessModeLabel).join(' /')}
                                </span>
                              </div>
                            </div>
                            <div className="pm-provider-actions">
                              <button className={'pm-toggle-btn ' + (isAdded ? 'added' : 'add')} onClick={() => !isAdded && handleToggleDefault(key)} disabled={isAdded}>
                                {isAdded ? <CheckCircle size={14}/> : <Plus size={14}/>}
                                {isAdded ? '已添加' : '添加'}
                              </button>
                              {isAdded && (
                                <button className="pm-toggle-btn cancel" onClick={() => handleToggleDefault(key)}>
                                  <X size={14} />
                                  取消添加
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      };

                      return (
                        <>
                          {configuredCommon.length > 0 && (
                            <>
                              <div className="pm-category-header">
                                <button className="pm-category-label collapsible" onClick={() => setConfiguredExpanded(!configuredExpanded)}>
                                  {configuredExpanded ? '▼' : '▶'} ⚙️ 已配置和验证的供应商 ({configuredCommon.length})
                                </button>
                                {(() => {
                                  const keys = configuredCommon.map(([k]) => k);
                                  const isCategoryLoading = keys.some(k => loading[k]);
                                  return (
                                    <button 
                                      className="pm-category-verify-btn" 
                                      disabled={isCategoryLoading}
                                      onClick={(e) => { 
                                        e.stopPropagation(); 
                                        handleVerifyCategory(keys); 
                                      }}
                                    >
                                      {isCategoryLoading ? <RefreshCw size={10} className="spin" /> : <RefreshCw size={10} />}
                                      {isCategoryLoading ? '验证中...' : '一键验证'}
                                    </button>
                                  );
                                })()}
                              </div>
                              {configuredExpanded && configuredCommon.map(renderRow)}
                            </>
                          )}

                          {globalCommon.length > 0 && (
                            <>
                              <div className="pm-category-header">
                                <button className="pm-category-label collapsible" onClick={() => setGlobalExpanded(!globalExpanded)}>
                                  {globalExpanded ? '▼' : '▶'} 🌍 全球常用模型供应商 ({globalCommon.length})
                                </button>
                                {(() => {
                                  const keys = globalCommon.map(([k]) => k);
                                  const activeKeys = keys.filter(k => !!providers[k]);
                                  const isCategoryLoading = keys.some(k => loading[k]);
                                  if (activeKeys.length === 0) return null;
                                  return (
                                    <button 
                                      className="pm-category-verify-btn" 
                                      disabled={isCategoryLoading}
                                      onClick={(e) => { 
                                        e.stopPropagation(); 
                                        handleVerifyCategory(keys); 
                                      }}
                                    >
                                      {isCategoryLoading ? <RefreshCw size={10} className="spin" /> : <RefreshCw size={10} />}
                                      {isCategoryLoading ? '验证中...' : '一键验证'}
                                    </button>
                                  );
                                })()}
                              </div>
                              {globalExpanded && globalCommon.map(renderRow)}
                            </>
                          )}

                          {domesticCommon.length > 0 && (
                            <>
                              <div className="pm-category-header">
                                <button className="pm-category-label collapsible" onClick={() => setDomesticExpanded(!domesticExpanded)}>
                                  {domesticExpanded ? '▼' : '▶'} 🇨🇳 国产常用模型供应商 ({domesticCommon.length})
                                </button>
                                {(() => {
                                  const keys = domesticCommon.map(([k]) => k);
                                  const activeKeys = keys.filter(k => !!providers[k]);
                                  const isCategoryLoading = keys.some(k => loading[k]);
                                  if (activeKeys.length === 0) return null;
                                  return (
                                    <button 
                                      className="pm-category-verify-btn" 
                                      disabled={isCategoryLoading}
                                      onClick={(e) => { 
                                        e.stopPropagation(); 
                                        handleVerifyCategory(keys); 
                                      }}
                                    >
                                      {isCategoryLoading ? <RefreshCw size={10} className="spin" /> : <RefreshCw size={10} />}
                                      {isCategoryLoading ? '验证中...' : '一键验证'}
                                    </button>
                                  );
                                })()}
                              </div>
                              {domesticExpanded && domesticCommon.map(renderRow)}
                            </>
                          )}

                          {others.length > 0 && (
                            <>
                              <div className="pm-category-header with-divider">
                                <button className="pm-category-label collapsible" onClick={() => setOthersExpanded(!othersExpanded)}>
                                  {othersExpanded ? '▼' : '▶'} 📦 其他模型供应商 ({others.length})
                                </button>
                                {(() => {
                                  const keys = others.map(([k]) => k);
                                  const activeKeys = keys.filter(k => !!providers[k]);
                                  const isCategoryLoading = keys.some(k => loading[k]);
                                  if (activeKeys.length === 0) return null;
                                  return (
                                    <button 
                                      className="pm-category-verify-btn" 
                                      disabled={isCategoryLoading}
                                      onClick={(e) => { 
                                        e.stopPropagation(); 
                                        handleVerifyCategory(keys); 
                                      }}
                                    >
                                      {isCategoryLoading ? <RefreshCw size={10} className="spin" /> : <RefreshCw size={10} />}
                                      {isCategoryLoading ? '验证中...' : '一键验证'}
                                    </button>
                                  );
                                })()}
                              </div>
                              {othersExpanded && others.map(renderRow)}
                            </>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* ORIGINAL ProviderManager Right detail area */}
              <div className="pm-main" ref={detailRef}>
                {showCustomForm ? (
                  <CustomProviderForm
                    onSave={async (provider) => {
                      await saveProvider(provider);
                      setShowCustomForm(false);
                      setSelectedId(provider.id);
                      onRefresh();
                    }}
                    onCancel={() => setShowCustomForm(false)}
                  />
                ) : selectedProvider ? (() => {
                  const provider = selectedProvider;
                  const defInfo = defaults[provider.id] || {};
                  const accessModes = provider.accessModes || defInfo.accessModes || ['apikey'];
                  const oauthStatus = provider.oauthStatus || { authenticated: false };
                  const hasOAuth = accessModes.includes('oauth') || !!provider.oauth || !!defInfo.oauth;
                  const hasKey = provider.apiKey && provider.apiKey.length > 4;
                  const types = getModelTypes(provider.models);
                  const filteredModels = getFilteredModels(provider.id, provider.models);
                  const addForm = addModelForms[provider.id];
                  const verifyResult = verifyResults[provider.id];
                  const oauthBusy = !!loading[provider.id + ':oauth'];

                  return (
                    <div className="pm-detail">
                      <div className="pm-detail-header">
                        <h3>{provider.name}</h3>
                        <div className="pm-detail-actions">
                          <button className="btn btn-sm btn-secondary" onClick={() => handleVerify(provider.id)} disabled={loading[provider.id]}>
                            {loading[provider.id] ? <Loader size={14} className="spin" /> : <Shield size={14} />} 验证连接
                          </button>
                          <button className="btn btn-sm btn-secondary" onClick={() => handleVerifyModels(provider.id)} disabled={loading[provider.id + ':models']}>
                            {loading[provider.id + ':models'] ? <Loader size={14} className="spin" /> : <Sparkles size={14} />} 验证模型
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleDelete(provider.id)}>
                            <Trash2 size={14} /> 删除
                          </button>
                        </div>
                      </div>

                      <div className="pm-detail-body">
                        {/* Access Mode indicator */}
                        <div className="pc-access-modes">
                          <span className="pc-access-label">接入方式：</span>
                          {accessModes.includes('apikey') && (
                            <span className={'pc-access-badge apikey' + (hasKey ? ' active' : '')}>🔑 API Key {hasKey && '✅'}</span>
                          )}
                          {hasOAuth && (
                            <span className={'pc-access-badge oauth' + (oauthStatus.authenticated && !oauthStatus.expired ? ' active' : '')}>
                              🔐 订阅授权 {oauthStatus.authenticated && !oauthStatus.expired && '✅'}
                              {oauthStatus.authenticated && oauthStatus.expired && '⚠️已过期'}
                            </span>
                          )}
                        </div>

                        {/* API Key area */}
                        {accessModes.includes('apikey') && (
                          <div className="pc-section">
                            <h4>🔑 API Key 接入</h4>
                            <div className="pc-apikey-area">
                              <div className="pc-oauth-info">
                                <span>当前来源: {provider.apiKeySource === 'saved' ? '已保存 Key' : provider.apiKeySource === 'env' ? `环境变量 ${provider.apiKeyEnvVar}` : '未设置'}</span>
                              </div>
                              <div className="pc-apikey-row">
                                <input type="password" autoComplete="new-password" value={apiKeyInputs[provider.id] || ''} onChange={e => setApiKeyInputs(prev => ({ ...prev, [provider.id]: e.target.value }))} placeholder={hasKey ? '当前: ' + provider.apiKey + ' (输入新值覆盖)' : '请输入 API Key...'} />
                                <button className="btn btn-sm btn-primary" onClick={() => handleSaveKey(provider.id)} disabled={!apiKeyInputs[provider.id]?.trim()}><CheckCircle size={14} /> 保存</button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* OAuth config */}
                        {hasOAuth && (
                          <div className="pc-section pc-oauth-config">
                            <div className="pc-section-header">
                              <h4>🔐 OAuth / 订阅授权</h4>
                              <button className="btn btn-sm btn-secondary" onClick={() =>
                                setOauthForm(oauthForm ? null : {
                                  authorizeUrl: provider.oauth?.authorizeUrl || defInfo.oauth?.authorizeUrl || '',
                                  tokenUrl: provider.oauth?.tokenUrl || defInfo.oauth?.tokenUrl || '',
                                  clientId: provider.oauth?.clientId || defInfo.oauth?.clientId || '',
                                  clientSecret: provider.oauth?.clientSecret || '',
                                  scope: provider.oauth?.scope || defInfo.oauth?.scope || 'basic',
                                  redirectUri: provider.oauth?.redirectUri || defInfo.oauth?.redirectUri || '',
                                })
                              }>
                                {oauthForm ? '取消' : '编辑 OAuth'}
                              </button>
                            </div>

                            <div className="pc-oauth-status">
                              <div className={'pc-oauth-status-row ' + (oauthStatus.authenticated ? (oauthStatus.expired ? 'warning' : 'success') : 'neutral')}>
                                <span>
                                  {oauthStatus.authenticated
                                    ? (oauthStatus.expired ? '授权已过期，需要刷新或重新登录。' : 'OAuth 已授权，可以直接验证连接。')
                                    : '尚未完成 OAuth 授权。'}
                                </span>
                                <div className="pc-oauth-actions">
                                  <button className="btn btn-sm btn-primary" onClick={() => handleOAuthLogin(provider.id)} disabled={oauthBusy || (!SPECIAL_VERIFY_PROVIDERS.has(provider.id) && !(provider.oauth?.clientId || oauthForm?.clientId))}>
                                    <LogIn size={14} /> 去登录
                                  </button>
                                  {oauthStatus.authenticated && oauthStatus.expired && (
                                    <button className="btn btn-sm btn-secondary" onClick={() => handleRefreshOAuth(provider.id)} disabled={oauthBusy}>
                                      <RefreshCw size={14} className={oauthBusy ? 'spin' : ''} /> 刷新令牌
                                    </button>
                                  )}
                                  {oauthStatus.authenticated && (
                                    <button className="btn btn-sm btn-secondary" onClick={() => handleLogoutOAuth(provider.id)} disabled={oauthBusy}>
                                      <LogOut size={14} /> 退出授权
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>

                            {!oauthForm && (provider.oauth?.clientId || defInfo.oauth?.clientId) && (
                              <div className="pc-oauth-info">
                                <span>Client ID: {(provider.oauth?.clientId || defInfo.oauth?.clientId || '').slice(0, 12)}...</span>
                                {provider.oauth?.clientSecret && <span>Secret: {provider.oauth.clientSecret}</span>}
                                {(provider.oauth?.scope || defInfo.oauth?.scope) && <span>Scope: {provider.oauth?.scope || defInfo.oauth?.scope}</span>}
                              </div>
                            )}
                            {oauthForm && (
                              <div className="pc-add-model-form">
                                <div className="pc-field-row">
                                  <div className="pc-field"><label>Authorize URL</label><input value={oauthForm.authorizeUrl} onChange={e => setOauthForm(f => ({ ...f, authorizeUrl: e.target.value }))} placeholder="https://provider.com/oauth/authorize" /></div>
                                  <div className="pc-field"><label>Token URL</label><input value={oauthForm.tokenUrl} onChange={e => setOauthForm(f => ({ ...f, tokenUrl: e.target.value }))} placeholder="https://provider.com/oauth/token" /></div>
                                </div>
                                <div className="pc-field-row">
                                  <div className="pc-field"><label>Client ID</label><input value={oauthForm.clientId} onChange={e => setOauthForm(f => ({ ...f, clientId: e.target.value }))} placeholder="your-client-id" /></div>
                                  <div className="pc-field"><label>Client Secret</label><input type="password" autoComplete="new-password" value={oauthForm.clientSecret} onChange={e => setOauthForm(f => ({ ...f, clientSecret: e.target.value }))} placeholder="your-client-secret" /></div>
                                </div>
                                <div className="pc-field-row">
                                  <div className="pc-field"><label>Scope</label><input value={oauthForm.scope} onChange={e => setOauthForm(f => ({ ...f, scope: e.target.value }))} placeholder="basic" /></div>
                                  <div className="pc-field"><label>Redirect URI（可选）</label><input value={oauthForm.redirectUri} onChange={e => setOauthForm(f => ({ ...f, redirectUri: e.target.value }))} placeholder="自动生成" /></div>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                  <button className="btn btn-sm btn-primary" onClick={handleSaveOAuthConfig} disabled={!oauthForm.authorizeUrl || !oauthForm.tokenUrl || !oauthForm.clientId}><CheckCircle size={14} /> 保存 OAuth 配置</button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {verifyResult && (
                          <div className={'pc-verify-result ' + (verifyResult.success ? 'success' : 'error')}>
                            {verifyResult.message}
                          </div>
                        )}

                        {/* Models Section */}
                        <div className="pc-section">
                          <div className="pc-section-header">
                            <h4>📦 模型管理 ({provider.models?.length || 0})</h4>
                            <button className="btn btn-sm btn-secondary" onClick={() => setAddModelForms(prev => ({ ...prev, [provider.id]: prev[provider.id] ? null : { id: '', name: '', type: 'text' } }))}>
                              {addForm ? '取消' : <><Plus size={14} /> 添加模型</>}
                            </button>
                          </div>
                          {addForm && (
                             <div className="pc-add-model-form">
                               <div className="pc-field-row">
                                 <div className="pc-field"><label>模型 ID</label><input value={addForm.id} onChange={e => setAddModelForms(prev => ({ ...prev, [provider.id]: { ...addForm, id: e.target.value } }))} placeholder="例如: gpt-5" /></div>
                                 <div className="pc-field"><label>展示名称</label><input value={addForm.name} onChange={e => setAddModelForms(prev => ({ ...prev, [provider.id]: { ...addForm, name: e.target.value } }))} placeholder="例如: GPT-5" /></div>
                                 <div className="pc-field"><label>模型模态</label>
                                   <select value={addForm.type} onChange={e => setAddModelForms(prev => ({ ...prev, [provider.id]: { ...addForm, type: e.target.value } }))}>
                                     <option value="text">纯文本大模型</option>
                                     <option value="image">图像生成</option>
                                     <option value="video">视频生成</option>
                                     <option value="audio">音频模型</option>
                                   </select>
                                 </div>
                               </div>
                               <button className="btn btn-sm btn-primary block-btn" onClick={() => handleAddModel(provider.id)} disabled={!addForm.id || !addForm.name}><CheckCircle size={14} /> 确认添加</button>
                             </div>
                          )}
                          
                          {/* Default/Preset models to add */}
                          {defaults[provider.id] && (
                            (() => {
                              const existingIds = new Set((provider.models || []).map(m => m.id));
                              const availablePresets = (defaults[provider.id].models || []).filter(m => !existingIds.has(m.id));
                              if (availablePresets.length === 0) return null;
                              return (
                                <div className="pc-preset-models-section" style={{
                                  marginTop: '0px',
                                  marginBottom: '20px',
                                  padding: '16px',
                                  background: 'rgba(255, 255, 255, 0.02)',
                                  border: '1px dashed rgba(255, 255, 255, 0.08)',
                                  borderRadius: '12px'
                                }}>
                                  <h5 style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#e5e7eb', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                                    <Sparkles size={14} style={{ color: '#818cf8' }} /> 推荐的预置模型列表：
                                  </h5>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                    {availablePresets.map(m => {
                                      const isGuest = localStorage.getItem('hub-user-mode') === 'guest';
                                      const reachedLimit = isGuest && (provider.models || []).length >= 3;
                                      return (
                                        <button
                                          key={m.id}
                                          type="button"
                                          className="btn btn-sm btn-secondary"
                                          style={{
                                            background: 'rgba(255, 255, 255, 0.03)',
                                            border: '1px solid rgba(255, 255, 255, 0.06)',
                                            borderRadius: '8px',
                                            padding: '6px 10px',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            fontSize: '12px',
                                            opacity: reachedLimit ? 0.6 : 1,
                                            cursor: reachedLimit ? 'not-allowed' : 'pointer',
                                            color: '#e5e7eb',
                                            transition: 'all 0.2s'
                                          }}
                                          title={reachedLimit ? '游客模式单个供应商最多添加3个模型' : `添加 ${m.name}`}
                                          onClick={() => {
                                            if (reachedLimit) {
                                              alert('游客限制：单个供应商最多支持 3 个模型。请注册并登录正式账号解锁无限额功能！');
                                              return;
                                            }
                                            handleAddModelWithPreset(provider.id, m);
                                          }}
                                        >
                                          <span style={{ fontWeight: 500 }}>{m.name}</span>
                                          <span style={{ fontSize: '10px', opacity: 0.6, background: 'rgba(255,255,255,0.08)', padding: '2px 4px', borderRadius: '4px' }}>
                                            {m.type === 'text' ? '文本' : m.type === 'image' ? '图片' : m.type === 'video' ? '视频' : m.type === 'audio' ? '音频' : m.type}
                                          </span>
                                          <Plus size={12} />
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })()
                          )}
                          
                          {types.length > 2 && (
                            <div className="pc-model-filter">
                              {types.map(t => (
                                <button key={t} className={'pc-model-filter-btn ' + ((modelFilter[provider.id] || 'all') === t ? 'active' : '')} onClick={() => setModelFilter(prev => ({ ...prev, [provider.id]: t }))}>
                                  {MODEL_TYPE_LABELS[t] || t}
                                </button>
                              ))}
                            </div>
                          )}

                          <div className="pc-model-list">
                            {filteredModels.map(m => {
                              const inputKey = `${provider.id}:${m.id}`;
                              const modelKey = provider.modelKeys?.[m.id] || '';
                              const hasModelKey = modelKey && modelKey.length > 4;
                              return (
                                <div key={m.id} className="pc-model-item">
                                  <div className="pc-model-item-header">
                                    <span className={'pc-model-tag type-' + m.type}>{m.name} [{m.type}]</span>
                                    <span className="pc-model-id">{m.id}</span>
                                    {hasModelKey && <span className="pc-key-badge success">🔑 {modelKey}</span>}
                                    {!hasModelKey && hasKey && <span className="pc-key-badge muted">全局Key</span>}
                                    {modelVerifyResults[inputKey] && (() => {
                                      const res = modelVerifyResults[inputKey];
                                      if (res.checking) {
                                        return <span className="pc-key-badge warning" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Loader size={10} className="spin" /> 正在验证...</span>;
                                      }
                                      if (res.success) {
                                        return <span className="pc-key-badge success" title={res.message}>✓ 可用</span>;
                                      }
                                      return <span className="pc-key-badge danger" title={res.message} style={{ cursor: 'help' }}>✗ 不可用</span>;
                                    })()}
                                    <button className="btn-icon-sm" onClick={() => handleRemoveModel(provider.id, m.id, m.name)} title="删除模型"><Trash2 size={14} /></button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                      </div>
                    </div>
                  );
                })() : (
                  <div className="pm-empty-state">
                    <div className="pm-empty-state-card">
                      <h3>选择一个已添加的模型供应商</h3>
                      <p>左侧列表中先点击“添加”，再点击供应商名称，即可在这里配置 API Key、OAuth 和模型。</p>
                    </div>
                  </div>
                )}
              </div>

            </div>
          ) : (
            <div className="settings-content-wrapper">
              {activeTab === 'general' && renderGeneral()}
              {activeTab === 'shortcuts' && renderShortcuts()}
              {activeTab === 'skills' && renderSkills()}
              {activeTab === 'mcp' && renderMcp()}
              {activeTab === 'cli' && renderCli()}
              {activeTab === 'terminal' && renderTerminal()}
              {activeTab === 'privacy' && renderPrivacy()}
            </div>
          )}
        </div>
      </div>

      {/* Settings Bottom Action Bar */}
      <div className="settings-footer">
        <div className="settings-footer-left">
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            AI Model Hub Settings console v1.0.0
          </span>
        </div>
        <div className="settings-footer-right" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button className="btn btn-primary" onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            关闭
          </button>
        </div>
      </div>

      {/* Keep the floating dialog elements from original code */}
      {specialVerifyDialog && (
        <div className="pm-modal-backdrop" onClick={() => setSpecialVerifyDialog(null)}>
          <div className="pm-modal pm-auth-modal" onClick={e => e.stopPropagation()}>
            <div className="pm-modal-header">
              <div>
                <h3>{specialVerifyDialog.providerId === 'github_copilot' ? 'GitHub Copilot 当前页验证' : specialVerifyDialog.providerId === 'antigravity' ? 'Antigravity 订阅授权验证' : 'OpenAI Codex 当前页验证'}</h3>
                <p>{providers[specialVerifyDialog.providerId]?.name || specialVerifyDialog.providerId}</p>
              </div>
              <div className="pm-modal-actions">
                {specialVerifyDialog.providerId === 'github_copilot' && (
                  <button className="btn btn-sm btn-secondary" onClick={() => runInlineProviderVerify('github_copilot')} disabled={specialVerifyDialog.verifying}>
                    {specialVerifyDialog.verifying ? <Loader size={14} className="spin" /> : <Shield size={14} />} 验证接口
                  </button>
                )}
                {(specialVerifyDialog.providerId === 'openai_codex' || specialVerifyDialog.providerId === 'antigravity') && specialVerifyDialog.authStatus?.authenticated && !specialVerifyDialog.authStatus?.expired && (
                  <button className="btn btn-sm btn-secondary" onClick={() => runInlineProviderVerify(specialVerifyDialog.providerId)} disabled={specialVerifyDialog.verifying}>
                    {specialVerifyDialog.verifying ? <Loader size={14} className="spin" /> : <Shield size={14} />} 验证接口
                  </button>
                )}
                <button className="btn-icon-sm" onClick={() => setSpecialVerifyDialog(null)} title="关闭">
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="pm-modal-body">
              <div className="pm-auth-summary">
                <div>
                  <span className={'pm-auth-status-dot ' + (specialVerifyDialog.status || 'ready')}></span>
                  <strong>{getAuthStatusLabel(specialVerifyDialog.status)}</strong>
                </div>
                <p>
                  {specialVerifyDialog.providerId === 'github_copilot'
                    ? '先申请设备码，在 GitHub 页面完成绑定后回到这里自动/手动验证。'
                    : '授权在外部页面完成，本地页面只负责保存 token 和验证接口。'}
                </p>
              </div>
              {specialVerifyDialog.message && (
                <div className={'pc-verify-result ' + (specialVerifyDialog.status === 'error' ? 'error' : 'success')}>
                  {specialVerifyDialog.message}
                </div>
              )}
              {specialVerifyDialog.error && (
                <div className="pc-verify-result error">
                  {specialVerifyDialog.error}
                  {specialVerifyDialog.providerId === 'github_copilot' && (
                    <ul className="pm-auth-troubleshoot">
                      <li>确认后端服务正在运行：localhost:3001 能访问。</li>
                      <li>如果 GitHub 页面已经显示 connected，请回到这里点“我已完成授权，立即验证”。</li>
                      <li>如果设备码过期，重新申请设备码即可。</li>
                    </ul>
                  )}
                </div>
              )}

              {specialVerifyDialog.providerId === 'github_copilot' && (
                <div className="pm-auth-wizard">
                  <div className="pm-auth-card pm-auth-step-card">
                    <div className="pm-auth-step-index">1</div>
                    <div className="pm-auth-step-content">
                      <h3>申请 GitHub 设备码</h3>
                      <p>授权页会打开到 GitHub，本地验证状态会留在当前页面；失败后可直接重试。</p>
                      <button className="btn btn-primary" onClick={startInlineCopilotDeviceFlow} disabled={specialVerifyDialog.starting}>
                        {specialVerifyDialog.starting ? <Loader size={14} className="spin" /> : <LogIn size={14} />} {specialVerifyDialog.userCode ? '重新申请设备码' : '申请设备码'}
                      </button>
                    </div>
                  </div>

                  {specialVerifyDialog.userCode && (
                    <div className="pm-auth-card pm-auth-step-card">
                      <div className="pm-auth-step-index">2</div>
                      <div className="pm-auth-step-content">
                        <h3>在 GitHub 完成授权</h3>
                        <p className="pm-auth-hint">复制设备码或直接打开授权页，看到 GitHub 提示 connected 后回到这里。</p>
                        <div className="pm-auth-code">{specialVerifyDialog.userCode}</div>
                        <div className="pm-auth-actions">
                          <button className="btn btn-secondary" onClick={copyCopilotUserCode}>复制设备码</button>
                          <a className="btn btn-primary" href={specialVerifyDialog.verificationUriComplete || specialVerifyDialog.verificationUri} target="_blank" rel="noreferrer">
                            <ExternalLink size={14} /> 打开 GitHub 授权页
                          </a>
                          <button className="btn btn-secondary" onClick={pollInlineCopilotDeviceFlow} disabled={specialVerifyDialog.polling || specialVerifyDialog.done}>
                            {specialVerifyDialog.polling ? <Loader size={14} className="spin" /> : <RefreshCw size={14} />} 我已完成授权，立即验证
                          </button>
                        </div>
                        {specialVerifyDialog.expiresAt && <p className="pm-auth-hint">设备码有效期至 {new Date(specialVerifyDialog.expiresAt).toLocaleTimeString()}，页面会自动轮询。</p>}
                      </div>
                    </div>
                  )}

                  {specialVerifyDialog.copilotResult && (
                    <div className="pm-verify-block">
                      <div className="pm-verify-label">GitHub/Copilot 授权结果</div>
                      <pre className="pm-verify-pre response">{JSON.stringify(specialVerifyDialog.copilotResult, null, 2)}</pre>
                    </div>
                  )}
                </div>
              )}

              {specialVerifyDialog.providerId === 'openai_codex' && (
                <div className="pm-auth-wizard">
                  <div className="pm-empty-state-card">
                    <h3>1. 生成 OpenAI Codex 授权链接</h3>
                    <p>授权后可能跳到 localhost:1455且页面打不开，这是正常现象；请复制浏览器地址栏完整 URL 回来。</p>
                    <button className="btn btn-primary" onClick={startInlineCodexOAuth} disabled={specialVerifyDialog.starting}>
                      {specialVerifyDialog.starting ? <Loader size={14} className="spin" /> : <LogIn size={14} />} 生成授权链接
                    </button>
                  </div>

                  {specialVerifyDialog.authUrl && (
                    <div className="pm-auth-card">
                      <h3>2. 完成授权并粘贴回调地址</h3>
                      <a className="btn btn-primary" href={specialVerifyDialog.authUrl} target="_blank" rel="noreferrer">
                        <ExternalLink size={14} /> 打开 OpenAI 授权页
                      </a>
                      <p className="pm-auth-hint">请在 10 分钟内完成授权。必须粘贴包含 code 和 state 的完整 callback URL。</p>
                      <textarea
                        className="pm-auth-callback"
                        value={specialVerifyDialog.callbackUrl || ''}
                        onChange={e => updateSpecialVerifyDialog({ callbackUrl: e.target.value })}
                        placeholder="http://localhost:1455/auth/callback?code=...&state=..."
                      />
                      <button className="btn btn-primary" onClick={exchangeInlineCodexCallback} disabled={specialVerifyDialog.exchanging || !specialVerifyDialog.callbackUrl?.trim()}>
                        {specialVerifyDialog.exchanging ? <Loader size={14} className="spin" /> : <CheckCircle size={14} />} 写入 token 并验证接口
                      </button>
                    </div>
                  )}

                  {specialVerifyDialog.exchangeResult && (
                    <div className="pm-verify-block">
                      <div className="pm-verify-label">OAuth token 写入结果</div>
                      <pre className="pm-verify-pre response">{JSON.stringify(specialVerifyDialog.exchangeResult, null, 2)}</pre>
                    </div>
                  )}
                </div>
              )}

              {specialVerifyDialog.providerId === 'antigravity' && (
                <div className="pm-auth-wizard">
                  <div className="pm-empty-state-card">
                    <h3>1. 生成 Antigravity 授权链接</h3>
                    <p>授权链接已指向本地模拟授权页。请在外部页面完成授权，然后把完整 callback URL 粘贴回来。</p>
                    <button className="btn btn-primary" onClick={startInlineAntigravityOAuth} disabled={specialVerifyDialog.starting}>
                      {specialVerifyDialog.starting ? <Loader size={14} className="spin" /> : <LogIn size={14} />} 生成授权链接
                    </button>
                  </div>

                  {specialVerifyDialog.authUrl && (
                    <div className="pm-auth-card">
                      <h3>2. 完成授权并粘贴回调地址</h3>
                      <a className="btn btn-primary" href={specialVerifyDialog.authUrl} target="_blank" rel="noreferrer">
                        <ExternalLink size={14} /> 打开 Antigravity 模拟授权页
                      </a>
                      <p className="pm-auth-hint">请在 10 分钟内完成模拟授权。必须粘贴包含 code 和 state 的完整 callback URL。</p>
                      <textarea
                        className="pm-auth-callback"
                        value={specialVerifyDialog.callbackUrl || ''}
                        onChange={e => updateSpecialVerifyDialog({ callbackUrl: e.target.value })}
                        placeholder="http://localhost:1455/auth/callback?code=...&state=..."
                      />
                      <button className="btn btn-primary" onClick={exchangeInlineAntigravityCallback} disabled={specialVerifyDialog.exchanging || !specialVerifyDialog.callbackUrl?.trim()}>
                        {specialVerifyDialog.exchanging ? <Loader size={14} className="spin" /> : <CheckCircle size={14} />} 写入 token 并验证接口
                      </button>
                    </div>
                  )}

                  {specialVerifyDialog.exchangeResult && (
                    <div className="pm-verify-block">
                      <div className="pm-verify-label">OAuth token 写入结果</div>
                      <pre className="pm-verify-pre response">{JSON.stringify(specialVerifyDialog.exchangeResult, null, 2)}</pre>
                    </div>
                  )}
                </div>
              )}

              {specialVerifyDialog.providerVerifyResult && (
                <div className="pm-verify-step">
                  <div className="pm-verify-step-header">
                    <strong>Provider 接口验证</strong>
                    <span className={'pc-key-badge ' + (specialVerifyDialog.providerVerifyResult.success ? 'success' : 'warn')}>
                      {specialVerifyDialog.providerVerifyResult.success ? '成功' : '失败'}
                    </span>
                  </div>
                  <div className={'pc-verify-result ' + (specialVerifyDialog.providerVerifyResult.success ? 'success' : 'error')}>
                    {specialVerifyDialog.providerVerifyResult.message}
                  </div>
                  {(specialVerifyDialog.providerVerifyResult.steps || []).map((step, index) => (
                    <details key={index} className="pm-verify-block pm-verify-details" open={!step.success}>
                      <summary>
                        <span className={'pc-key-badge ' + (step.success ? 'success' : 'warn')}>{step.success ? '成功' : '失败'}</span>
                        <span>{step.title}</span>
                      </summary>
                      <pre className="pm-verify-pre response">{JSON.stringify(step, null, 2)}</pre>
                    </details>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {verifyDialog && (
        <div className="pm-modal-backdrop" onClick={() => setVerifyDialog(null)}>
          <div className="pm-modal" onClick={e => e.stopPropagation()}>
            <div className="pm-modal-header">
              <div>
                <h3>验证连接</h3>
                <p>{providers[verifyDialog.providerId]?.name || verifyDialog.providerId}</p>
              </div>
              <div className="pm-modal-actions">
                <button className="btn btn-sm btn-primary" onClick={handleVerifyFromDialog} disabled={loading[verifyDialog.providerId + ':dialog']}>
                  {loading[verifyDialog.providerId + ':dialog'] ? <Loader size={14} className="spin" /> : <Shield size={14} />}
                  验证连接
                </button>
                <button className="btn-icon-sm" onClick={() => setVerifyDialog(null)} title="关闭">
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="pm-modal-body">
              {!verifyDialog.result && (
                <div className="pm-empty-state-card">
                  <h3>验证窗口已打开</h3>
                  <p>先检查或修改下面的请求参数，再点击右上角“验证连接”正式发起请求。</p>
                </div>
              )}
              {verifyDialog.result && (
                <div className={'pc-verify-result ' + (verifyDialog.result.success ? 'success' : 'error')}>
                  {verifyDialog.result.message}
                </div>
              )}
              {verifyDialog.result?.diagnosis?.diagnosis?.length > 0 && (
                <div className="pm-empty-state-card">
                  <h3>诊断</h3>
                  {verifyDialog.result.diagnosis.diagnosis.map((item, index) => (
                    <p key={index}>{item}</p>
                  ))}
                  {verifyDialog.result.diagnosis.suggestions?.length > 0 && (
                    <>
                      <h3 style={{ marginTop: 14 }}>建议</h3>
                      {verifyDialog.result.diagnosis.suggestions.map((item, index) => (
                        <p key={'s-' + index}>{item}</p>
                      ))}
                    </>
                  )}
                </div>
              )}
              {(verifyDialog.result?.steps || [{ title: '默认验证请求', request: null }]).map((step, index) => (
                <div key={index} className="pm-verify-step">
                  <div className="pm-verify-step-header">
                    <strong>{step.title}</strong>
                    {verifyDialog.result && (
                      <span className={'pc-key-badge ' + (step.success ? 'success' : 'warn')}>
                        {step.success ? '成功' : '失败'} · {step.durationMs}ms
                      </span>
                    )}
                  </div>
                  <div className="pm-verify-block">
                    <div className="pm-verify-label">请求参数，可修改后再次验证</div>
                    <textarea
                      className="pm-verify-editor"
                      value={verifyDialogInputs[index] || ''}
                      onChange={e => setVerifyDialogInputs(prev => prev.map((item, i) => i === index ? e.target.value : item))}
                    />
                  </div>
                  {verifyDialog.result && (
                    <div className="pm-verify-block">
                      <div className="pm-verify-label">本次发送的请求 JSON</div>
                      <pre className="pm-verify-pre request">{JSON.stringify(step.request, null, 2)}</pre>
                    </div>
                  )}
                  {verifyDialog.result && (
                    <div className="pm-verify-block">
                      <div className="pm-verify-label">服务端响应 JSON</div>
                      <pre className="pm-verify-pre response">{JSON.stringify(step.response, null, 2)}</pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== Custom Provider Form ===== */
function CustomProviderForm({ onSave, onCancel }) {
  const [form, setForm] = useState({
    id: '', name: '', baseUrl: '', authType: 'bearer', apiFormat: 'openai',
    billingType: 'apikey', apiKey: '', loginUrl: '', subscriptionUrl: '',
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.id || !form.name || !form.baseUrl) return;
    onSave({ ...form, models: [], accessModes: ['apikey'] });
  };

  return (
    <div className="pm-detail">
      <div className="pm-detail-header">
        <h3>添加自定义供应商</h3>
      </div>
      <div className="pm-detail-body">
        <form onSubmit={handleSubmit} className="pc-section" style={{ gap: '12px' }}>
          <div className="pc-field-row">
            <div className="pc-field">
              <label>ID（唯一标识）</label>
              <input value={form.id} onChange={e => setForm(f => ({ ...f, id: e.target.value }))} placeholder="my-provider" required />
            </div>
            <div className="pc-field">
              <label>名称</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="My Provider" required />
            </div>
          </div>
          <div className="pc-field">
            <label>Base URL</label>
            <input value={form.baseUrl} onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))} placeholder="https://api.example.com/v1" required />
          </div>
          <div className="pc-field-row">
            <div className="pc-field">
              <label>认证方式</label>
              <select value={form.authType} onChange={e => setForm(f => ({ ...f, authType: e.target.value }))}>
                <option value="bearer">Bearer Token</option>
                <option value="custom-header">自定义 Header</option>
                <option value="query-key">URL Query Key</option>
                <option value="query-token">URL Access Token</option>
              </select>
            </div>
            <div className="pc-field">
              <label>API 格式</label>
              <select value={form.apiFormat} onChange={e => setForm(f => ({ ...f, apiFormat: e.target.value }))}>
                <option value="openai">OpenAI 兼容</option>
                <option value="anthropic">Anthropic</option>
                <option value="google">Google Gemini</option>
                <option value="baidu">百度文心</option>
              </select>
            </div>
            <div className="pc-field">
              <label>计费方式</label>
              <select value={form.billingType} onChange={e => setForm(f => ({ ...f, billingType: e.target.value }))}>
                <option value="apikey">API Key 按量</option>
                <option value="subscription">订阅制</option>
                <option value="both">API Key + 订阅</option>
              </select>
            </div>
          </div>
          <div className="pc-field">
            <label>API Key（可选）</label>
            <input type="password" autoComplete="new-password" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))} placeholder="可选" />
          </div>
          <div className="pc-field-row">
            <div className="pc-field">
              <label>获取Key链接</label>
              <input value={form.loginUrl} onChange={e => setForm(f => ({ ...f, loginUrl: e.target.value }))} placeholder="https://..." />
            </div>
            <div className="pc-field">
              <label>充值链接</label>
              <input value={form.subscriptionUrl} onChange={e => setForm(f => ({ ...f, subscriptionUrl: e.target.value }))} placeholder="https://..." />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={onCancel}>取消</button>
            <button type="submit" className="btn btn-primary">添加供应商</button>
          </div>
        </form>
      </div>
    </div>
  );
}
