import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, Link, Trash2, Image, X } from 'lucide-react';

export default function InputBar({ onSend, disabled, modelType, onClear, shortcuts }) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(Math.max(textareaRef.current.scrollHeight, 96), 280) + 'px';
    }
  }, [text]);

  const handleSubmit = () => {
    if (disabled) return;
    if (!text.trim() && attachments.length === 0) return;
    onSend(text, attachments);
    setText('');
    setAttachments([]);
  };

  const handleKeyDown = (e) => {
    const sendMsgOnEnter = shortcuts ? shortcuts.sendMsg : true;
    if (e.key === 'Enter') {
      if (sendMsgOnEnter) {
        if (!e.shiftKey) {
          e.preventDefault();
          handleSubmit();
        }
      } else {
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          handleSubmit();
        }
      }
    }
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      setAttachments(prev => [...prev, { file, preview, name: file.name, type: file.type }]);
    }
    e.target.value = '';
  };

  const handleUrlAdd = () => {
    if (!urlValue.trim()) return;
    setAttachments(prev => [...prev, { url: urlValue, name: urlValue, type: 'link' }]);
    setUrlValue('');
    setShowUrlInput(false);
  };

  const removeAttachment = (index) => {
    setAttachments(prev => {
      const updated = [...prev];
      if (updated[index].preview) URL.revokeObjectURL(updated[index].preview);
      updated.splice(index, 1);
      return updated;
    });
  };

  const sendMsgOnEnter = shortcuts ? shortcuts.sendMsg : true;
  const placeholder = modelType === 'image'
    ? '描述你想要生成的图片...'
    : modelType === 'video'
    ? '描述你想要生成的视频...'
    : sendMsgOnEnter 
    ? '输入消息... (Shift+Enter 换行，Enter 发送)'
    : '输入消息... (Enter 换行，Cmd/Ctrl+Enter 发送)';

  return (
    <div className="input-bar">
      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="input-attachments">
          {attachments.map((att, i) => (
            <div key={i} className="input-attachment">
              {att.preview && <img src={att.preview} alt={att.name} />}
              {att.type === 'link' && <Link size={14} />}
              {!att.preview && att.type !== 'link' && <Paperclip size={14} />}
              <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {att.name}
              </span>
              <button onClick={() => removeAttachment(i)}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* URL input */}
      {showUrlInput && (
        <div className="input-attachments" style={{ marginBottom: 8 }}>
          <input
            value={urlValue}
            onChange={e => setUrlValue(e.target.value)}
            placeholder="输入链接地址 (如 GitHub 仓库、网页等)..."
            style={{ flex: 1, minWidth: 200 }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); handleUrlAdd(); }
              if (e.key === 'Escape') setShowUrlInput(false);
            }}
            autoFocus
          />
          <button className="btn btn-sm btn-primary" onClick={handleUrlAdd}>添加</button>
          <button className="btn btn-sm btn-secondary" onClick={() => setShowUrlInput(false)}>取消</button>
        </div>
      )}

      {/* Input row */}
      <div className="input-row">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={4}
        />
        <div className="input-actions">
          {/* File upload */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.pdf,.txt,.csv,.md,.json,.docx,.xlsx,.pptx,.zip,.tar.gz"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <button
            className="btn-icon"
            onClick={() => fileInputRef.current?.click()}
            title="上传文件"
            disabled={disabled}
          >
            <Paperclip size={18} />
          </button>
          {/* URL link */}
          <button
            className="btn-icon"
            onClick={() => setShowUrlInput(!showUrlInput)}
            title="添加链接"
            disabled={disabled}
          >
            <Link size={18} />
          </button>
          {/* Clear */}
          <button
            className="btn-icon"
            onClick={onClear}
            title="清空工作区"
          >
            <Trash2 size={18} />
          </button>
          {/* Send */}
          <button
            className="btn-icon"
            onClick={handleSubmit}
            disabled={disabled || (!text.trim() && attachments.length === 0)}
            title="发送 (Enter)"
            style={{ color: text.trim() || attachments.length > 0 ? 'var(--accent)' : undefined }}
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
