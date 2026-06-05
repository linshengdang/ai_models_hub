import React, { useState, useEffect } from 'react';
import { saveProvider, updateApiKey, updateModelKey, deleteProvider, verifyProvider, addModel, removeModel, getOAuthLoginUrl, saveOAuthConfig, refreshOAuthToken, logoutOAuth } from '../api';
import { Plus, Trash2, CheckCircle, Key, Shield, Loader, ExternalLink, CreditCard, X, LogIn, LogOut, RefreshCw , Search } from 'lucide-react';

const MODEL_TYPE_LABELS = { all: '全部', text: '📝 文本', image: '🖼️ 图片', video: '🎬 视频', audio: '🎵 音频' };
const MODEL_TYPES = ['text', 'image', 'video', 'audio'];

export default function ProviderManager({ providers, defaults, onRefresh, onClose }) {
  const [selectedId, setSelectedId] = useState(null);
  const [verifyResults, setVerifyResults] = useState({});
  const [loading, setLoading] = useState({});
  const [modelFilter, setModelFilter] = useState({});
  const [apiKeyInputs, setApiKeyInputs] = useState({});
  const [modelKeyInputs, setModelKeyInputs] = useState({});
  const [editForms, setEditForms] = useState({});
  const [addModelForms, setAddModelForms] = useState({});
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [providerSearch, setProviderSearch] = useState('');
  const [othersExpanded, setOthersExpanded] = useState(false);

  // Check URL for OAuth callback result
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authSuccess = params.get('auth_success');
    const authError = params.get('auth_error');
    const provider = params.get('provider');
    if (authSuccess && provider) {
      setSelectedId(provider);
      onRefresh();
      window.history.replaceState({}, '', '/');
    } else if (authError && provider) {
      setSelectedId(provider);
      setVerifyResults(prev => ({ ...prev, [provider]: { success: false, message: 'OAuth 授权失败: ' + authError } }));
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const selectProvider = (id) => {
    setSelectedId(id);
    setShowCustomForm(false);
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
      await saveProvider({
        id: key, name: template.name, baseUrl: template.baseUrl,
        authType: template.authType, authHeader: template.authHeader,
        billingType: template.billingType, apiFormat: template.apiFormat,
        loginUrl: template.loginUrl || '', docsUrl: template.docsUrl || '',
        subscriptionUrl: template.subscriptionUrl || '',
        models: template.models, apiKey: '',
        accessModes: template.accessModes || ['apikey'],
        oauth: template.oauth || null,
      });
      onRefresh();
      setSelectedId(key);
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

  const handleVerify = async (id) => {
    setLoading(prev => ({ ...prev, [id]: true }));
    setVerifyResults(prev => ({ ...prev, [id]: null }));
    try {
      const result = await verifyProvider(id);
      setVerifyResults(prev => ({ ...prev, [id]: result }));
    } catch (err) {
      setVerifyResults(prev => ({ ...prev, [id]: { success: false, message: err.message } }));
    } finally {
      setLoading(prev => ({ ...prev, [id]: false }));
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

  return (
    <div className="provider-manager">
      <div className="pm-header">
        <h2>🔧 供应商 & 模型管理</h2>
        <p style={{ color: "var(--text-light)", fontSize: "0.85rem", marginTop: "4px" }}>接入近 300 款主流模型，支持 Text / Image / Audio / Video 全模态</p>
        <button className="btn btn-primary" onClick={onClose}>💬 进入对话</button>
      </div>
      <div className="pm-split">
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
                const commonList = ['openai', 'openai_codex', 'kimi_coding', 'moonshot', 'minimax', 'qwen', 'github_copilot', 'doubao', 'deepseek', 'anthropic', 'gemini', 'xai', 'hunyuan'];
                const globalCommonList = ['openai', 'openai_codex', 'github_copilot', 'anthropic', 'gemini', 'xai'];
                const domesticCommonList = ['moonshot', 'kimi_coding', 'minimax', 'qwen', 'doubao', 'deepseek', 'hunyuan'];

                const filtered = Object.entries(defaults).filter(([key, tpl]) => 
                  !providerSearch || tpl.name.toLowerCase().includes(providerSearch.toLowerCase()) || key.toLowerCase().includes(providerSearch.toLowerCase())
                );

                const globalCommon = filtered.filter(([key]) => globalCommonList.includes(key));
                const domesticCommon = filtered.filter(([key]) => domesticCommonList.includes(key));
                const others = filtered.filter(([key]) => !commonList.includes(key));

                const renderRow = ([key, tpl]) => {
                  const isAdded = !!providers[key];
                  return (
                    <div key={key} className={'pm-provider-row' + (isAdded ? ' added' : '') + (selectedId === key ? ' selected' : '')}>
                      <div className="pm-provider-row-info" onClick={() => isAdded ? selectProvider(key) : handleToggleDefault(key)}>
                        <div className={'pm-dot ' + (isAdded ? 'active' : '')} />
                        <div className="pm-provider-row-text">
                          <span className="pm-provider-name">{tpl.name}</span>
                          <span className="pm-provider-meta">
                            {tpl.models.length} 模型 · {(tpl.accessModes || ['apikey']).map(m => m === 'oauth' ? ' 订阅' : ' API Key').join(' /')}
                          </span>
                        </div>
                      </div>
                      <button className={'pm-toggle-btn ' + (isAdded ? 'remove' : 'add')} onClick={() => handleToggleDefault(key)}>
                        {isAdded ? <CheckCircle size={14}/> : <Plus size={14}/>}
                        {isAdded ? '已添加' : '添加'}
                      </button>
                    </div>
                  );
                };

                return (
                  <>
                    {globalCommon.length > 0 && <div className="pm-category-label">🌍 全球常用模型</div>}
                    {globalCommon.map(renderRow)}

                    {domesticCommon.length > 0 && <div className="pm-category-label">🇨🇳 国产常用模型</div>}
                    {domesticCommon.map(renderRow)}

                    {others.length > 0 && (
                      <div className="pm-category-label collapsible" onClick={() => setOthersExpanded(!othersExpanded)} style={{ cursor: 'pointer', marginTop: 12, borderTop: '1px solid var(--border-color)', paddingTop: 10 }}>
                        {othersExpanded ? '▼' : '▶'} 📦 其他模型供应商 ({others.length})
                      </div>
                    )}
                    {othersExpanded && others.map(renderRow)}
                  </>
                );
              })()}
            </div>
          </div>
          <div className="pm-main">
            {selectedProvider && (() => {
              const provider = selectedProvider;
              const defInfo = defaults[provider.id] || {};
              const accessModes = provider.accessModes || defInfo.accessModes || ['apikey'];
              const oauthStatus = provider.oauthStatus || { authenticated: false };
              const hasOAuth = accessModes.includes('oauth');
              return (
                <div className="pm-detail">
                  <div className="pm-detail-header">
                    <h3>{provider.name}</h3>
                  </div>
                  <div className="pm-detail-body">
                    <div className="pc-section-header">
                      <h5>OAuth 配置</h5>
                      <button className="btn btn-sm btn-secondary" onClick={() =>
                        setOauthForm(oauthForm ? null : {
                          authorizeUrl: provider.oauth?.authorizeUrl || defInfo.oauth?.authorizeUrl || '',
                          tokenUrl: provider.oauth?.tokenUrl || defInfo.oauth?.tokenUrl || '',
                          clientId: provider.oauth?.clientId || '',
                          clientSecret: '',
                          scope: provider.oauth?.scope || defInfo.oauth?.scope || 'basic',
                          redirectUri: provider.oauth?.redirectUri || '',
                        })
                      }>
                  {oauthForm ? '取消' : '编辑 OAuth'}
                </button>
              </div>
              {!oauthForm && provider.oauth?.clientId && (
                <div className="pc-oauth-info">
                  <span>Client ID: {provider.oauth.clientId.slice(0, 8)}...</span>
                  {provider.oauth.clientSecret && <span>Secret: {provider.oauth.clientSecret}</span>}
                </div>
              )}
              {oauthForm && (
                <div className="pc-add-model-form">
                  <div className="pc-field-row">
                    <div className="pc-field">
                      <label>Authorize URL</label>
                      <input value={oauthForm.authorizeUrl}
                        onChange={e => setOauthForm(f => ({ ...f, authorizeUrl: e.target.value }))}
                        placeholder="https://provider.com/oauth/authorize"
                      />
                    </div>
                    <div className="pc-field">
                      <label>Token URL</label>
                      <input value={oauthForm.tokenUrl}
                        onChange={e => setOauthForm(f => ({ ...f, tokenUrl: e.target.value }))}
                        placeholder="https://provider.com/oauth/token"
                      />
                    </div>
                  </div>
                  <div className="pc-field-row">
                    <div className="pc-field">
                      <label>Client ID</label>
                      <input value={oauthForm.clientId}
                        onChange={e => setOauthForm(f => ({ ...f, clientId: e.target.value }))}
                        placeholder="your-client-id"
                      />
                    </div>
                    <div className="pc-field">
                      <label>Client Secret</label>
                      <input type="password" value={oauthForm.clientSecret}
                        onChange={e => setOauthForm(f => ({ ...f, clientSecret: e.target.value }))}
                        placeholder="your-client-secret"
                      />
                    </div>
                  </div>
                  <div className="pc-field-row">
                    <div className="pc-field">
                      <label>Scope</label>
                      <input value={oauthForm.scope}
                        onChange={e => setOauthForm(f => ({ ...f, scope: e.target.value }))}
                        placeholder="basic"
                      />
                    </div>
                    <div className="pc-field">
                      <label>Redirect URI（可选，留空自动生成）</label>
                      <input value={oauthForm.redirectUri}
                        onChange={e => setOauthForm(f => ({ ...f, redirectUri: e.target.value }))}
                        placeholder="自动: /api/auth/callback/{id}"
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button className="btn btn-sm btn-primary" onClick={handleSaveOAuthConfig}
                      disabled={!oauthForm.authorizeUrl || !oauthForm.tokenUrl || !oauthForm.clientId}
                    >
                      <CheckCircle size={14} /> 保存 OAuth 配置
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== Models section ===== */}
        <div className="pc-section">
          <div className="pc-section-header">
            <h4>📦 模型管理 ({provider.models?.length || 0})</h4>
            <button className="btn btn-sm btn-secondary"
              onClick={() => setAddModelForms(prev => ({
                ...prev,
                [provider.id]: prev[provider.id] ? null : { id: '', name: '', type: 'text' }
              }))}
            >
              {addForm ? '取消' : <><Plus size={14} /> 添加模型</>}
            </button>
          </div>

          {addForm && (
            <div className="pc-add-model-form">
              <div className="pc-field-row">
                <div className="pc-field">
                  <label>模型 ID</label>
                  <input value={addForm.id}
                    onChange={e => setAddModelForms(prev => ({
                      ...prev, [provider.id]: { ...prev[provider.id], id: e.target.value }
                    }))}
                    placeholder="gpt-4o-mini"
                  />
                </div>
                <div className="pc-field">
                  <label>显示名称</label>
                  <input value={addForm.name}
                    onChange={e => setAddModelForms(prev => ({
                      ...prev, [provider.id]: { ...prev[provider.id], name: e.target.value }
                    }))}
                    placeholder="GPT-4o Mini"
                  />
                </div>
                <div className="pc-field">
                  <label>类型</label>
                  <select value={addForm.type}
                    onChange={e => setAddModelForms(prev => ({
                      ...prev, [provider.id]: { ...prev[provider.id], type: e.target.value }
                    }))}
                  >
                    {MODEL_TYPES.map(t => <option key={t} value={t}>{MODEL_TYPE_LABELS[t]}</option>)}
                  </select>
                </div>
              </div>
              <button className="btn btn-sm btn-primary"
                onClick={() => handleAddModel(provider.id)}
                disabled={!addForm.id?.trim() || !addForm.name?.trim()}
              >
                <Plus size={14} /> 确认添加
              </button>
            </div>
          )}

          {types.length > 2 && (
            <div className="pc-model-filter">
              {types.map(t => (
                <button key={t}
                  className={'pc-model-filter-btn ' + ((modelFilter[provider.id] || 'all') === t ? 'active' : '')}
                  onClick={() => setModelFilter(prev => ({ ...prev, [provider.id]: t }))}
                >
                  {MODEL_TYPE_LABELS[t] || t}
                </button>
              ))}
            </div>
          )}

          <div className="pc-model-list">
            {filteredModels.map(m => {
              const inputKey = provider.id + ':' + m.id;
              const modelKey = provider.modelKeys?.[m.id] || '';
              const hasModelKey = modelKey && modelKey.length > 4;
              return (
                <div key={m.id} className="pc-model-item">
                  <div className="pc-model-item-header">
                    <span className={'pc-model-tag type-' + m.type}>{m.name} [{m.type}]</span>
                    <span className="pc-model-id">{m.id}</span>
                    {hasModelKey && <span className="pc-key-badge success">🔑 {modelKey}</span>}
                    {!hasModelKey && hasKey && <span className="pc-key-badge muted">全局Key</span>}
                    {!hasModelKey && !hasKey && <span className="pc-key-badge warn">⚠️ 无Key</span>}
                    <button className="btn-icon-sm" onClick={() => handleRemoveModel(provider.id, m.id, m.name)} title="删除模型">
                      <X size={14} />
                    </button>
                  </div>
                  <div className="pc-model-key-row">
                    <input type="password"
                      value={modelKeyInputs[inputKey] || ''}
                      onChange={e => setModelKeyInputs(prev => ({ ...prev, [inputKey]: e.target.value }))}
                      placeholder={hasModelKey ? '输入新Key覆盖...' : '独立Key（可选，不填用全局Key）'}
                    />
                    <button className="btn btn-sm btn-primary"
                      onClick={() => handleSaveModelKey(provider.id, m.id)}
                      disabled={!modelKeyInputs[inputKey]?.trim()}
                    >保存</button>
                    {hasModelKey && (
                      <button className="btn btn-sm btn-danger"
                        onClick={() => handleDeleteModelKey(provider.id, m.id)}
                      ><Trash2 size={12} /></button>
                    )}
                  </div>
                </div>
              );
            })}
            {filteredModels.length === 0 && (
              <div className="pc-empty-models">暂无模型，点击"添加模型"来添加</div>
            )}
          </div>
        </div>
      </div>
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
            <input type="password" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))} placeholder="可选" />
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
