import { fetchJSON } from './utils';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function chatAPIStream(payload: { 
  messages: ChatMessage[]; 
  mode: string;
  stream?: boolean; 
}): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Chat API error: ${response.statusText}`);
  }

  return response.body.getReader();
}
