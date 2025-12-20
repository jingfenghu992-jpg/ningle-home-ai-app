import { fetchJSON } from './utils';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatResponse {
  ok: boolean;
  content?: string;
  error?: string;
  message?: string;
  errorCode?: string;
  details?: string;
  debug?: any;
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

export async function* chatWithDeepseekStream(params: {
  mode: string;
  text: string;
  messages: ChatMessage[];
  visionSummary?: string;
}): AsyncGenerator<string, void, unknown> {
  const { mode, text, messages, visionSummary } = params;

  const apiMessages: ChatMessage[] = [...messages];
  apiMessages.push({ role: 'user', content: text });

  // Use AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000); // 180s timeout

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        mode, 
        messages: apiMessages,
        visionSummary 
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
        let errorMsg = `HTTP ${response.status}`;
        try {
            const errData = await response.json();
            if (errData.error) errorMsg = errData.error;
            if (errData.details) errorMsg += `: ${errData.details}`;
        } catch (e) { }
        throw new Error(errorMsg);
    }

    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      
      // Process SSE lines
      const lines = buffer.split('\n');
      // Keep the last partial line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        
        if (trimmed.startsWith('data: ')) {
          try {
            const jsonStr = trimmed.slice(6);
            const data = JSON.parse(jsonStr);
            const content = data.choices?.[0]?.delta?.content || '';
            if (content) yield content;
          } catch (e) {
            // ignore parse error for partial chunks
          }
        }
      }
    }
  } catch (error: any) {
    clearTimeout(timeoutId);
    console.error('[Chat Client] Error:', error);
    if (error.name === 'AbortError') {
       throw new Error('伺服器響應超時，請稍後再試');
    }
    throw error;
  }
}
