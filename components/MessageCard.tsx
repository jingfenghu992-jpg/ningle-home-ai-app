import React from 'react';
import { Loader2 } from 'lucide-react';
import { Message } from '../types';

interface MessageCardProps {
  message: Message;
  onOptionClick?: (message: Message, opt: string) => void;
}

export const MessageCard: React.FC<MessageCardProps> = ({ message, onOptionClick }) => {
  const isUser = message.sender === 'user';
  
  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-6 px-4 animate-in fade-in slide-in-from-bottom-2 duration-300`}>
      <div 
        className={`
          max-w-[85%] rounded-[20px] p-4 text-[15px] leading-relaxed shadow-sm
          ${isUser 
            ? 'bg-[#3E3C38] text-[#EBE8E3] rounded-tr-sm' 
            : 'bg-[#E6DED2] text-[#4A453C] rounded-tl-sm'
          }
        `}
      >
        {message.type === 'image' ? (
          <div className="max-w-xs md:max-w-sm rounded-[14px] overflow-hidden bg-black/5">
            <img src={message.content} alt="result" className="w-full h-auto object-cover" />
          </div>
        ) : (
          <div className="whitespace-pre-wrap">
              {message.content}
              {/* Spinner for streaming/loading */}
              {!isUser && (message.isStreaming || message.meta?.loading) && (
                <span className="inline-flex items-center ml-1 align-middle">
                  <Loader2 size={14} className="animate-spin text-[#8A8F79]" />
                </span>
              )}
          </div>
        )}

        {/* Options / Chips */}
        {message.options && message.options.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3 pt-2 border-t border-black/5">
            {message.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => onOptionClick?.(message, opt)}
                className="bg-white/50 hover:bg-white text-[#4A453C] border border-black/5 px-3 py-1.5 rounded-full text-xs font-medium transition-all shadow-sm active:scale-95"
              >
                {opt}
              </button>
            ))}
          </div>
        )}
        
        <div className={`text-[10px] mt-1.5 text-right ${isUser ? 'text-white/30' : 'text-black/30'}`}>
          {new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
        </div>
      </div>
    </div>
  );
};
