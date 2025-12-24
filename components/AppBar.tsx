import React from 'react';
import { MessageCircle } from 'lucide-react';

export const AppBar: React.FC = () => {
  const handleWhatsApp = () => {
    const text = encodeURIComponent('你好，我想了解全屋訂造/室內設計方案，想免費跟進一下。');
    const waLink = `https://wa.me/85256273817?text=${text}`;
    window.open(waLink, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="shrink-0 z-20 px-4 pt-4">
      <div className="relative w-full rounded-full border border-white/10 bg-white/10 backdrop-blur-xl shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
        <div className="grid grid-cols-[1fr_auto] items-center px-4 py-2">
          <div className="justify-self-center col-start-1 col-end-3 text-[#F4EFE6] font-semibold text-lg tracking-wide">
            寧樂家居助手
          </div>
          <button
            onClick={handleWhatsApp}
            className="justify-self-end col-start-2 col-end-3 flex items-center gap-2 bg-[#8A8F79] hover:bg-[#6B705C] text-white px-4 py-2 rounded-full text-sm font-semibold transition-colors shadow-lg shadow-black/20"
          >
            <MessageCircle size={16} />
            <span>免費跟進</span>
          </button>
        </div>
      </div>
    </div>
  );
};
