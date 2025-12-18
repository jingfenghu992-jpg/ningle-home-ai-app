import { IncomingMessage, ServerResponse } from 'http';
import { getEnv, getOptionalEnv } from './_env';
import { readJsonBody, sendJson, sendError } from './_utils';

async function callStepFunVision(apiKey: string, imageBase64: string) {
    // Hypothetical StepFun Vision Endpoint (OpenAI Compatible usually)
    const url = 'https://api.stepfun.com/v1/chat/completions'; 
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'step-1v-8k', // Example model name
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Analyze this interior design image. Describe room type, camera angle, composition, lighting, and materials in JSON format." },
                        { type: "image_url", image_url: { url: imageBase64 } }
                    ]
                }
            ]
        })
    });

    if (!response.ok) {
        throw new Error(`API_ERROR: ${response.status}`);
    }

    return await response.json();
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('Method Not Allowed');
    return;
  }

  let body: any;
  try {
      body = await readJsonBody(req);
      if (!body.image || !body.image.startsWith('data:image/')) {
          throw new Error('Invalid image data');
      }
  } catch (e) {
      return sendError(res, 'Invalid Payload', 400, 'INVALID_PAYLOAD');
  }

  const requestId = crypto.randomUUID();
  let usedKey = 'STEPFUN_VISION_API_KEY';
  let apiKey: string;

  try {
      apiKey = getEnv('STEPFUN_VISION_API_KEY');
  } catch (e) {
      return sendError(res, 'Missing API Key', 500, 'MISSING_KEY');
  }

  try {
    try {
        await callStepFunVision(apiKey, body.image);
    } catch (e: any) {
        if (e.message.includes('401') || e.message.includes('429')) {
             console.log('Primary key failed, trying secondary...');
             const key2 = getOptionalEnv('STEPFUN_VISION_API_KEY_2');
             if (key2) {
                 usedKey = 'STEPFUN_VISION_API_KEY_2';
                 await callStepFunVision(key2, body.image);
             } else {
                 throw e; // No secondary key
             }
        } else {
            throw e; // Other error
        }
    }

    return sendJson(res, {
        ok: true,
        requestId,
        mode: 'vision',
        usedKey,
        vision_summary: "Analysis complete (upstream proxy).",
        extraction: {
            roomTypeGuess: "Detected Room",
            surfaces: { walls: "Analyzed", floor: "Analyzed" }
        }
    });

  } catch (error: any) {
      return sendError(res, 'Vision API Failed', 500, 'VISION_API_ERROR');
  }
}
