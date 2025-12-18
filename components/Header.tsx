import React from 'react';
import { WHATSAPP_LINK } from '../constants';

const Header: React.FC = () => {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-[var(--wa-header)] text-white shadow-sm z-20">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-sm font-bold">
          NL
        </div>
        <h1 className="text-lg font-medium">寧樂家居助手</h1>
      </div>
      <a
        href={WHATSAPP_LINK}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm bg-emerald-600 px-3 py-1.5 rounded-full hover:bg-emerald-700 transition-colors"
      >
        WhatsApp
      </a>
    </div>
  );
};

export default Header;
