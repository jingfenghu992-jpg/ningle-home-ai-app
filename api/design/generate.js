// NOTE: We intentionally do NOT persist user images/results.
// This endpoint returns StepFun temporary URLs (or base64 data URLs) only.

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
    const safeJsonParse = (raw) => {
      try {
        const clean = String(raw || '').replace(/```json/g, '').replace(/```/g, '').trim();
        const s = clean.indexOf('{');
        const e = clean.lastIndexOf('}');
        if (s >= 0 && e > s) return JSON.parse(clean.slice(s, e + 1));
        return JSON.parse(clean);
      } catch {
        return null;
      }
    };

    const buildSpec = async (intake, opts) => {
      const normalize = (s) => String(s || '').trim();
      const compact = (s, max = 420) => {
        const t = normalize(s).replace(/\s+/g, ' ');
        return t.length > max ? t.slice(0, max) + '…' : t;
      };

      const payload = {
        space: normalize(intake?.space),
        style: normalize(intake?.style),
        color: normalize(intake?.color),
        focus: normalize(intake?.focus),
        storage: normalize(intake?.storage),
        priority: normalize(intake?.priority),
        intensity: normalize(intake?.intensity),
        constraints: compact(intake?.visionSummary || intake?.requirements || '', 520),
      };

      const mustInclude = Array.isArray(opts?.mustInclude) ? opts.mustInclude : [];
      const system = `You are a senior HK interior designer. Produce a compact, executable design spec that will be used for image-to-image generation.
Output MUST be valid JSON only, no extra text.
Rules:
- The generated image MUST look like a finished photorealistic interior render (V-Ray/Corona style).
- INTERIOR ONLY: do NOT redesign balcony/outdoor view; keep balcony as background unchanged.
- Do NOT move windows/doors/beams/columns; keep camera viewpoint/perspective.
- Preserve object geometry: keep window frames, doors, sofa/coffee-table shapes (if present) and do NOT warp/melt objects.
- Must include: ceiling detail (cove/false ceiling + downlights), finished flooring, finished wall surfaces, built-in cabinetry, lighting plan, and soft furnishings.
- The spec MUST match the final render and also match the explanation.
- Keep prompt_en <= 900 characters.

Space-specific must-haves:
- living room: MUST include TV + TV console + TV feature wall storage; sofa and coffee table (keep if present, otherwise add).
- dining room: MUST include dining table for 4 + chairs + pendant above table + dining sideboard/tall pantry.
- bedroom: MUST include bed + full-height wardrobe.
- kitchen: MUST include base cabinets + wall cabinets + countertop + sink/cooktop zone.

Return JSON schema:
{
  "prompt_en": "English prompt for img2img, <= 900 chars, concrete items + placements",
  "explain_zh": ["5-7 bullet points in Simplified Chinese, each directly reflected in prompt_en"],
  "checks": ["list of must-have tokens like CEILING, FLOOR, CABINET, SOFT, INTERIOR_ONLY, NO_BALCONY_CHANGE"]
}`;

      const user = `User selections (Chinese labels possible):
${JSON.stringify(payload)}

Write a design that fits a typical Hong Kong apartment and the constraints.
Make cabinetry placement explicit (e.g., right wall / left wall / opposite window).
Keep balcony unchanged.
MUST include these items in prompt_en and explain_zh (if applicable): ${mustInclude.join(', ') || '(none)'}.`;

      const resp = await fetch('https://api.stepfun.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'step-1-8k',
          temperature: 0.2,
          max_tokens: 700,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ]
        })
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '';
      const parsed = safeJsonParse(content);
      if (!parsed?.prompt_en) return null;

      let promptEn = String(parsed.prompt_en || '').replace(/\s+/g, ' ').trim();
      // Hard cap for StepFun prompt limit (keep extra headroom)
      if (promptEn.length > 900) promptEn = promptEn.slice(0, 897) + '...';
      const explainArr = Array.isArray(parsed.explain_zh) ? parsed.explain_zh : [];
      const explainZh = explainArr
        .map(s => String(s).trim())
        .filter(Boolean)
        .slice(0, 8);

      return {
        prompt_en: promptEn,
        explain_zh: explainZh,
        checks: Array.isArray(parsed.checks) ? parsed.checks : []
      };
    };

    const inferSpaceKind = (spaceText) => {
      const s0 = String(spaceText || '');
      const s = s0.toLowerCase();
      // Living / dining
      if (s0.includes('客') || s.includes('living')) return 'living';
      if (s0.includes('餐') || s.includes('dining')) return 'dining';
      // Bedroom / study
      if (s0.includes('書') || s0.includes('书') || s.includes('study')) return 'study';
      if (s0.includes('睡') || s0.includes('卧') || s0.includes('房') || s.includes('bed')) return 'bedroom';
      // Kitchen / bath
      if (s0.includes('廚') || s0.includes('厨') || s.includes('kitchen')) return 'kitchen';
      if (s0.includes('浴') || s0.includes('厕') || s0.includes('衛') || s0.includes('卫') || s.includes('bath')) return 'bath';
      // Entry / corridor / hallway
      if (s0.includes('玄') || s0.includes('关') || s0.includes('關') || s.includes('entry')) return 'entry';
      if (s0.includes('走廊') || s0.includes('通道') || s.includes('corridor') || s.includes('hallway')) return 'corridor';
      return 'other';
    };

    const validateMustHave = (spaceKind, spec) => {
      const p = String(spec?.prompt_en || '').toLowerCase();
      if (!p) return false;

      // Universal "finished render" elements (these make it look like a real proposal)
      const universal = ['ceiling', 'floor', 'wall finish', 'lighting', 'built-in', 'cabinet', 'soft'];
      if (!universal.every(k => p.includes(k))) return false;

      if (spaceKind === 'living') {
        if (!p.includes('tv')) return false;
        if (!(p.includes('tv console') || p.includes('media console') || p.includes('tv cabinet'))) return false;
        if (!(p.includes('sofa') || p.includes('sectional'))) return false;
        return true;
      }
      if (spaceKind === 'dining') {
        if (!p.includes('dining table')) return false;
        if (!(p.includes('chairs') || p.includes('dining chair'))) return false;
        if (!(p.includes('pendant') || p.includes('chandelier'))) return false;
        return true;
      }
      if (spaceKind === 'bedroom') {
        if (!p.includes('bed')) return false;
        if (!(p.includes('wardrobe') || p.includes('closet'))) return false;
        return true;
      }
      if (spaceKind === 'study') {
        if (!(p.includes('desk') || p.includes('work desk') || p.includes('study desk'))) return false;
        if (!(p.includes('bookcase') || p.includes('bookshelf') || p.includes('storage'))) return false;
        return true;
      }
      if (spaceKind === 'kitchen') {
        if (!(p.includes('countertop') || p.includes('worktop'))) return false;
        if (!(p.includes('backsplash') || p.includes('tile backsplash'))) return false;
        if (!(p.includes('sink') || p.includes('cooktop') || p.includes('stove'))) return false;
        return true;
      }
      if (spaceKind === 'bath') {
        if (!(p.includes('vanity') || p.includes('vanity cabinet'))) return false;
        if (!(p.includes('mirror cabinet') || p.includes('medicine cabinet') || p.includes('mirror'))) return false;
        if (!(p.includes('shower') || p.includes('shower screen') || p.includes('wet area'))) return false;
        if (!(p.includes('non-slip') || p.includes('anti-slip'))) return false;
        return true;
      }
      if (spaceKind === 'entry') {
        if (!(p.includes('shoe cabinet') || p.includes('shoe storage'))) return false;
        if (!(p.includes('bench') || p.includes('seat'))) return false;
        if (!(p.includes('mirror') || p.includes('full-length mirror'))) return false;
        return true;
      }
      if (spaceKind === 'corridor') {
        if (!(p.includes('shallow cabinet') || p.includes('wall cabinet') || p.includes('storage along corridor'))) return false;
        if (!(p.includes('clear walkway') || p.includes('clear circulation'))) return false;
        return true;
      }
      return true;
    };

    // Construct Prompt Server-Side if renderIntake is provided
    let finalPrompt = prompt;
    let designExplanation = '';
    let designSpec = null;
    if (renderIntake) {
        // Build a spec first (prompt + explanation from same source) to keep them consistent
        try {
          const spaceKind = inferSpaceKind(renderIntake?.space);
          const mustInclude = (() => {
            const base = ['CEILING detail', 'FLOOR finish', 'BUILT-IN CABINETRY', 'SOFT FURNISHINGS', 'INTERIOR ONLY (do not change balcony)'];
            if (spaceKind === 'living') return base.concat(['TV', 'TV console', 'TV feature wall storage', 'keep sofa and coffee table if present']);
            if (spaceKind === 'dining') return base.concat(['dining table for 4', 'chairs', 'pendant above table', 'dining sideboard/tall pantry']);
            if (spaceKind === 'bedroom') return base.concat(['bed', 'full-height wardrobe']);
            if (spaceKind === 'kitchen') return base.concat(['base + wall cabinets', 'countertop', 'sink/cooktop zone']);
            return base;
          })();

          designSpec = await buildSpec(renderIntake, { mustInclude });
          // If missing critical items (e.g., living room without TV), retry once with stronger mustInclude
          if (!validateMustHave(spaceKind, designSpec)) {
            designSpec = await buildSpec(renderIntake, { mustInclude: mustInclude.concat(['DO NOT warp/melt objects', 'MUST mention TV explicitly if living room']) });
          }
          if (designSpec?.prompt_en) {
            finalPrompt = designSpec.prompt_en;
            if (Array.isArray(designSpec.explain_zh) && designSpec.explain_zh.length) {
              designExplanation = designSpec.explain_zh.map(x => `- ${x}`).join('\n');
            }
          }
        } catch (e) {
          console.warn('[Design Gen] buildSpec failed:', e?.message || e);
        }

        // If spec generation failed, fallback to heuristic prompt builder below
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

        if (!designSpec?.prompt_en) {
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

    const finalResult = (() => {
        if (finalResponseFormat === 'url') {
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
      isTemporaryUrl: finalResponseFormat === 'url',
      designExplanation: designExplanation || undefined,
      designSpec: designSpec || undefined,
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
