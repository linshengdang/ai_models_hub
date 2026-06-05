import React, { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { User, Bot, Paperclip, Copy, Check } from 'lucide-react';

export default function MessageBubble({ message }) {
  const { role, content, isStreaming, attachmentPreviews } = message;

  return (
    <div className={`message ${role}`}>
      <div className="msg-avatar">
        {role === 'user' ? <User size={16} /> : <Bot size={16} />}
      </div>
      <div className="msg-content">
        {role === 'user' ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>
        ) : (
          <>
            {content ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code: CodeBlock,
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                  ),
                }}
              >
                {content}
              </ReactMarkdown>
            ) : isStreaming ? (
              <div className="msg-typing">
                <span /><span /><span />
              </div>
            ) : null}
          </>
        )}
        {attachmentPreviews && attachmentPreviews.length > 0 && (
          <div className="msg-attachments">
            {attachmentPreviews.map((att, i) => (
              <span key={i} className="msg-attachment">
                <Paperclip size={12} />
                {att.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CodeBlock({ node, inline, className, children, ...props }) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';
  const codeString = String(children).replace(/\n$/, '');

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [codeString]);

  if (inline) {
    return <code className={className} {...props}>{children}</code>;
  }

  return (
    <div className="code-block-wrapper">
      <button className="code-copy-btn" onClick={handleCopy}>
        {copied ? <><Check size={12} /> 已复制</> : <><Copy size={12} /> 复制</>}
      </button>
      <SyntaxHighlighter
        style={oneDark}
        language={language || 'text'}
        PreTag="pre"
        customStyle={{
          margin: '8px 0',
          borderRadius: '8px',
          fontSize: '13px',
        }}
        {...props}
      >
        {codeString}
      </SyntaxHighlighter>
    </div>
  );
}
