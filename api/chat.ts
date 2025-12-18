import { getEnv } from './_env';

// export const config = {
//   runtime: 'edge',
// };

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

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // 1. Get Key (throw if missing)
  let apiKey: string;
  try {
    apiKey = getEnv('DEEPSEEK_API_KEY');
  } catch (e: any) {
    return new Response(JSON.stringify({ 
      error: 'Missing API Key', 
      errorCode: 'MISSING_KEY',
      details: e.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await req.json();
    const { messages, mode } = body;

    const systemPrompt = mode === 'design' ? buildDesignSystemPrompt() : buildConsultantSystemPrompt();
    
    // Construct messages for DeepSeek (OpenAI compatible)
    const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages
    ];

    // 2. Call DeepSeek API
    // Using standard OpenAI-compatible endpoint for DeepSeek
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
        return new Response(JSON.stringify({ 
            error: 'Upstream API Error', 
            upstreamStatus: response.status 
        }), { 
            status: response.status === 401 ? 401 : 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 3. Proxy the stream
    // We want to inject metadata at the start, but SSE is tricky to mix with direct binary stream proxying.
    // For simplicity and robustness with Vercel AI SDK or simple clients, we usually just pipe.
    // However, the requirement asks to return `usedKey` and `requestId`. 
    // Since this is a stream, we can't easily add JSON metadata *before* the stream without a custom protocol.
    // BUT: The client expects a stream of text.
    // For strict compliance with the prompt "return ... usedKey", typically implies a JSON response, 
    // but this is a *chat* endpoint which is usually streamed.
    // COMPROMISE: We will stream the content. The `usedKey` requirement might be better suited for headers or a non-streaming mode.
    // Checking prompt again: "Successful return must include requestId, mode, usedKey".
    // If it's a stream, we can send these as custom headers! 
    
    const stream = new ReadableStream({
        async start(controller) {
            if (!response.body) return;
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value);
                    // Parse OpenAI stream format "data: {...}" if needed, or just pass through.
                    // Since the client likely expects the text content, we might need to parse.
                    // However, if the client handles OpenAI format, we pass through.
                    // Let's assume pass-through for now as it's safest for "proxy".
                    controller.enqueue(value); 
                }
            } catch (e) {
                console.error('Stream Error', e);
                controller.error(e);
            } finally {
                controller.close();
            }
        }
    });

    return new Response(response.body, { // Direct proxy is better for performance
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Request-Id': crypto.randomUUID(),
            'X-Mode': mode,
            'X-Used-Key': 'DEEPSEEK_API_KEY' // Requirement met via Header for stream
        }
    });

  } catch (error: any) {
    console.error('Handler Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }
}
