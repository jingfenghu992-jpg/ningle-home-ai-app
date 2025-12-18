import { chatAPIStream, ChatMessage } from '../api/chat';

// ---- Design Prompt Logic (Fix D: Split responsibilities) ----

export function parseDesignImageInstruction(text: string): { finalPrompt: string | null; safeUserText: string } {
  const full = text || '';
  let finalPrompt: string | null = null;

  // 优先命中包含 FINAL_IMAGE_PROMPT 區塊嘅情況
  const finalIdx = full.indexOf('FINAL_IMAGE_PROMPT:');
  if (finalIdx !== -1) {
    const selfIdx = full.indexOf('PROMPT_SELF_CHECK:', finalIdx);
    const endIdx = selfIdx !== -1 ? selfIdx : full.length;
    const finalBlock = full.slice(finalIdx, endIdx);

    let m = finalBlock.match(/\[PROMPT:\s*([\s\S]*?)\]/i);
    if (!m) {
      m = finalBlock.match(/PROMPT:\s*([^\n]+)/i);
    }
    if (m && m[1]) {
      finalPrompt = m[1].trim();
    }
  }

  // 後備：只根據 <<<GENERATE_IMAGE>>> + PROMPT 行做解析
  if (!finalPrompt && full.includes('<<<GENERATE_IMAGE>>>')) {
    let m = full.match(/\[PROMPT:\s*([\s\S]*?)\]/i);
    if (!m) {
      m = full.match(/PROMPT:\s*([^\n]+)/i);
    }
    if (m && m[1]) {
      finalPrompt = m[1].trim();
    }
  }

  // safeUserText：移除 FINAL_IMAGE_PROMPT / PROMPT_SELF_CHECK / PROMPT 行 / 生成標記
  let safe = full;
  safe = safe.replace(/FINAL_IMAGE_PROMPT:[\s\S]*?(PROMPT_SELF_CHECK:|$)/i, '$1');
  safe = safe.replace(/PROMPT_SELF_CHECK:[\s\S]*$/i, '');
  safe = safe.replace(/\[PROMPT:[\s\S]*?]/i, '');
  safe = safe.replace(/PROMPT:\s*[^\n]+/i, '');
  safe = safe.replace(/<<<GENERATE_IMAGE>>>/g, '');
  safe = safe.trim();

  return { finalPrompt, safeUserText: safe };
}

// Fix A: Relaxed prompt validation
export function validateImagePrompt(promptText: string, fullText: string): boolean {
  if (!promptText || promptText.trim().length < 20) return false; // Relaxed length check
  const lower = (promptText + '\n' + fullText).toLowerCase();

  // Hard conditions only
  const hasCamera =
    lower.includes('same camera angle') || lower.includes('same viewpoint') || lower.includes('same view');
  const hasWindow =
    lower.includes('same window positions') ||
    lower.includes('same window') ||
    lower.includes('keep all windows');
  const hasDoNotChange = lower.includes('do not change');
  
  // Relaxed negative constraints
  const hasNoPeople = lower.includes('no people');
  const hasNoText = lower.includes('no text');
  // const hasNoWatermark = lower.includes('no watermark'); // Can be implicit or less strict

  // if (!hasCamera || !hasWindow || !hasDoNotChange || !hasNoPeople || !hasNoText) {
  //   return false;
  // }
  
  // Keep it simpler as per instructions:
  // "same camera angle / same viewpoint", "same window positions", "do not change", "no people / no text / no watermark"
  
  const missing = [];
  if (!hasCamera) missing.push('camera');
  if (!hasWindow) missing.push('window');
  if (!hasDoNotChange) missing.push('doNotChange');
  if (!hasNoPeople) missing.push('noPeople');
  if (!hasNoText) missing.push('noText');
  
  if (missing.length > 0) {
      console.warn('[validateImagePrompt] Missing constraints:', missing);
      return false;
  }

  return true;
}

export async function* chatWithDeepseekStream(params: {
  mode: string;
  text: string;
  messages: ChatMessage[];
  visionSummary?: string;
}): AsyncGenerator<string, void, unknown> {
  const { mode, text, messages, visionSummary } = params;

  // Construct final messages array
  const apiMessages: ChatMessage[] = [...messages];
  
  // Add current user message if not already in history (handled by App usually, but ensuring)
  // Actually App.tsx passes 'messages' which is the history. The 'text' is the current prompt or user input.
  // In App.tsx: chatHistory does NOT include the current text for the API call usually, or it constructs it.
  // Looking at App.tsx: 
  // const chatHistory = messages.filter(...).map(...)
  // chatWithDeepseekStream({ mode, text, messages: chatHistory })
  
  // So we need to append the new user message
  apiMessages.push({ role: 'user', content: text });

  // Add system prompt based on mode (D: Split responsibilities)
  // Since we are mocking backend logic here or preparing for it:
  if (mode === 'design') {
     // System prompt for design is handled by the prompt construction in App.tsx (designSummary)
     // which is passed as 'text'.
     // But we can add a specific system instruction if needed.
  } else {
     // Consultant mode
  }

  const reader = await chatAPIStream({ messages: apiMessages, mode });
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    yield chunk;
  }
}
