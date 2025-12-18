import { getOptionalEnv } from './_env';

// export const config = {
//   runtime: 'edge',
// };

export default function handler(req: Request) {
  const hasKey = !!getOptionalEnv('DEEPSEEK_API_KEY');
  return new Response(JSON.stringify({ 
      status: 'ok', 
      timestamp: Date.now(),
      envOk: hasKey
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
