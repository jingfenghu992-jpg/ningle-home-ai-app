import React from 'react';
import { MessageCircle } from 'lucide-react';

export const AppBar: React.FC = () => {
  const handleWhatsApp = () => {
    const text = encodeURIComponent('你好，我想了解全屋訂造/室內設計方案，想免費跟進一下。');
    const waLink = `https://wa.me/85256273817?text=${text}`;
    window.open(waLink, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex items-center justify-center relative px-4 py-4 shrink-0 z-20">
      <span className="text-[#EBE8E3] font-medium text-lg tracking-wide text-shadow-sm">
        寧樂家居助手
      </span>
      
      <div className="absolute right-4 top-1/2 -translate-y-1/2">
        <button 
          onClick={handleWhatsApp}
          className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-[#EBE8E3] px-3 py-1.5 rounded-full text-xs font-medium transition-colors border border-white/20 backdrop-blur-md"
        >
          <MessageCircle size={14} />
          <span>免費跟進</span>
        </button>
      </div>
    </div>
  );
};
