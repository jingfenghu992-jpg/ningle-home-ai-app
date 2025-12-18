import { fetchJSON } from './utils';

export interface GenerateResponse {
  ok: boolean;
  b64_json?: string; // DeepSeek / OpenAI style
  message?: string;
}

export async function generateImageAPI(payload: { prompt: string; size: string; response_format: string }): Promise<GenerateResponse> {
  try {
    return await fetchJSON<GenerateResponse>('/api/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (error: any) {
    console.error('[Generate API] Error:', error);
    return {
      ok: false,
      message: error.message || 'Generation failed',
    };
  }
}
