import { IncomingMessage, ServerResponse } from 'http';
import { getEnv } from './_env';
import { readJsonBody, sendError } from './_utils';

// Debug flag: Set to true to bypass upstream API and return mock response if key exists
const DEBUG_MODE = false;

// D) 拆分 chat / design 职责
function buildDesignSystemPrompt() {
    return `You are a professional Interior Design Assistant.
Your goal is to generate a FINAL_IMAGE_PROMPT block based on the user's requirements and the structural lock.
Do NOT act as a conversational assistant. Output only the analysis and the prompt block.
Structure:
Analysis: <text>
FINAL_IMAGE_PROMPT:
[PROMPT: <content>]
<<<GENERATE_IMAGE>>>
PROMPT_SELF_CHECK: <text>`;
}

function buildConsultantSystemPrompt() {
    return `You are a helpful Home Design Consultant.
Answer the user's questions about interior design, renovation, and materials.
Be professional, friendly, and concise.`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('Method Not Allowed');
    return;
  }

  // 1. Get Key (throw if missing)
  let apiKey: string;
  try {
    apiKey = getEnv('DEEPSEEK_API_KEY');
  } catch (e: any) {
    return sendError(res, 'Missing API Key', 500, 'MISSING_KEY');
  }

  try {
    const body: any = await readJsonBody(req);
    const { messages, mode } = body;

    const systemPrompt = mode === 'design' ? buildDesignSystemPrompt() : buildConsultantSystemPrompt();
    
    // Construct messages for DeepSeek (OpenAI compatible)
    const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages
    ];

    // 2. Call DeepSeek API
    // Using standard OpenAI-compatible endpoint for DeepSeek
    if (DEBUG_MODE) {
        console.log('[DEBUG] Key exists, returning mock response');
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Request-Id', crypto.randomUUID());
        res.setHeader('X-Mode', mode);
        res.setHeader('X-Used-Key', 'DEEPSEEK_API_KEY');

        const text = "（DEBUG模式：Key已檢測到，正在回覆）你好！我係寧樂家居助手。雖然現在使用的是測試模式，但證明系統已經成功讀取到 API Key 了。";
        const chunks = text.split('');
        
        for (const char of chunks) {
            res.write(char);
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        res.end();
        return;
    }

    const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'deepseek-chat', // or 'deepseek-reasoner' depending on preference
            messages: apiMessages,
            stream: true,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error('DeepSeek API Error:', response.status, errText);
        return sendError(res, 'Upstream API Error', response.status === 401 ? 401 : 500);
    }

    // 3. Proxy the stream
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Request-Id', crypto.randomUUID());
    res.setHeader('X-Mode', mode);
    res.setHeader('X-Used-Key', 'DEEPSEEK_API_KEY');

    if (response.body) {
        // Node.js fetch response body is a ReadableStream (web standard) in Node 18+
        // But we need to pipe it to res (Node stream)
        // We can use a reader
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            // Direct pass through for now, assuming client handles it
            res.write(chunk);
        }
        res.end();
    } else {
        res.end();
    }

  } catch (error: any) {
    console.error('Handler Error:', error);
    sendError(res, error.message || 'Internal Error', 400);
  }
}
