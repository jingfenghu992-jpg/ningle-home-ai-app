import React from 'react';
import { BookOpen, HelpCircle, MessageCircle } from 'lucide-react';

export const AppBar: React.FC<{ onOpenKnowledge?: () => void }> = ({ onOpenKnowledge }) => {
  const handleWhatsApp = () => {
    const text = encodeURIComponent('你好，我想了解全屋訂造/室內設計方案，想免費跟進一下。');
    const waLink = `https://wa.me/85256273817?text=${text}`;
    window.open(waLink, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="shrink-0 z-20 px-3 pt-3">
      <div className="glass-pill flex items-center justify-between px-4 py-3 rounded-[18px]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 bg-[#8A8F79] rounded-lg flex items-center justify-center text-white font-bold shrink-0">
            N
          </div>
          <span className="text-[#EBE8E3] font-medium text-[16px] truncate">寧樂家居助手</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenKnowledge}
            className="text-white/70 hover:text-white transition-colors"
            aria-label="Knowledge Base"
            title="知識庫"
          >
            <BookOpen size={20} />
          </button>
          <button
            onClick={handleWhatsApp}
            className="flex items-center gap-1.5 bg-[#8A8F79] hover:bg-[#6B705C] text-white px-3 py-1.5 rounded-full text-sm font-medium transition-colors"
          >
            <MessageCircle size={16} />
            <span>免費跟進</span>
          </button>
          <button className="text-white/60 hover:text-white transition-colors" aria-label="Help">
            <HelpCircle size={22} />
          </button>
        </div>
      </div>
    </div>
  );
};
