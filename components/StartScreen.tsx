import React from 'react';
import { Camera, Upload, ArrowRight } from 'lucide-react';

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

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 pb-20 animate-in fade-in duration-700">
      <div className="w-20 h-20 bg-[#8A8F79]/10 rounded-3xl flex items-center justify-center mb-8 shadow-sm">
        <span className="text-4xl">🏡</span>
      </div>
      
      <h1 className="text-3xl font-bold text-[#4A453C] mb-3 text-center tracking-tight">
        上傳你屋企相片
      </h1>
      
      <p className="text-[#4A453C]/70 text-center mb-10 text-[17px] leading-relaxed max-w-[280px]">
        我會先做智能分析，再一步步幫你規劃訂造方案
      </p>

      <div className="w-full max-w-xs space-y-4">
        <button 
          onClick={() => fileInputRef.current?.click()}
          className="w-full bg-[#8A8F79] hover:bg-[#6B705C] text-white py-4 rounded-[20px] font-bold text-lg shadow-xl shadow-[#8A8F79]/20 flex items-center justify-center gap-2 transition-transform active:scale-95"
        >
          <Upload size={22} />
          上傳相片
        </button>
        
        <input 
          type="file" 
          ref={fileInputRef} 
          accept="image/*" 
          className="hidden" 
          onChange={handleFileChange}
        />

        <button 
          onClick={() => fileInputRef.current?.click()} // Camera usually handled by file input on mobile
          className="w-full bg-white border border-[#EBE8E3] text-[#4A453C] py-4 rounded-[20px] font-semibold text-lg hover:bg-gray-50 flex items-center justify-center gap-2 transition-colors"
        >
          <Camera size={22} />
          拍照
        </button>
      </div>

      <div className="mt-12 text-[#4A453C]/40 text-sm flex items-center gap-1">
        想報價/度尺？右上角『免費跟進』搵我哋
        <ArrowRight size={14} />
      </div>
    </div>
  );
};
