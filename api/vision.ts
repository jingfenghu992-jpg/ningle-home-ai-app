export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Environment variable check
  const apiKey = process.env.STEPFUN_VISION_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({
      ok: false,
      message: 'Missing STEPFUN_VISION_API_KEY environment variable',
      errorCode: 'MISSING_ENV_VAR'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await req.json();
    
    // C) 修复图片“假收到”问题：严格校验
    if (!body.image || !body.image.startsWith('data:image/')) {
      return new Response(JSON.stringify({ 
        ok: false, 
        message: 'Image payload missing or invalid',
        errorCode: 'INVALID_PAYLOAD'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Mock Vision Analysis
    // Return a mock summary
    return new Response(JSON.stringify({
      ok: true,
      vision_summary: "照片顯示一個典型的香港住宅空間，光線充足。可見一面白牆和木質地板。",
      extraction: {
          roomTypeGuess: "客廳",
          camera: { shotType: "Wide", viewpointHeight: "Eye Level" },
          composition: { horizonLine: "Middle" },
          openings: { windowsDoors: [] },
          fixedElements: { beamsColumns: "None" },
          surfaces: { floor: "Wood", walls: "White" },
          lighting: { daylightDirection: "Left" }
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, message: 'Invalid JSON body' }), { status: 400 });
  }
}
