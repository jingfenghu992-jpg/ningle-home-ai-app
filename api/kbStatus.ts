export const config = {
  runtime: 'edge',
};

export default function handler(req: Request) {
  return new Response(JSON.stringify({ status: 'ready', docs_count: 0 }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
