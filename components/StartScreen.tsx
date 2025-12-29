import React from 'react';
import { Camera, Upload, MessageCircle } from 'lucide-react';
import { CHAT_GUTTER_CLASS, CHAT_MAX_CLASS, CHAT_TEXT_HINT_CLASS, WHATSAPP_LINK } from '../constants';

interface StartScreenProps {
  onUpload: (file: File) => void;
}

export const StartScreen: React.FC<StartScreenProps> = ({ onUpload }) => {
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
    window.open(WHATSAPP_LINK, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="min-h-[100dvh] bg-[#F5F2ED] pb-[calc(env(safe-area-inset-bottom,0px)+24px)] animate-in fade-in duration-700">
      <div className={`mx-auto w-full ${CHAT_MAX_CLASS} ${CHAT_GUTTER_CLASS} pt-4`}>
        <div className="mt-4 rounded-3xl bg-[#FFFCF7] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.08)] border border-black/5">
          {/* A) Title + Intro */}
          <h1 className="text-[28px] font-extrabold text-[#2F2A23] tracking-tight leading-tight">
            上传照片，生成订造建议
          </h1>
          <p className="mt-3 text-[#4A453C]/75 text-[14px] leading-6">
            我会先整理空间与收纳重点，再按你的需要给出改善方向（你也可以补充需求）。
          </p>

          {/* B) Selling points */}
          <div className="mt-6 space-y-3 text-[14px] leading-6 text-[#2F2A23]">
            <div className="flex gap-3">
              <div className="shrink-0">✅</div>
              <div>支持 厨房 / 衣柜 / 全屋订造</div>
            </div>
            <div className="flex gap-3">
              <div className="shrink-0">✅</div>
              <div>自动整理重点问题和改善方向</div>
            </div>
            <div className="flex gap-3">
              <div className="shrink-0">✅</div>
              <div>你可选择偏好：耐用 / 易打理 / 性价比</div>
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
              className="w-full bg-[#1F4D3A] hover:bg-[#173C2D] text-white h-11 rounded-2xl font-semibold text-[14px] leading-5 shadow-md active:scale-[0.99] transition-transform flex items-center justify-center gap-2"
            >
              <Camera size={20} />
              直接拍摄并开始分析
            </button>

            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              className="w-full bg-[#1F4D3A] hover:bg-[#173C2D] text-white h-11 rounded-2xl font-semibold text-[14px] leading-5 shadow-md active:scale-[0.99] transition-transform flex items-center justify-center gap-2"
            >
              <Upload size={20} />
              上传相片并开始分析
            </button>

            <button
              type="button"
              onClick={handleWhatsApp}
              className="w-full bg-[#DCE9E2] hover:bg-[#CFE2D8] text-[#1F4D3A] h-11 rounded-2xl font-semibold text-[14px] leading-5 active:scale-[0.99] transition-transform flex items-center justify-center gap-2"
            >
              <MessageCircle size={18} />
              想了解更多 / 一对一免费服务（WhatsApp）
            </button>
          </div>

          {/* D) Bottom hint text (must be visible) */}
          <div className={`mt-4 text-center ${CHAT_TEXT_HINT_CLASS} text-[#4A453C]/75`}>
            iPhone/Android 都得：点「直接拍摄」会开相机；点「上传相片」会开相册/文件。WhatsApp 会带预填消息。
          </div>
        </div>
      </div>
    </div>
  );
};
