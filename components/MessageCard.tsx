import React from 'react';
import { Message } from '../types';

interface MessageCardProps {
  message: Message;
  onOptionClick?: (opt: string) => void;
}

export const MessageCard: React.FC<MessageCardProps> = ({ message, onOptionClick }) => {
  const isUser = message.sender === 'user';
  
  if (message.type === 'image') return null; // Images handled by PhotoCard primarily, or special card

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-6 px-4 animate-in fade-in slide-in-from-bottom-2 duration-300`}>
      <div 
        className={`
          max-w-[85%] rounded-[20px] p-4 text-[15px] leading-relaxed shadow-sm
          ${isUser 
            ? 'bg-[var(--app-primary)] text-white rounded-tr-sm' 
            : 'bg-white text-[var(--app-text-main)] rounded-tl-sm border border-[var(--app-border)]'
          }
        `}
      >
        <div className="whitespace-pre-wrap">
            {message.content}
            {/* Blinking cursor while streaming */}
            {!isUser && message.content.length > 0 && (
                <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-[var(--app-primary)] animate-pulse align-middle" style={{animationDuration: '0.8s'}}></span>
            )}
        </div>

        {/* Options / Chips */}
        {message.options && message.options.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3 pt-2 border-t border-black/5">
            {message.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => onOptionClick?.(opt)}
                className="bg-[var(--app-bg)] hover:bg-white text-[var(--app-text-main)] border border-[var(--app-border)] px-3 py-1.5 rounded-full text-xs font-medium transition-all shadow-sm active:scale-95"
              >
                {opt}
              </button>
            ))}
          </div>
        )}
        
        <div className={`text-[10px] mt-1.5 text-right ${isUser ? 'text-white/70' : 'text-black/35'}`}>
          {new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
        </div>
      </div>
    </div>
  );
};
