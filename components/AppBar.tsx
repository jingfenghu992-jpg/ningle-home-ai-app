import React from 'react';

export const AppBar: React.FC = () => {
  const handleWhatsApp = () => {
    const text = encodeURIComponent('我想免費了解全屋訂造／收納方案，方便了解嗎？');
    const waLink = `https://wa.me/85256273817?text=${text}`;
    window.open(waLink, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex items-center justify-between px-4 h-[56px] shrink-0 z-20">
      <div className="flex items-center gap-2">
        <div className="w-[28px] h-[28px] bg-[#F3EBDD] rounded-lg flex items-center justify-center text-[#2A201A] font-bold text-sm">
          N
        </div>
        <span className="font-semibold text-[18px] text-[#F3EBDD] tracking-wide">
          寧樂家居助手
        </span>
      </div>
      
      <button 
        onClick={handleWhatsApp}
        className="flex items-center gap-1.5 h-[34px] px-[12px] rounded-[999px] transition-colors backdrop-blur-sm"
        style={{
          backgroundColor: 'rgba(255,255,255,0.12)',
          border: '1px solid rgba(255,255,255,0.18)'
        }}
      >
        <img 
            src="/ui/icon-whatsapp.png" 
            alt="WA" 
            className="w-4 h-4 object-contain opacity-90"
            onError={(e) => {
                // Fallback SVG if image not found
                e.currentTarget.style.display = 'none';
                e.currentTarget.parentElement?.insertAdjacentHTML('afterbegin', '<svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-message-circle"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>');
            }}
        />
        <span className="text-[#F3EBDD] text-[14px] font-medium leading-none pt-[1px]">免費跟進</span>
      </button>
    </div>
  );
};
