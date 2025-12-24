import React from 'react';
import { ArrowRight } from 'lucide-react';

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
    <div className="flex flex-col items-center justify-center h-full px-5 pb-10 animate-in fade-in duration-700">
      
      {/* Main Card */}
      <div 
        className="w-full max-w-sm rounded-[32px] p-2 shadow-2xl relative overflow-hidden"
        style={{
             boxShadow: '0 20px 40px -10px rgba(0,0,0,0.5)'
        }}
      >
        {/* Card Background - Translucent Dark */}
        <div 
            className="absolute inset-0 bg-gradient-to-b from-[#705C45]/80 to-[#5C4530]/90 backdrop-blur-sm"
        />
        
        {/* Card Content */}
        <div className="relative z-10 flex flex-col items-center p-5 pt-6">
             {/* Hero Image */}
            <div className="w-full aspect-[4/3] rounded-[24px] mb-6 overflow-hidden relative shadow-md">
               <img 
                 src="/2_hero-clear.jpg" 
                 alt="Living Room" 
                 className="w-full h-full object-cover"
                 onError={(e) => {
                     // Fallback if image not found
                     (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?q=80&w=800&auto=format&fit=crop';
                 }} 
               />
            </div>

            {/* Title & Subtitle */}
            <h1 className="text-[26px] font-bold text-[#EBE8E3] mb-2 text-center tracking-tight leading-tight text-shadow-sm">
              上傳你屋企相片
            </h1>
            
            <p className="text-[#D1C7B7] text-center mb-8 text-[15px] leading-relaxed max-w-[260px] font-medium">
              我會先幫你分析空間，再一步步規劃訂造方案
            </p>

            {/* Main Action Button */}
            <div className="w-full space-y-3">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-[60px] bg-gradient-to-b from-[#A69C85] to-[#8F8670] hover:from-[#968C75] hover:to-[#7F7660] text-white rounded-[20px] font-bold text-[19px] shadow-lg shadow-[#5C4530]/40 flex items-center justify-center gap-3 transition-all active:scale-95 border border-[#BDB5A3]/30"
              >
                <img src="/3_icon-camera.png" className="w-6 h-6 object-contain drop-shadow-sm" alt="Camera" />
                <span className="drop-shadow-md text-shadow-sm">開始分析</span>
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

             {/* Secondary Button / Footer */}
             <button 
                onClick={handleWhatsApp}
                className="mt-4 w-full bg-[#3E2F23]/40 hover:bg-[#3E2F23]/60 text-[#D1C7B7] py-3.5 rounded-[16px] text-[13px] font-medium flex items-center justify-between px-5 transition-colors border border-[#D1C7B7]/10"
              >
                <div className="flex items-center gap-2">
                    {/* Simple Document Icon */}
                    <img src="/3_icon-upload.png" className="w-4 h-4 object-contain opacity-80" alt="Quote" onError={(e) => (e.currentTarget.style.display = 'none')} />
                    <span>想問報價/尺寸？按右上角「免費跟進」</span>
                </div>
                <ArrowRight size={14} className="opacity-60" />
              </button>
        </div>
      </div>
    </div>
  );
};
