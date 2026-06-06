import React, { useState, useEffect, useRef } from 'react';
import WelcomePage from './components/WelcomePage';
import ChatView from './components/ChatView';
import ProviderManager from './components/ProviderManager';
import StatsDashboard from './components/StatsDashboard';
import LoginGate from './components/LoginGate';
import { fetchProviders, fetchDefaultProviders, registerUser, loginUser } from './api';
import { Home, MessageSquare, Settings, Bot, X, ChevronDown, Check, User, LogOut, BarChart2 } from 'lucide-react';

function ChatSelect({ className, value, placeholder, options, groups, disabled, onChange, renderLabel, renderOption }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = (options || Object.values(groups || {}).flat()).find(item => item.id === value);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  return (
    <div className={`custom-select ${className || ''} ${open ? 'open' : ''} ${disabled ? 'disabled' : ''}`} ref={ref}>
      <button type="button" className="custom-select-trigger" disabled={disabled} onClick={() => setOpen(prev => !prev)}>
        <span>{selected ? renderLabel(selected) : placeholder}</span>
        <ChevronDown size={14} />
      </button>
      {open && !disabled && (
        <div className="custom-select-menu">
          {groups ? Object.entries(groups).map(([group, items]) => (
            <div key={group} className="custom-select-group">
              <div className="custom-select-group-label">{group.toUpperCase()}</div>
              {items.map(item => (
                <button key={item.id} type="button" className={`custom-select-option ${item.id === value ? 'selected' : ''}`} onClick={() => { onChange(item.id); setOpen(false); }}>
                  <span>{renderOption ? renderOption(item) : renderLabel(item)}</span>
                  {item.id === value && <Check size={14} />}
                </button>
              ))}
            </div>
          )) : options.map(item => (
            <button key={item.id} type="button" className={`custom-select-option ${item.id === value ? 'selected' : ''}`} onClick={() => { onChange(item.id); setOpen(false); }}>
              <span>{renderOption ? renderOption(item) : renderLabel(item)}</span>
              {item.id === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [providers, setProviders] = useState({});
  const [defaults, setDefaults] = useState({});
  const [page, setPage] = useState('home');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [settingsActiveTab, setSettingsActiveTab] = useState('general');
  const [settingsSelectedProviderId, setSettingsSelectedProviderId] = useState(null);
  const [currentUser, setCurrentUser] = useState(() => localStorage.getItem('hub-user-id') || 'guest');
  const [currentUserMode, setCurrentUserMode] = useState(() => localStorage.getItem('hub-user-mode') || null);
  const [showUserModal, setShowUserModal] = useState(false);

  // Loaded setting states from localStorage (Mocked or persisted)
  const [generalSettings, setGeneralSettings] = useState(() => {
    const saved = localStorage.getItem('hub-general-settings');
    return saved ? JSON.parse(saved) : {
      theme: 'light',
      lang: 'zh',
      proxyEnabled: false,
      proxyHost: '127.0.0.1',
      proxyPort: '7890',
      proxyUser: '',
      proxyPass: '',
      apiTimeout: 30
    };
  });

  const [shortcuts, setShortcuts] = useState(() => {
    const saved = localStorage.getItem('hub-shortcuts-settings');
    return saved ? JSON.parse(saved) : {
      sendMsg: true,     // Enter to send, Shift+Enter to break
      clearChat: true,   // Cmd+L to clear
      newChat: true,     // Cmd+K to new chat
      openSettings: true // Cmd+, to settings
    };
  });

  const [skills, setSkills] = useState(() => {
    const saved = localStorage.getItem('hub-skills-settings');
    return saved ? JSON.parse(saved) : {
      webSearch: true,
      codeInterpreter: true,
      docSummary: true,
      imageAnalysis: false
    };
  });

  const [mcpServices, setMcpServices] = useState(() => {
    const saved = localStorage.getItem('hub-mcp-settings');
    return saved ? JSON.parse(saved) : [
      { id: 'sqlite', name: 'SQLite Inspector', status: 'active', cmd: 'npx -y @modelcontextprotocol/server-sqlite --db /tmp/mcp.db', desc: 'Allows AI model to query sqlite database context' },
      { id: 'filesystem', name: 'Local File System', status: 'active', cmd: 'npx -y @modelcontextprotocol/server-filesystem /Users', desc: 'Permits reading and indexing of workspace folder' },
      { id: 'github', name: 'GitHub Manager', status: 'inactive', cmd: 'npx -y @modelcontextprotocol/server-github', desc: 'Enables search, pull requests and repository operations' }
    ];
  });

  const [cliTools, setCliTools] = useState(() => {
    const saved = localStorage.getItem('hub-cli-settings');
    return saved ? JSON.parse(saved) : [
      { id: 'gradle', name: 'Gradle', code: 'gradle', enabled: true, status: 'inactive', version: '', desc: 'Java build tool', category: 'BUILD' },
      { id: 'maven', name: 'Maven', code: 'mvn', enabled: true, status: 'inactive', version: '', desc: 'Java build tool', category: 'BUILD' },
      { id: 'make', name: 'make', code: 'make', enabled: true, status: 'active', version: 'vGNU Make 3.81', desc: 'Build automation', category: 'BUILD' },
      { id: 'aws', name: 'AWS CLI', code: 'aws', enabled: false, status: 'inactive', version: '', desc: 'Amazon Web Services CLI', category: 'CLOUD' }
    ];
  });

  const [terminalSettings, setTerminalSettings] = useState(() => {
    const saved = localStorage.getItem('hub-terminal-settings');
    return saved ? JSON.parse(saved) : {
      shell: 'zsh',
      fontSize: 14,
      fontFamily: 'SF Mono'
    };
  });

  const [privacySettings, setPrivacySettings] = useState(() => {
    const saved = localStorage.getItem('hub-privacy-settings');
    return saved ? JSON.parse(saved) : {
      analytics: true,
      saveHistory: true,
      semanticIndex: true,
      dataRetention: '30'
    };
  });

  const loadProviders = async () => {
    const [p, d] = await Promise.all([fetchProviders(), fetchDefaultProviders()]);
    setProviders(p);
    setDefaults(d);
  };

  useEffect(() => {
    loadProviders();
  }, []);

  // Sync theme
  useEffect(() => {
    const applyTheme = () => {
      const { theme } = generalSettings;
      if (theme === 'dark') {
        document.body.classList.add('dark');
      } else if (theme === 'light') {
        document.body.classList.remove('dark');
      } else {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (isDark) {
          document.body.classList.add('dark');
        } else {
          document.body.classList.remove('dark');
        }
      }
    };
    applyTheme();
  }, [generalSettings.theme]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeys = (e) => {
      if (shortcuts.openSettings && (e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setPage('settings');
      }
      if (shortcuts.newChat && (e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPage('home');
      }
    };
    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [shortcuts]);

  const providerList = Object.values(providers).filter(p => (p.models || []).length > 0);

  const goToChat = () => setPage('chat');
  const goToSettings = (tab = 'general', providerId = null) => {
    setSettingsActiveTab(tab);
    setSettingsSelectedProviderId(providerId);
    setPage('settings');
  };
  const goToChatWithProvider = (providerId) => {
    const models = providers[providerId]?.models || [];
    if (models.length > 0) {
      setSelectedProvider(providerId);
      setSelectedModel('');
      setPage('chat');
    } else {
      goToSettings('models', providerId);
    }
  };

  if (!currentUserMode) {
    return (
      <LoginGate
        onLoginSuccess={(username, mode) => {
          setCurrentUser(username);
          setCurrentUserMode(mode);
          loadProviders();
        }}
      />
    );
  }

  const pageTitle = page === 'home' ? '首页' : page === 'chat' ? '应用工作区' : page === 'stats' ? '数据统计' : '设置';

  return (
    <div className="app">
      {/* Left Sidebar */}
      <aside className="app-sidebar">
        <div className="sidebar-header" onClick={() => setPage('home')}>
          <Bot size={22} />
          <h1>AI Model Hub</h1>
        </div>
        <nav className="sidebar-nav">
          <button className={page === 'home' ? 'active' : ''} onClick={() => setPage('home')}>
            <Home size={18} /><span>首页</span>
          </button>
          <button className={page === 'chat' ? 'active' : ''} onClick={() => setPage('chat')}>
            <MessageSquare size={18} /><span>应用</span>
          </button>
          <button className={page === 'stats' ? 'active' : ''} onClick={() => setPage('stats')}>
            <BarChart2 size={18} /><span>数据统计</span>
          </button>
          <button className={page === 'settings' ? 'active' : ''} onClick={() => goToSettings('general')}>
            <Settings size={18} /><span>设置</span>
          </button>
        </nav>
        <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="sidebar-user-section" onClick={() => setShowUserModal(true)} title="用户账户管理">
            <span className="user-icon"><User size={14} /></span>
            <span className="user-name">
              {currentUser === 'guest' ? '游客 (点击登录)' : currentUserMode === 'demo' ? '演示 (点击切换)' : currentUser}
            </span>
          </div>
          <div style={{ fontSize: '11px', opacity: 0.6 }}>
            {Object.keys(providers).length} 个供应商已配置
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="app-main">
        {/* Top Bar */}
        <div className="app-topbar">
          <span className="topbar-title">{pageTitle}</span>
          <div className="topbar-right">
          </div>
        </div>

        {/* Content */}
        <div className="app-body">
          {page === 'home' && (
            <WelcomePage
              providers={providers}
              defaults={defaults}
              onGoChat={goToChat}
              onGoSettings={goToSettings}
              onGoToChatWithProvider={goToChatWithProvider}
              onGoStats={() => setPage('stats')}
            />
          )}
          {page === 'settings' && (
            <ProviderManager
              providers={providers}
              defaults={defaults}
              onRefresh={loadProviders}
              onClose={goToChat}
              initialTab={settingsActiveTab}
              initialSelectedProviderId={settingsSelectedProviderId}
              generalSettings={generalSettings}
              setGeneralSettings={setGeneralSettings}
              shortcuts={shortcuts}
              setShortcuts={setShortcuts}
              skills={skills}
              setSkills={setSkills}
              mcpServices={mcpServices}
              setMcpServices={setMcpServices}
              cliTools={cliTools}
              setCliTools={setCliTools}
              terminalSettings={terminalSettings}
              setTerminalSettings={setTerminalSettings}
              privacySettings={privacySettings}
              setPrivacySettings={setPrivacySettings}
            />
          )}
          {page === 'chat' && (
            <ChatView
              providerId={selectedProvider}
              modelId={selectedModel}
              setSelectedProvider={setSelectedProvider}
              setSelectedModel={setSelectedModel}
              providerList={providerList}
              providers={providers}
              defaults={defaults}
              onGoSettings={goToSettings}
              shortcuts={shortcuts}
            />
          )}
          {page === 'stats' && (
            <StatsDashboard />
          )}
        </div>
      </div>

      {showUserModal && (
        <UserModal
          currentUser={currentUser}
          setCurrentUser={setCurrentUser}
          currentUserMode={currentUserMode}
          setCurrentUserMode={setCurrentUserMode}
          onClose={() => setShowUserModal(false)}
          onRefresh={loadProviders}
          setSelectedProvider={setSelectedProvider}
          setSelectedModel={setSelectedModel}
        />
      )}
    </div>
  );
}

function UserModal({ currentUser, setCurrentUser, currentUserMode, setCurrentUserMode, onClose, onRefresh, setSelectedProvider, setSelectedModel }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    if (!username.trim() || !password) {
      setError('用户名和密码不能为空');
      return;
    }

    if (isRegister && password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    try {
      if (isRegister) {
        const res = await registerUser(username, password, confirmPassword);
        if (res.error) {
          setError(res.error);
        } else {
          setSuccess('注册成功，请选择登录账号！');
          setIsRegister(false);
          setPassword('');
        }
      } else {
        const res = await loginUser(username, password);
        if (res.error) {
          setError(res.error);
        } else {
          localStorage.setItem('hub-user-id', res.username);
          localStorage.setItem('hub-user-mode', 'user');
          setCurrentUser(res.username);
          setCurrentUserMode('user');
          setSelectedProvider('');
          setSelectedModel('');
          await onRefresh();
          onClose();
        }
      }
    } catch (err) {
      setError(err.message || '操作失败，请重试');
    }
  };

  const handleLogout = async () => {
    localStorage.removeItem('hub-user-id');
    localStorage.removeItem('hub-user-mode');
    setCurrentUser('guest');
    setCurrentUserMode(null);
    setSelectedProvider('');
    setSelectedModel('');
    await onRefresh();
    onClose();
  };

  return (
    <div className="pm-modal-backdrop" onClick={onClose}>
      <div className="user-modal-card" onClick={e => e.stopPropagation()}>
        <div className="user-modal-header">
          <h3>用户中心</h3>
          <button className="btn-icon-sm" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="user-modal-body">
          {currentUserMode === 'user' ? (
            <div className="user-profile-view">
              <div className="user-avatar">👤</div>
              <h4>{currentUser}</h4>
              <p className="user-status-text">已登录，您的配置数据已完全隔离存储。</p>
              <button className="btn btn-danger btn-logout" onClick={handleLogout} style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: '0 auto' }}>
                <LogOut size={14} /> 退出登录 / 切换模式
              </button>
            </div>
          ) : (
            <div className="user-profile-view" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ textAlign: 'center' }}>
                <div className="user-avatar">👤</div>
                <h4 style={{ margin: '8px 0' }}>{currentUserMode === 'demo' ? '演示模式' : '游客模式'}</h4>
                <p className="user-status-text" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  您当前正处于{currentUserMode === 'demo' ? '演示' : '游客'}状态。想要切换体验模式或登录个人专属账户？
                </p>
              </div>
              <button className="btn btn-danger btn-logout" onClick={handleLogout} style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: '0 auto', background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', border: 'none', color: '#ffffff' }}>
                <LogOut size={14} /> 切换体验模式 / 登录注册
              </button>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px', marginTop: '8px' }}>
                <h5 style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#e5e7eb' }}>直接在下方注册/登录正式账号：</h5>
                <form onSubmit={handleSubmit} className="user-auth-form">
                  <div className="auth-tab-headers" style={{ marginBottom: '12px' }}>
                    <button
                      type="button"
                      className={`auth-tab-btn ${!isRegister ? 'active' : ''}`}
                      onClick={() => { setIsRegister(false); setError(''); setSuccess(''); setConfirmPassword(''); }}
                      style={{ padding: '6px 12px', fontSize: '12px' }}
                    >
                      账号登录
                    </button>
                    <button
                      type="button"
                      className={`auth-tab-btn ${isRegister ? 'active' : ''}`}
                      onClick={() => { setIsRegister(true); setError(''); setSuccess(''); setConfirmPassword(''); }}
                      style={{ padding: '6px 12px', fontSize: '12px' }}
                    >
                      注册新账号
                    </button>
                  </div>

                  {error && <div className="user-auth-error">{error}</div>}
                  {success && <div className="user-auth-success">{success}</div>}

                  <div className="auth-form-field" style={{ marginBottom: '10px' }}>
                    <label style={{ fontSize: '11px' }}>用户名</label>
                    <input
                      type="text"
                      placeholder="请输入用户名..."
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      required
                      style={{ padding: '8px' }}
                    />
                  </div>
                  <div className="auth-form-field" style={{ marginBottom: '12px' }}>
                    <label style={{ fontSize: '11px' }}>密码</label>
                    <input
                      type="password"
                      placeholder="请输入密码..."
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      style={{ padding: '8px' }}
                    />
                  </div>
                  {isRegister && (
                    <div className="auth-form-field" style={{ marginBottom: '12px' }}>
                      <label style={{ fontSize: '11px' }}>确认密码</label>
                      <input
                        type="password"
                        placeholder="请再次输入密码确认..."
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        required
                        style={{ padding: '8px' }}
                      />
                    </div>
                  )}

                  <button type="submit" className="btn btn-primary btn-auth-submit" style={{ width: '100%', padding: '8px', fontSize: '13px' }}>
                    {isRegister ? '立即注册并登录' : '登录正式账号'}
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
