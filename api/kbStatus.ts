// export const config = {
//   runtime: 'edge',
// };

export default function handler(req: Request) {
  // Assuming no specific key needed for status, or add if needed
  return new Response(JSON.stringify({ 
      status: 'ready', 
      docs_count: 0,
      envOk: true 
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
