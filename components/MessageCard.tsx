import React from 'react';
import { Loader2 } from 'lucide-react';
import { Message } from '../types';
import { CHAT_TEXT_BASE_CLASS, CHAT_TEXT_HINT_CLASS, CHAT_TEXT_TITLE_CLASS } from '../constants';

interface MessageCardProps {
  message: Message;
  onOptionClick?: (message: Message, opt: string) => void;
}

export const MessageCard: React.FC<MessageCardProps> = ({ message, onOptionClick }) => {
  const isUser = message.sender === 'user';
  const isUploadImage = isUser && message.type === 'image';
  const isDebugPrompt = message.type === 'text' && typeof message.content === 'string' && message.content.startsWith('[[DEBUG_PROMPT]]');
  const debugBody = isDebugPrompt ? message.content.replace('[[DEBUG_PROMPT]]\n', '') : '';
  const isCardLike =
    !isUser &&
    message.type === 'text' &&
    typeof message.content === 'string' &&
    (message.content.trim().startsWith('【') || (message.options && message.options.length > 0));
  const twoCol = Array.isArray(message.options) && message.options.length === 2;
  const optionBtnClass =
    'w-full py-3 px-4 text-[14px] leading-6 font-medium rounded-xl border border-black/5 bg-white/60 hover:bg-white text-[#4A453C] transition-all shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed';
  
  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300`}>
      <div 
        className={`
          ${isCardLike ? 'w-full max-w-none' : 'max-w-[85%]'}
          rounded-[20px] p-4 shadow-sm ${CHAT_TEXT_BASE_CLASS}
          ${isUser
            ? (isUploadImage ? 'bg-[#1F4D3A] text-[#EBE8E3] rounded-tr-sm' : 'bg-[#3E3C38] text-[#EBE8E3] rounded-tr-sm')
            : 'bg-[#E6DED2] text-[#4A453C] rounded-tl-sm'}
        `}
      >
        {message.type === 'image' ? (
          <div className="max-w-xs md:max-w-sm rounded-[14px] overflow-hidden bg-black/5">
            <img src={message.content} alt="result" className="w-full h-auto object-cover" />
          </div>
        ) : (
          isDebugPrompt ? (
            <details className="whitespace-pre-wrap">
              <summary className="cursor-pointer select-none font-medium">
                调试：最终 prompt（点击展开）
              </summary>
              <div className={`mt-2 whitespace-pre-wrap ${CHAT_TEXT_HINT_CLASS}`}>
                {debugBody}
              </div>
            </details>
          ) : (
            <div className={`whitespace-pre-wrap ${isCardLike ? CHAT_TEXT_TITLE_CLASS : ''}`}>
                {message.content}
                {/* Spinner for streaming/loading */}
                {!isUser && (message.isStreaming || message.meta?.loading) && (
                  <span className="inline-flex items-center ml-1 align-middle">
                    <Loader2 size={14} className="animate-spin text-[#8A8F79]" />
                  </span>
                )}
            </div>
          )
        )}

        {/* Options / Chips */}
        {message.options && message.options.length > 0 && (
          <div className="mt-3 pt-2 border-t border-black/5">
            <div className={`grid ${twoCol ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
              {message.options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => onOptionClick?.(message, opt)}
                  className={optionBtnClass}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        )}
        
        <div className={`${CHAT_TEXT_HINT_CLASS} mt-1.5 text-right ${isUser ? 'text-white/30' : 'text-black/30'}`}>
          {new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
        </div>
      </div>
    </div>
  );
};
