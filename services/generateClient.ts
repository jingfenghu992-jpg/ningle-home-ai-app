import { generateImageAPI, GenerateResponse } from '../api/generate';

export async function generateImage(params: { prompt: string; size: string; response_format: string }): Promise<GenerateResponse> {
  return await generateImageAPI(params);
}
