import { fetchJSON } from './utils';

export interface VisionResponse {
  ok: boolean;
  vision_summary?: string;
  extraction?: any;
  message?: string;
  errorCode?: string;
}

export async function analyzeImage(params: { imageDataUrl?: string; imageUrl?: string; mode: string }): Promise<VisionResponse> {
  const payloadUrl = params.imageUrl || params.imageDataUrl;
  if (!payloadUrl) {
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
        imageUrl: params.imageUrl, // Prioritize remote URL
        imageDataUrl: params.imageDataUrl, // Fallback to base64
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
