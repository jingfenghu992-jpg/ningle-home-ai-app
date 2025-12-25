import { put, list } from '@vercel/blob';
import { createHash } from 'crypto';

// Bump this whenever prompt logic changes, to avoid returning stale cached renders.
const PROMPT_VERSION = 'v4-render-20251225';

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
    clientId,
    uploadId,
    jobId,
    // StepFun image2image params (optional overrides)
    source_weight,
    steps,
    cfg_scale,
    seed,
    response_format
  } = req.body;

  const safeClientId = String(clientId || 'anon').slice(0, 80);
  const safeUploadId = String(uploadId || '').slice(0, 120);
  const safeJobId = String(jobId || '').slice(0, 120);

  const stableStringify = (obj) => {
    const seen = new WeakSet();
    const helper = (v) => {
      if (v === null || typeof v !== 'object') return v;
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
      if (Array.isArray(v)) return v.map(helper);
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = helper(v[k]);
      return out;
    };
    return JSON.stringify(helper(obj));
  };

  const normalizeUrlForKey = (u) => {
    const s = String(u || '');
    if (s.startsWith('data:')) return `data:${createHash('sha1').update(s).digest('hex')}`;
    try {
      const url = new URL(s);
      return `${url.origin}${url.pathname}`;
    } catch {
      return s.slice(0, 512);
    }
  };

  const hashKey = (s) => createHash('sha256').update(String(s)).digest('hex');

  const getLatestByExactPath = async (pathname) => {
    try {
      const result = await list({ prefix: pathname, limit: 10 });
      const items = (result?.blobs || []).filter(b => b.pathname === pathname);
      if (!items.length) return null;
      items.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
      return items[0];
    } catch {
      return null;
    }
  };

  const readJsonFromUrl = async (url) => {
    const r = await fetch(url);
    if (!r.ok) return null;
    try { return await r.json(); } catch { return null; }
  };

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
    // --- Job idempotency + cache (for large-scale public usage) ---
    const cacheKeyPayload = stableStringify({
      promptVersion: PROMPT_VERSION,
      base: normalizeUrlForKey(baseImageBlobUrl),
      size: String(size || ''),
      renderIntake: renderIntake || null,
      source_weight,
      steps,
      cfg_scale,
      seed
    });
    const cacheKey = hashKey(cacheKeyPayload);
    const cachePath = `ningle-cache/${cacheKey}.json`;

    // 1) If this exact jobId was already completed, return it.
    if (safeClientId && safeJobId) {
      const jobPath = `ningle-jobs/${safeClientId}/${safeJobId}.json`;
      const jobBlob = await getLatestByExactPath(jobPath);
      if (jobBlob?.url) {
        const job = await readJsonFromUrl(jobBlob.url);
        if (job?.status === 'done' && job?.resultBlobUrl) {
          res.status(200).json({ ok: true, resultBlobUrl: job.resultBlobUrl, debug: { ...(job.debug || {}), jobId: safeJobId, cacheHit: true } });
          return;
        }
        if (job?.status === 'running') {
          const startedAt = Number(job.startedAt || 0);
          if (startedAt && Date.now() - startedAt < 3 * 60 * 1000) {
            res.status(200).json({ ok: false, errorCode: 'IN_PROGRESS', message: 'Job is running', jobId: safeJobId });
            return;
          }
        }
      }

      // Mark job running (best-effort)
      try {
        const running = {
          status: 'running',
          startedAt: Date.now(),
          clientId: safeClientId,
          uploadId: safeUploadId || undefined,
          cacheKey
        };
        await put(jobPath, Buffer.from(JSON.stringify(running)), { access: 'public', contentType: 'application/json' });
      } catch (e) {
        console.warn('[Design Gen] Failed to write running job record:', e?.message || e);
      }
    }

    // 2) Content-addressed cache: if same image+intake already generated, return instantly.
    const cacheBlob = await getLatestByExactPath(cachePath);
    if (cacheBlob?.url) {
      const cached = await readJsonFromUrl(cacheBlob.url);
      if (cached?.resultBlobUrl) {
        res.status(200).json({
          ok: true,
          resultBlobUrl: cached.resultBlobUrl,
          isTemporaryUrl: !!cached.isTemporaryUrl,
          debug: { ...(cached.debug || {}), cacheHit: true, jobId: safeJobId || undefined }
        });
        return;
      }
    }

    // Construct Prompt Server-Side if renderIntake is provided
    let finalPrompt = prompt;
    if (renderIntake) {
        const { space, style, color, requirements, focus, storage, priority, intensity } = renderIntake;

        const normalize = (s) => String(s || '').trim();
        const compact = (s, max = 360) => {
            const t = normalize(s).replace(/\s+/g, ' ');
            return t.length > max ? t.slice(0, max) + '…' : t;
        };
        const trimPrompt = (s) => {
            let t = String(s || '').replace(/\s+/g, ' ').trim();
            if (t.length > 1024) t = t.slice(0, 1021) + '...';
            return t;
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

        // Prefer structured fields; fallback to inferring from requirements.
        const reqText = normalize(requirements);
        const focusKw = normalize(focus) || inferFromRequirements(reqText, ['餐邊', '餐边', '餐桌', '動線', '动线', '電視', '电视', '衣櫃', '衣柜', '玄關', '玄关', '書枱', '书桌', '收納牆', '收纳墙']);
        const storageKw = normalize(storage) || inferFromRequirements(reqText, ['隱藏', '隐藏', '展示', '工作位', '书桌', '書枱']);
        const priorityKw = normalize(priority) || inferFromRequirements(reqText, ['性價比', '性价比', '耐用', '易打理']);
        const intensityKw = normalize(intensity) || inferFromRequirements(reqText, ['輕改', '轻改', '明顯', '明显', '大改造']);

        const mapFocus = (kw, spaceEn) => {
            const k = normalize(kw);
            if (!k) return '';
            if (String(spaceEn).includes('dining') || k.includes('餐')) {
                return 'Focus: dining circulation + dining table for 4 + dining sideboard/tall pantry storage as the main design feature.';
            }
            if (k.includes('電視') || k.includes('电视')) return 'Focus: TV wall built-in storage wall with concealed cabinets + open display niches.';
            if (k.includes('衣櫃') || k.includes('衣柜')) return 'Focus: full-height wardrobe system with practical internal compartments.';
            if (k.includes('玄關') || k.includes('玄关')) return 'Focus: entry shoe cabinet + bench + full-height storage + hidden clutter zone.';
            if (k.includes('書枱') || k.includes('书桌') || k.includes('工作')) return 'Focus: built-in desk + storage wall integration (work/study corner).';
            if (k.includes('牆') || k.includes('墙')) return 'Focus: feature storage wall with mix of concealed + display.';
            return `Focus: ${k}.`;
        };

        const mapStorage = (kw) => {
            const k = normalize(kw);
            if (!k) return '';
            if (k.includes('隱') || k.includes('隐')) return 'Storage: prioritize concealed storage (flat fronts), clean and uncluttered.';
            if (k.includes('展示')) return 'Storage: mix of display (glass/open shelves with lighting) + concealed storage to keep tidy.';
            if (k.includes('書枱') || k.includes('书桌') || k.includes('工作')) return 'Storage: integrate storage with a desk/work nook.';
            return `Storage: ${k}.`;
        };

        const mapPriority = (kw) => {
            const k = normalize(kw);
            if (!k) return '';
            if (k.includes('耐用')) return 'Priority: durability (scratch-resistant finishes, robust hardware).';
            if (k.includes('易')) return 'Priority: easy to clean (matte anti-fingerprint surfaces, stain-resistant finishes).';
            if (k.includes('性')) return 'Priority: value-for-money (simple, efficient cabinetry layout).';
            return `Priority: ${k}.`;
        };

        const mapIntensity = (kw) => {
            const k = normalize(kw);
            if (!k) return '';
            if (k.includes('輕') || k.includes('轻')) return 'Intensity: light refresh (still must look fully finished).';
            if (k.includes('大')) return 'Intensity: bold redesign, visible changes while keeping structure.';
            return 'Intensity: noticeable redesign (recommended), clearly different from the original bare room.';
        };

        const focusHint = mapFocus(focusKw, mapSpace(space));
        const storageHint = mapStorage(storageKw);
        const priorityHint = mapPriority(priorityKw);
        const intensityHint = mapIntensity(intensityKw);

        const spaceEn = mapSpace(space);
        const styleEn = mapStyle(style);
        const colorEn = mapColor(color);

        // Hard constraints for HK apartment + balcony cases
        const hardRules = [
            'Photorealistic high-end interior design rendering, V-Ray/Corona render style, magazine quality, beautiful and finished.',
            'This must look like a real interior design proposal render, NOT an empty room.',
            'Hong Kong apartment practicality, built-in cabinetry is the main change.',
            'INTERIOR ONLY: do NOT redesign the balcony or outdoor view; keep balcony/exterior as background unchanged.',
            'Do NOT add balcony furniture; do NOT change balcony floor/walls/railings/exterior facade.',
            'Keep the exact room structure and perspective: do NOT move windows/doors/beams/columns; keep camera viewpoint.',
            'Do NOT leave bare concrete floor or unfinished walls; fully finish the interior.',
        ].join(' ');

        const mustHave = [
            'Must include: finished flooring (engineered wood or large-format porcelain tiles with skirting), finished wall surfaces, and a proper ceiling design (gypsum false ceiling / cove lighting + downlights).',
            'Must include: built-in cabinetry plan with real details (full-height cabinets, toe-kick, shadow gap or integrated handles, internal compartments).',
            'Must include: a complete furniture layout + soft furnishings (curtains, rug, artwork, plants), warm realistic lighting, coherent styling.',
            spaceEn.includes('dining') ? 'Dining must-have: dining table for 4 + chairs with clear circulation, pendant light above table, and a dining sideboard/tall pantry storage with display niche lighting.' : '',
        ].filter(Boolean).join(' ');

        const quality = [
            'Materials: ENF-grade multilayer wood/plywood cabinetry.',
            'Lighting: warm, natural; balanced exposure; not oversharpened.',
            'Clean realistic textures; no cartoon/CGI look; no low-poly.',
            'Avoid: empty room, blank walls, unfinished concrete, muddy textures.'
        ].join(' ');

        const extraReq = compact(requirements, 380);

        // Keep prompt explicit and mostly English for better adherence.
        // Put hard constraints + must-have early to avoid being truncated away.
        finalPrompt = trimPrompt([
            hardRules,
            mustHave,
            `Space: ${spaceEn}.`,
            `Style: ${styleEn}.`,
            `Color palette: ${colorEn}.`,
            focusHint,
            storageHint,
            priorityHint,
            intensityHint,
            quality,
            extraReq ? `Constraints/notes: ${extraReq}` : ''
        ].filter(Boolean).join(' '));
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

    const callStepFun = async ({
        urlToUse,
        rf = finalResponseFormat,
        promptToUse = finalPrompt,
        sw = finalSourceWeight,
        st = finalSteps,
        cfg = finalCfgScale
    }) => {
        console.log(`[Design Gen] Calling StepFun image2image with ${urlToUse.slice(0, 50)}...`);
        return await fetch('https://api.stepfun.com/v1/images/image2image', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'step-1x-medium',
            prompt: promptToUse,
            source_url: urlToUse,
            source_weight: sw,
            size: finalSize,
            n: 1,
            response_format: rf,
            seed: finalSeed,
            steps: st,
            cfg_scale: cfg
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

    let stepfunRes = await callStepFun({ urlToUse: sourceUrl, rf: finalResponseFormat });
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
                    stepfunRes = await callStepFun({ urlToUse: sourceUrl, rf: finalResponseFormat });
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
        // One more safety retry: lower cfg/steps to improve stability under load
        try {
            const retryRes = await callStepFun({
                urlToUse: sourceUrl,
                rf: finalResponseFormat,
                sw: Math.min(0.52, finalSourceWeight),
                st: Math.min(32, finalSteps),
                cfg: Math.min(6.6, finalCfgScale)
            });
            if (retryRes.ok) {
                stepfunRes = retryRes;
            } else {
                const msg = lastUpstreamErrorText || '(no upstream body)';
                throw new Error(`StepFun API Error: ${stepfunRes.status} ${msg}`);
            }
        } catch (e) {
            const msg = lastUpstreamErrorText || '(no upstream body)';
            throw new Error(`StepFun API Error: ${stepfunRes.status} ${msg}`);
        }
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
        const retryRes = await callStepFun({ urlToUse: sourceUrl, rf: alt });
        if (retryRes.ok) {
            data = await readStepFunJson(retryRes);
            ({ finishReason, resultSeed, resultImageB64, resultUrl } = extractResult(data));
        }
    }

    // Optional second-pass refinement: keep structure, but make it look like slicing-ready design render.
    // This helps cases where first pass is still too empty / not "designed".
    const shouldRefine = (() => {
        const norm = (s) => String(s || '').trim();
        const k = norm(renderIntake?.intensity || '');
        if (!k) return true;
        return !(k.includes('輕') || k.includes('轻'));
    })();

    if (shouldRefine) {
        try {
            const refineSource =
                resultUrl
                    ? resultUrl
                    : (resultImageB64 ? `data:image/jpeg;base64,${resultImageB64}` : null);
            if (refineSource) {
                const refinePrompt = (() => {
                    const suffix = ' Refine into magazine-quality photorealistic interior render: add detailed cabinetry, ceiling cove lighting, finished flooring, wall finishes, and complete furniture + soft furnishings. Avoid empty room, avoid blank walls, avoid unfinished concrete.';
                    const t = String(finalPrompt + suffix).replace(/\s+/g, ' ').trim();
                    return t.length > 1024 ? t.slice(0, 1021) + '...' : t;
                })();
                const refineRes = await callStepFun({
                    urlToUse: refineSource,
                    rf: 'url',
                    promptToUse: refinePrompt,
                    // Lower weight to preserve the (already designed) first-pass image
                    sw: Math.min(0.34, finalSourceWeight),
                    st: Math.min(34, finalSteps),
                    cfg: Math.min(6.4, finalCfgScale)
                });
                if (refineRes.ok) {
                    const refineData = await readStepFunJson(refineRes);
                    const refined = extractResult(refineData);
                    if (refined.resultUrl || refined.resultImageB64) {
                        // Replace outputs with refined result
                        finishReason = refined.finishReason || finishReason;
                        resultSeed = refined.resultSeed ?? resultSeed;
                        resultImageB64 = refined.resultImageB64 || resultImageB64;
                        resultUrl = refined.resultUrl || resultUrl;
                    }
                } else {
                    console.warn(`[Design Gen] Refinement pass failed (${refineRes.status})`);
                }
            }
        } catch (e) {
            console.warn('[Design Gen] Refinement pass error:', e?.message || e);
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
                const resultPath = safeClientId
                  ? `ningle-results/${safeClientId}/${Date.now()}-${cacheKey.slice(0, 8)}.jpg`
                  : `ningle-results/${Date.now()}-${cacheKey.slice(0, 8)}.jpg`;
                const blob = await put(resultPath, imgRes.body, { access: 'public' });
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

    const responseBody = {
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
        finish_reason: finishReason,
        cacheKey,
        jobId: safeJobId || undefined
      }
    };

    // Write cache + finalize job (best-effort)
    try {
      await put(cachePath, Buffer.from(JSON.stringify({
        resultBlobUrl: finalResult,
        isTemporaryUrl: responseBody.isTemporaryUrl,
        debug: responseBody.debug,
        createdAt: Date.now()
      })), { access: 'public', contentType: 'application/json' });
    } catch (e) {
      console.warn('[Design Gen] Failed to write cache:', e?.message || e);
    }

    if (safeClientId && safeJobId) {
      try {
        const jobPath = `ningle-jobs/${safeClientId}/${safeJobId}.json`;
        await put(jobPath, Buffer.from(JSON.stringify({
          status: 'done',
          startedAt: Date.now(),
          finishedAt: Date.now(),
          clientId: safeClientId,
          uploadId: safeUploadId || undefined,
          cacheKey,
          resultBlobUrl: finalResult,
          debug: responseBody.debug
        })), { access: 'public', contentType: 'application/json' });
      } catch (e) {
        console.warn('[Design Gen] Failed to write done job record:', e?.message || e);
      }
    }

    res.status(200).json(responseBody);

  } catch (error) {
    console.error('[Design Gen] Error:', error);
    // Mark job failed (best-effort)
    try {
      if (safeClientId && safeJobId && process.env.BLOB_READ_WRITE_TOKEN) {
        const jobPath = `ningle-jobs/${safeClientId}/${safeJobId}.json`;
        await put(jobPath, Buffer.from(JSON.stringify({
          status: 'failed',
          finishedAt: Date.now(),
          clientId: safeClientId,
          uploadId: safeUploadId || undefined,
          message: error.message || 'Generation failed'
        })), { access: 'public', contentType: 'application/json' });
      }
    } catch (e) {
      console.warn('[Design Gen] Failed to write failed job record:', e?.message || e);
    }
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
}
