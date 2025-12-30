import { Message } from './types';

// --- Shared chat layout/typography (UI only; do NOT change theme colors) ---
// Mobile-first: keep chat readable like WhatsApp.
// - container max-width: min(92vw, 420px) on mobile
// - widen slightly on md+
export const CHAT_MAX_CLASS = 'max-w-[min(92vw,420px)] md:max-w-[520px]';
// 12px on mobile, 16px on md+ (avoid贴边)
export const CHAT_GUTTER_CLASS = 'px-3 md:px-4';
export const CHAT_CONTAINER_CLASS = `w-full mx-auto ${CHAT_MAX_CLASS} ${CHAT_GUTTER_CLASS}`;

// Mobile-first: min 14px; main text 17px (unified); comfortable line-height.
export const CHAT_TEXT_BASE_CLASS = 'text-[17px] leading-[1.5] font-normal';
export const CHAT_TEXT_TITLE_CLASS = 'text-[17px] leading-[1.5] font-semibold text-[#2F2A23]'; // dark title, same size
export const CHAT_TEXT_HINT_CLASS = 'text-[14px] leading-5 opacity-80';

export const INITIAL_MESSAGE: Message = {
  id: 'init-1',
  type: 'text',
  content: `你好 👋  
我是宁乐家居智能助手。

你可以直接打字问我，
或者上传你家/房间的照片，
我可以帮你分析并提供订造建议 🙂`,
  sender: 'ai',
  timestamp: Date.now(),
};

// Colors (Tailwind arbitrary values reference)
// Background: #0b141a
// Header/Input: #202c33
// User Bubble: #005c4b
// Assistant Bubble: #202c33
// Text Main: #e9edef
// Text Secondary: #8696a0
// Accent Green: #00a884

// WhatsApp Configuration
const WA_NUMBER = "85256273817"; 
const WA_TEXT = "你好，我想一对一了解全屋订造设计，方便聊一下吗？";
export const WHATSAPP_LINK = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(WA_TEXT)}`;