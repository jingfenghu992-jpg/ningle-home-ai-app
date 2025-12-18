import { fetchJSON } from './utils';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export function parseDesignImageInstruction(text: string): { finalPrompt: string | null; safeUserText: string } {
  const full = text || '';
  let finalPrompt: string | null = null;

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

  if (!finalPrompt && full.includes('<<<GENERATE_IMAGE>>>')) {
    let m = full.match(/\[PROMPT:\s*([\s\S]*?)\]/i);
    if (!m) {
      m = full.match(/PROMPT:\s*([^\n]+)/i);
    }
    if (m && m[1]) {
      finalPrompt = m[1].trim();
    }
  }

  let safe = full;
  safe = safe.replace(/FINAL_IMAGE_PROMPT:[\s\S]*?(PROMPT_SELF_CHECK:|$)/i, '$1');
  safe = safe.replace(/PROMPT_SELF_CHECK:[\s\S]*$/i, '');
  safe = safe.replace(/\[PROMPT:[\s\S]*?]/i, '');
  safe = safe.replace(/PROMPT:\s*[^\n]+/i, '');
  safe = safe.replace(/<<<GENERATE_IMAGE>>>/g, '');
  safe = safe.trim();

  return { finalPrompt, safeUserText: safe };
}

export function validateImagePrompt(promptText: string, fullText: string): boolean {
  if (!promptText || promptText.trim().length < 20) return false;
  const lower = (promptText + '\n' + fullText).toLowerCase();

  const hasCamera =
    lower.includes('same camera angle') || lower.includes('same viewpoint') || lower.includes('same view');
  const hasWindow =
    lower.includes('same window positions') ||
    lower.includes('same window') ||
    lower.includes('keep all windows');
  const hasDoNotChange = lower.includes('do not change');
  
  const hasNoPeople = lower.includes('no people');
  const hasNoText = lower.includes('no text');
  
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

async function chatAPIStream(payload: { 
  messages: ChatMessage[]; 
  mode: string;
  stream?: boolean; 
}): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Chat API error: ${response.statusText}`);
  }

  return response.body.getReader();
}

export async function* chatWithDeepseekStream(params: {
  mode: string;
  text: string;
  messages: ChatMessage[];
  visionSummary?: string;
}): AsyncGenerator<string, void, unknown> {
  const { mode, text, messages, visionSummary } = params;

  const apiMessages: ChatMessage[] = [...messages];
  apiMessages.push({ role: 'user', content: text });

  const reader = await chatAPIStream({ messages: apiMessages, mode });
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    yield chunk;
  }
}
