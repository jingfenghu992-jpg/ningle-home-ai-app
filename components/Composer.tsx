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
    <div className="bg-[var(--app-bg)] border-t border-[var(--app-divider)] p-3 pb-6 shrink-0 z-20">
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
          className="p-3 text-[var(--app-text-muted)] hover:text-[var(--app-text-main)] hover:bg-white/70 rounded-full transition-colors disabled:opacity-50"
        >
          <ImageIcon size={24} />
        </button>
        
        <div
          className="flex-1 bg-[var(--app-surface)] rounded-[24px] border border-[var(--app-border)] focus-within:border-[var(--app-primary)]/40 transition-colors flex items-center min-h-[48px] px-4 py-2"
          style={{ boxShadow: '0 1px 0 rgba(17,24,39,0.03)' }}
        >
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="輸入訊息..."
            disabled={disabled}
            rows={1}
            className="w-full bg-transparent text-[var(--app-text-main)] placeholder-[var(--app-text-muted)]/80 outline-none resize-none text-[15px] leading-6 max-h-[120px] scrollbar-none"
          />
        </div>

        <button 
          onClick={handleSend}
          disabled={!text.trim() || disabled}
          className="p-3 text-white rounded-full shadow-sm disabled:opacity-50 transition-all"
          style={{
            backgroundColor: !text.trim() || disabled ? 'rgba(20,83,45,0.35)' : 'var(--app-primary)',
          }}
        >
          <Send size={20} className={text.trim() ? "translate-x-0.5" : ""} />
        </button>
      </div>
    </div>
  );
};
