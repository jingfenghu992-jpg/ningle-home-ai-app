import React from 'react';
import { MessageCircle } from 'lucide-react';

interface AppBarProps {
  variant?: 'light' | 'dark';
}

export const AppBar: React.FC<AppBarProps> = ({ variant = 'light' }) => {
  const handleWhatsApp = () => {
    const text = encodeURIComponent('你好，我想了解全屋訂造/室內設計方案，想免費跟進一下。');
    const waLink = `https://wa.me/85256273817?text=${text}`;
    window.open(waLink, '_blank', 'noopener,noreferrer');
  };

  if (variant === 'dark') {
    return (
      <div className="flex items-center justify-between px-4 py-3 bg-[#2E2C29] border-b border-white/5 shrink-0 z-20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#8A8F79] rounded-lg flex items-center justify-center text-white font-bold">
            N
          </div>
          <span className="text-[#EBE8E3] font-medium text-lg">寧樂家居助手</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleWhatsApp}
            className="flex items-center gap-1.5 bg-[#8A8F79] hover:bg-[#6B705C] text-white px-3 py-1.5 rounded-full text-sm font-medium transition-colors"
          >
            <MessageCircle size={16} />
            <span>免費跟進</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-2 shrink-0 z-20">
      <div
        className="flex items-center justify-between rounded-full px-4 py-2 bg-white/75 backdrop-blur border border-[var(--app-border)]"
        style={{ boxShadow: 'var(--elev-0)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold shrink-0"
            style={{ backgroundColor: 'var(--app-primary)' }}
          >
            N
          </div>
          <span className="font-semibold text-[15px] tracking-tight text-[var(--app-text-main)] truncate">
            寧樂家居助手
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleWhatsApp}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold transition-colors border border-[var(--app-border)] text-[var(--app-primary)] hover:bg-[var(--app-divider)]"
          >
            <MessageCircle size={16} />
            <span>免費跟進</span>
          </button>
        </div>
      </div>
    </div>
  );
};
