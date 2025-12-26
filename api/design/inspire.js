export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

// Text-to-image "inspiration" render (NOT tied to user's exact structure).
// Goal: provide fast, magazine-quality reference while i2i is generating.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, message: 'Method Not Allowed' });
    return;
  }

  const {
    renderIntake,
    size,
    response_format,
    steps,
    cfg_scale,
    seed,
  } = req.body || {};

  const allowedSizes = new Set([
    '256x256', '512x512', '768x768', '1024x1024',
    '1280x800', '800x1280',
  ]);
  const finalSize = (typeof size === 'string' && allowedSizes.has(size)) ? size : '1280x800';

  const finalResponseFormat = (response_format === 'b64_json' || response_format === 'url') ? response_format : 'url';

  // Keep it fast and stable
  const finalSteps = Number.isInteger(steps) ? Math.min(Math.max(steps, 1), 40) : 30;
  const finalCfgScale = (typeof cfg_scale === 'number') ? Math.min(Math.max(cfg_scale, 1), 7.0) : 6.6;
  const finalSeed = Number.isInteger(seed) && seed > 0 ? seed : undefined;

  // Unified key (same as chat/vision/i2i)
  const apiKey = process.env.STEPFUN_API_KEY || process.env.STEPFUN_IMAGE_API_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, errorCode: 'MISSING_KEY', message: 'Missing STEPFUN_API_KEY' });
    return;
  }

  const normalize = (s) => String(s || '').trim();

  const mapSpace = (s) => {
    const t = normalize(s);
    if (t.includes('客餐')) return 'Hong Kong open-plan living-dining room';
    if (t.includes('入户') || t.includes('玄')) return 'Hong Kong entryway / foyer';
    if (t.includes('走廊')) return 'Hong Kong corridor';
    if (t.includes('厨房') || t.includes('廚') || t.includes('厨')) return 'Hong Kong kitchen';
    if (t.includes('卫生间') || t.includes('衛') || t.includes('卫') || t.includes('浴') || t.includes('洗手')) return 'Hong Kong bathroom';
    if (t.includes('大睡房') || t.includes('主人房') || t.includes('主卧')) return 'Hong Kong master bedroom';
    if (t.includes('小睡房') || t.includes('次卧') || t.includes('眼镜房') || t.includes('儿童房')) return 'Hong Kong small bedroom (compact)';
    if (t.includes('睡') || t.includes('卧') || t.includes('房')) return 'Hong Kong bedroom';
    return t ? `Hong Kong apartment ${t}` : 'Hong Kong apartment interior';
  };

  const mapStyle = (s) => {
    const t = normalize(s);
    if (t.includes('日式') || t.includes('木')) return 'Japandi / Japanese wood minimalist, warm and calm, clean lines, natural wood';
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
    return t || 'neutral warm';
  };

  const lightingByVibe = (vibe) => {
    const v = normalize(vibe);
    if (v.includes('明亮')) {
      return 'Lighting: bright and airy, layered ceiling cove + recessed downlights, soft indirect bounce, clean white balance, warm white 3000K.';
    }
    if (v.includes('酒店') || v.includes('高級') || v.includes('高级')) {
      return 'Lighting: premium hotel-like layered lighting, ceiling cove + downlights + accent wall wash + cabinet niche lighting, warm 2700-3000K, realistic GI, controlled highlights.';
    }
    return 'Lighting: warm cozy layered lighting, ceiling cove + recessed downlights + subtle accents, warm 2700-3000K, soft shadows, realistic GI.';
  };

  const intake = renderIntake || {};
  const spaceEn = mapSpace(intake?.space);
  const styleEn = mapStyle(intake?.style);
  const colorEn = mapColor(intake?.color);
  const focus = normalize(intake?.focus);
  const storage = normalize(intake?.storage);
  const decor = normalize(intake?.decor);
  const vibe = normalize(intake?.vibe);

  const focusLine = focus ? `Key feature: ${focus}.` : '';
  const storageLine = storage ? `Storage strategy: ${storage}.` : 'Storage strategy: practical full-height cabinetry, space-saving built-ins.';
  const decorLine = decor ? `Soft furnishing density: ${decor}.` : 'Soft furnishing density: balanced and livable.';

  const mustHave = (() => {
    const s = normalize(intake?.space);
    if (s.includes('客餐')) return 'Must include: TV wall + sofa seating + dining table for 4 + pendant above dining table + dining sideboard/pantry.';
    if (s.includes('厨房') || s.includes('廚') || s.includes('厨')) return 'Must include: base cabinets + wall cabinets to ceiling + countertop + sink/cooktop zones + under-cabinet task lighting.';
    if (s.includes('卫生') || s.includes('衛') || s.includes('浴') || s.includes('洗手')) return 'Must include: vanity cabinet + mirror cabinet + shower screen/zone + anti-slip floor tiles + mirror/vanity light.';
    if (s.includes('入户') || s.includes('玄')) return 'Must include: full-height shoe cabinet + bench + full-length mirror + concealed clutter storage.';
    if (s.includes('走廊')) return 'Must include: shallow corridor storage + wall wash/linear lighting + clear circulation width.';
    if (s.includes('小睡房') || s.includes('眼镜房') || s.includes('次卧') || s.includes('儿童')) return 'Must include: space-saving bed (platform/tatami/Murphy) + full-height slim wardrobe + integrated desk/shelves.';
    if (s.includes('睡') || s.includes('卧') || s.includes('房')) return 'Must include: residential bed + full-height wardrobe + bedside + curtains.';
    return 'Must include: finished ceiling/walls/floor + built-in cabinetry + layered lighting + soft furnishings.';
  })();

  const prompt = [
    'Photorealistic high-end interior design rendering, V-Ray/Corona render style, magazine quality.',
    `${spaceEn}.`,
    `Style: ${styleEn}.`,
    `Color palette: ${colorEn}.`,
    mustHave,
    focusLine,
    storageLine,
    decorLine,
    lightingByVibe(vibe),
    'Hong Kong apartment practicality, compact space planning, clear circulation.',
    'Ceiling design: slim gypsum board ceiling with recessed cove lighting + downlights (no office grid ceiling).',
    'Materials: coherent warm textures, clean realistic details; built-in cabinetry with toe-kick and shadow gaps.',
    'Avoid: cartoon, CGI toy look, low-poly, distorted straight lines, fisheye, clutter, unfinished concrete.',
  ].filter(Boolean).join(' ');

  try {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const doFetch = async () =>
      await fetch('https://api.stepfun.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'step-1x-medium',
          prompt,
          size: finalSize,
          n: 1,
          response_format: finalResponseFormat,
          seed: finalSeed,
          steps: finalSteps,
          cfg_scale: finalCfgScale,
        }),
      });

    // StepFun may enforce limit=1 concurrency. Retry lightly on 429.
    let response = await doFetch();
    if (response.status === 429) {
      await sleep(800);
      response = await doFetch();
    }

    if (!response.ok) {
      const errText = await response.text();
      res.status(response.status).json({
        ok: false,
        errorCode: `UPSTREAM_${response.status}`,
        message: `Upstream error: ${errText}`,
      });
      return;
    }

    const data = await response.json();
    const first = data?.data?.[0] || {};
    const finishReason = first?.finish_reason;
    const resultSeed = first?.seed ?? data?.seed;
    const resultUrl = first?.url || first?.image_url;
    const resultB64 = first?.b64_json || first?.image || first?.base64 || first?.b64;

    if (finalResponseFormat === 'url') {
      if (!resultUrl && !resultB64) {
        res.status(502).json({ ok: false, errorCode: 'INVALID_RESPONSE', message: 'No image payload received' });
        return;
      }
      res.status(200).json({
        ok: true,
        resultUrl: resultUrl || `data:image/jpeg;base64,${resultB64}`,
        debug: { seed: resultSeed, finish_reason: finishReason, size: finalSize, steps: finalSteps, cfg_scale: finalCfgScale },
      });
      return;
    }

    if (!resultB64) {
      res.status(502).json({ ok: false, errorCode: 'INVALID_RESPONSE', message: 'No base64 image received' });
      return;
    }
    res.status(200).json({
      ok: true,
      resultUrl: `data:image/png;base64,${resultB64}`,
      debug: { seed: resultSeed, finish_reason: finishReason, size: finalSize, steps: finalSteps, cfg_scale: finalCfgScale },
    });
  } catch (e) {
    res.status(500).json({ ok: false, errorCode: 'INTERNAL_ERROR', message: e?.message || 'Internal error' });
  }
}

