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
      <div className="relative w-full rounded-full border border-white/12 bg-white/10 backdrop-blur-xl shadow-[0_14px_34px_rgba(0,0,0,0.40)]">
        {/* subtle warm highlight */}
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(120%_120%_at_20%_0%,rgba(255,235,210,0.22)_0%,rgba(255,235,210,0)_55%)] pointer-events-none" />

        <div className="relative grid grid-cols-3 items-center px-4 py-2.5">
          {/* Brand mark (left) */}
          <div className="justify-self-start">
            <div className="w-9 h-9 rounded-2xl bg-white/10 border border-white/12 flex items-center justify-center text-[#F4EFE6] font-extrabold tracking-tight shadow-sm">
              N
            </div>
          </div>

          {/* Centered title */}
          <div className="justify-self-center text-[#F4EFE6] font-semibold text-lg tracking-wide">
            寧樂家居助手
          </div>

          {/* Follow-up button (right) */}
          <div className="justify-self-end">
            <button
              onClick={handleWhatsApp}
              className="flex items-center gap-2 bg-[#8A8F79] hover:bg-[#6B705C] text-white px-4 py-2 rounded-full text-sm font-semibold transition-colors shadow-lg shadow-black/20 border border-white/10"
            >
              <MessageCircle size={16} />
              <span>免費跟進</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
