import React from 'react';
import { Palette, Layers, Box, AlertTriangle, ArrowRight } from 'lucide-react';

interface RenderResultCardProps {
  imageUrl: string;
  onModify: () => void;
  onWhatsApp: () => void;
}

export const RenderResultCard: React.FC<RenderResultCardProps> = ({ imageUrl, onModify, onWhatsApp }) => {
  return (
    <div className="mx-4 my-4 bg-[#F3F0EA] rounded-[24px] overflow-hidden shadow-xl border border-white/20 animate-in fade-in zoom-in-95 duration-500">
      <div className="relative aspect-square w-full bg-black/5">
        <img src={imageUrl} alt="Generated Design" className="w-full h-full object-cover" />
      </div>
      
      <div className="p-5">
        <h3 className="text-[#4A453C] font-bold text-lg mb-2">設計效果預覽</h3>
        <p className="text-[#4A453C]/80 text-sm leading-relaxed mb-4">
          這是根據你的要求生成的初步效果圖。我們保留了原有結構，調整了材質與光線。
        </p>
        
        <div className="grid grid-cols-2 gap-3">
          <button 
            onClick={onModify}
            className="flex items-center justify-center gap-1.5 py-3 rounded-xl bg-[#EBE8E3] text-[#4A453C] font-medium text-sm hover:bg-[#E0DCD6] transition-colors"
          >
            <Palette size={16} />
            再改一次
          </button>
          <button 
            onClick={onWhatsApp}
            className="flex items-center justify-center gap-1.5 py-3 rounded-xl bg-[#8A8F79] text-white font-medium text-sm hover:bg-[#6B705C] shadow-lg shadow-[#8A8F79]/20 transition-all"
          >
            <ArrowRight size={16} />
            免費跟進
          </button>
        </div>
      </div>
    </div>
  );
};
