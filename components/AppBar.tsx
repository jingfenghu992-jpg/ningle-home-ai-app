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
      <div className="relative w-full rounded-[28px] border border-white/12 bg-white/10 backdrop-blur-2xl shadow-[0_16px_40px_rgba(0,0,0,0.42)]">
        {/* subtle warm highlight */}
        <div className="absolute inset-0 rounded-[28px] bg-[radial-gradient(120%_120%_at_20%_0%,rgba(255,235,210,0.22)_0%,rgba(255,235,210,0)_58%)] pointer-events-none" />
        <div className="absolute inset-0 rounded-[28px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] pointer-events-none" />

        <div className="relative px-4 py-2.5">
          {/* Centered title (true center, like reference) */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[#F1E3CD] font-semibold text-lg tracking-wide drop-shadow-[0_10px_24px_rgba(0,0,0,0.45)]">
            寧樂家居助手
          </div>

          {/* Right CTA */}
          <div className="flex items-center justify-end">
            <button
              onClick={handleWhatsApp}
              className="flex items-center gap-2 bg-[#7C806A] hover:bg-[#6B705C] text-[#F7F3EA] px-4 py-2 rounded-full text-sm font-semibold transition-colors shadow-lg shadow-black/20 border border-white/10"
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
