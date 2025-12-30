import React from 'react';
import { Loader2 } from 'lucide-react';
import { Message } from '../types';
import { CHAT_TEXT_BASE_CLASS, CHAT_TEXT_HINT_CLASS, CHAT_TEXT_TITLE_CLASS } from '../constants';
import { OptionChip } from './OptionChip';
import { PrimaryActionButton } from './PrimaryActionButton';

interface MessageCardProps {
  message: Message;
  onOptionClick?: (message: Message, opt: string) => void;
}

export const MessageCard: React.FC<MessageCardProps> = ({ message, onOptionClick }) => {
  const isUser = message.sender === 'user';
  const isUploadImage = isUser && message.type === 'image';
  const isCardLike =
    !isUser &&
    message.type === 'text' &&
    typeof message.content === 'string' &&
    (message.content.trim().startsWith('【') || (message.options && message.options.length > 0));
  const options = Array.isArray(message.options) ? message.options : [];
  const isCTA = (opt: string) => /出图|出圖|开始生成|開始生成|生成效果图|生成效果圖/.test(String(opt || ''));
  const isGroupOpt = (opt: string) => /^(风格|目标|强度|風格|目標|強度)：/.test(String(opt || '').trim());
  const stripRadioPrefix = (opt: string) =>
    String(opt || '')
      .replace(/^(风格|目标|强度|風格|目標|強度)：\s*[◉○]\s*/g, '')
      .trim();
  const isSelected = (opt: string) => String(opt || '').includes('◉');

  const renderOptions = () => {
    if (!options.length) return null;

    // CTA button (single prominent action) — keep as full width but only this one.
    const ctas = options.filter(isCTA);
    const nonCtas = options.filter(o => !isCTA(o));

    const grouped =
      nonCtas.length > 0 && nonCtas.every(isGroupOpt)
        ? nonCtas.reduce((acc: Record<string, string[]>, raw) => {
            const m = String(raw).match(/^(风格|目标|强度|風格|目標|強度)：/);
            const k = m ? m[1] : '选项';
            acc[k] = acc[k] || [];
            acc[k].push(raw);
            return acc;
          }, {})
        : null;

    // Space pick / generic: Flow layout (wrap) for compact height
    if (!grouped) {
      return (
        <div className="mt-2.5 pt-2 border-t border-black/5">
          {nonCtas.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {nonCtas.map((opt, i) => (
                <OptionChip
                  key={`${i}-${opt}`}
                  label={stripRadioPrefix(opt)}
                  selected={isSelected(opt)}
                  onClick={() => onOptionClick?.(message, opt)}
                />
              ))}
            </div>
          )}
          {ctas.length > 0 && (
            <div className="mt-2">
              {ctas.map((opt, i) => (
                <PrimaryActionButton
                  key={`cta-${i}-${opt}`}
                  label={opt}
                  onClick={() => onOptionClick?.(message, opt)}
                />
              ))}
            </div>
          )}
        </div>
      );
    }

    // Grouped (style/goal/intensity): headings + chips (horizontal flow)
    const order = ['風格', '风格', '目標', '目标', '強度', '强度'];
    const keys = Object.keys(grouped).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return (
      <div className="mt-2.5 pt-2 border-t border-black/5 space-y-2">
        {keys.map(k => (
          <div key={k} className="flex items-baseline gap-2 flex-wrap">
            <span className={`shrink-0 ${CHAT_TEXT_HINT_CLASS} font-medium mr-1`}>{k}</span>
            <div className="flex flex-wrap gap-2 items-center">
              {(grouped[k] || []).map((opt, i) => (
                <OptionChip
                  key={`${k}-${i}-${opt}`}
                  label={stripRadioPrefix(opt)}
                  selected={isSelected(opt)}
                  onClick={() => onOptionClick?.(message, opt)}
                />
              ))}
            </div>
          </div>
        ))}
        {ctas.length > 0 && (
          <div className="pt-1">
            {ctas.map((opt, i) => (
              <PrimaryActionButton
                key={`cta-${i}-${opt}`}
                label={opt}
                onClick={() => onOptionClick?.(message, opt)}
              />
            ))}
          </div>
        )}
      </div>
    );
  };
  
  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-3 animate-in fade-in slide-in-from-bottom-2 duration-300`}>
      <div
        className={`
          ${isCardLike ? 'w-full max-w-none nl-card px-3.5 py-3' : 'max-w-[85%] nl-bubble px-3 py-2'} 
          ${CHAT_TEXT_BASE_CLASS}
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
          <div className={`whitespace-pre-wrap ${isCardLike ? CHAT_TEXT_TITLE_CLASS : ''}`}>
              {message.content}
              {/* Spinner for streaming/loading */}
              {!isUser && (message.isStreaming || message.meta?.loading) && (
                <span className="inline-flex items-center ml-1 align-middle">
                  <Loader2 size={14} className="animate-spin text-[#8A8F79]" />
                </span>
              )}
          </div>
        )}

        {/* Options */}
        {renderOptions()}
        
        <div className={`${CHAT_TEXT_HINT_CLASS} mt-1 text-[12px] text-right ${isUser ? 'text-white/30' : 'text-black/30'}`}>
          {new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
        </div>
      </div>
    </div>
  );
};
