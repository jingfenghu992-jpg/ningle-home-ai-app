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

  // Fallback to StepFun keys (Try all available keys)
  const apiKey = 
    process.env.STEPFUN_IMAGE_API_KEY || 
    process.env.STEPFUN_VISION_API_KEY || 
    process.env.STEPFUN_VISION_API_KEY_2;

  if (!apiKey) {
    console.error('Missing StepFun API Key');
    res.status(500).json({ 
        ok: false, 
        errorCode: 'MISSING_KEY', 
        message: 'Missing StepFun API key (checked STEPFUN_IMAGE/VISION_API_KEY)' 
    });
    return;
  }

  // Use server-side timeout to fail fast (110s)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 110000);

  try {
    let sourceImageUrl = baseImageBlobUrl;
    let dataUrl = null;

    // Optimization: If baseImageBlobUrl is already a data URL, use it directly.
    // Otherwise, try to convert it to data URL server-side to avoid CORS/Auth issues with StepFun.
    if (baseImageBlobUrl.startsWith('data:')) {
        dataUrl = baseImageBlobUrl;
    } else {
        // Fetch the base image from Blob/URL
        console.log(`[Design Gen] Fetching base image from: ${baseImageBlobUrl}`);
        const imageRes = await fetch(baseImageBlobUrl);
        if (!imageRes.ok) {
            throw new Error(`Failed to fetch base image: ${imageRes.statusText}`);
        }
        const arrayBuffer = await imageRes.arrayBuffer();
        const base64Image = Buffer.from(arrayBuffer).toString('base64');
        dataUrl = `data:${imageRes.headers.get('content-type') || 'image/jpeg'};base64,${base64Image}`;
    }
    
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
        source_weight: 0.45,
        size: size,
        n: 1,
        response_format: "url", // Keep using URL to get the result
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
        message: `Upstream error: ${errText}`,
        step: 'call_stepfun'
      });
      return;
    }

    const data = await stepfunRes.json();
    const resultUrl = data.data?.[0]?.url;

    if (!resultUrl) {
      console.error('[Design Gen] Invalid response:', data);
      res.status(502).json({ 
          ok: false, 
          errorCode: 'INVALID_RESPONSE', 
          message: 'No image URL received from StepFun',
          step: 'parse_response'
      });
      return;
    }

    // 3. Return Success IMMEDIATELY (Soft Return)
    // We will attempt to save to Blob asynchronously or in a try-catch block,
    // but the primary goal is to return the image to the user.
    
    let finalBlobUrl = null;

    // Try to upload to Vercel Blob for persistence
    try {
        console.log(`[Design Gen] Downloading result from: ${resultUrl}`);
        const resultImgRes = await fetch(resultUrl);
        if (resultImgRes.ok) {
            // Check if BLOB_READ_WRITE_TOKEN is set
            if (process.env.BLOB_READ_WRITE_TOKEN) {
                const resultBlob = await put(`ningle-results/${Date.now()}-generated.jpg`, resultImgRes.body, {
                    access: 'public',
                });
                finalBlobUrl = resultBlob.url;
                console.log(`[Design Gen] Saved to Blob: ${finalBlobUrl}`);
            } else {
                console.warn('[Design Gen] BLOB_READ_WRITE_TOKEN missing, skipping persistence.');
            }
        } else {
            console.warn('[Design Gen] Failed to download generated image for persistence');
        }
    } catch (blobError) {
        console.warn('[Design Gen] Blob upload failed (non-fatal):', blobError);
        // Do not fail the request
    }

    // Return the result
    // If blob upload succeeded, return that.
    // If blob upload failed (or no token), return the StepFun temporary URL directly.
    // StepFun URLs might expire, but it's better than 500 error.
    res.status(200).json({
      ok: true,
      resultBlobUrl: finalBlobUrl || resultUrl, // Fallback to StepFun URL
      isTemporaryUrl: !finalBlobUrl, // Flag to frontend
      seed: data.data?.[0]?.seed,
      finish_reason: data.data?.[0]?.finish_reason
    });

  } catch (error) {
    clearTimeout(timeoutId);
    console.error('[Design Gen] Exception:', error);
    res.status(500).json({
      ok: false,
      errorCode: error.name === 'AbortError' ? 'TIMEOUT' : 'INTERNAL_ERROR',
      message: error.name === 'AbortError' ? 'Image generation timed out (server-side)' : error.message,
      step: 'internal_process'
    });
  }
}
