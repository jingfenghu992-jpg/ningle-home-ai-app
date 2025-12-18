export const config = {
  runtime: 'edge',
};

// D) 拆分 chat / design 职责
// Helper to construct prompt for design mode
function buildDesignSystemPrompt() {
    return `You are a professional Interior Design Assistant.
Your goal is to generate a FINAL_IMAGE_PROMPT block based on the user's requirements and the structural lock.
Do NOT act as a conversational assistant. Output only the analysis and the prompt block.`
}

// Helper for consultant mode
function buildConsultantSystemPrompt() {
    return `You are a helpful Home Design Consultant.
Answer the user's questions about interior design, renovation, and materials.
Be professional, friendly, and concise.`
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Environment variable check
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({
      error: 'Missing DEEPSEEK_API_KEY environment variable'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await req.json();
    const { messages, mode } = body;

    // Determine system prompt based on mode
    const systemPrompt = mode === 'design' ? buildDesignSystemPrompt() : buildConsultantSystemPrompt();
    
    const lastMsg = messages[messages.length - 1]?.content || '';
    
    let responseText = '';
    if (mode === 'design') {
        // Mock design response with FINAL_IMAGE_PROMPT
        responseText = `Based on your request, I have analyzed the structure.

FINAL_IMAGE_PROMPT:
[PROMPT: realistic interior design, ${lastMsg.substring(0, 50)}..., same camera angle, same window positions, do not change structure, no people, no text]
<<<GENERATE_IMAGE>>>

PROMPT_SELF_CHECK:
The prompt includes key constraints: same camera angle, same window positions, do not change structure.`;
    } else {
        responseText = `(Consultant Mode) I understand you are interested in ${lastMsg.substring(0, 20)}. Here is some advice...`;
    }

    // Stream output
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const chunks = responseText.split(/(?=[ ,.])/); // Split by words/punctuation for effect
        for (const chunk of chunks) {
            // Explicitly typing chunk as string is redundant here but following "mark chunk type explicitly" instruction if it were a callback
            const textChunk: string = chunk; 
            controller.enqueue(encoder.encode(textChunk));
            await new Promise(r => setTimeout(r, 50)); // 50ms delay per chunk
        }
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }
}
