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

  const renderSpinner = () => (
    !isUser && (message.isStreaming || message.meta?.loading) && (
      <span className="inline-flex items-center ml-1 align-middle">
        <Loader2 size={14} className="animate-spin text-[#8A8F79]" />
      </span>
    )
  );

  const renderContent = () => {
    if (message.type === 'image') {
      return (
        <div className="max-w-xs md:max-w-sm rounded-[14px] overflow-hidden bg-black/5">
          <img src={message.content} alt="result" className="w-full h-auto object-cover" />
        </div>
      );
    }

    const content = typeof message.content === 'string' ? message.content : '';
    
    // 1. Image Analysis: compact grid
    // Matches 【图片分析】 or 【圖片分析】
    if (content.includes('【圖片分析】') || content.includes('【图片分析】')) {
      const lines = content.split('\n').filter(l => l.trim());
      // First line is title
      const title = lines[0]; 
      // Rest are key-value pairs
      const items = lines.slice(1).map(l => {
        // simple split by colon
        const parts = l.split(/[:：]/);
        if (parts.length < 2) return { k: l, v: '' };
        return { k: parts[0], v: parts.slice(1).join(':') }; 
      });

      return (
        <div className="w-full">
          <div className={`${CHAT_TEXT_TITLE_CLASS} mb-1.5`}>{title}</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {items.map((item, idx) => (
              <div key={idx} className="text-[15px] leading-snug break-words"> 
                <span className="font-medium opacity-70 block text-xs mb-0.5">{item.k}</span>
                <span>{item.v}</span>
              </div>
            ))}
          </div>
          {renderSpinner()}
        </div>
      );
    }

    // 2. Layout Proposals A/B: side-by-side
    // Pattern: Has "方案 A" and "方案 B"
    if (content.includes('方案 A') && content.includes('方案 B')) {
       const lines = content.split('\n');
       // Assume title is the first line starting with 【
       const titleLine = lines.find(l => l.trim().startsWith('【')) || '';
       
       // Remove title from content to parse A/B
       let raw = content.replace(titleLine, '').trim();
       
       // Extract intro (text before "方案 A")
       let intro = '';
       const matchAStart = raw.indexOf('方案 A');
       if (matchAStart > 0) {
           intro = raw.substring(0, matchAStart).trim();
           raw = raw.substring(matchAStart);
       } else if (matchAStart === 0) {
           // No intro or intro is empty
       }

       // Split A and B
       // Regex to find "方案 B" start
       const matchB = raw.match(/(方案 B[:：]?[\s\S]*)$/);
       let contentA = '';
       let contentB = '';
       
       if (matchB) {
           const idxB = matchB.index!;
           contentA = raw.substring(0, idxB).trim(); // "方案 A..."
           contentB = matchB[1].trim(); // "方案 B..."
       } else {
           // Fallback
           contentA = raw;
       }
       
       // Helper to clean "方案 A" prefix if redundant in grid header
       const cleanPrefix = (text: string, prefix: string) => {
           return text.replace(new RegExp(`^${prefix}[:：]?\\s*`), '');
       };

       return (
         <div className="w-full">
           {titleLine && <div className={`${CHAT_TEXT_TITLE_CLASS} mb-2`}>{titleLine}</div>}
           {intro && <div className={`${CHAT_TEXT_BASE_CLASS} mb-2 text-[15px]`}>{intro}</div>}
           
           <div className="grid grid-cols-2 gap-3">
             <div className="bg-black/5 rounded-md p-2.5">
               <div className="font-semibold mb-1 text-[14px] text-black/70">方案 A</div>
               <div className="whitespace-pre-wrap text-[15px] leading-snug opacity-90">
                 {cleanPrefix(contentA, '方案 A')}
               </div>
             </div>
             <div className="bg-black/5 rounded-md p-2.5">
               <div className="font-semibold mb-1 text-[14px] text-black/70">方案 B</div>
               <div className="whitespace-pre-wrap text-[15px] leading-snug opacity-90">
                 {cleanPrefix(contentB, '方案 B')}
               </div>
             </div>
           </div>
           {renderSpinner()}
         </div>
       );
    }
    
    // 3. Design Focus / General Card with Title
    // If starts with 【, treat first line as title
    if (content.trim().startsWith('【')) {
        const firstLineEnd = content.indexOf('\n');
        if (firstLineEnd > 0) {
            const title = content.substring(0, firstLineEnd);
            const body = content.substring(firstLineEnd + 1).trim();
            return (
                <div className="w-full">
                    <div className={`${CHAT_TEXT_TITLE_CLASS} mb-1`}>{title}</div>
                    <div className={`${CHAT_TEXT_BASE_CLASS} whitespace-pre-wrap`}>{body}</div>
                    {renderSpinner()}
                </div>
            )
        }
    }

    // Default: regular text
    return (
      <div className={`whitespace-pre-wrap ${isCardLike ? CHAT_TEXT_TITLE_CLASS : CHAT_TEXT_BASE_CLASS}`}>
          {content}
          {renderSpinner()}
      </div>
    );
  };

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
          ${isUser
            ? (isUploadImage ? 'bg-[#1F4D3A] text-[#EBE8E3] rounded-tr-sm' : 'bg-[#3E3C38] text-[#EBE8E3] rounded-tr-sm')
            : 'bg-[#E6DED2] text-[#4A453C] rounded-tl-sm'}
        `}
      >
        {renderContent()}

        {/* Options */}
        {renderOptions()}
        
        <div className={`${CHAT_TEXT_HINT_CLASS} mt-1 text-[12px] text-right ${isUser ? 'text-white/30' : 'text-black/30'}`}>
          {new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
        </div>
      </div>
    </div>
  );
};
