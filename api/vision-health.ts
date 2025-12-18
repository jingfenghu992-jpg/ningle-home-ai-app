export const config = {
  runtime: 'edge',
};

export default function handler(req: Request) {
  return new Response(JSON.stringify({ status: 'vision_ok' }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
