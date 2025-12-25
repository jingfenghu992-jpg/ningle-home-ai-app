import { fetchJSON } from './utils';

export interface SpaceCandidate {
  space: string;
  confidence: number;
}

export interface SpaceClassifyResponse {
  ok: boolean;
  primary?: string;
  candidates?: SpaceCandidate[];
  reason?: string;
  message?: string;
}

export async function classifySpace(params: {
  imageDataUrl?: string;
  imageUrl?: string;
  clientId?: string;
}): Promise<SpaceClassifyResponse> {
  const payloadUrl = params.imageUrl || params.imageDataUrl;
  if (!payloadUrl) {
    return { ok: false, message: 'Image payload is missing or invalid' };
  }

  try {
    const body: any = { clientId: params.clientId };
    if (params.imageUrl) body.imageUrl = params.imageUrl;
    else body.imageDataUrl = params.imageDataUrl;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s

    try {
      const res = await fetchJSON<SpaceClassifyResponse>('/api/space', {
        method: 'POST',
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res;
    } catch (e: any) {
      clearTimeout(timeoutId);
      return { ok: false, message: e?.message || 'Network error' };
    }
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Network error' };
  }
}

