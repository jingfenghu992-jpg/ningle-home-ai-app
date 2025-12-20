import { Message } from './types';

export const INITIAL_MESSAGE: Message = {
  id: 'init-1',
  type: 'text',
  content: `你好 👋  
我係寧樂家居智能助手。

你可以直接打字問我，
或者上傳你屋企／房間嘅相片，
我可以幫你分析同提供設計建議 🙂`,
  sender: 'ai',
  timestamp: Date.now(),
};

// Colors (Tailwind arbitrary values reference)
// Background: #0b141a
// Header/Input: #202c33
// User Bubble: #005c4b
// AI Bubble: #202c33
// Text Main: #e9edef
// Text Secondary: #8696a0
// Accent Green: #00a884

// WhatsApp Configuration
const WA_NUMBER = "85256273817"; 
const WA_TEXT = "你好，我想一對一了解全屋訂造設計，方便傾下嗎？";
export const WHATSAPP_LINK = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(WA_TEXT)}`;