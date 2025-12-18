import { fetchJSON } from './utils';

export interface GenerateResponse {
  ok: boolean;
  b64_json?: string; // DeepSeek / OpenAI style
  message?: string;
  errorCode?: string;
}

export async function generateImage(params: { prompt: string; size: string; response_format: string }): Promise<GenerateResponse> {
  try {
    return await fetchJSON<GenerateResponse>('/api/generate', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  } catch (error: any) {
    console.error('[Generate Client] Error:', error);
    return {
      ok: false,
      message: error.message || 'Generation failed',
      errorCode: error.code || 'NETWORK_ERROR'
    };
  }
}
