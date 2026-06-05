import React from 'react';
import { Settings, Play, ArrowRight, Sparkles, BarChart2 } from 'lucide-react';

export default function WelcomePage({ providers, defaults, onGoChat, onGoSettings, onGoToChatWithProvider, onGoStats }) {
  const configuredCount = Object.keys(providers).length;
  const totalDefaults = Object.keys(defaults).length;

  return (
    <div className="welcome-page">
      <div className="welcome-hero-banner">
        <div className="hero-badge">
          <Sparkles size={14} /> <span>一站式大模型管理终端</span>
        </div>
        <h2>AI Model Hub</h2>
        <p>
          一站式接入并管理全球与国产常用大模型供应商。支持 API Key 与订阅登录两种验证方式，即时校验接口，支持文本交互、图片绘制、视频创作及音频合成等多模态场景。
        </p>

        <div className="hero-actions">
          {configuredCount > 0 ? (
            <>
              <button className="btn btn-primary btn-lg" onClick={onGoChat}>
                <Play size={16} fill="currentColor" /> 进入应用工作区
              </button>
              <button className="btn btn-secondary btn-lg" onClick={onGoStats} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <BarChart2 size={16} /> 数据统计
              </button>
              <button className="btn btn-secondary btn-lg" onClick={() => onGoSettings('models')}>
                <Settings size={16} /> 管理配置
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-primary btn-lg" onClick={() => onGoSettings('models')}>
                <Settings size={16} /> 立即配置供应商 <ArrowRight size={16} />
              </button>
              <button className="btn btn-secondary btn-lg" onClick={onGoStats} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <BarChart2 size={16} /> 数据统计
              </button>
            </>
          )}
        </div>
      </div>

      <div className="welcome-dashboard">
        <div className="dashboard-header">
          <h3>模型供应商状态矩阵 ({configuredCount} / {totalDefaults})</h3>
          <p>亮色卡片为已配置，点击可直接激活并进入该供应商应用工作区；未配置的卡片点击快速跳转进行密钥与参数配置。</p>
        </div>

        <div className="welcome-provider-grid">
          {Object.entries(defaults).map(([key, tpl]) => {
            const isConfigured = !!providers[key];
            return (
              <div
                key={key}
                className={`welcome-provider-card ${isConfigured ? 'active' : ''}`}
                onClick={() => isConfigured && onGoToChatWithProvider ? onGoToChatWithProvider(key) : onGoSettings('models', key)}
              >
                <div className="provider-card-header">
                  <span className="provider-name">{tpl.name}</span>
                  {isConfigured ? (
                    <span className="badge-configured">已启用</span>
                  ) : (
                    <span className="badge-not-configured">待配置</span>
                  )}
                </div>
                <div className="provider-card-body">
                  <span>{tpl.models.length} 个模型</span>
                  <span className="arrow-icon"><ArrowRight size={14} /></span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
