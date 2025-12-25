import React from 'react';
import { Upload, Sparkles, LayoutGrid, ShieldCheck, ArrowRight } from 'lucide-react';

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
    <div className="flex flex-col h-full px-5 pb-8 animate-in fade-in duration-700">
      <div className="flex-1 flex flex-col justify-center">
        <div
          className="w-full bg-[var(--app-surface)] rounded-[var(--radius-card)] border border-[var(--app-border)] p-5"
          style={{ boxShadow: 'var(--elev-1)' }}
        >
          {/* Example / Guidance */}
          <div className="w-full aspect-[4/3] rounded-[14px] overflow-hidden mb-5 relative border border-[var(--app-divider)]">
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(135deg, rgba(20,83,45,0.08), rgba(201,162,39,0.08), rgba(250,247,242,1))',
              }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
              <div className="text-[var(--app-primary)]/80 font-semibold text-sm mb-1">
                示例：客廳 / 廚房 / 睡房
              </div>
              <div className="text-[var(--app-text-muted)] text-xs leading-relaxed">
                影到主要牆身、櫃位位置同走位會更準
              </div>
            </div>
          </div>

          <h1 className="text-[30px] font-semibold text-[var(--app-text-main)] tracking-tight leading-tight">
            上傳照片，生成訂造建議
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-[var(--app-text-muted)]">
            AI 先分析空間與收納，再提供用料同預算方向（你可再補充需求）。
          </p>

          <div className="mt-5 space-y-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 text-[var(--app-primary)]">
                <LayoutGrid size={18} />
              </div>
              <div className="text-[14px] leading-relaxed text-[var(--app-text-main)]">
                支持 廚房 / 衣櫃 / 全屋訂造
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 text-[var(--app-primary)]">
                <Sparkles size={18} />
              </div>
              <div className="text-[14px] leading-relaxed text-[var(--app-text-main)]">
                自動整理重點問題同改善方向
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 text-[var(--app-primary)]">
                <ShieldCheck size={18} />
              </div>
              <div className="text-[14px] leading-relaxed text-[var(--app-text-main)]">
                你可選擇偏好：耐用 / 易打理 / 性價比
              </div>
            </div>
          </div>

          <div className="mt-6">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-4 rounded-[var(--radius-btn)] font-semibold text-[17px] text-white flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
              style={{ backgroundColor: 'var(--app-primary)', boxShadow: '0 10px 24px rgba(20,83,45,0.18)' }}
            >
              <Upload size={20} />
              上傳照片並開始分析
            </button>

            <div className="mt-3 text-center text-xs text-[var(--app-text-muted)]">
              你亦可以直接拍照上傳（手機會提示使用相機）
            </div>

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

        <button
          onClick={handleWhatsApp}
          className="mt-5 w-full flex items-center justify-center gap-2 text-sm font-semibold text-[var(--app-primary)] hover:opacity-90 transition-opacity"
        >
          <span>只想問報價/尺寸？免費跟進</span>
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};
