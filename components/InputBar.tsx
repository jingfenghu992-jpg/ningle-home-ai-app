import React, { useState, useRef } from 'react';
import { Image, Send, Camera } from 'lucide-react';

interface InputBarProps {
  onSendMessage: (text: string) => void;
  onSendImage: (file: File) => void;
}

const InputBar: React.FC<InputBarProps> = ({ onSendMessage, onSendImage }) => {
  const [input, setInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

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
    // Reset inputs
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  return (
    <div className="bg-[#2E2C29] p-3 px-4 flex items-center gap-3 z-20 border-t border-white/5">
      <div className="flex gap-2">
        <button
          onClick={() => cameraInputRef.current?.click()}
          className="p-2 text-[#8A8F79] hover:text-[#F3F0EA] hover:bg-white/10 rounded-full transition-colors"
        >
          <Camera size={24} />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-2 text-[#8A8F79] hover:text-[#F3F0EA] hover:bg-white/10 rounded-full transition-colors"
        >
          <Image size={24} />
        </button>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />
      <input
        type="file"
        ref={cameraInputRef}
        onChange={handleFileChange}
        accept="image/*"
        capture="environment"
        className="hidden"
      />

      <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="輸入你嘅問題…"
          className="flex-1 bg-[#F3F0EA]/10 text-[#EBE8E3] rounded-xl px-4 py-3 text-[16px] placeholder:text-[#EBE8E3]/40 focus:outline-none focus:ring-1 focus:ring-[#8A8F79] transition-all"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="p-2 text-[#8A8F79] disabled:opacity-50 hover:text-[#F3F0EA] hover:bg-white/10 rounded-full transition-colors"
        >
          <Send size={24} />
        </button>
      </form>
    </div>
  );
};

export default InputBar;
