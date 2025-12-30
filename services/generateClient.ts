import { fetchJSON } from './utils';

export interface GenerateResponse {
  ok: boolean;
  b64_json?: string; // Legacy
  resultBlobUrl?: string; // New img2img result
  designExplanation?: string; // Human explanation aligned to prompt
  designSpec?: any; // Optional: structured spec (debug)
  debug?: any;
  message?: string;
  errorCode?: string;
}

export interface DesignQaResponse {
  ok: boolean;
  designExplanation?: string;
  qa?: any;
  debug?: any;
  message?: string;
}

export interface InspireResponse {
  ok: boolean;
  resultUrl?: string;
  renderId?: string;
  designNotes?: string;
  debug?: any;
  fallbackPlan?: any;
  message?: string;
  errorCode?: string;
}

export async function uploadImage(
  file: File | Blob,
  opts?: { clientId?: string; uploadId?: string }
): Promise<{ url: string } | null> {
  try {
    const filename = (file as File).name || 'image.jpg';
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: {
        'x-vercel-filename': filename,
        ...(opts?.clientId ? { 'x-client-id': opts.clientId } : {}),
        ...(opts?.uploadId ? { 'x-upload-id': opts.uploadId } : {}),
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

export async function generateDesignImage(params: {
  prompt?: string;
  baseImageBlobUrl: string;
  size?: string;
  renderIntake?: any;
  clientId?: string;
  uploadId?: string;
  jobId?: string;
  source_weight?: number;
  steps?: number;
  cfg_scale?: number;
  seed?: number;
  response_format?: 'b64_json' | 'url';
  fast_refine?: boolean; // skip slower QA/auto-refine for quicker "细节增强"
  debug?: boolean; // if true, backend returns usedText in debug
}): Promise<GenerateResponse> {
  try {
    const { debug, ...rest } = params as any;
    const url = debug ? '/api/design/generate?debug=1' : '/api/design/generate';
    return await fetchJSON<GenerateResponse>(url, {
      method: 'POST',
      body: JSON.stringify(rest),
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

export async function qaDesignImage(params: {
  imageUrl: string;
  renderIntake?: any;
}): Promise<DesignQaResponse> {
  try {
    return await fetchJSON<DesignQaResponse>('/api/design/qa', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  } catch (error: any) {
    console.error('[Design QA Client] Error:', error);
    return {
      ok: false,
      message: error.message || 'QA failed',
    };
  }
}

export async function generateInspireImage(params: {
  renderIntake: any;
  // C3: dual mode support (optional, backward compatible)
  sourceImageUrl?: string;
  outputMode?: 'FAST_T2I' | 'PRECISE_I2I';
  i2i_strength?: number;
  i2i_source_weight?: number;
  keep_structure?: boolean;
  qualityPreset?: 'STRUCTURE_LOCK' | string;
  fastAnchors?: boolean; // if true, backend will run FAST structural anchors (hkAnchorsLite)
  layoutVariant?: 'A' | 'B';
  sizeChoice?: string;
  styleChoice?: string;
  size?: string;
  response_format?: 'b64_json' | 'url';
  steps?: number;
  cfg_scale?: number;
  seed?: number;
  debug?: boolean; // if true, backend returns usedText in debug
}): Promise<InspireResponse> {
  try {
    const { debug, ...rest } = params as any;
    const url = debug ? '/api/design/inspire?debug=1' : '/api/design/inspire';
    return await fetchJSON<InspireResponse>(url, {
      method: 'POST',
      body: JSON.stringify(rest),
    });
  } catch (error: any) {
    console.error('[Inspire Client] Error:', error);
    const details = error?.details;
    return {
      ok: false,
      message: (details?.message || error.message || 'Inspiration generation failed'),
      errorCode: (details?.errorCode || error.code || 'NETWORK_ERROR'),
      debug: details?.debug,
      fallbackPlan: details?.fallbackPlan,
    };
  }
}

// Unified render endpoint (rewrite => /api/design/inspire). Keeps UX aligned with HK flow.
export async function generateRenderImage(params: Parameters<typeof generateInspireImage>[0]): Promise<InspireResponse> {
  try {
    const { debug, ...rest } = params as any;
    const url = debug ? '/api/design/render?debug=1' : '/api/design/render';
    // If outputMode is PRECISE_I2I, ensure sourceImageUrl is present
    if (rest.outputMode === 'PRECISE_I2I' && !rest.sourceImageUrl) {
        console.warn('[Render Client] PRECISE_I2I requested but no sourceImageUrl. Aborting I2I, fallback to FAST_T2I.');
        rest.outputMode = 'FAST_T2I';
    }
    return await fetchJSON<InspireResponse>(url, {
      method: 'POST',
      body: JSON.stringify(rest),
    });
  } catch (error: any) {
    console.error('[Render Client] Error:', error);
    const details = error?.details;
    return {
      ok: false,
      message: (details?.message || error.message || 'Render failed'),
      errorCode: (details?.errorCode || error.code || 'NETWORK_ERROR'),
      debug: details?.debug,
      fallbackPlan: details?.fallbackPlan,
      renderId: details?.renderId,
      designNotes: details?.designNotes,
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
