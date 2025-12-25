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

        const normalize = (s) => String(s || '').trim();
        const compact = (s, max = 360) => {
            const t = normalize(s).replace(/\s+/g, ' ');
            return t.length > max ? t.slice(0, max) + '…' : t;
        };

        // Map user-facing (mostly Chinese) selections into explicit English design constraints
        const mapSpace = (s) => {
            const t = normalize(s);
            if (t.includes('餐')) return 'dining room';
            if (t.includes('客')) return 'living room';
            if (t.includes('廚') || t.includes('厨')) return 'kitchen';
            if (t.includes('玄') || t.includes('关') || t.includes('關')) return 'entryway';
            if (t.includes('書') || t.includes('书')) return 'study room';
            if (t.includes('睡') || t.includes('卧') || t.includes('房')) return 'bedroom';
            if (t.includes('浴') || t.includes('厕') || t.includes('衛') || t.includes('卫')) return 'bathroom';
            return t ? `room (${t})` : 'room';
        };

        const mapStyle = (s) => {
            const t = normalize(s);
            if (t.includes('日式') || t.includes('木')) return 'Japandi / Japanese wood minimalist, warm and calm, clean lines, natural wood details';
            if (t.includes('奶油')) return 'Creamy minimal style, soft warm palette, rounded details, cozy';
            if (t.includes('輕奢') || t.includes('轻奢')) return 'Light luxury modern style, subtle metal accents, refined materials';
            if (t.includes('現代') || t.includes('现代') || t.includes('簡約') || t.includes('简约')) return 'Modern minimalist, clean geometry, practical';
            return t || 'Modern minimalist';
        };

        const mapColor = (s) => {
            const t = normalize(s);
            if (t.includes('淺木') || t.includes('浅木')) return 'light oak wood + off-white, warm neutral';
            if (t.includes('胡桃')) return 'walnut wood + gray-white, warm gray neutral';
            if (t.includes('純白') || t.includes('纯白')) return 'pure white + light gray, clean and bright';
            if (t.includes('深木')) return 'dark wood + warm white, cozy contrast';
            return t || 'neutral';
        };

        const inferFromRequirements = (req, keys) => {
            const r = normalize(req);
            for (const k of keys) {
                if (r.includes(k)) return k;
            }
            return '';
        };

        // These fields are currently embedded in requirements text on the client,
        // so we infer keywords to steer the prompt harder.
        const reqText = normalize(requirements);
        const focusKw = inferFromRequirements(reqText, ['餐邊', '餐边', '餐桌', '動線', '动线', '電視', '电视', '衣櫃', '衣柜', '玄關', '玄关', '書枱', '书桌', '收納牆', '收纳墙']);
        const storageKw = inferFromRequirements(reqText, ['隱藏', '隐藏', '展示', '工作位', '书桌', '書枱']);
        const priorityKw = inferFromRequirements(reqText, ['性價比', '性价比', '耐用', '易打理']);
        const intensityKw = inferFromRequirements(reqText, ['輕改', '轻改', '明顯', '明显', '大改造']);

        const focusHint = focusKw
            ? `Focus area: ${focusKw.includes('餐') ? 'dining layout + dining sideboard / tall storage' : focusKw}.`
            : '';
        const storageHint = storageKw
            ? `Storage direction: ${storageKw.includes('隱') || storageKw.includes('隐') ? 'mostly concealed storage with clean fronts' : storageKw.includes('展示') ? 'mix of display + concealed storage (glass/openshelf + closed cabinets)' : 'storage with a work desk / study nook integration'}.`
            : '';
        const priorityHint = priorityKw
            ? `Priority: ${priorityKw.includes('耐用') ? 'durability' : priorityKw.includes('易') ? 'easy to clean' : 'value-for-money'}.`
            : '';
        const intensityHint = intensityKw
            ? `Renovation intensity: ${intensityKw.includes('輕') || intensityKw.includes('轻') ? 'light refresh, keep closer to source' : intensityKw.includes('大') ? 'bolder redesign, more visible changes' : 'noticeable redesign with structure preserved'}.`
            : '';

        const spaceEn = mapSpace(space);
        const styleEn = mapStyle(style);
        const colorEn = mapColor(color);

        // Hard constraints for HK apartment + balcony cases
        const hardRules = [
            'Photorealistic interior design rendering (professional).',
            'Hong Kong apartment practicality, built-in cabinetry is the main change.',
            'INTERIOR ONLY: do NOT redesign the balcony or outdoor view; keep balcony/exterior as background unchanged.',
            'Do NOT add balcony furniture; do NOT change balcony floor/walls/railings.',
            'Keep the exact room structure and perspective: do NOT move windows/doors/beams/columns; keep camera viewpoint.',
        ].join(' ');

        const mustHave = [
            'Must include: a coherent cabinetry/storage plan; wall finish; floor finish; simple ceiling detail (cove/false ceiling); lighting plan; soft furnishings.',
            spaceEn.includes('dining') ? 'Dining must-have: place a dining table and chairs with clear circulation, plus a dining sideboard/tall pantry storage.' : '',
        ].filter(Boolean).join(' ');

        const quality = 'Materials: ENF-grade multilayer wood/plywood cabinetry. Lighting: warm, natural, not oversharpened. Clean realistic textures, no cartoon look.';

        const extraReq = compact(requirements, 380);

        // Keep prompt explicit and mostly English for better adherence.
        finalPrompt = [
            `Design a ${spaceEn}.`,
            `Style: ${styleEn}.`,
            `Color palette: ${colorEn}.`,
            hardRules,
            focusHint,
            storageHint,
            priorityHint,
            intensityHint,
            mustHave,
            quality,
            extraReq ? `Constraints/notes: ${extraReq}` : ''
        ].filter(Boolean).join(' ');
    }

    if (!finalPrompt) {
         res.status(400).json({ ok: false, message: 'Missing prompt or renderIntake' });
         return;
    }

    // StepFun: prompt length must be 1..1024 chars
    finalPrompt = String(finalPrompt).replace(/\s+/g, ' ').trim();
    if (finalPrompt.length === 0) {
        res.status(400).json({ ok: false, message: 'Invalid prompt (empty)' });
        return;
    }
    if (finalPrompt.length > 1024) {
        finalPrompt = finalPrompt.slice(0, 1021) + '...';
    }

    // --- STRATEGY A: Try Blob URL directly ---
    let sourceUrl = baseImageBlobUrl;
    let usedFallback = false;

    const callStepFun = async (urlToUse, rf = finalResponseFormat) => {
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
            response_format: rf,
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

    let stepfunRes = await callStepFun(sourceUrl, finalResponseFormat);
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
                    stepfunRes = await callStepFun(sourceUrl, finalResponseFormat);
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

    const readStepFunJson = async (r) => {
        try {
            return await r.json();
        } catch (e) {
            const t = await r.text().catch(() => '');
            throw new Error(`StepFun invalid JSON response: ${t || '(empty)'}`);
        }
    };

    const fetchUrlToB64 = async (url) => {
        const imgRes = await fetch(url);
        if (!imgRes.ok) return null;
        const ab = await imgRes.arrayBuffer();
        const mime = imgRes.headers.get('content-type') || 'image/jpeg';
        const b64 = Buffer.from(ab).toString('base64');
        return { mime, b64 };
    };

    const extractResult = (data) => {
        const first = data?.data?.[0] || {};
        const finishReason = first?.finish_reason;
        const resultSeed = first?.seed ?? data?.seed;
        // StepFun variants: b64_json / image / base64
        const resultImageB64 = first?.b64_json || first?.image || first?.base64 || first?.b64;
        // StepFun variants: url / image_url
        const resultUrl = first?.url || first?.image_url;
        return { first, finishReason, resultSeed, resultImageB64, resultUrl };
    };

    let data = await readStepFunJson(stepfunRes);
    let { finishReason, resultSeed, resultImageB64, resultUrl } = extractResult(data);

    // Some successful responses may omit the requested field; do one safe retry by flipping response_format.
    const hasImage = Boolean(resultImageB64 || resultUrl);
    if (!hasImage) {
        const alt = finalResponseFormat === 'b64_json' ? 'url' : 'b64_json';
        console.warn(`[Design Gen] No image payload despite success; retrying with response_format=${alt}`);
        const retryRes = await callStepFun(sourceUrl, alt);
        if (retryRes.ok) {
            data = await readStepFunJson(retryRes);
            ({ finishReason, resultSeed, resultImageB64, resultUrl } = extractResult(data));
        }
    }

    // If client asked for base64 but only URL exists, fetch and convert.
    let fetchedB64 = null;
    if (finalResponseFormat === 'b64_json' && !resultImageB64 && resultUrl) {
        fetchedB64 = await fetchUrlToB64(resultUrl);
        if (fetchedB64?.b64) resultImageB64 = fetchedB64.b64;
    }

    // If client asked for URL but only base64 exists, just return data-url (still viewable).
    if (finalResponseFormat === 'url' && !resultUrl && resultImageB64) {
        // no-op: we will build data URL below
    }

    if (finalResponseFormat === 'url') {
        if (!resultUrl && !resultImageB64) {
            throw new Error(`No image received from StepFun (finish_reason=${finishReason || 'unknown'})`);
        }
    } else {
        if (!resultImageB64) {
            throw new Error(`No image base64 received from StepFun (finish_reason=${finishReason || 'unknown'})`);
        }
    }

    // Try persistence (Non-fatal)
    let finalBlobUrl = null;
    try {
        // Persist whenever we have a URL; if only base64 exists, skip persistence.
        if (process.env.BLOB_READ_WRITE_TOKEN && resultUrl) {
            const imgRes = await fetch(resultUrl);
            if (imgRes.ok) {
                const blob = await put(`ningle-results/${Date.now()}.jpg`, imgRes.body, { access: 'public' });
                finalBlobUrl = blob.url;
            }
        }
    } catch (e) {
        console.warn('Blob persistence failed:', e);
    }

    const finalResult = (() => {
        if (finalResponseFormat === 'url') {
            if (finalBlobUrl) return finalBlobUrl;
            if (resultUrl) return resultUrl;
            // fallback: return data url
            return `data:image/jpeg;base64,${resultImageB64}`;
        }
        // b64_json: always return data url
        const mime = fetchedB64?.mime || 'image/jpeg';
        return `data:${mime};base64,${resultImageB64}`;
    })();

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
