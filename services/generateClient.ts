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
}): Promise<GenerateResponse> {
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
