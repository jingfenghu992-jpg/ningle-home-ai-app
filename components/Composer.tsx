import React, { useRef, useEffect, useState } from 'react';
import { Send, Image as ImageIcon } from 'lucide-react';

interface ComposerProps {
  onSendMessage: (text: string) => void;
  onSendImage: (file: File) => void;
  disabled?: boolean;
}

export const Composer: React.FC<ComposerProps> = ({ onSendMessage, onSendImage, disabled }) => {
  const [text, setText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [text]);

  return (
    <div className="bg-[#3E3C38] border-t border-black/5 px-3 pt-2.5 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] shrink-0 z-20 shadow-[0_-10px_30px_rgba(0,0,0,0.10)] backdrop-blur supports-[backdrop-filter]:bg-[#3E3C38]/90">
      <div className="max-w-md mx-auto flex items-end gap-2">
        <input 
          type="file" 
          ref={fileInputRef} 
          accept="image/*" 
          className="hidden" 
          onChange={handleFileChange}
        />
        <button 
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="p-3 text-[#1F4D3A] hover:bg-black/5 rounded-full transition-colors disabled:opacity-40"
        >
          <ImageIcon size={24} />
        </button>
        
        <div className="flex-1 bg-white/70 rounded-[24px] border border-black/10 focus-within:border-[#1F4D3A]/35 transition-colors flex items-center min-h-[48px] px-4 py-2 shadow-sm">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息…"
            disabled={disabled}
            rows={1}
            className="w-full bg-transparent text-[#2F2A23] placeholder:text-[#4A453C]/55 outline-none resize-none text-[15px] leading-6 max-h-[120px] scrollbar-none"
          />
        </div>

        <button 
          onClick={handleSend}
          disabled={!text.trim() || disabled}
          className="p-3 bg-[#1F4D3A] hover:bg-[#173C2D] text-white rounded-full shadow-md disabled:opacity-50 disabled:bg-black/10 transition-all"
        >
          <Send size={20} className={text.trim() ? "translate-x-0.5" : ""} />
        </button>
      </div>
    </div>
  );
};
