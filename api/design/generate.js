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

  const apiKey = process.env.STEPFUN_API_KEY;

  if (!apiKey) {
    res.status(500).json({ 
        ok: false, 
        errorCode: 'MISSING_KEY', 
        message: 'Missing STEPFUN_API_KEY' 
    });
    return;
  }

  try {
    let dataUrl = baseImageBlobUrl;
    // Ensure we have data URL for StepFun
    if (!baseImageBlobUrl.startsWith('data:')) {
        const imageRes = await fetch(baseImageBlobUrl);
        if (imageRes.ok) {
            const ab = await imageRes.arrayBuffer();
            const b64 = Buffer.from(ab).toString('base64');
            dataUrl = `data:${imageRes.headers.get('content-type')||'image/jpeg'};base64,${b64}`;
        }
    }

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
        source_weight: 0.55, // Adjusted for balance
        size: size,
        n: 1,
        response_format: "url",
        steps: 40,
        cfg_scale: 7.5
      })
    });

    if (!stepfunRes.ok) {
      throw new Error(`StepFun API Error: ${stepfunRes.status} ${await stepfunRes.text()}`);
    }

    const data = await stepfunRes.json();
    const resultUrl = data.data?.[0]?.url;

    if (!resultUrl) {
      throw new Error('No image URL received from StepFun');
    }

    // Try persistence (Non-fatal)
    let finalBlobUrl = null;
    try {
        if (process.env.BLOB_READ_WRITE_TOKEN) {
            const imgRes = await fetch(resultUrl);
            if (imgRes.ok) {
                const blob = await put(`ningle-results/${Date.now()}.jpg`, imgRes.body, { access: 'public' });
                finalBlobUrl = blob.url;
            }
        }
    } catch (e) {
        console.warn('Blob persistence failed:', e);
    }

    res.status(200).json({
      ok: true,
      resultBlobUrl: finalBlobUrl || resultUrl,
      isTemporaryUrl: !finalBlobUrl
    });

  } catch (error) {
    console.error('[Design Gen] Error:', error);
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
}
