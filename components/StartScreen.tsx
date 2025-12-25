import React from 'react';
import { Camera, Upload, ArrowUpRight } from 'lucide-react';

interface StartScreenProps {
  onUpload: (file: File) => void;
}

const DEMO_IMAGE_SRC = '/warm-hk-living-dining.jpg';

export const StartScreen: React.FC<StartScreenProps> = ({ onUpload }) => {
  const galleryInputRef = React.useRef<HTMLInputElement>(null);
  const cameraInputRef = React.useRef<HTMLInputElement>(null);
  const [heroImageOk, setHeroImageOk] = React.useState(true);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onUpload(e.target.files[0]);
    }
    // allow re-select same file
    e.target.value = '';
  };

  const handleWhatsApp = () => {
    const text = encodeURIComponent('你好，我想了解全屋訂造/室內設計方案，想免費跟進一下。');
    const waLink = `https://wa.me/85256273817?text=${text}`;
    window.open(waLink, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex-1 w-full overflow-y-auto overflow-x-hidden px-4 pt-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))] animate-in fade-in duration-700">
      <div className="flex flex-col items-center">
        {/* Main Card */}
        <div className="w-full max-w-sm bg-[#F3F0EA] rounded-[32px] p-6 shadow-xl border border-white/20 flex flex-col items-center">
          {/* Image */}
          <div className="w-full mb-3">
            <div className="text-[#4A453C]/70 text-sm font-medium mb-2">溫馨香港客餐廳示意圖</div>
            <div className="w-full aspect-[4/3] bg-[#EBE8E3] rounded-[24px] overflow-hidden relative shadow-inner">
              {heroImageOk ? (
                <img
                  src={DEMO_IMAGE_SRC}
                  alt="溫馨香港客餐廳示意圖"
                  className="w-full h-full object-cover"
                  onError={() => setHeroImageOk(false)}
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-[#8A8F79]/40">
                  <div className="w-12 h-12 rounded-2xl bg-white/40 flex items-center justify-center">
                    <Camera size={22} />
                  </div>
                  <div className="mt-3 text-xs text-[#4A453C]/60 text-center px-6 leading-relaxed">
                    示意圖未載入。請把圖片放到 <span className="font-mono">public/warm-hk-living-dining.jpg</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Title & Subtitle */}
          <h1 className="text-[28px] font-bold text-[#4A453C] mb-3 text-center tracking-tight leading-tight">
            上傳照片，生成訂造建議
          </h1>

          <p className="text-[#4A453C]/70 text-center mb-6 text-[16px] leading-relaxed max-w-[280px]">
            我會先分析空間與收納，再提供用料同預算方向（你可再補充需求）。
          </p>

          {/* Bullets */}
          <div className="w-full text-[#4A453C]/80 text-[14px] space-y-2 mb-6">
            <div className="flex items-start gap-2">
              <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#8A8F79]" />
              <div>支持 廚房 / 衣櫃 / 全屋訂造</div>
            </div>
            <div className="flex items-start gap-2">
              <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#8A8F79]" />
              <div>自動整理重點問題同改善方向</div>
            </div>
            <div className="flex items-start gap-2">
              <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#8A8F79]" />
              <div>你可選擇偏好：耐用 / 易打理 / 性價比</div>
            </div>
          </div>

          {/* Main Action Button */}
          <div className="w-full space-y-3">
            <button
              onClick={() => galleryInputRef.current?.click()}
              className="w-full bg-[#8A8F79] hover:bg-[#6B705C] text-white py-4 rounded-[20px] font-bold text-[18px] shadow-lg shadow-[#8A8F79]/25 flex items-center justify-center gap-2.5 transition-all active:scale-95"
            >
              <Upload size={22} />
              上傳照片並開始分析
            </button>

            {/* Gallery/Files (no capture => allow both) */}
            <input
              type="file"
              ref={galleryInputRef}
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />

            {/* Camera-only fallback (some WebViews need explicit capture) */}
            <input
              type="file"
              ref={cameraInputRef}
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileChange}
            />

            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="w-full bg-white/60 hover:bg-white text-[#4A453C] py-3 rounded-[18px] font-medium text-[15px] flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              <Camera size={18} />
              直接拍照上傳
            </button>
          </div>

          <div className="mt-4 text-xs text-[#4A453C]/55 text-center">
            你亦可以直接拍照上傳（手機會提示使用相機）
          </div>
        </div>

        {/* Footer Text */}
        <button
          onClick={handleWhatsApp}
          className="mt-6 text-[#EBE8E3]/70 text-sm flex items-center gap-1.5 hover:text-[#EBE8E3] transition-colors"
        >
          <span>只想問報價/尺寸？免費跟進</span>
          <ArrowUpRight size={14} />
        </button>
      </div>
    </div>
  );
};
