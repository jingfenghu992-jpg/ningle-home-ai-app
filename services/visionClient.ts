import { fetchJSON } from './utils';

export interface VisionResponse {
  ok: boolean;
  vision_summary?: string;
  extraction?: any;
  hkAnchorsLite?: any;
  message?: string;
  errorCode?: string;
  debug?: any;
}

export async function analyzeImage(params: { imageDataUrl?: string; imageUrl?: string; mode: string; spaceType?: string; clientId?: string }): Promise<VisionResponse> {
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
      mode: params.mode,
      clientId: params.clientId
    };
    if (params.spaceType) body.spaceType = params.spaceType;

    if (params.imageUrl) {
      body.imageUrl = params.imageUrl;
    } else {
      // Fallback: If no remote URL, we MUST send base64, but we try to compress or warn?
      // Actually with Vercel Blob, we should almost always have imageUrl.
      // If we don't, it means upload failed.
      if (!params.imageDataUrl) {
          return { ok: false, message: 'Image upload failed, please retry.', errorCode: 'UPLOAD_FAILED' };
      }
      body.imageDataUrl = params.imageDataUrl;
    }

    // Increase client timeout to 300s to match Vercel Pro potential or just to be safe
    // Since we are using Vercel Hobby (60s limit), this client timeout is just a safety net.
    // But StepFun analysis can be slow.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 300s timeout

    try {
        const response = await fetchJSON<VisionResponse>('/api/vision', {
            method: 'POST',
            body: JSON.stringify(body),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error: any) {
        clearTimeout(timeoutId);
        console.error('[Vision Client] Error:', error);
        return {
            ok: false,
            message: error.message || 'Network error',
            errorCode: error.code || 'NETWORK_ERROR'
        };
    }
  } catch (error: any) {
    console.error('[Vision Client] Error:', error);
    return {
      ok: false,
      message: error.message || 'Network error',
      errorCode: error.code || 'NETWORK_ERROR'
    };
  }
}

// FAST structure anchors (2–6s priority): uses /api/vision-fast rewrite => /api/vision?mode=FAST
export async function analyzeImageFast(params: { imageDataUrl?: string; imageUrl?: string; spaceHint?: string; clientId?: string; debug?: boolean }): Promise<VisionResponse> {
  const payloadUrl = params.imageUrl || params.imageDataUrl;
  if (!payloadUrl) {
    return { ok: false, message: 'Image payload is missing or invalid', errorCode: 'INVALID_IMAGE_CLIENT' };
  }
  const body: any = { mode: 'FAST', clientId: params.clientId };
  if (params.spaceHint) body.spaceHint = params.spaceHint;
  if (params.imageUrl) body.imageUrl = params.imageUrl;
  else body.imageDataUrl = params.imageDataUrl;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  try {
    const url = params.debug ? '/api/vision-fast?debug=1' : '/api/vision-fast';
    const res = await fetchJSON<any>(url, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res as VisionResponse;
  } catch (e: any) {
    clearTimeout(timeoutId);
    return { ok: false, message: e?.message || 'FAST vision failed', errorCode: e?.code || 'NETWORK_ERROR' };
  }
}
