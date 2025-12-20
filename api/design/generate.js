import { put } from '@vercel/blob';

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '10mb',
        },
    },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { prompt, baseImageBlobUrl, size = "1024x1024" } = req.body;

  if (!baseImageBlobUrl) {
    res.status(400).json({ ok: false, message: 'Missing baseImageBlobUrl' });
    return;
  }

  const apiKey = process.env.STEPFUN_IMAGE_API_KEY;
  if (!apiKey) {
    console.error('Missing STEPFUN_IMAGE_API_KEY');
    res.status(500).json({ ok: false, errorCode: 'MISSING_KEY', message: 'Missing STEPFUN_IMAGE_API_KEY' });
    return;
  }

// Use server-side timeout to fail fast (55s to avoid Vercel 60s limit)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55000);

  try {
    // 1. Fetch the base image from Blob
    // Need to fetch because 'dataUrl' in source_url might be undefined in the broken code below
    console.log(`[Design Gen] Fetching base image from: ${baseImageBlobUrl}`);
    const imageRes = await fetch(baseImageBlobUrl);
    if (!imageRes.ok) {
      throw new Error(`Failed to fetch base image: ${imageRes.statusText}`);
    }
    const arrayBuffer = await imageRes.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');
    console.log(`[Design Gen] Image converted. Size: ${(base64Image.length / 1024 / 1024).toFixed(2)} MB`);
    const dataUrl = `data:${imageRes.headers.get('content-type') || 'image/jpeg'};base64,${base64Image}`;
    
    // 2. Call StepFun Image-to-Image API
    console.log('[Design Gen] Calling StepFun image2image...');
    const stepfunRes = await fetch('https://api.stepfun.com/v1/images/image2image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'step-1x-medium',
        prompt: prompt,
        source_url: dataUrl, // Wait, StepFun might prefer remote URL if possible? But dataUrl is safer if auth needed for blob.
        source_weight: 0.45,
        size: size,
        n: 1,
        response_format: "url",
        seed: 0,
        steps: 40,
        cfg_scale: 7.5
      }),
      signal: controller.signal // Bind signal
    });
    
    clearTimeout(timeoutId); // Clear timeout on success

    if (!stepfunRes.ok) {
      const errText = await stepfunRes.text();
      console.error('[Design Gen] StepFun Error:', stepfunRes.status, errText);
      res.status(stepfunRes.status).json({
        ok: false,
        errorCode: `UPSTREAM_${stepfunRes.status}`,
        message: `Upstream error: ${errText}`
      });
      return;
    }

    const data = await stepfunRes.json();
    const resultUrl = data.data?.[0]?.url;

    if (!resultUrl) {
      console.error('[Design Gen] Invalid response:', data);
      res.status(502).json({ ok: false, errorCode: 'INVALID_RESPONSE', message: 'No image URL received' });
      return;
    }

    // 3. Download Result and Upload to Blob
    console.log(`[Design Gen] Downloading result from: ${resultUrl}`);
    const resultImgRes = await fetch(resultUrl);
    if (!resultImgRes.ok) throw new Error('Failed to download generated image');
    
    const resultBlob = await put(`ningle-results/${Date.now()}-generated.jpg`, resultImgRes.body, {
      access: 'public',
    });

    res.status(200).json({
      ok: true,
      resultBlobUrl: resultBlob.url,
      seed: data.data?.[0]?.seed,
      finish_reason: data.data?.[0]?.finish_reason
    });

  } catch (error) {
    clearTimeout(timeoutId);
    console.error('[Design Gen] Exception:', error);
    res.status(500).json({
      ok: false,
      errorCode: error.name === 'AbortError' ? 'TIMEOUT' : 'INTERNAL_ERROR',
      message: error.name === 'AbortError' ? 'Image generation timed out (server-side)' : error.message
    });
  }
}
