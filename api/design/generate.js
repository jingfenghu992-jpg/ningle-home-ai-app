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

  const {
    prompt,
    baseImageBlobUrl,
    size,
    renderIntake,
    // StepFun image2image params (optional overrides)
    source_weight,
    steps,
    cfg_scale,
    seed,
    response_format
  } = req.body;

  const allowedSizes = new Set([
    "256x256", "512x512", "768x768", "1024x1024",
    "1280x800", "800x1280"
  ]);
  const finalSize = (typeof size === 'string' && allowedSizes.has(size)) ? size : "1024x1024";

  // StepFun doc: smaller source_weight => closer to source (less deformation)
  const finalSourceWeight =
    typeof source_weight === 'number' && source_weight > 0 && source_weight <= 1
      ? source_weight
      : 0.4;

  const finalSteps =
    Number.isInteger(steps) && steps >= 1 && steps <= 100
      ? steps
      : 40;

  const finalCfgScale =
    typeof cfg_scale === 'number' && cfg_scale >= 1 && cfg_scale <= 10
      ? cfg_scale
      : 6.0;

  const finalSeed =
    Number.isInteger(seed) && seed > 0
      ? seed
      : undefined;

  const finalResponseFormat =
    response_format === 'b64_json' || response_format === 'url'
      ? response_format
      : 'b64_json';

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
    // Construct Prompt Server-Side if renderIntake is provided
    let finalPrompt = prompt;
    if (renderIntake) {
        const { space, style, color, requirements } = renderIntake;
        // Keep prompt simple and direct for StepFun
        finalPrompt = `Realistic interior design render of ${space || 'room'}, ${style || 'modern'} style, ${color || 'neutral'} color scheme. ${requirements || ''}. Keep structural elements unchanged. High quality, photorealistic.`;
    }

    if (!finalPrompt) {
         res.status(400).json({ ok: false, message: 'Missing prompt or renderIntake' });
         return;
    }

    // --- STRATEGY A: Try Blob URL directly ---
    let sourceUrl = baseImageBlobUrl;
    let usedFallback = false;

    const callStepFun = async (urlToUse) => {
        console.log(`[Design Gen] Calling StepFun image2image with ${urlToUse.slice(0, 50)}...`);
        return await fetch('https://api.stepfun.com/v1/images/image2image', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'step-1x-medium',
            prompt: finalPrompt,
            source_url: urlToUse,
            source_weight: finalSourceWeight,
            size: finalSize,
            n: 1,
            response_format: finalResponseFormat,
            seed: finalSeed,
            steps: finalSteps,
            cfg_scale: finalCfgScale
          })
        });
    };

    // Quick preflight check for public URL access (non-fatal; we can still try)
    if (sourceUrl.startsWith('http')) {
        try {
            const headRes = await fetch(sourceUrl, { method: 'HEAD' });
            if (!headRes.ok && headRes.status !== 405) {
                console.warn(`[Design Gen] source_url HEAD not OK: ${headRes.status}`);
            }
        } catch (e) {
            console.warn('[Design Gen] source_url HEAD failed:', e?.message || e);
        }
    }

    let stepfunRes = await callStepFun(sourceUrl);
    let lastUpstreamErrorText = null;

    // --- STRATEGY B: Fallback to Base64 if URL fails ---
    if (!stepfunRes.ok) {
        const errText = await stepfunRes.text();
        lastUpstreamErrorText = errText;
        console.warn(`[Design Gen] Strategy A failed (${stepfunRes.status}): ${errText}`);
        
        // If it's not a data URL already, try to fetch and convert
        if (!baseImageBlobUrl.startsWith('data:')) {
            console.log('[Design Gen] Strategy B: Fallback to Base64...');
            try {
                const imageRes = await fetch(baseImageBlobUrl);
                if (imageRes.ok) {
                    const ab = await imageRes.arrayBuffer();
                    const b64 = Buffer.from(ab).toString('base64');
                    const mime = imageRes.headers.get('content-type') || 'image/jpeg';
                    sourceUrl = `data:${mime};base64,${b64}`;
                    usedFallback = true;
                    
                    // Retry with Base64
                    stepfunRes = await callStepFun(sourceUrl);
                    if (!stepfunRes.ok) {
                        const errText2 = await stepfunRes.text();
                        lastUpstreamErrorText = errText2;
                        console.warn(`[Design Gen] Strategy B failed (${stepfunRes.status}): ${errText2}`);
                    }
                } else {
                    console.error('[Design Gen] Failed to fetch image for fallback');
                }
            } catch (e) {
                console.error('[Design Gen] Error preparing fallback:', e);
            }
        }
    }

    if (!stepfunRes.ok) {
        const msg = lastUpstreamErrorText || '(no upstream body)';
        throw new Error(`StepFun API Error: ${stepfunRes.status} ${msg}`);
    }

    const data = await stepfunRes.json();
    const first = data.data?.[0];
    const finishReason = first?.finish_reason;
    const resultSeed = first?.seed ?? data.seed;
    const resultUrl = first?.url;
    const resultImageB64 = first?.image;

    if (finalResponseFormat === 'url') {
        if (!resultUrl) {
            throw new Error(`No image URL received from StepFun (finish_reason=${finishReason || 'unknown'})`);
        }
    } else {
        if (!resultImageB64) {
            throw new Error(`No image base64 received from StepFun (finish_reason=${finishReason || 'unknown'})`);
        }
    }

    // Try persistence (Non-fatal)
    let finalBlobUrl = null;
    try {
        if (process.env.BLOB_READ_WRITE_TOKEN && finalResponseFormat === 'url') {
            const imgRes = await fetch(resultUrl);
            if (imgRes.ok) {
                const blob = await put(`ningle-results/${Date.now()}.jpg`, imgRes.body, { access: 'public' });
                finalBlobUrl = blob.url;
            }
        }
    } catch (e) {
        console.warn('Blob persistence failed:', e);
    }

    const finalResult =
      finalResponseFormat === 'url'
        ? (finalBlobUrl || resultUrl)
        : `data:image/jpeg;base64,${resultImageB64}`;

    res.status(200).json({
        ok: true,
        resultBlobUrl: finalResult,
        isTemporaryUrl: finalResponseFormat === 'url' ? !finalBlobUrl : true,
        debug: {
            usedFallback,
            size: finalSize,
            source_weight: finalSourceWeight,
            steps: finalSteps,
            cfg_scale: finalCfgScale,
            seed: resultSeed,
            finish_reason: finishReason
        }
    });

  } catch (error) {
    console.error('[Design Gen] Error:', error);
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
}
