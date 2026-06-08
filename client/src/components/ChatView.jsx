import React, { useState, useRef, useCallback, useEffect } from 'react';
import MessageBubble from './MessageBubble';
import InputBar from './InputBar';
import MediaPreview from './MediaPreview';
import { sendChatMessage, parseSSEStream, uploadFile, fileToBase64, generateImageApi, generateAudioApi, generateVideoApi } from '../api';
import { 
  MessageSquare, Settings, ArrowRight, Sparkles, Image as ImageIcon, 
  Video as VideoIcon, Music, Check, ChevronDown, RefreshCw, Download, 
  Play, Pause, Sliders, ExternalLink, HelpCircle, Film
} from 'lucide-react';

// Common SELECT component imported inline to avoid App selector dependency
function LocalChatSelect({ className, value, placeholder, options, groups, disabled, onChange, renderLabel, renderOption }) {
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

// Stunning mock resources for multimodal output
const MOCK_IMAGES = [
  { url: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=800', desc: '赛博朋克二次元女孩 · 璀璨街景' },
  { url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800', desc: '流沙梦幻艺术 · 液体大理石抽象' },
  { url: 'https://images.unsplash.com/photo-1614741118887-7a4ee193a5fa?w=800', desc: '宇宙星河深空 · 梦境超现实主义' },
  { url: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=800', desc: '梵高表现主义油画风格 · 绚烂花束' },
  { url: 'https://images.unsplash.com/photo-1549490349-8643362247b5?w=800', desc: '东京深夜霓虹细雨 · 赛博朋克风' }
];

const MOCK_VIDEOS = [
  { url: 'https://assets.mixkit.co/videos/preview/mixkit-stars-in-space-background-1611-large.mp4', desc: '深邃宇宙繁星闪烁 · 慢动作平移' },
  { url: 'https://assets.mixkit.co/videos/preview/mixkit-flying-through-neon-city-at-night-42861-large.mp4', desc: '俯瞰穿越赛博朋克霓虹城市 · 第一人称' }
];

const MOCK_AUDIOS = [
  { url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', desc: 'SoundHelix 极简电子合成器乐曲 (男声配音模拟)' },
  { url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', desc: 'SoundHelix 动感声学旋律配乐 (女声配音模拟)' }
];

export default function ChatView({ 
  providerId, 
  modelId, 
  setSelectedProvider, 
  setSelectedModel, 
  providerList, 
  providers, 
  defaults, 
  onGoSettings, 
  shortcuts,
  showToast
}) {
  const [activeView, setActiveView] = useState('experience'); // 'experience' | 'proxy'
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [mediaItems, setMediaItems] = useState([]);
  
  // Custom workspace states for multimodal generators
  const [images, setImages] = useState([]);
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageStyle, setImageStyle] = useState('cyberpunk');
  const [imageAspect, setImageAspect] = useState('16:9');
  
  const [videos, setVideos] = useState([]);
  const [videoPrompt, setVideoPrompt] = useState('');
  const [cameraMotion, setCameraMotion] = useState('zoom-in');
  
  const [audios, setAudios] = useState([]);
  const [audioPrompt, setAudioPrompt] = useState('');
  const [voiceRole, setVoiceRole] = useState('female-gentle');
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [showDropdownSelector, setShowDropdownSelector] = useState(false);
  const [zoomedImage, setZoomedImage] = useState(null);

  const messagesEndRef = useRef(null);

  // Compute provider & model details
  const currentProvider = providers[providerId];
  const modelList = currentProvider ? (currentProvider.models || []) : [];
  const currentModel = modelList.find(m => m.id === modelId);

  // Grouped models for select group label
  const groupedModels = {};
  modelList.forEach(m => {
    const typeLabel = m.type === 'text' ? '📝 文本' : m.type === 'image' ? '🖼️ 图片' : m.type === 'video' ? '🎬 视频' : m.type === 'audio' ? '🎵 音频' : '📦 其他';
    if (!groupedModels[typeLabel]) groupedModels[typeLabel] = [];
    groupedModels[typeLabel].push(m);
  });

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (currentModel?.type === 'text') {
      scrollToBottom();
    }
  }, [messages, scrollToBottom, currentModel]);

  // Handle regular chat text message
  const handleSend = async (text, attachments) => {
    if (!providerId || !modelId) return;
    if (!text.trim() && attachments.length === 0) return;

    const userMessage = {
      role: 'user',
      content: text,
      files: [],
      attachmentPreviews: [],
    };

    for (const att of attachments) {
      if (att.file) {
        const result = await uploadFile(att.file);
        if (result.success) {
          const fileInfo = {
            name: result.file.name,
            type: result.file.type,
            url: result.file.url,
            size: result.file.size,
          };
          if (att.file.type.startsWith('image/')) {
            fileInfo.base64 = await fileToBase64(att.file);
          }
          userMessage.files.push(fileInfo);
          userMessage.attachmentPreviews.push(fileInfo);
        }
      } else if (att.url) {
        userMessage.content += `\n\n[链接: ${att.url}]`;
        userMessage.attachmentPreviews.push({ name: att.url, type: 'link', url: att.url });
      }
    }

    const displayMessages = [...messages, userMessage];
    setMessages(displayMessages);

    const apiMessages = displayMessages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.files?.length ? { files: m.files } : {}),
    }));

    setIsStreaming(true);

    const assistantMsg = { role: 'assistant', content: '', isStreaming: true };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      const response = await sendChatMessage({
        providerId,
        modelId,
        messages: apiMessages,
      });

      if (response.type === 'stream') {
        await parseSSEStream(
          response.body,
          (text) => {
            setMessages(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              updated[updated.length - 1] = {
                ...last,
                content: last.content + text,
              };
              return updated;
            });
          },
          () => {
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                isStreaming: false,
              };
              return updated;
            });
          },
          (error) => {
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: 'assistant',
                content: `❌ 错误: ${error}`,
                isStreaming: false,
              };
              return updated;
            });
          }
        );
      }
    } catch (error) {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: `❌ 请求失败: ${error.message}`,
          isStreaming: false,
        };
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  // Handle image generation workflow
  const handleGenerateImage = async (e) => {
    e.preventDefault();
    if (!imagePrompt.trim()) return;

    setIsGenerating(true);
    const previewId = Date.now();

    // Add generating preview state
    setImages(prev => [
      { id: previewId, prompt: imagePrompt, style: imageStyle, isGenerating: true },
      ...prev
    ]);

    try {
      const result = await generateImageApi(providerId, modelId, imagePrompt, imageStyle, imageAspect);
      if (result.success && result.url) {
        setImages(prev => prev.map(img => 
          img.id === previewId 
            ? { ...img, url: result.url, desc: `${imagePrompt} (${imageStyle})`, isGenerating: false } 
            : img
        ));
      } else {
        throw new Error(result.error || '未返回图片 URL');
      }
    } catch (error) {
      console.warn('Real API failed, falling back to client-side generation:', error);
      const styleQueries = {
        cyberpunk: 'cyberpunk style, neon glowing accents, futuristic digital art',
        anime: 'anime scene, vibrant colors, detailed illustration, key visual',
        realistic: 'photorealistic, dslr photograph, high details, sharp focus, 8k',
        'oil-painting': 'classic oil painting style, rich textures, masterwork brush strokes',
        '3d-render': 'stunning 3d render, octane render style, unreal engine 5 scene'
      };
      const styleSuffix = styleQueries[imageStyle] || '';
      const colors = [
        ['#2193b0', '#6dd5ed'],
        ['#ee9ca7', '#ffdde1'],
        ['#00c6ff', '#0072ff'],
        ['#f12711', '#f5af19'],
        ['#a8c0ff', '#3f2b96'],
        ['#11998e', '#38ef7d']
      ];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];
      const cleanPrompt = (imagePrompt || 'AI Image').replace(/"/g, '&quot;');
      
      const svgString = `<svg width="800" height="450" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${randomColor[0]};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${randomColor[1]};stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="800" height="450" fill="url(#grad)" />
  <circle cx="400" cy="185" r="50" fill="rgba(255,255,255,0.15)" />
  <path d="M385 185 L415 185 M400 170 L400 200" stroke="#ffffff" stroke-width="4" stroke-linecap="round" />
  <text x="400" y="290" font-family="system-ui, -apple-system, sans-serif" font-size="26" font-weight="bold" fill="#ffffff" text-anchor="middle">${cleanPrompt.slice(0, 24)}</text>
  <text x="400" y="335" font-family="system-ui, -apple-system, sans-serif" font-size="14" fill="rgba(255,255,255,0.75)" text-anchor="middle">AI 图像创作平台 (本地生成)</text>
</svg>`;
      const generatedUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgString)}`;

      setImages(prev => prev.map(img => 
        img.id === previewId 
          ? { ...img, url: generatedUrl, desc: `${imagePrompt} (${imageStyle}) (生成失败，为您启用本地兜底渲染)`, isGenerating: false } 
          : img
      ));
    } finally {
      setIsGenerating(false);
      setImagePrompt('');
    }
  };

  // Handle video generation workflow
  const handleGenerateVideo = async (e) => {
    e.preventDefault();
    if (!videoPrompt.trim()) return;

    setIsGenerating(true);
    const previewId = Date.now();
    setVideos(prev => [
      { id: previewId, prompt: videoPrompt, motion: cameraMotion, isGenerating: true },
      ...prev
    ]);

    try {
      const result = await generateVideoApi(providerId, modelId, videoPrompt, cameraMotion);
      if (result.success && result.url) {
        setVideos(prev => prev.map(vid => 
          vid.id === previewId 
            ? { ...vid, url: result.url, desc: videoPrompt, isGenerating: false } 
            : vid
        ));
      } else {
        throw new Error(result.error || '未返回视频 URL');
      }
    } catch (error) {
      console.warn('Real API failed, falling back to mock video:', error);
      const mockItem = MOCK_VIDEOS[Math.floor(Math.random() * MOCK_VIDEOS.length)];
      setVideos(prev => prev.map(vid => 
        vid.id === previewId 
          ? { ...vid, url: mockItem.url, desc: `${mockItem.desc} (兜底生成: ${error.message})`, isGenerating: false } 
          : vid
      ));
    } finally {
      setIsGenerating(false);
      setVideoPrompt('');
    }
  };

  // Handle TTS / Audio generation workflow
  const handleGenerateAudio = async (e) => {
    e.preventDefault();
    if (!audioPrompt.trim()) return;

    setIsGenerating(true);
    const previewId = Date.now();
    setAudios(prev => [
      { id: previewId, prompt: audioPrompt, voice: voiceRole, isGenerating: true },
      ...prev
    ]);

    try {
      const result = await generateAudioApi(providerId, modelId, audioPrompt, voiceRole);
      if (result.success && result.url) {
        setAudios(prev => prev.map(aud => 
          aud.id === previewId 
            ? { ...aud, url: result.url, desc: audioPrompt, isGenerating: false } 
            : aud
        ));
      } else {
        throw new Error(result.error || '未返回音频 URL');
      }
    } catch (error) {
      console.warn('Real API failed, falling back to mock audio:', error);
      const mockItem = MOCK_AUDIOS[Math.floor(Math.random() * MOCK_AUDIOS.length)];
      setAudios(prev => prev.map(aud => 
        aud.id === previewId 
          ? { ...aud, url: mockItem.url, desc: `${mockItem.desc} (兜底生成: ${error.message})`, isGenerating: false } 
          : aud
      ));
    } finally {
      setIsGenerating(false);
      setAudioPrompt('');
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setMediaItems([]);
  };

  const renderTabSelector = () => (
    <div className="chat-tab-selector" style={{
      display: 'flex',
      background: 'rgba(255, 255, 255, 0.02)',
      borderBottom: '1px solid var(--border-color)',
      padding: '10px 24px',
      gap: '12px',
      alignItems: 'center',
      zIndex: 99
    }}>
      <button 
        className={`chat-tab-btn ${activeView === 'experience' ? 'active' : ''}`}
        onClick={() => setActiveView('experience')}
        style={{
          background: activeView === 'experience' ? 'var(--accent)' : 'transparent',
          border: 'none',
          color: activeView === 'experience' ? '#ffffff' : 'var(--text-secondary)',
          padding: '6px 14px',
          borderRadius: '20px',
          fontSize: '13px',
          fontWeight: '600',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}
      >
        <MessageSquare size={14} /> 模型体验工作区
      </button>
      <button 
        className={`chat-tab-btn ${activeView === 'proxy' ? 'active' : ''}`}
        onClick={() => setActiveView('proxy')}
        style={{
          background: activeView === 'proxy' ? 'var(--accent)' : 'transparent',
          border: 'none',
          color: activeView === 'proxy' ? '#ffffff' : 'var(--text-secondary)',
          padding: '6px 14px',
          borderRadius: '20px',
          fontSize: '13px',
          fontWeight: '600',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}
      >
        <ExternalLink size={14} /> 外部 API 代理服务
      </button>
    </div>
  );

  const renderProxyDashboard = () => {
    const username = localStorage.getItem('hub-user-id') || 'guest';
    const proxyApiKey = `sk-spacedream-${username}`;
    const proxyBaseUrl = `${window.location.origin}/v1`;

    const configuredModels = [];
    const modelFrequency = {};
    
    Object.entries(providers).forEach(([pId, provider]) => {
      (provider.models || []).forEach(m => {
        modelFrequency[m.id] = (modelFrequency[m.id] || 0) + 1;
      });
    });

    Object.entries(providers).forEach(([pId, provider]) => {
      (provider.models || []).forEach(m => {
        const isDuplicate = modelFrequency[m.id] > 1;
        configuredModels.push({
          originalId: m.id,
          apiId: isDuplicate ? `${pId}-${m.id}` : m.id,
          name: m.name,
          type: m.type,
          providerName: provider.name,
          providerId: pId,
          isDuplicate
        });
      });
    });

    const copyText = (text, label) => {
      navigator.clipboard?.writeText(text);
      showToast?.(`${label} 已复制到剪贴板！`, 'success');
    };

    return (
      <div className="proxy-dashboard" style={{
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        height: 'calc(100% - 53px)',
        overflowY: 'auto',
        fontFamily: "'Outfit', 'Inter', sans-serif"
      }}>
        {/* Banner Card */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(168, 85, 247, 0.1) 100%)',
          border: '1px solid rgba(99, 102, 241, 0.2)',
          borderRadius: '16px',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: 'var(--text-primary)' }}>🔑 外部 API 代理服务</h3>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            本服务完美兼容 OpenAI 标准 API 规范。您可以使用下方提供的本地代理地址与 API 密钥，在外部客户端（如 Cursor、Open WebUI、Lobe Chat 或自定义 Python/NodeJS 脚本）中，直接调用您当前已在 AI Model Hub 中激活并配置好的所有供应商模型。
          </p>
        </div>

        {/* Credentials Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '20px'
        }}>
          {/* Base URL Card */}
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}>
            <h4 style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>🔗 代理接口地址 (API Base URL)</h4>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="text" 
                value={proxyBaseUrl} 
                readOnly 
                style={{
                  flexGrow: 1,
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  fontSize: '13px',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace'
                }}
              />
              <button 
                className="btn btn-secondary btn-sm" 
                onClick={() => copyText(proxyBaseUrl, '代理接口地址')}
                style={{ borderRadius: '8px', padding: '0 12px' }}
              >
                复制
              </button>
            </div>
          </div>

          {/* API Key Card */}
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}>
            <h4 style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>🔑 外部 API 密钥 (API Key)</h4>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="password" 
                value={proxyApiKey} 
                readOnly 
                style={{
                  flexGrow: 1,
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  fontSize: '13px',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace'
                }}
              />
              <button 
                className="btn btn-secondary btn-sm" 
                onClick={() => copyText(proxyApiKey, '代理 API 密钥')}
                style={{ borderRadius: '8px', padding: '0 12px' }}
              >
                复制
              </button>
            </div>
          </div>
        </div>

        {/* Client Config Guides */}
        <div style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>💻 常用第三方客户端配置示例</h4>
          
          <details style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '8px 12px' }}>
            <summary style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              🤖 示例 A: Cursor 软件集成
            </summary>
            <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '8px', lineHeight: '1.6' }}>
              在 Cursor 的 <strong>Settings -&gt; Models -&gt; OpenAI API Key</strong> 中设置：<br />
              1. 填写 API Key 为：<code>{proxyApiKey}</code><br />
              2. 展开 Override OpenAI Base URL，填写为：<code>{proxyBaseUrl}</code><br />
              3. 在下方输入对应的可用模型 ID 进行绑定即可启用。
            </div>
          </details>

          <details style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '8px 12px' }}>
            <summary style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              🐍 示例 B: Python 代码集成 (openai sdk)
            </summary>
            <pre style={{
              background: 'var(--bg-tertiary)',
              padding: '12px',
              borderRadius: '6px',
              fontSize: '12px',
              overflowX: 'auto',
              fontFamily: 'monospace',
              color: 'var(--text-primary)',
              marginTop: '8px',
              border: '1px solid var(--border-color)'
            }}>{`from openai import OpenAI

client = OpenAI(
    base_url="${proxyBaseUrl}",
    api_key="${proxyApiKey}"
)

completion = client.chat.completions.create(
    model="${configuredModels[0]?.apiId || 'gpt-4o'}",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(completion.choices[0].message.content)`}</pre>
          </details>
        </div>

        {/* Supported Models List */}
        <div style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>📦 代理服务支持的模型列表</h4>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
              不同供应商如果配置了同名的相同模型，系统会自动添加提供商前缀以示区分（例如 <code>openai-gpt-4o</code> ）。
            </p>
          </div>

          {configuredModels.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '13px' }}>
              暂无已配置的模型，请先前往“设置”控制台添加并挂载模型供应商。
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '13px',
                textAlign: 'left'
              }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '10px 12px' }}>API 接口模型 ID</th>
                    <th style={{ padding: '10px 12px' }}>原模型 ID</th>
                    <th style={{ padding: '10px 12px' }}>所属供应商</th>
                    <th style={{ padding: '10px 12px' }}>模型类型</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {configuredModels.map((m, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
                      <td style={{ padding: '12px', fontFamily: 'monospace', fontWeight: m.isDuplicate ? 'bold' : 'normal' }}>
                        {m.apiId}
                        {m.isDuplicate && (
                          <span style={{
                            marginLeft: '8px',
                            background: 'rgba(99, 102, 241, 0.15)',
                            color: '#a5b4fc',
                            border: '1px solid rgba(99, 102, 241, 0.3)',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontSize: '9.5px'
                          }}>
                            已加供应商前缀
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{m.originalId}</td>
                      <td style={{ padding: '12px' }}>{m.providerName}</td>
                      <td style={{ padding: '12px' }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          background: m.type === 'text' ? 'rgba(16, 185, 129, 0.15)' : m.type === 'image' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                          color: m.type === 'text' ? '#34d399' : m.type === 'image' ? '#60a5fa' : '#fbbf24'
                        }}>
                          {m.type === 'text' ? '文本' : m.type === 'image' ? '图片' : m.type === 'video' ? '视频' : m.type === 'audio' ? '音频' : m.type}
                        </span>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        <button 
                          className="btn btn-secondary btn-sm"
                          onClick={() => copyText(m.apiId, '模型 ID')}
                          style={{ padding: '4px 8px', borderRadius: '6px' }}
                        >
                          复制 ID
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Model Selection Panel Content
  const renderModelSelectorCard = (isFloating = false) => {
    return (
      <div className={`chat-selector-card ${isFloating ? 'floating' : ''}`}>
        <div className="selector-header">
          <Sparkles size={20} className="shine-icon" />
          <h3>请选择模型供应商与大模型</h3>
          <p>从您已激活的通道中挑选合适的模型来开启创作体验</p>
        </div>
        <div className="selector-form tiled">
          <div className="form-item">
            <label>模型供应商</label>
            <div className="provider-chips-grid">
              {providerList.map(p => (
                <button 
                  key={p.id} 
                  type="button"
                  className={`provider-chip-btn ${providerId === p.id ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedProvider(p.id);
                    setSelectedModel('');
                  }}
                >
                  <span className="dot" style={{ background: p.id === providerId ? 'var(--accent)' : 'var(--text-muted)' }} />
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <div className="form-item">
            <label>可用大模型</label>
            {providerId && Object.keys(groupedModels).length > 0 ? (
              <div className="model-groups-wrapper">
                {Object.entries(groupedModels).map(([groupName, modelsList]) => (
                  <div key={groupName} className="model-group-section">
                    <h4 className="model-group-title">{groupName}</h4>
                    <div className="model-chips-grid">
                      {modelsList.map(m => (
                        <button
                          key={m.id}
                          type="button"
                          className={`model-chip-btn ${modelId === m.id ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedModel(m.id);
                            setShowDropdownSelector(false); // Collapse floating card on select
                          }}
                        >
                          <div className="model-chip-name">{m.id}</div>
                          {m.vision && <div className="model-chip-badge">支持视觉</div>}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="model-select-placeholder">
                {providerId ? '该供应商下暂无可用的模型，请前往“设置”中添加模型' : '请先选择上方的模型供应商'}
              </div>
            )}
          </div>
        </div>
        {!isFloating && onGoSettings && (
          <div className="selector-footer-hint">
            <span>没有可用的模型？</span>
            <button className="btn-link" onClick={() => onGoSettings('models')}>
              前往设置添加供应商 <ArrowRight size={12} />
            </button>
          </div>
        )}
      </div>
    );
  };

  // Define details for selected model layout
  const modelType = currentModel?.type || 'text';
  const getModelTypeBadge = (type) => {
    if (type === 'image') return { label: '🖼️ 图像生成', class: 'badge-image' };
    if (type === 'video') return { label: '🎬 视频生成', class: 'badge-video' };
    if (type === 'audio') return { label: '🎵 音频合成', class: 'badge-audio' };
    return { label: '📝 文本聊天', class: 'badge-text' };
  };
  const typeBadge = getModelTypeBadge(modelType);

  return (
    <div className="chat-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {renderTabSelector()}

      {activeView === 'proxy' ? (
        renderProxyDashboard()
      ) : (
        <div style={{ flexGrow: 1, position: 'relative', display: 'flex', flexDirection: 'column', height: 'calc(100% - 53px)' }}>
          {(!providerId || !modelId || showDropdownSelector) ? (
            <div className="chat-empty-panel" style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {renderModelSelectorCard(showDropdownSelector)}
              {showDropdownSelector && (
                <button className="btn btn-secondary btn-close-selector" onClick={() => setShowDropdownSelector(false)} style={{ marginTop: '16px' }}>
                  取消修改并返回
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
              {/* 2. Floating capsule bar at top of workarea */}
              <div className="chat-floating-pill-container" style={{ zIndex: 10 }}>
                <div className="chat-floating-pill" onClick={() => setShowDropdownSelector(true)} title="点击重新选择模型或供应商">
                  <span className="pill-provider">{currentProvider?.name}</span>
                  <span className="pill-divider">/</span>
                  <span className="pill-model">{currentModel?.id}</span>
                  <span className={`pill-badge ${typeBadge.class}`}>{typeBadge.label}</span>
                  <span className="pill-arrow"><ChevronDown size={12} /></span>
                </div>
              </div>

              {/* 3. Render differentiated views based on model type */}
              
              {/* TEXT MODEL VIEW */}
              {modelType === 'text' && (
                <div className="chat-main-container">
                  <div className="chat-messages">
                    {messages.length === 0 && (
                      <div className="chat-empty">
                        <MessageSquare size={36} style={{ opacity: 0.5, marginBottom: 8 }} />
                        <p>已进入与 <strong>{currentModel?.name || modelId}</strong> 的应用工作区...</p>
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                          支持输入文字、Markdown 格式以及上传图像/代码资源。
                        </p>
                      </div>
                    )}
                    {messages.map((msg, index) => (
                      <MessageBubble key={index} message={msg} />
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                  <InputBar
                    onSend={handleSend}
                    disabled={isStreaming}
                    modelType="text"
                    onClear={handleClearChat}
                    shortcuts={shortcuts}
                  />
                </div>
              )}

              {/* IMAGE MODEL VIEW */}
              {modelType === 'image' && (
                <div className="multimodal-workarea image-layout">
                  {/* Left Prompt Console */}
                  <div className="multimodal-panel console">
                    <div className="panel-header">
                      <ImageIcon size={18} />
                      <h4>AI 图像创作台</h4>
                    </div>
                    <form onSubmit={handleGenerateImage} className="panel-body">
                      <div className="panel-form-field">
                        <label>提示词 (Prompt)</label>
                        <textarea
                          placeholder="描绘你脑海中的画面，例如: '一个身穿太空服的宇航员在荒芜的火星表面驻足，星河璀璨，赛博朋克风'..."
                          value={imagePrompt}
                          onChange={e => setImagePrompt(e.target.value)}
                          disabled={isGenerating}
                          required
                        />
                      </div>

                      <div className="panel-form-field">
                        <label>风格艺术选型 (Art Style)</label>
                        <div className="style-chips-grid">
                          {[
                            { id: 'cyberpunk', name: '⚡ 赛博朋克' },
                            { id: 'anime', name: '🎨 日漫动漫' },
                            { id: 'realistic', name: '📷 纪实写实' },
                            { id: 'oil-painting', name: '🖌️ 古典油画' },
                            { id: '3d-render', name: '🎮 3D 渲染' }
                          ].map(style => (
                            <button
                              key={style.id}
                              type="button"
                              className={`style-chip ${imageStyle === style.id ? 'active' : ''}`}
                              onClick={() => setImageStyle(style.id)}
                              disabled={isGenerating}
                            >
                              {style.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="panel-form-field">
                        <label>画面宽高比 (Aspect Ratio)</label>
                        <div className="aspect-ratio-selector">
                          {['1:1', '4:3', '16:9', '9:16'].map(ratio => (
                            <button
                              key={ratio}
                              type="button"
                              className={`aspect-btn ${imageAspect === ratio ? 'active' : ''}`}
                              onClick={() => setImageAspect(ratio)}
                              disabled={isGenerating}
                            >
                              {ratio}
                            </button>
                          ))}
                        </div>
                      </div>

                      <button type="submit" className="btn btn-primary btn-generate" disabled={isGenerating || !imagePrompt.trim()}>
                        {isGenerating ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />} 
                        {isGenerating ? '正在艺术渲染...' : '开始生成图像'}
                      </button>
                    </form>
                  </div>

                  {/* Right Gallery Board */}
                  <div className="multimodal-panel showcase">
                    <div className="panel-header">
                      <h4>生成的画廊展墙 ({images.length})</h4>
                    </div>
                    <div className="showcase-content images-grid">
                      {images.length === 0 && (
                        <div className="panel-empty-state">
                          <ImageIcon size={48} />
                          <p>您生成的 AI 图像作品会显示在这里</p>
                          <p style={{ fontSize: 12, opacity: 0.6 }}>在左侧控制台配置好您的 Prompt 和风格，即刻生成大片</p>
                        </div>
                      )}
                      {images.map(img => (
                        <div key={img.id} className={`showcase-card ${img.isGenerating ? 'generating' : ''}`}>
                          {img.isGenerating ? (
                            <div className="card-shimmer">
                              <div className="shimmer-spinner">
                                <RefreshCw size={24} className="spin" />
                              </div>
                              <p>正在生成高精画质...</p>
                            </div>
                          ) : (
                            <>
                              <img src={img.url} alt={img.prompt} onClick={() => setZoomedImage(img)} />
                              <div className="card-overlay">
                                <p className="card-prompt-hint" title={img.prompt}>{img.prompt}</p>
                                <div className="card-meta">
                                  <span className="style-tag">{img.style}</span>
                                  <a href={img.url} download={`ai-image-${img.id}.jpg`} target="_blank" rel="noreferrer" className="btn-download" title="下载图片">
                                    <Download size={14} />
                                  </a>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* VIDEO MODEL VIEW */}
              {modelType === 'video' && (
                <div className="multimodal-workarea video-layout">
                  {/* Left Console */}
                  <div className="multimodal-panel console">
                    <div className="panel-header">
                      <Film size={18} />
                      <h4>AI 视频梦工厂</h4>
                    </div>
                    <form onSubmit={handleGenerateVideo} className="panel-body">
                      <div className="panel-form-field">
                        <label>视频描述文本 (Prompt)</label>
                        <textarea
                          placeholder="用文字叙述需要的画面镜头，例如: '一架极光飞艇滑行着越过充满科幻大楼的霓虹赛博朋克深谷，雨夜，霓虹折射'..."
                          value={videoPrompt}
                          onChange={e => setVideoPrompt(e.target.value)}
                          disabled={isGenerating}
                          required
                        />
                      </div>

                      <div className="panel-form-field">
                        <label>运镜模式 (Camera Movement)</label>
                        <div className="style-chips-grid">
                          {[
                            { id: 'zoom-in', name: '🔍 镜头拉近 (Zoom In)' },
                            { id: 'pan-left', name: '↔️ 镜头向左 (Pan Left)' },
                            { id: 'orbit', name: '🔄 环绕运镜 (Orbit)' },
                            { id: 'crane-up', name: '⬆️ 镜头抬升 (Crane Up)' }
                          ].map(motion => (
                            <button
                              key={motion.id}
                              type="button"
                              className={`style-chip wide ${cameraMotion === motion.id ? 'active' : ''}`}
                              onClick={() => setCameraMotion(motion.id)}
                              disabled={isGenerating}
                            >
                              {motion.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      <button type="submit" className="btn btn-primary btn-generate" disabled={isGenerating || !videoPrompt.trim()}>
                        {isGenerating ? <RefreshCw size={14} className="spin" /> : <VideoIcon size={14} />} 
                        {isGenerating ? '正在极速渲染视频...' : '生成电影级视频'}
                      </button>
                    </form>
                  </div>

                  {/* Right Showcase */}
                  <div className="multimodal-panel showcase">
                    <div className="panel-header">
                      <h4>生成的视频队列 ({videos.length})</h4>
                    </div>
                    <div className="showcase-content videos-column">
                      {videos.length === 0 && (
                        <div className="panel-empty-state">
                          <Film size={48} />
                          <p>您创作的 AI 视频片段会列在这里</p>
                          <p style={{ fontSize: 12, opacity: 0.6 }}>在左侧输入您奇妙的想法，AI 会将其化为动感现实</p>
                        </div>
                      )}
                      {videos.map(vid => (
                        <div key={vid.id} className={`video-showcase-card ${vid.isGenerating ? 'generating' : ''}`}>
                          {vid.isGenerating ? (
                            <div className="video-card-shimmer">
                              <RefreshCw size={24} className="spin" />
                              <p>正在生成高帧率视频 (预计 4 秒视频)...</p>
                            </div>
                          ) : (
                            <div className="video-card-main">
                              <div className="video-player-container">
                                <video src={vid.url} controls preload="auto" width="100%" />
                              </div>
                              <div className="video-card-info">
                                <h5>{vid.prompt}</h5>
                                <div className="video-card-meta">
                                  <span className="badge-text class-tag">运镜: {vid.motion}</span>
                                  <a href={vid.url} download={`ai-video-${vid.id}.mp4`} target="_blank" rel="noreferrer" className="btn btn-sm btn-secondary">
                                    <Download size={12} /> 下载视频
                                  </a>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* AUDIO MODEL VIEW */}
              {modelType === 'audio' && (
                <div className="multimodal-workarea audio-layout">
                  {/* Left Console */}
                  <div className="multimodal-panel console">
                    <div className="panel-header">
                      <Music size={18} />
                      <h4>AI 音频与配音中心</h4>
                    </div>
                    <form onSubmit={handleGenerateAudio} className="panel-body">
                      <div className="panel-form-field">
                        <label>转换文本内容 (Text Input)</label>
                        <textarea
                          placeholder="在此输入需要转换成音频的文本，AI 会以选配的人声或曲风将其完美合成出来..."
                          value={audioPrompt}
                          onChange={e => setAudioPrompt(e.target.value)}
                          disabled={isGenerating}
                          required
                        />
                      </div>

                      <div className="panel-form-field">
                        <label>配音角色选配 (Voice Role / Style)</label>
                        <div className="style-chips-grid">
                          {[
                            { id: 'female-gentle', name: '👩 温柔女声 (Gentle Female)' },
                            { id: 'male-magnetic', name: '👨 磁性男声 (Magnetic Male)' },
                            { id: 'child-dynamic', name: '👶 活力童声 (Dynamic Child)' },
                            { id: 'ambient-bgm', name: '🎵 氛围配乐 (Ambient BGM)' }
                          ].map(role => (
                            <button
                              key={role.id}
                              type="button"
                              className={`style-chip wide ${voiceRole === role.id ? 'active' : ''}`}
                              onClick={() => setVoiceRole(role.id)}
                              disabled={isGenerating}
                            >
                              {role.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      <button type="submit" className="btn btn-primary btn-generate" disabled={isGenerating || !audioPrompt.trim()}>
                        {isGenerating ? <RefreshCw size={14} className="spin" /> : <Music size={14} />} 
                        {isGenerating ? '正在进行人声合成...' : '开始合成音频'}
                      </button>
                    </form>
                  </div>

                  {/* Right Showcase */}
                  <div className="multimodal-panel showcase">
                    <div className="panel-header">
                      <h4>音频文件包 ({audios.length})</h4>
                    </div>
                    <div className="showcase-content audios-column">
                      {audios.length === 0 && (
                        <div className="panel-empty-state">
                          <Music size={48} />
                          <p>您合成的音频列表会展现于此</p>
                          <p style={{ fontSize: 12, opacity: 0.6 }}>极高保真度音频流，点击左边即刻快速合成</p>
                        </div>
                      )}
                      {audios.map(aud => (
                        <div key={aud.id} className={`audio-showcase-card ${aud.isGenerating ? 'generating' : ''}`}>
                          {aud.isGenerating ? (
                            <div className="audio-card-shimmer">
                              <RefreshCw size={18} className="spin" />
                              <span>正在模拟声学频谱渲染...</span>
                            </div>
                          ) : (
                            <div className="audio-card-main">
                              <div className="audio-card-top">
                                <div className="audio-title-info">
                                  <h6>{aud.prompt}</h6>
                                  <span className="badge-text class-tag">角色: {aud.voice}</span>
                                </div>
                                <a href={aud.url} download={`ai-audio-${aud.id}.mp3`} target="_blank" rel="noreferrer" className="btn-download" title="下载音频">
                                  <Download size={14} />
                                </a>
                              </div>
                              
                              {/* Waveform Animation Mock */}
                              <div className="waveform-box">
                                <div className="bar bar-1"></div>
                                <div className="bar bar-2"></div>
                                <div className="bar bar-3"></div>
                                <div className="bar bar-4"></div>
                                <div className="bar bar-5"></div>
                                <div className="bar bar-6"></div>
                                <div className="bar bar-7"></div>
                                <div className="bar bar-8"></div>
                                <div className="bar bar-9"></div>
                                <div className="bar bar-10"></div>
                              </div>

                              <audio src={aud.url} controls className="audio-element" />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Large Zoomed Image Modal */}
      {zoomedImage && (
        <div className="pm-modal-backdrop" onClick={() => setZoomedImage(null)}>
          <div className="zoomed-image-card" onClick={e => e.stopPropagation()}>
            <img src={zoomedImage.url} alt={zoomedImage.prompt} />
            <div className="zoomed-image-footer">
              <p>{zoomedImage.prompt}</p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <a href={zoomedImage.url} download={`ai-image-${zoomedImage.id}.jpg`} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
                  <Download size={12} /> 下载高清图
                </a>
                <button className="btn btn-secondary btn-sm" onClick={() => setZoomedImage(null)}>
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
