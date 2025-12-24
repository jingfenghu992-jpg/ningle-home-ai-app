import React from 'react';
import { Camera, Image as ImageIcon, ArrowRight, StickyNote } from 'lucide-react';

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
    <div className="flex flex-col items-center justify-center h-full px-6 pb-12 animate-in fade-in duration-700">
      
      {/* Main Card */}
      <div className="relative w-full max-w-sm rounded-[38px] p-6 shadow-[0_26px_80px_rgba(0,0,0,0.60)] border border-white/14 bg-[#3b2d27]/40 backdrop-blur-2xl flex flex-col items-center">
        {/* Soft inner glow (warmer, more welcoming) */}
        <div className="absolute inset-0 rounded-[38px] bg-[radial-gradient(120%_120%_at_50%_0%,rgba(255,235,210,0.18)_0%,rgba(255,235,210,0)_60%)] pointer-events-none" />
        <div className="absolute inset-0 rounded-[38px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)] pointer-events-none" />
        
        {/* Image Placeholder */}
        <div className="relative w-full aspect-[4/3] bg-white/6 rounded-[28px] mb-6 overflow-hidden shadow-[0_12px_30px_rgba(0,0,0,0.40)] border border-white/12">
          {heroSrc ? (
            <>
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
              {/* Warm overlay to match reference */}
              <div className="absolute inset-0 bg-[radial-gradient(90%_80%_at_50%_28%,rgba(0,0,0,0)_0%,rgba(0,0,0,0.20)_60%,rgba(0,0,0,0.45)_100%)]" />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,240,220,0.06)_0%,rgba(255,240,220,0)_45%)]" />
            </>
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
        <h1 className="relative text-[40px] font-black text-[#F1E3CD] mb-3 text-center tracking-tight leading-tight drop-shadow-[0_12px_26px_rgba(0,0,0,0.55)]">
          上傳你屋企相片
        </h1>
        
        <p className="text-[#F1E3CD]/78 text-center mb-7 text-[16px] leading-relaxed max-w-[300px]">
          我會先幫你分析空間，再一步步幫你規劃訂造方案
        </p>

        {/* Main Action Button */}
        <div className="w-full space-y-4">
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="w-full bg-[#7C806A] hover:bg-[#6B705C] text-[#F7F3EA] py-4 rounded-[24px] font-bold text-[20px] shadow-[0_16px_34px_rgba(0,0,0,0.40)] flex items-center justify-center gap-3 transition-all active:scale-[0.98] border border-white/12"
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

          {/* Hint bar (inside card, like reference) */}
          <button
            onClick={handleWhatsApp}
            className="w-full rounded-[24px] bg-white/7 border border-white/12 px-4 py-3.5 text-left flex items-center gap-3 hover:bg-white/9 transition-colors"
          >
            <div className="w-10 h-10 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center text-[#F1E3CD]/90 shadow-sm">
              <StickyNote size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[#F1E3CD]/85 text-sm font-medium truncate">
                想問報價/尺寸？按右上角「免費跟進」
              </div>
            </div>
            <ArrowRight size={18} className="text-[#F1E3CD]/70 shrink-0" />
          </button>
        </div>
      </div>
    </div>
  );
};
