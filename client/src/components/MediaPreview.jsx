import React from 'react';
import { Download, ExternalLink, X, Image, Film, Music } from 'lucide-react';

export default function MediaPreview({ items, onClear }) {
  if (!items || items.length === 0) return null;

  return (
    <div style={{
      width: 320,
      borderLeft: '1px solid var(--border-color)',
      background: 'var(--bg-secondary)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: '1px solid var(--border-color)',
        fontSize: 13,
        fontWeight: 600,
      }}>
        <span>📎 媒体 & 文件 ({items.length})</span>
        <button className="btn-icon" onClick={onClear} title="清空">
          <X size={16} />
        </button>
      </div>
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        {items.map((item, i) => (
          <MediaItem key={i} item={item} />
        ))}
      </div>
    </div>
  );
}

function MediaItem({ item }) {
  const { type, url, name } = item;

  const handleDownload = async () => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = name || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, '_blank');
    }
  };

  const handleOpen = () => {
    window.open(url, '_blank');
  };

  const renderPreview = () => {
    if (type === 'image' || url?.match(/\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i)) {
      return (
        <img
          src={url}
          alt={name}
          style={{
            width: '100%',
            maxHeight: 250,
            objectFit: 'contain',
            background: 'var(--bg-primary)',
            borderRadius: 'var(--radius)',
          }}
          onError={(e) => {
            e.target.style.display = 'none';
          }}
        />
      );
    }

    if (type === 'video' || url?.match(/\.(mp4|webm|mov)(\?|$)/i)) {
      return (
        <video
          src={url}
          controls
          style={{
            width: '100%',
            maxHeight: 250,
            borderRadius: 'var(--radius)',
            background: 'var(--bg-primary)',
          }}
        />
      );
    }

    if (type === 'audio' || url?.match(/\.(mp3|wav|ogg|webm)(\?|$)/i)) {
      return (
        <div style={{ padding: 12, background: 'var(--bg-primary)', borderRadius: 'var(--radius)' }}>
          <Music size={24} style={{ marginBottom: 8, color: 'var(--text-muted)' }} />
          <audio src={url} controls style={{ width: '100%' }} />
        </div>
      );
    }

    // Generic file
    return (
      <div style={{
        padding: 16,
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius)',
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: 13,
      }}>
        📄 {name || '文件'}
      </div>
    );
  };

  return (
    <div className="media-item">
      {renderPreview()}
      <div className="media-actions">
        <button className="btn btn-sm btn-secondary" onClick={handleDownload}>
          <Download size={14} /> 下载
        </button>
        <button className="btn btn-sm btn-secondary" onClick={handleOpen}>
          <ExternalLink size={14} /> 新窗口打开
        </button>
      </div>
    </div>
  );
}
