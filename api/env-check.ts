import { IncomingMessage, ServerResponse } from 'http';
import { getOptionalEnv } from './_env';
import { sendJson, sendError } from './_utils';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end('Method Not Allowed');
    return;
  }

  const keysToCheck = [
    'DEEPSEEK_API_KEY',
    'STEPFUN_IMAGE_API_KEY',
    'STEPFUN_VISION_API_KEY',
    'STEPFUN_VISION_API_KEY_2'
  ];
  
  console.log('[Env Check] Verifying keys in Runtime:', process.env.NODE_ENV || 'unknown');

  const result: Record<string, boolean> = {};
  const missing: string[] = [];

  for (const key of keysToCheck) {
    const val = getOptionalEnv(key);
    const exists = !!(val && val.trim().length > 0);
    result[key] = exists;
    if (!exists) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    return sendError(res, 'Missing Keys', 500, 'MISSING_KEY');
  }

  return sendJson(res, {
    ok: true,
    runtime: 'vercel-node',
    has: result
  });
}
