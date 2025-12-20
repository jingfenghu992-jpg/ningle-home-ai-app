import React from 'react';
import { Message } from '../types';

interface MessageBubbleProps {
  message: Message;
  onOptionClick?: (option: string) => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onOptionClick }) => {
  const isUser = message.sender === 'user';

  return (
    <div className={`flex flex-col w-full max-w-[90%] mb-3 ${isUser ? 'self-end items-end' : 'self-start items-start'}`}>
      <div
        className={`px-4 py-3 rounded-xl relative break-words shadow-sm text-[17px] leading-[1.6] font-medium ${
          isUser
            ? 'bg-[var(--wa-user)] text-[var(--wa-text-user)] rounded-tr-none'
            : 'bg-[var(--wa-bot)] text-[var(--wa-text-bot)] rounded-tl-none'
        }`}
      >
        {message.type === 'image' ? (
          <div className="max-w-xs md:max-w-sm rounded overflow-hidden">
            <img src={message.content} alt="Upload" className="w-full h-auto object-cover" />
            {message.visionSummary && (
              <div className="mt-2 pt-1 border-t border-white/20 text-[12px] opacity-90 font-normal flex items-center gap-1">
                <span>✅</span> 圖片已分析，可直接針對畫面提問
              </div>
            )}
          </div>
        ) : (
          <div className="whitespace-pre-wrap">{message.content}</div>
        )}
        
        <div className="text-[11px] text-[var(--wa-text-secondary)] text-right mt-1 opacity-70 font-normal">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      {message.options && message.options.length > 0 && !isUser && (
        <div className="flex flex-wrap gap-2 mt-2 ml-1">
          {message.options.map((option, idx) => (
            <button
              key={idx}
              onClick={() => onOptionClick?.(option)}
              className="px-4 py-2 bg-[#2a3942] text-[var(--wa-accent)] text-[15px] font-medium rounded-full border border-[var(--wa-accent)]/30 hover:bg-[var(--wa-accent)]/10 transition-colors"
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default MessageBubble;
