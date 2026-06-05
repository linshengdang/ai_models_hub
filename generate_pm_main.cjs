const fs = require('fs');

const code = fs.readFileSync('pm_debug.jsx', 'utf8');

const prefix = code.split('<div className="pm-main">')[0] + '<div className="pm-main">\n';
const suffixParts = code.split('/* ===== Custom Provider Form ===== */');
const suffix = '\n      </div>\n    </div>\n  );\n}\n\n/* ===== Custom Provider Form ===== */' + suffixParts[1];

const mainContent = `
        {selectedProvider && (() => {
          const provider = selectedProvider;
          const defInfo = defaults[provider.id] || {};
          const accessModes = provider.accessModes || defInfo.accessModes || ['apikey'];
          const oauthStatus = provider.oauthStatus || { authenticated: false };
          const hasOAuth = accessModes.includes('oauth');
          const hasKey = provider.apiKey && provider.apiKey.length > 4;
          const types = getModelTypes(provider.models);
          const filteredModels = getFilteredModels(provider.id, provider.models);
          const addForm = addModelForms[provider.id];

          return (
            <div className="pm-detail">
              <div className="pm-detail-header">
                <h3>{provider.name}</h3>
                <div className="pm-detail-actions">
                  <button className="btn btn-sm btn-secondary" onClick={() => handleVerify(provider.id)} disabled={loading[provider.id]}>
                    {loading[provider.id] ? <Loader size={14} className="spin" /> : <Shield size={14} />} 验证连接
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
                      <div className="pc-apikey-row">
                        <input type="password" value={apiKeyInputs[provider.id] || ''} onChange={e => setApiKeyInputs(prev => ({ ...prev, [provider.id]: e.target.value }))} placeholder={hasKey ? '当前: ' + provider.apiKey + ' (输入新值覆盖)' : '请输入 API Key...'} />
                        <button className="btn btn-sm btn-primary" onClick={() => handleSaveKey(provider.id)} disabled={!apiKeyInputs[provider.id]?.trim()}><CheckCircle size={14} /> 保存</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* OAuth config */}
                <div className="pc-oauth-config">
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
                        <div className="pc-field"><label>Authorize URL</label><input value={oauthForm.authorizeUrl} onChange={e => setOauthForm(f => ({ ...f, authorizeUrl: e.target.value }))} placeholder="https://provider.com/oauth/authorize" /></div>
                        <div className="pc-field"><label>Token URL</label><input value={oauthForm.tokenUrl} onChange={e => setOauthForm(f => ({ ...f, tokenUrl: e.target.value }))} placeholder="https://provider.com/oauth/token" /></div>
                      </div>
                      <div className="pc-field-row">
                        <div className="pc-field"><label>Client ID</label><input value={oauthForm.clientId} onChange={e => setOauthForm(f => ({ ...f, clientId: e.target.value }))} placeholder="your-client-id" /></div>
                        <div className="pc-field"><label>Client Secret</label><input type="password" value={oauthForm.clientSecret} onChange={e => setOauthForm(f => ({ ...f, clientSecret: e.target.value }))} placeholder="your-client-secret" /></div>
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
                      const inputKey = \`\${provider.id}:\${m.id}\`;
                      const modelKey = provider.modelKeys?.[m.id] || '';
                      const hasModelKey = modelKey && modelKey.length > 4;
                      return (
                        <div key={m.id} className="pc-model-item">
                          <div className="pc-model-item-header">
                            <span className={'pc-model-tag type-' + m.type}>{m.name} [{m.type}]</span>
                            <span className="pc-model-id">{m.id}</span>
                            {hasModelKey && <span className="pc-key-badge success">🔑 {modelKey}</span>}
                            {!hasModelKey && hasKey && <span className="pc-key-badge muted">全局Key</span>}
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
        })()}
        </div>`;

fs.writeFileSync('client/src/components/ProviderManager.jsx', prefix + mainContent + suffix);
console.log('Main refactored.');
