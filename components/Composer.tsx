import React, { useRef, useEffect, useState } from 'react';
import { Send, Image as ImageIcon, Camera } from 'lucide-react';

interface ComposerProps {
  onSendMessage: (text: string) => void;
  onSendImage: (file: File) => void;
  disabled?: boolean;
}

export const Composer: React.FC<ComposerProps> = ({ onSendMessage, onSendImage, disabled }) => {
  const [text, setText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!text.trim() || disabled) return;
    onSendMessage(text.trim());
    setText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onSendImage(e.target.files[0]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [text]);

  return (
    <div className="bg-[#2E2C29] border-t border-white/10 p-3 pb-6 shrink-0 z-20">
      <div className="max-w-md mx-auto flex items-end gap-2">
        <input 
          type="file" 
          ref={fileInputRef} 
          accept="image/*" 
          className="hidden" 
          onChange={handleFileChange}
        />
        <input 
          type="file" 
          ref={cameraInputRef} 
          accept="image/*" 
          capture="environment"
          className="hidden" 
          onChange={handleFileChange}
        />
        
        <button 
          onClick={() => cameraInputRef.current?.click()}
          disabled={disabled}
          className="p-3 text-[#EBE8E3]/60 hover:text-[#EBE8E3] hover:bg-white/5 rounded-full transition-colors disabled:opacity-50"
        >
          <Camera size={24} />
        </button>

        <button 
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="p-3 text-[#EBE8E3]/60 hover:text-[#EBE8E3] hover:bg-white/5 rounded-full transition-colors disabled:opacity-50"
        >
          <ImageIcon size={24} />
        </button>
        
        <div className="flex-1 bg-[#1B1917] rounded-[24px] border border-white/10 focus-within:border-[#8A8F79]/50 transition-colors flex items-center min-h-[48px] px-4 py-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="輸入訊息..."
            disabled={disabled}
            rows={1}
            className="w-full bg-transparent text-[#EBE8E3] placeholder-white/30 outline-none resize-none text-[15px] leading-6 max-h-[120px] scrollbar-none"
          />
        </div>

        <button 
          onClick={handleSend}
          disabled={!text.trim() || disabled}
          className="p-3 bg-[#8A8F79] hover:bg-[#6B705C] text-white rounded-full shadow-lg disabled:opacity-50 disabled:bg-white/10 transition-all"
        >
          <Send size={20} className={text.trim() ? "translate-x-0.5" : ""} />
        </button>
      </div>
    </div>
  );
};
