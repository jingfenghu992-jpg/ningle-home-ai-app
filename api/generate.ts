import { getEnv } from './_env';

// export const config = {
//   runtime: 'edge',
// };

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const requestId = crypto.randomUUID();
  let apiKey: string;

  try {
    apiKey = getEnv('STEPFUN_IMAGE_API_KEY');
  } catch (e: any) {
    return new Response(JSON.stringify({ 
      ok: false, 
      message: 'Missing API Key',
      errorCode: 'MISSING_KEY'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await req.json();
    const { prompt } = body;

    if (!prompt) {
      return new Response(JSON.stringify({ ok: false, message: 'Missing prompt' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Call StepFun Image Generation API
    // Using generic OpenAI DALL-E compatible endpoint or StepFun specific
    const response = await fetch('https://api.stepfun.com/v1/images/generations', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            prompt: prompt,
            model: 'step-1x-medium', // Example model
            n: 1,
            size: '1024x1024',
            response_format: 'b64_json'
        })
    });

    if (!response.ok) {
        throw new Error(`Upstream Error: ${response.status}`);
    }

    const data = await response.json();
    // Assuming OpenAI format: { data: [{ b64_json: "..." }] }
    const b64_json = data.data?.[0]?.b64_json;

    if (!b64_json) {
        throw new Error('Invalid upstream response format');
    }

    return new Response(JSON.stringify({
      ok: true,
      b64_json: `data:image/png;base64,${b64_json}`,
      requestId,
      mode: 'generate',
      usedKey: 'STEPFUN_IMAGE_API_KEY'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ 
        ok: false, 
        message: error.message || 'Generation Failed' 
    }), { status: 500 });
  }
}
