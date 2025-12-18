import { fetchJSON } from './utils';

export interface VisionResponse {
  ok: boolean;
  vision_summary?: string;
  extraction?: any;
  message?: string;
  errorCode?: string;
}

export async function analyzeImageAPI(payload: { image: string; mode: string }): Promise<VisionResponse> {
  // C) 修复图片“假收到”问题：严格校验 image payload
  if (!payload.image || !payload.image.startsWith('data:image/')) {
    console.error('[Vision API] Invalid image payload');
    return {
      ok: false,
      message: 'Image payload is missing or invalid',
      errorCode: 'INVALID_IMAGE'
    };
  }

  try {
    return await fetchJSON<VisionResponse>('/api/vision', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (error: any) {
    console.error('[Vision API] Error:', error);
    return {
      ok: false,
      message: error.message || 'Network error',
      errorCode: error.code || 'NETWORK_ERROR'
    };
  }
}
