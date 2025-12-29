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

  const chipClassBase =
    'inline-flex items-center justify-center h-10 px-3 text-[14px] leading-6 font-medium rounded-xl border border-black/5 transition-all shadow-sm active:scale-95';
  const chipClass = (selected: boolean) =>
    `${chipClassBase} ${selected ? 'bg-white text-[#4A453C]' : 'bg-white/60 hover:bg-white text-[#4A453C]'}`;
  const ctaClass =
    'w-full h-11 px-4 text-[14px] leading-6 font-medium rounded-xl border border-black/10 bg-white/80 hover:bg-white text-[#4A453C] transition-all shadow-sm active:scale-95';

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

    // Space pick / generic: 2-col grid of chips, not full-width.
    if (!grouped) {
      const useGrid = nonCtas.length >= 4 || nonCtas.length === 2;
      return (
        <div className="mt-3 pt-2 border-t border-black/5">
          {nonCtas.length > 0 && (
            <div className={useGrid ? 'grid grid-cols-2 gap-2 justify-items-start' : 'flex flex-wrap gap-2'}>
              {nonCtas.map((opt, i) => (
                <button
                  key={`${i}-${opt}`}
                  onClick={() => onOptionClick?.(message, opt)}
                  className={`${chipClass(isSelected(opt))} min-w-[140px] w-auto`}
                >
                  {stripRadioPrefix(opt)}
                </button>
              ))}
            </div>
          )}
          {ctas.length > 0 && (
            <div className="mt-2">
              {ctas.map((opt, i) => (
                <button key={`cta-${i}-${opt}`} onClick={() => onOptionClick?.(message, opt)} className={ctaClass}>
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    // Grouped (style/goal/intensity): headings + chips.
    const order = ['風格', '风格', '目標', '目标', '強度', '强度'];
    const keys = Object.keys(grouped).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return (
      <div className="mt-3 pt-2 border-t border-black/5 space-y-3">
        {keys.map(k => (
          <div key={k}>
            <div className={`mb-2 ${CHAT_TEXT_HINT_CLASS}`}>{k}</div>
            <div className="flex flex-wrap gap-2">
              {(grouped[k] || []).map((opt, i) => (
                <button
                  key={`${k}-${i}-${opt}`}
                  onClick={() => onOptionClick?.(message, opt)}
                  className={`${chipClass(isSelected(opt))} min-w-[140px] w-auto`}
                >
                  {stripRadioPrefix(opt)}
                </button>
              ))}
            </div>
          </div>
        ))}
        {ctas.length > 0 && (
          <div>
            {ctas.map((opt, i) => (
              <button key={`cta-${i}-${opt}`} onClick={() => onOptionClick?.(message, opt)} className={ctaClass}>
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };
  
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
        
        <div className={`${CHAT_TEXT_HINT_CLASS} mt-1.5 text-right ${isUser ? 'text-white/30' : 'text-black/30'}`}>
          {new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
        </div>
      </div>
    </div>
  );
};
