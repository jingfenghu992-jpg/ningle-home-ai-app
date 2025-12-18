import { analyzeImageAPI, VisionResponse } from '../api/vision';

export async function analyzeImage(params: { imageDataUrl: string; mode: string }): Promise<VisionResponse> {
  // C) 修复图片“假收到”问题：Ensure field consistency
  // Map frontend 'imageDataUrl' to API 'image'
  return await analyzeImageAPI({
    image: params.imageDataUrl,
    mode: params.mode
  });
}
