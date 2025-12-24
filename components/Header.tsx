import React from 'react';
import { WHATSAPP_LINK } from '../constants';
import { Home } from 'lucide-react';

const Header: React.FC = () => {
  return (
    <div className="flex items-center justify-between px-4 py-4 bg-[#2E2C29] text-[#EBE8E3] z-20">
      <div className="flex items-center gap-3">
        <button 
          onClick={() => window.location.reload()} 
          className="w-10 h-10 rounded-full bg-[#F3F0EA]/10 flex items-center justify-center hover:bg-[#F3F0EA]/20 transition-colors text-[#F3F0EA]"
        >
          <Home size={20} />
        </button>
        <h1 className="text-lg font-bold tracking-wide text-[#F3F0EA]">寧樂家居助手</h1>
      </div>
      <a
        href={WHATSAPP_LINK}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm bg-[#8A8F79] text-white px-4 py-2 rounded-full font-medium hover:bg-[#6B705C] transition-colors shadow-lg shadow-[#8A8F79]/20"
      >
        免費跟進
      </a>
    </div>
  );
};

export default Header;
