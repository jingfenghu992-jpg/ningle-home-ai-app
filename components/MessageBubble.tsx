import React from 'react';
import { Message } from '../types';

interface MessageBubbleProps {
  message: Message;
  onOptionClick?: (option: string) => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onOptionClick }) => {
  const isUser = message.sender === 'user';

  return (
    <div className={`flex flex-col w-full max-w-[85%] mb-2 ${isUser ? 'self-end items-end' : 'self-start items-start'}`}>
      <div
        className={`px-3 py-2 rounded-lg relative break-words text-sm md:text-base shadow-sm ${
          isUser
            ? 'bg-[var(--wa-bubble-user)] text-[var(--wa-text-main)] rounded-tr-none'
            : 'bg-[var(--wa-bubble-ai)] text-[var(--wa-text-main)] rounded-tl-none'
        }`}
      >
        {message.type === 'image' ? (
          <div className="max-w-xs md:max-w-sm rounded overflow-hidden">
            <img src={message.content} alt="Upload" className="w-full h-auto object-cover" />
          </div>
        ) : (
          <div className="whitespace-pre-wrap">{message.content}</div>
        )}
        
        <div className="text-[10px] text-[var(--wa-text-secondary)] text-right mt-1 opacity-70">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      {message.options && message.options.length > 0 && !isUser && (
        <div className="flex flex-wrap gap-2 mt-2 ml-1">
          {message.options.map((option, idx) => (
            <button
              key={idx}
              onClick={() => onOptionClick?.(option)}
              className="px-3 py-1.5 bg-[#2a3942] text-[var(--wa-accent)] text-sm rounded-full border border-[var(--wa-accent)]/30 hover:bg-[var(--wa-accent)]/10 transition-colors"
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
