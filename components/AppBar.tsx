import React from 'react';
import { HelpCircle, MessageCircle, Home } from 'lucide-react';

export const AppBar: React.FC = () => {
  const handleWhatsApp = () => {
    const text = encodeURIComponent('你好，我想了解全屋訂造/室內設計方案，想免費跟進一下。');
    const waLink = `https://wa.me/85256273817?text=${text}`;
    window.open(waLink, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-[#2E2C29] border-b border-white/5 shrink-0 z-20">
      <div className="flex items-center gap-3">
        <button 
          onClick={() => window.location.reload()}
          className="w-10 h-10 bg-[#F3F0EA]/10 hover:bg-[#F3F0EA]/20 rounded-full flex items-center justify-center text-[#F3F0EA] transition-colors"
        >
          <Home size={20} />
        </button>
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
};
