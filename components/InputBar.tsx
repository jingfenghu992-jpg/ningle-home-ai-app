import React, { useState, useRef } from 'react';
import { Image, Send } from 'lucide-react';

interface InputBarProps {
  onSendMessage: (text: string) => void;
  onSendImage: (file: File) => void;
}

const InputBar: React.FC<InputBarProps> = ({ onSendMessage, onSendImage }) => {
  const [input, setInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSendMessage(input);
    setInput('');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onSendImage(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="bg-[var(--wa-header)] p-2 px-4 flex items-center gap-2 z-20">
      <button
        onClick={() => fileInputRef.current?.click()}
        className="p-2 text-[var(--wa-text-secondary)] hover:text-[var(--wa-text-main)] transition-colors"
      >
        <Image size={24} />
      </button>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />
      <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="輸入訊息..."
          className="flex-1 bg-[#2a3942] text-[var(--wa-text-main)] rounded-lg px-4 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--wa-accent)]"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="p-2 text-[var(--wa-accent)] disabled:opacity-50 hover:bg-[#2a3942] rounded-full transition-colors"
        >
          <Send size={24} />
        </button>
      </form>
    </div>
  );
};

export default InputBar;
