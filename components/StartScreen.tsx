import React from 'react';

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
    const text = encodeURIComponent('我想免費了解全屋訂造／收納方案，方便了解嗎？');
    const waLink = `https://wa.me/85256273817?text=${text}`;
    window.open(waLink, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex flex-col items-center justify-center h-full px-4 pb-12 animate-in fade-in duration-700">
      
      {/* Main Card */}
      <div 
        className="w-full max-w-[420px] flex flex-col items-center backdrop-blur-[10px]"
        style={{
             padding: '18px',
             borderRadius: '28px',
             backgroundColor: 'rgba(243,235,221,0.10)',
             border: '1px solid rgba(255,255,255,0.14)',
             boxShadow: '0 20px 60px rgba(0,0,0,0.35)'
        }}
      >
        
        {/* Hero Image */}
        <div className="w-full relative shadow-sm overflow-hidden" style={{ borderRadius: '18px', height: 'clamp(160px, 25vh, 190px)' }}>
            <img 
                src="/ui/hero-room.png" 
                alt="Living Room" 
                className="w-full h-full object-cover"
                onError={(e) => {
                    (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?q=80&w=800&auto=format&fit=crop';
                }} 
            />
            {/* Inner Shadow for blend */}
            <div className="absolute inset-0 shadow-[inset_0_-10px_20px_rgba(0,0,0,0.1)] pointer-events-none rounded-[18px]" />
        </div>

        {/* Content Container */}
        <div className="w-full flex flex-col items-center pt-6 pb-2 px-1">

            {/* Title */}
            <h1 className="mb-3 text-center tracking-tight leading-[1.1]"
                style={{
                    fontSize: 'clamp(26px, 3.2vw, 32px)',
                    fontWeight: 800,
                    color: '#F3EBDD'
                }}
            >
              上傳你屋企相片
            </h1>
            
            {/* Subtitle */}
            <p className="text-center mb-8 leading-relaxed max-w-[280px]"
                style={{
                    fontSize: '15px',
                    fontWeight: 500,
                    color: 'rgba(243,235,221,0.85)'
                }}
            >
              我會先幫你分析空間，再一步步幫你規劃訂造方案
            </p>

            {/* Main Action Button */}
            <div className="w-full mb-4">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] hover:bg-[#9A9378]"
                style={{
                    height: '52px',
                    backgroundColor: '#8D876E',
                    borderRadius: '16px',
                    color: '#FFFFFF',
                    fontSize: '16px',
                    fontWeight: 700,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                }}
              >
                <img 
                    src="/ui/icon-camera.png" 
                    className="w-[18px] h-[18px] object-contain" 
                    alt="Camera" 
                    onError={(e) => {
                         // Fallback SVG
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.parentElement?.insertAdjacentHTML('afterbegin', '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>');
                    }}
                />
                <span>開始分析</span>
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

             {/* Footer Prompt Bar */}
             <button 
                onClick={handleWhatsApp}
                className="w-full flex items-center justify-between transition-colors hover:bg-black/25"
                style={{
                    backgroundColor: 'rgba(0,0,0,0.18)',
                    borderRadius: '14px',
                    padding: '12px 12px',
                    color: 'rgba(243,235,221,0.85)',
                    fontSize: '13px',
                    fontWeight: 400
                }}
              >
                <span>想問報價／尺寸？按右上角『免費跟進』</span>
                <span className="opacity-70 text-[16px] font-light">→</span>
              </button>
        </div>
      </div>
    </div>
  );
};
