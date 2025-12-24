import React from 'react';
import { HelpCircle, MessageCircle } from 'lucide-react';

export const AppBar: React.FC = () => {
  const handleWhatsApp = () => {
    window.open('https://wa.me/85212345678', '_blank'); // Replace with actual number if known, or generic
  };

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
        <button className="text-white/60 hover:text-white transition-colors">
          <HelpCircle size={22} />
        </button>
      </div>
    </div>
  );
};
