import React from 'react';
import { Image as ImageIcon, Upload, ArrowUpRight } from 'lucide-react';

interface StartScreenProps {
  onUpload: (file: File) => void;
  onCamera: () => void;
}

export const StartScreen: React.FC<StartScreenProps> = ({ onUpload, onCamera }) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  // Prefer user-provided /public/hero.jpg; fall back to bundled /public/hero.svg; then placeholder.
  const [heroSrc, setHeroSrc] = React.useState<string | null>('/hero.jpg');

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
    <div className="flex flex-col items-center justify-center h-full px-4 pb-12 animate-in fade-in duration-700">
      
      {/* Main Card */}
      <div className="w-full max-w-sm bg-[#F3F0EA] rounded-[32px] p-6 shadow-xl border border-white/20 flex flex-col items-center">
        
        {/* Image Placeholder */}
        <div className="w-full aspect-[4/3] bg-[#EBE8E3] rounded-[24px] mb-6 overflow-hidden relative shadow-inner">
          {heroSrc ? (
            <img
              src={heroSrc}
              alt="主視覺"
              className="absolute inset-0 w-full h-full object-cover"
              onError={() => {
                // If hero.jpg is missing, fall back to hero.svg. If that also fails, show placeholder.
                setHeroSrc((prev) => (prev === '/hero.jpg' ? '/hero.svg' : null));
              }}
              loading="eager"
              decoding="async"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-black/35 text-white/90 px-4 py-2 rounded-full flex items-center gap-2 backdrop-blur-sm">
                <ImageIcon size={18} />
                <span className="text-sm font-medium">等待換上主視覺圖片</span>
              </div>
            </div>
          )}
        </div>

        {/* Title & Subtitle */}
        <h1 className="text-[28px] font-bold text-[#4A453C] mb-3 text-center tracking-tight leading-tight">
          上傳你屋企相片
        </h1>
        
        <p className="text-[#4A453C]/70 text-center mb-8 text-[16px] leading-relaxed max-w-[260px]">
          我會先幫你分析空間，再一步步幫你規劃訂造方案
        </p>

        {/* Main Action Button */}
        <div className="w-full space-y-3">
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="w-full bg-[#8A8F79] hover:bg-[#6B705C] text-white py-4 rounded-[20px] font-bold text-[18px] shadow-lg shadow-[#8A8F79]/25 flex items-center justify-center gap-2.5 transition-all active:scale-95"
          >
            <Upload size={22} />
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
        </div>
      </div>

      {/* Footer Text */}
      <button 
        onClick={handleWhatsApp}
        className="mt-8 text-[#EBE8E3]/60 text-sm flex items-center gap-1.5 hover:text-[#EBE8E3] transition-colors"
      >
        <span>想問報價/尺寸？按右上角「免費跟進」</span>
        <ArrowUpRight size={14} />
      </button>
    </div>
  );
};
