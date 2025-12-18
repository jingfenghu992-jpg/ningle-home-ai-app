export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Environment variable check
  const apiKey = process.env.STEPFUN_IMAGE_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({
      ok: false,
      message: 'Missing STEPFUN_IMAGE_API_KEY environment variable'
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

    // Mock Generation
    // In a real app, this would call OpenAI/Midjourney
    // Here we return a placeholder base64 image (1x1 pixel)
    const b64_json = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    
    // Simulate delay
    await new Promise(r => setTimeout(r, 2000));

    return new Response(JSON.stringify({
      ok: true,
      b64_json: b64_json
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, message: 'Invalid JSON body' }), { status: 400 });
  }
}
