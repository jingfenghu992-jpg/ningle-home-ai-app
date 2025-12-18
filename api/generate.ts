import { IncomingMessage, ServerResponse } from 'http';
import { getEnv } from './_env';
import { readJsonBody, sendJson, sendError } from './_utils';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('Method Not Allowed');
    return;
  }

  const requestId = crypto.randomUUID();
  let apiKey: string;

  try {
    apiKey = getEnv('STEPFUN_IMAGE_API_KEY');
  } catch (e: any) {
    return sendError(res, 'Missing API Key', 500, 'MISSING_KEY');
  }

  try {
    const body: any = await readJsonBody(req);
    const { prompt } = body;

    if (!prompt) {
      return sendError(res, 'Missing prompt', 400);
    }

    // Call StepFun Image Generation API
    const response = await fetch('https://api.stepfun.com/v1/images/generations', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            prompt: prompt,
            model: 'step-1x-medium',
            n: 1,
            size: '1024x1024',
            response_format: 'b64_json'
        })
    });

    if (!response.ok) {
        throw new Error(`Upstream Error: ${response.status}`);
    }

    const data = await response.json();
    const b64_json = data.data?.[0]?.b64_json;

    if (!b64_json) {
        throw new Error('Invalid upstream response format');
    }

    return sendJson(res, {
      ok: true,
      b64_json: `data:image/png;base64,${b64_json}`,
      requestId,
      mode: 'generate',
      usedKey: 'STEPFUN_IMAGE_API_KEY'
    });

  } catch (error: any) {
    return sendError(res, error.message || 'Generation Failed', 500);
  }
}
