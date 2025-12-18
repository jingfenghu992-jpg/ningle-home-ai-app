import { getOptionalEnv } from './_env';

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const keysToCheck = [
    'DEEPSEEK_API_KEY',
    'STEPFUN_IMAGE_API_KEY',
    'STEPFUN_VISION_API_KEY',
    'STEPFUN_VISION_API_KEY_2'
  ];

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
    return new Response(JSON.stringify({
      ok: false,
      errorCode: 'MISSING_KEY',
      missing,
      runtime: 'vercel-edge' // indicater
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    runtime: 'vercel-edge',
    has: result
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
