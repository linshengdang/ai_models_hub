import React, { useState } from 'react';
import { loginUser, registerUser } from '../api';

export default function LoginGate({ onLoginSuccess }) {
  const [activeTab, setActiveTab] = useState('demo'); // 'demo' | 'guest' | 'form'
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const handleDemoEntry = () => {
    localStorage.setItem('hub-user-id', 'demo');
    localStorage.setItem('hub-user-mode', 'demo');
    onLoginSuccess('DemoUser', 'demo');
  };

  const handleGuestEntry = () => {
    localStorage.setItem('hub-user-id', 'guest');
    localStorage.setItem('hub-user-mode', 'guest');
    onLoginSuccess('GuestUser', 'guest');
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMsg('用户名和密码不能为空');
      return;
    }
    if (isRegister && password !== confirmPassword) {
      setErrorMsg('两次输入的密码不一致');
      return;
    }
    setErrorMsg('');
    setLoading(true);

    try {
      if (isRegister) {
        const res = await registerUser(username, password, confirmPassword);
        if (res.success) {
          // Auto login after registration
          const loginRes = await loginUser(username, password);
          if (loginRes.success) {
            localStorage.setItem('hub-user-id', loginRes.username);
            localStorage.setItem('hub-user-mode', 'user');
            onLoginSuccess(loginRes.username, 'user');
          } else {
            setErrorMsg('注册成功，但登录失败：' + (loginRes.error || '未知错误'));
          }
        } else {
          setErrorMsg(res.error || '注册失败，该用户名可能已被占用');
        }
      } else {
        const res = await loginUser(username, password);
        if (res.success) {
          localStorage.setItem('hub-user-id', res.username);
          localStorage.setItem('hub-user-mode', 'user');
          onLoginSuccess(res.username, 'user');
        } else {
          setErrorMsg(res.error || '用户名或密码错误');
        }
      }
    } catch (err) {
      setErrorMsg('网络请求失败：' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-gate-container">
      <style>{`
        .login-gate-container {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: radial-gradient(circle at 10% 20%, rgb(18, 19, 31) 0%, rgb(10, 10, 16) 90%);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          color: #f3f4f6;
          overflow: hidden;
        }

        /* Decorative Background Orbs */
        .login-gate-bg-orb {
          position: absolute;
          width: 600px;
          height: 600px;
          border-radius: 50%;
          filter: blur(140px);
          opacity: 0.15;
          pointer-events: none;
          z-index: 1;
        }
        .orb-left {
          background: radial-gradient(circle, rgba(99, 102, 241, 0.8) 0%, rgba(168, 85, 247, 0) 70%);
          top: -200px;
          left: -200px;
          animation: pulse OrbAnim1 15s infinite alternate;
        }
        .orb-right {
          background: radial-gradient(circle, rgba(236, 72, 153, 0.8) 0%, rgba(99, 102, 241, 0) 70%);
          bottom: -200px;
          right: -200px;
        }

        .login-gate-wrapper {
          position: relative;
          z-index: 2;
          width: 1000px;
          max-width: 90%;
          height: 620px;
          background: rgba(22, 23, 36, 0.65);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 24px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          display: flex;
          overflow: hidden;
        }

        /* Left Branding Panel */
        .login-gate-brand {
          flex: 1;
          background: linear-gradient(135deg, rgba(31, 38, 135, 0.3) 0%, rgba(99, 102, 241, 0.1) 100%);
          border-right: 1px solid rgba(255, 255, 255, 0.05);
          padding: 48px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          position: relative;
        }
        .brand-logo {
          font-size: 28px;
          font-weight: 800;
          background: linear-gradient(135deg, #a5b4fc 0%, #6366f1 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          letter-spacing: -0.5px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .brand-logo svg {
          stroke: #818cf8;
        }
        .brand-main h1 {
          font-size: 38px;
          font-weight: 800;
          line-height: 1.25;
          margin-bottom: 20px;
          background: linear-gradient(135deg, #ffffff 30%, #c7d2fe 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .brand-main p {
          font-size: 15px;
          line-height: 1.6;
          color: #9ca3af;
        }
        .brand-footer {
          font-size: 13px;
          color: #6b7280;
        }

        /* Right Auth Panel */
        .login-gate-auth {
          width: 500px;
          padding: 48px;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .auth-title {
          margin-bottom: 28px;
        }
        .auth-title h2 {
          font-size: 24px;
          font-weight: 700;
          margin-bottom: 8px;
        }
        .auth-title p {
          color: #9ca3af;
          font-size: 14px;
        }

        /* Tabs Selection */
        .auth-tabs {
          display: flex;
          background: rgba(255, 255, 255, 0.04);
          border-radius: 12px;
          padding: 4px;
          gap: 4px;
          border: 1px solid rgba(255, 255, 255, 0.05);
          margin-bottom: 24px;
        }
        .auth-tab-btn {
          flex: 1;
          background: transparent;
          border: none;
          color: #9ca3af;
          padding: 10px 0;
          font-size: 14px;
          font-weight: 600;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .auth-tab-btn:hover {
          color: #f3f4f6;
        }
        .auth-tab-btn.active {
          background: rgba(99, 102, 241, 0.2);
          color: #e0e7ff;
          border: 1px solid rgba(99, 102, 241, 0.3);
          box-shadow: 0 4px 12px rgba(99, 102, 241, 0.1);
        }

        /* Panel Cards Description */
        .tab-panel-desc {
          animation: fadeIn 0.4s ease-out;
          min-height: 250px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .desc-card {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 16px;
          padding: 24px;
          margin-bottom: 24px;
          flex-grow: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .desc-card-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
        }
        .desc-card-icon {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: rgba(99, 102, 241, 0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #818cf8;
        }
        .desc-card-title {
          font-size: 16px;
          font-weight: 700;
          color: #e0e7ff;
        }
        .desc-card-body {
          font-size: 14px;
          line-height: 1.6;
          color: #9ca3af;
        }

        .limit-badge-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-top: 16px;
        }
        .limit-badge {
          background: rgba(239, 68, 68, 0.08);
          border: 1px solid rgba(239, 68, 68, 0.15);
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 12px;
          color: #fca5a5;
          text-align: center;
          font-weight: 600;
        }
        .limit-badge.normal {
          background: rgba(16, 185, 129, 0.08);
          border: 1px solid rgba(16, 185, 129, 0.15);
          color: #a7f3d0;
        }

        /* Action Buttons */
        .btn-action-primary {
          width: 100%;
          background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
          color: #ffffff;
          border: none;
          padding: 14px;
          font-size: 15px;
          font-weight: 700;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          box-shadow: 0 4px 15px rgba(99, 102, 241, 0.35);
        }
        .btn-action-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(99, 102, 241, 0.45);
        }
        .btn-action-primary:active {
          transform: translateY(0);
        }

        /* Auth Form */
        .auth-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
          animation: fadeIn 0.4s ease-out;
        }
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .form-label {
          font-size: 13px;
          font-weight: 600;
          color: #9ca3af;
        }
        .form-input {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          padding: 12px 16px;
          border-radius: 10px;
          color: #ffffff;
          font-size: 14px;
          outline: none;
          transition: all 0.2s ease;
        }
        .form-input:focus {
          border-color: #6366f1;
          background: rgba(255, 255, 255, 0.08);
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
        }
        .error-message {
          color: #ef4444;
          font-size: 13px;
          background: rgba(239, 68, 68, 0.08);
          border: 1px solid rgba(239, 68, 68, 0.15);
          padding: 8px 12px;
          border-radius: 8px;
          font-weight: 500;
        }
        .auth-toggle-link {
          font-size: 13px;
          text-align: center;
          color: #9ca3af;
          margin-top: 8px;
        }
        .auth-toggle-link span {
          color: #818cf8;
          cursor: pointer;
          font-weight: 600;
        }
        .auth-toggle-link span:hover {
          text-decoration: underline;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Background orbs */}
      <div className="login-gate-bg-orb orb-left"></div>
      <div className="login-gate-bg-orb orb-right"></div>

      <div className="login-gate-wrapper">
        {/* Left Branding */}
        <div className="login-gate-brand">
          <div className="brand-logo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            <span>SpaceDream AI</span>
          </div>

          <div className="brand-main">
            <h1>开启您的多模型<br />应用创作中心</h1>
            <p>SpaceDream 是一款面向开发者的 AI 资源聚合与多模态合成中心。通过平铺卡片直接管理您的所有供应商 API Key，安全隔离配置，并提供丰富的数据调用仪表盘。</p>
          </div>

          <div className="brand-footer">
            © 2026 SpaceDream. Powered by Antigravity IDE.
          </div>
        </div>

        {/* Right Authentication Control */}
        <div className="login-gate-auth">
          <div className="auth-title">
            <h2>选择体验方式</h2>
            <p>提供以下三种环境供您体验平台全部功能</p>
          </div>

          {/* Navigation Tabs */}
          <div className="auth-tabs">
            <button 
              className={`auth-tab-btn ${activeTab === 'demo' ? 'active' : ''}`}
              onClick={() => { setActiveTab('demo'); setErrorMsg(''); setConfirmPassword(''); }}
            >
              Demo 演示
            </button>
            <button 
              className={`auth-tab-btn ${activeTab === 'guest' ? 'active' : ''}`}
              onClick={() => { setActiveTab('guest'); setErrorMsg(''); setConfirmPassword(''); }}
            >
              游客模式
            </button>
            <button 
              className={`auth-tab-btn ${activeTab === 'form' ? 'active' : ''}`}
              onClick={() => { setActiveTab('form'); setErrorMsg(''); setConfirmPassword(''); }}
            >
              注册 / 登录
            </button>
          </div>

          {/* Tab Content Panels */}
          {activeTab === 'demo' && (
            <div className="tab-panel-desc">
              <div className="desc-card">
                <div className="desc-card-header">
                  <div className="desc-card-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  </div>
                  <div className="desc-card-title">Demo 体验模式 (完全仿真)</div>
                </div>
                <div className="desc-card-body">
                  此模式采用精心定制的静态 Mock 数据。您不需要配置任何供应商 API Key 即可完整测试对话聊天、SVG 卡片生图、语音合成及视频生成等核心功能。
                  <div className="limit-badge-grid">
                    <div className="limit-badge normal">🚀 无需 API Key</div>
                    <div className="limit-badge normal">💡 绿色安全无计费</div>
                  </div>
                </div>
              </div>
              <button className="btn-action-primary" onClick={handleDemoEntry}>
                进入 Demo 演示空间
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </button>
            </div>
          )}

          {activeTab === 'guest' && (
            <div className="tab-panel-desc">
              <div className="desc-card">
                <div className="desc-card-header">
                  <div className="desc-card-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </div>
                  <div className="desc-card-title">游客登录模式 (额度限制)</div>
                </div>
                <div className="desc-card-body">
                  支持调用您配置的真实大模型 API 接口，体验真实的返回与网络情况。但为了平台稳定，此模式存在以下限额约束：
                  <div className="limit-badge-grid">
                    <div className="limit-badge">⚠️ 最多 5 个供应商</div>
                    <div className="limit-badge">⚠️ 供应商限 3 个模型</div>
                  </div>
                </div>
              </div>
              <button className="btn-action-primary" onClick={handleGuestEntry}>
                进入游客体验空间
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </button>
            </div>
          )}

          {activeTab === 'form' && (
            <form className="auth-form" onSubmit={handleAuthSubmit}>
              <div className="form-group">
                <label className="form-label">用户名</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="输入字母、数字或符号" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">密码</label>
                <input 
                  type="password" 
                  className="form-input" 
                  placeholder="输入密码" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {isRegister && (
                <div className="form-group">
                  <label className="form-label">确认密码</label>
                  <input 
                    type="password" 
                    className="form-input" 
                    placeholder="再次输入密码确认" 
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
              )}

              {errorMsg && <div className="error-message">{errorMsg}</div>}

              <button className="btn-action-primary" type="submit" disabled={loading}>
                {loading ? '正在处理...' : (isRegister ? '立即注册并进入' : '安全登录并进入')}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </button>

              <div className="auth-toggle-link">
                {isRegister ? (
                  <>已有账号？ <span onClick={() => { setIsRegister(false); setErrorMsg(''); setConfirmPassword(''); }}>立即登录</span></>
                ) : (
                  <>没有账号？ <span onClick={() => { setIsRegister(true); setErrorMsg(''); setConfirmPassword(''); }}>立即注册新账号</span></>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
