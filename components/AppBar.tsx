import React from 'react';
import { MessageCircle } from 'lucide-react';
import { WHATSAPP_LINK } from '../constants';

export const AppBar: React.FC = () => {
  const handleWhatsApp = () => {
    window.open(WHATSAPP_LINK, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-[#F5F2ED] border-b border-black/5 shrink-0 z-20">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 bg-[#1F4D3A] rounded-full flex items-center justify-center text-white font-bold">
          N
        </div>
        <span className="text-[#2F2A23] font-semibold text-[17px]">宁乐家居助手</span>
      </div>
      <div className="flex items-center gap-3">
        <button 
          onClick={handleWhatsApp}
          className="flex items-center gap-1.5 bg-[#1F4D3A] hover:bg-[#173C2D] text-white px-3 py-2 rounded-full text-sm font-semibold transition-colors shadow-sm active:scale-95"
        >
          <MessageCircle size={16} />
          <span>免费跟进</span>
        </button>
      </div>
    </div>
  );
};
