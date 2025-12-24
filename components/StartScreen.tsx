import React from 'react';
import { Camera, ArrowUpRight, Image as ImageIcon } from 'lucide-react';

interface StartScreenProps {
  onUpload: (file: File) => void;
  onCamera: () => void;
}

export const StartScreen: React.FC<StartScreenProps> = ({ onUpload, onCamera }) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onUpload(e.target.files[0]);
    }
  };

  const handleWhatsApp = () => {
    const text = encodeURIComponent('你好，我想了解全屋訂造/室內設計方案，想免費跟進一下。');
    const waLink = `https://wa.me/85256273817?text=${text}`;
    window.open(waLink, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex flex-col items-center justify-center h-full px-4 pb-10 animate-in fade-in duration-700">
      
      {/* Main Card */}
      <div className="w-full max-w-sm bg-[#F3F0EA]/95 rounded-[32px] p-5 shadow-2xl border border-white/15 flex flex-col items-center">
        
        {/* Hero Image (replace with your asset later) */}
        <div className="w-full aspect-[4/3] rounded-[24px] mb-6 overflow-hidden relative shadow-inner">
          <div className="absolute inset-0 bg-gradient-to-br from-[#c8b39e] via-[#b79d87] to-[#9a7d68]" />
          <div className="absolute inset-0 opacity-55" style={{
            background:
              "radial-gradient(800px 420px at 50% 30%, rgba(255,255,255,0.45), rgba(255,255,255,0) 55%)"
          }} />
          <div className="absolute inset-0 flex items-center justify-center text-white/70">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/20 border border-white/20">
              <ImageIcon size={18} />
              <span className="text-sm font-medium">等你換上主視覺圖片</span>
            </div>
          </div>
          {/* 你给我素材后，把上面这个占位替换成：
              <img src="..." className="absolute inset-0 w-full h-full object-cover" /> */}
        </div>

        {/* Title & Subtitle */}
        <h1 className="text-[30px] font-extrabold text-[#4A453C] mb-2 text-center tracking-tight leading-tight">
          上傳你屋企相片
        </h1>
        
        <p className="text-[#4A453C]/70 text-center mb-6 text-[15px] leading-relaxed max-w-[270px]">
          我會先幫你分析空間，再一步步幫你規劃訂造方案
        </p>

        {/* Main Action Button */}
        <div className="w-full space-y-4">
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="w-full bg-[#8A8F79] hover:bg-[#6B705C] text-white py-4 rounded-[22px] font-bold text-[18px] shadow-lg shadow-black/15 flex items-center justify-center gap-2.5 transition-all active:scale-95"
          >
            <Camera size={22} />
            開始分析
          </button>
          
          <input 
            type="file" 
            ref={fileInputRef} 
            accept="image/*" 
            capture="environment"
            className="hidden" 
            onChange={handleFileChange}
          />

          {/* Tip Bar (inside card like screenshot 2) */}
          <button
            onClick={handleWhatsApp}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-[18px] bg-[#2E2C29]/10 border border-black/10 text-[#4A453C]/80 hover:text-[#4A453C] transition-colors"
          >
            <div className="w-9 h-9 rounded-xl bg-[#8A8F79]/25 flex items-center justify-center text-[#6B705C]">
              <span className="text-lg">💬</span>
            </div>
            <div className="flex-1 text-left text-[13px] leading-snug">
              想問報價/尺寸？按右上角「免費跟進」
            </div>
            <ArrowUpRight size={16} className="opacity-70" />
          </button>
        </div>
      </div>
    </div>
  );
};
