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
    // Optimization: If we have a remote URL, DO NOT send the base64 data.
    // This prevents hitting Vercel's 4.5MB request body limit and reduces latency.
    const body: any = {
      mode: params.mode
    };

    if (params.imageUrl) {
      body.imageUrl = params.imageUrl;
    } else {
      body.imageDataUrl = params.imageDataUrl;
    }

    return await fetchJSON<VisionResponse>('/api/vision', {
      method: 'POST',
      body: JSON.stringify(body),
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
