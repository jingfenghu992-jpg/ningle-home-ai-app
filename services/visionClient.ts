import { fetchJSON } from './utils';

export interface VisionResponse {
  ok: boolean;
  vision_summary?: string;
  extraction?: any;
  message?: string;
  errorCode?: string;
}

export async function analyzeImage(params: { imageDataUrl: string; mode: string }): Promise<VisionResponse> {
  if (!params.imageDataUrl || !params.imageDataUrl.startsWith('data:image/')) {
    console.error('[Vision Client] Invalid image payload');
    return {
      ok: false,
      message: 'Image payload is missing or invalid',
      errorCode: 'INVALID_IMAGE_CLIENT'
    };
  }

  try {
    return await fetchJSON<VisionResponse>('/api/vision', {
      method: 'POST',
      body: JSON.stringify({
        imageDataUrl: params.imageDataUrl,
        mode: params.mode
      }),
    });
  } catch (error: any) {
    console.error('[Vision Client] Error:', error);
    return {
      ok: false,
      message: error.message || 'Network error',
      errorCode: error.code || 'NETWORK_ERROR'
    };
  }
}
