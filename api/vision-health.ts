import { getOptionalEnv } from './_env';

// export const config = {
//   runtime: 'edge',
// };

export default function handler(req: Request) {
  const hasKey = !!getOptionalEnv('STEPFUN_VISION_API_KEY');
  return new Response(JSON.stringify({ 
      status: 'vision_ok',
      envOk: hasKey 
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
