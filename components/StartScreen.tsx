import React from 'react';
import { Camera, Upload, MessageCircle } from 'lucide-react';

interface StartScreenProps {
  onUpload: (file: File) => void;
}

export const StartScreen: React.FC<StartScreenProps> = ({ onUpload }) => {
  const WHATSAPP_NUMBER = "85256273817";
  const waText = encodeURIComponent("你好，我想了解寧樂家居一對一免費服務，麻煩跟進。謝謝！");
  const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${waText}`;

  const uploadInputRef = React.useRef<HTMLInputElement>(null);
  const cameraInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileSelected = (file: File) => {
    // Keep existing flow: inject File into the existing upload/analyze handler
    onUpload(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
    // allow re-select same file
    e.target.value = '';
  };

  const handleWhatsApp = () => {
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="min-h-[100dvh] bg-[#F5F2ED] pb-[calc(env(safe-area-inset-bottom,0px)+24px)] animate-in fade-in duration-700">
      <div className="mx-auto w-full max-w-md px-4 pt-4">
        <div className="mt-4 rounded-3xl bg-[#FFFCF7] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)] border border-black/5">
          {/* A) Title + Intro */}
          <h1 className="text-[28px] font-extrabold text-[#2F2A23] tracking-tight leading-tight">
            上傳照片，生成訂造建議
          </h1>
          <p className="mt-3 text-[#4A453C]/75 text-[16px] leading-relaxed">
            我會先分析空間與收納，再提供用料同預算方向（你可再補充需求）。
          </p>

          {/* B) Selling points */}
          <div className="mt-6 space-y-3 text-[15px] text-[#2F2A23]">
            <div className="flex gap-3">
              <div className="shrink-0">✅</div>
              <div>支持 廚房 / 衣櫃 / 全屋訂造</div>
            </div>
            <div className="flex gap-3">
              <div className="shrink-0">✅</div>
              <div>自動整理重點問題同改善方向</div>
            </div>
            <div className="flex gap-3">
              <div className="shrink-0">✅</div>
              <div>你可選擇偏好：耐用 / 易打理 / 性價比</div>
            </div>
          </div>

          {/* C) CTA buttons (inside same card) */}
          <div className="mt-7 space-y-3 mb-1">
            {/* Hidden inputs */}
            <input
              type="file"
              ref={cameraInputRef}
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileChange}
            />
            <input
              type="file"
              ref={uploadInputRef}
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />

            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="w-full bg-[#1F4D3A] hover:bg-[#173C2D] text-white py-4 rounded-2xl font-extrabold text-[17px] shadow-md active:scale-[0.99] transition-transform flex items-center justify-center gap-2"
            >
              <Camera size={20} />
              直接拍攝並開始分析
            </button>

            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              className="w-full bg-[#1F4D3A] hover:bg-[#173C2D] text-white py-4 rounded-2xl font-extrabold text-[17px] shadow-md active:scale-[0.99] transition-transform flex items-center justify-center gap-2"
            >
              <Upload size={20} />
              上傳相片並開始分析
            </button>

            <button
              type="button"
              onClick={handleWhatsApp}
              className="w-full bg-[#DCE9E2] hover:bg-[#CFE2D8] text-[#1F4D3A] py-3.5 rounded-2xl font-semibold text-[15px] active:scale-[0.99] transition-transform flex items-center justify-center gap-2"
            >
              <MessageCircle size={18} />
              想了解更多／一對一免費服務（WhatsApp）
            </button>
          </div>

          {/* D) Bottom hint text (must be visible) */}
          <div className="mt-4 text-center text-xs text-[#4A453C]/65 leading-relaxed">
            iPhone/Android 均可用：按「直接拍攝」會開相機；按「上傳相片」會開相簿/檔案。WhatsApp 會以預填訊息向我哋免費跟進。
          </div>
        </div>
      </div>
    </div>
  );
};
