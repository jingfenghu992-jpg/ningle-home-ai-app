import { fetchJSON } from './utils';

export interface GenerateResponse {
  ok: boolean;
  b64_json?: string; // Legacy
  resultBlobUrl?: string; // New img2img result
  message?: string;
  errorCode?: string;
}

export async function uploadImage(file: File): Promise<{ url: string } | null> {
  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: {
        'x-vercel-filename': file.name,
      },
      body: file,
    });

    if (!response.ok) throw new Error('Upload failed');
    return await response.json();
  } catch (error) {
    console.error('[Upload Client] Error:', error);
    return null;
  }
}

export async function generateDesignImage(params: { prompt: string; baseImageBlobUrl: string; size?: string }): Promise<GenerateResponse> {
  try {
    return await fetchJSON<GenerateResponse>('/api/design/generate', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  } catch (error: any) {
    console.error('[Generate Design Client] Error:', error);
    return {
      ok: false,
      message: error.message || 'Generation failed',
      errorCode: error.code || 'NETWORK_ERROR'
    };
  }
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
