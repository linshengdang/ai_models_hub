import React, { useEffect, useState } from 'react';
import { fetchStats } from '../api';

export default function StatsDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetchStats();
      if (res.success) {
        setStats(res.data);
      } else {
        setError(res.error || '获取统计数据失败');
      }
    } catch (err) {
      setError('网络连接错误：' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // Refresh stats every 10 seconds automatically
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !stats) {
    return (
      <div className="stats-loading-container">
        <div className="stats-spinner"></div>
        <p>正在获取实时统计分析数据...</p>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="stats-error-container">
        <div className="stats-error-icon">⚠️</div>
        <p>{error}</p>
        <button onClick={loadData} className="stats-btn-refresh">重试</button>
      </div>
    );
  }

  const { metrics, providerUsage, modelUsage, typeUsage, recentLogs } = stats || {
    metrics: { totalCalls: 0, successCount: 0, failCount: 0, successRate: 100, totalTokens: 0 },
    providerUsage: {},
    modelUsage: {},
    typeUsage: { text: 0, image: 0, audio: 0, video: 0 },
    recentLogs: []
  };

  // Extract unique model count
  const activeModelsCount = Object.keys(modelUsage).length;

  // Calculate percentages for providers
  const totalCalls = metrics.totalCalls || 1;
  const sortedProviders = Object.entries(providerUsage).sort((a, b) => b[1] - a[1]);

  const typeLabels = {
    text: { name: '文本对话', icon: '💬', color: '#6366f1' },
    image: { name: '图像合成', icon: '🎨', color: '#ec4899' },
    audio: { name: '语音生成', icon: '🔊', color: '#10b981' },
    video: { name: '视频生成', icon: '📹', color: '#f59e0b' }
  };

  return (
    <div className="stats-dashboard-container">
      <style>{`
        .stats-dashboard-container {
          padding: 24px;
          color: var(--text-primary);
          background: var(--bg-primary);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          height: 100%;
          overflow-y: auto;
          box-sizing: border-box;
        }

        .stats-header-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }
        .stats-title h2 {
          font-size: 22px;
          font-weight: 800;
          color: var(--text-primary);
          margin: 0 0 4px 0;
        }
        .stats-title p {
          color: var(--text-muted);
          font-size: 13px;
          margin: 0;
        }
        .stats-btn-refresh-manual {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          color: var(--text-primary);
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all 0.2s ease;
        }
        .stats-btn-refresh-manual:hover {
          background: var(--bg-hover);
          border-color: var(--accent);
        }

        /* Metrics Grid */
        .stats-metrics-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 20px;
          margin-bottom: 24px;
        }
        .stats-metric-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 16px;
          padding: 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          transition: transform 0.3s ease, border-color 0.3s ease;
          box-shadow: var(--shadow);
        }
        .stats-metric-card:hover {
          transform: translateY(-2px);
          border-color: var(--accent);
          box-shadow: var(--shadow-lg);
        }
        .metric-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .metric-label {
          font-size: 13px;
          color: var(--text-muted);
          font-weight: 500;
        }
        .metric-value {
          font-size: 28px;
          font-weight: 800;
          color: var(--text-primary);
        }
        .metric-icon-box {
          width: 46px;
          height: 46px;
          border-radius: 12px;
          background: var(--accent-light);
          border: 1px solid var(--border-color);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--accent);
        }

        /* Success Rate Ring */
        .metric-ring-container {
          position: relative;
          width: 52px;
          height: 52px;
        }
        .metric-ring-bg {
          fill: none;
          stroke: var(--border-color);
          stroke-width: 4;
        }
        .metric-ring-fill {
          fill: none;
          stroke: var(--success);
          stroke-width: 4;
          stroke-linecap: round;
          transform: rotate(-90deg);
          transform-origin: 50% 50%;
          transition: stroke-dashoffset 0.8s ease;
        }
        .metric-ring-fill.fail {
          stroke: var(--error);
        }
        .metric-ring-text {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 700;
          color: var(--text-primary);
        }

        /* Data Charts Row */
        .stats-charts-row {
          display: grid;
          grid-template-columns: 3fr 2fr;
          gap: 20px;
          margin-bottom: 24px;
        }
        .stats-panel {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 16px;
          padding: 24px;
          box-shadow: var(--shadow);
        }
        .panel-title {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 18px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        /* Provider Usage Bars */
        .provider-bars-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .provider-bar-item {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .bar-label-row {
          display: flex;
          justify-content: space-between;
          font-size: 13px;
          font-weight: 600;
        }
        .bar-name {
          color: var(--text-secondary);
        }
        .bar-value {
          color: var(--accent);
        }
        .bar-track {
          height: 8px;
          background: var(--bg-tertiary);
          border-radius: 4px;
          overflow: hidden;
        }
        .bar-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--accent) 0%, #a855f7 100%);
          border-radius: 4px;
          transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
        }

        /* Type Progress Cards */
        .type-pills-list {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .type-pill-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--bg-primary);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 12px 16px;
        }
        .type-pill-info {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .type-pill-icon {
          font-size: 16px;
        }
        .type-pill-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
        }
        .type-pill-count {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
        }

        /* Audit logs Table */
        .audit-table-wrapper {
          overflow-x: auto;
          margin-top: 10px;
        }
        .audit-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 13px;
        }
        .audit-table th {
          border-bottom: 2px solid var(--border-color);
          padding: 12px 16px;
          color: var(--text-muted);
          font-weight: 600;
        }
        .audit-table td {
          border-bottom: 1px solid var(--border-color);
          padding: 12px 16px;
          color: var(--text-primary);
          white-space: nowrap;
        }
        .audit-table tr:hover td {
          background: var(--bg-hover);
        }

        /* Status Badge */
        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 700;
        }
        .status-badge.success {
          background: rgba(0, 180, 42, 0.1);
          color: var(--success);
          border: 1px solid rgba(0, 180, 42, 0.2);
        }
        .status-badge.fail {
          background: rgba(245, 63, 63, 0.1);
          color: var(--error);
          border: 1px solid rgba(245, 63, 63, 0.2);
        }

        .type-badge {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
        }

        /* Loading Spinner */
        .stats-loading-container, .stats-error-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          min-height: 400px;
          color: var(--text-muted);
        }
        .stats-spinner {
          width: 40px;
          height: 40px;
          border: 3px solid var(--border-color);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: stats-spin 1s linear infinite;
          margin-bottom: 16px;
        }
        .stats-btn-refresh {
          background: var(--accent);
          color: #ffffff;
          border: none;
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          margin-top: 12px;
        }
        @keyframes stats-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Header bar */}
      <div className="stats-header-bar">
        <div className="stats-title">
          <h2>模型调用与审计分析</h2>
          <p>实时统计当前用户的 API 计费打点、数据流向与成功失败率</p>
        </div>
        <button onClick={loadData} className="stats-btn-refresh-manual">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          刷新数据
        </button>
      </div>

      {/* Metrics Cards Grid */}
      <div className="stats-metrics-grid">
        <div className="stats-metric-card">
          <div className="metric-info">
            <span className="metric-label">调用总量 (次)</span>
            <span className="metric-value">{metrics.totalCalls}</span>
          </div>
          <div className="metric-icon-box">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            </svg>
          </div>
        </div>

        <div className="stats-metric-card">
          <div className="metric-info">
            <span className="metric-label">Token 消耗量</span>
            <span className="metric-value">{metrics.totalTokens.toLocaleString()}</span>
          </div>
          <div className="metric-icon-box">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
        </div>

        <div className="stats-metric-card">
          <div className="metric-info">
            <span className="metric-label">活跃模型数 (个)</span>
            <span className="metric-value">{activeModelsCount}</span>
          </div>
          <div className="metric-icon-box">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
              <line x1="6" y1="6" x2="6.01" y2="6" />
              <line x1="6" y1="18" x2="6.01" y2="18" />
            </svg>
          </div>
        </div>

        <div className="stats-metric-card">
          <div className="metric-info">
            <span className="metric-label">调用成功率</span>
            <span className="metric-value">{metrics.successRate}%</span>
          </div>
          <div className="metric-ring-container">
            <svg width="52" height="52">
              <circle cx="26" cy="26" r="22" className="metric-ring-bg" />
              <circle 
                cx="26" 
                cy="26" 
                r="22" 
                className={`metric-ring-fill ${metrics.successRate < 70 ? 'fail' : ''}`}
                strokeDasharray={2 * Math.PI * 22}
                strokeDashoffset={2 * Math.PI * 22 * (1 - metrics.successRate / 100)}
              />
            </svg>
            <div className="metric-ring-text">{metrics.successRate}%</div>
          </div>
        </div>
      </div>

      {/* Row with Charts */}
      <div className="stats-charts-row">
        {/* Left: Provider usage bar charts */}
        <div className="stats-panel">
          <div className="panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            按供应商调用频次
          </div>
          <div className="provider-bars-list">
            {sortedProviders.length === 0 ? (
              <div style={{ color: '#6b7280', fontSize: '13px', padding: '20px 0' }}>暂无供应商调用数据</div>
            ) : (
              sortedProviders.map(([providerId, count]) => {
                const percentage = Math.round((count / totalCalls) * 100);
                return (
                  <div key={providerId} className="provider-bar-item">
                    <div className="bar-label-row">
                      <span className="bar-name">{providerId}</span>
                      <span className="bar-value">{count} 次 ({percentage}%)</span>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${percentage}%` }}></div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Generation type count breakdown */}
        <div className="stats-panel">
          <div className="panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              <path d="M2 12h20" />
            </svg>
            多模态类型分布
          </div>
          <div className="type-pills-list">
            {Object.entries(typeLabels).map(([type, label]) => {
              const count = typeUsage[type] || 0;
              return (
                <div key={type} className="type-pill-item">
                  <div className="type-pill-info">
                    <span className="type-pill-icon">{label.icon}</span>
                    <span className="type-pill-name">{label.name}</span>
                  </div>
                  <span className="type-pill-count" style={{ color: label.color }}>{count} 次</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Audit Logs Table */}
      <div className="stats-panel">
        <div className="panel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          调用审计明细 (最近 50 次)
        </div>
        <div className="audit-table-wrapper">
          {recentLogs.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: '13px', padding: '20px 0', textAlign: 'center' }}>
              暂无调用审计日志，进行第一次对话或多模态生成即可生成日志。
            </div>
          ) : (
            <table className="audit-table">
              <thead>
                <tr>
                  <th>请求时间</th>
                  <th>供应商</th>
                  <th>模型</th>
                  <th>类型</th>
                  <th>Tokens</th>
                  <th>状态</th>
                  <th>异常说明</th>
                </tr>
              </thead>
              <tbody>
                {recentLogs.map((log) => {
                  const date = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  const typeInfo = typeLabels[log.type] || { name: log.type, color: '#9ca3af' };
                  return (
                    <tr key={log.id}>
                      <td>{date}</td>
                      <td>{log.providerId}</td>
                      <td><code>{log.modelId}</code></td>
                      <td>
                        <span className="type-badge" style={{ background: `${typeInfo.color}15`, color: typeInfo.color }}>
                          {typeInfo.name}
                        </span>
                      </td>
                      <td>{log.tokens > 0 ? log.tokens.toLocaleString() : '-'}</td>
                      <td>
                        {log.success ? (
                          <span className="status-badge success">
                            ✓ 成功
                          </span>
                        ) : (
                          <span className="status-badge fail">
                            ✗ 失败
                          </span>
                        )}
                      </td>
                      <td style={{ color: '#f87171', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={log.errorMsg}>
                        {log.errorMsg || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
