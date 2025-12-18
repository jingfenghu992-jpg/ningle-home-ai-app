export const config = {
  runtime: 'edge',
};

export default function handler(req: Request) {
  return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
