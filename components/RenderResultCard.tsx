import React from 'react';
import { Palette, Layers, Box, AlertTriangle, ArrowRight } from 'lucide-react';

interface RenderResultCardProps {
  imageUrl: string;
  onModify: () => void;
  onWhatsApp: () => void;
}

export const RenderResultCard: React.FC<RenderResultCardProps> = ({ imageUrl, onModify, onWhatsApp }) => {
  return (
    <div className="mx-4 my-4 bg-white rounded-[16px] overflow-hidden border border-[var(--app-border)] animate-in fade-in zoom-in-95 duration-500" style={{ boxShadow: 'var(--elev-1)' }}>
      <div className="relative aspect-square w-full bg-black/5">
        <img src={imageUrl} alt="Generated Design" className="w-full h-full object-cover" />
      </div>
      
      <div className="p-5">
        <h3 className="text-[var(--app-text-main)] font-bold text-lg mb-2">設計效果預覽</h3>
        <p className="text-[var(--app-text-muted)] text-sm leading-relaxed mb-4">
          這是根據你的要求生成的初步效果圖。我們保留了原有結構，調整了材質與光線。
        </p>
        
        <div className="grid grid-cols-2 gap-3">
          <button 
            onClick={onModify}
            className="flex items-center justify-center gap-1.5 py-3 rounded-xl bg-[var(--app-bg)] text-[var(--app-text-main)] font-semibold text-sm hover:bg-white transition-colors border border-[var(--app-border)]"
          >
            <Palette size={16} />
            再改一次
          </button>
          <button 
            onClick={onWhatsApp}
            className="flex items-center justify-center gap-1.5 py-3 rounded-xl text-white font-semibold text-sm transition-all active:scale-[0.99]"
            style={{ backgroundColor: 'var(--app-primary)', boxShadow: '0 10px 24px rgba(20,83,45,0.18)' }}
          >
            <ArrowRight size={16} />
            免費跟進
          </button>
        </div>
      </div>
    </div>
  );
};
