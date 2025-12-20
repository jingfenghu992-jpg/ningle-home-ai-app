import { put } from '@vercel/blob';

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

  try {
    // 1. Fetch the base image from Blob
    console.log(`[Design Gen] Fetching base image from: ${baseImageBlobUrl}`);
    const imageRes = await fetch(baseImageBlobUrl);
    if (!imageRes.ok) {
      throw new Error(`Failed to fetch base image: ${imageRes.statusText}`);
    }
    const arrayBuffer = await imageRes.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');
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
        source_url: dataUrl,
        source_weight: 0.45, // Adhering to requirement
        size: size,
        n: 1,
        response_format: "url", // StepFun returns URL for img2img usually, or b64_json. Docs say url is default/supported.
        seed: 0,
        steps: 40,
        cfg_scale: 7.5
      })
    });

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
    console.error('[Design Gen] Exception:', error);
    res.status(500).json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: error.message
    });
  }
}
