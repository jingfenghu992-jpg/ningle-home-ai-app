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

  // Vercel maxDuration is configured as 60s in vercel.json for api/**.
  // We MUST keep end-to-end work below that budget to avoid 504 Gateway Timeout.
  const startedAt = Date.now();
  const hardBudgetMs = 56000; // keep some headroom for network/serialization
  const timeLeftMs = () => Math.max(0, hardBudgetMs - (Date.now() - startedAt));

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

  // StepFun doc: smaller source_weight => closer to source (less deformation).
  // Our product goal: "明显改造、像设计效果图" by default, while still keeping structure constraints.
  // So default source_weight should be higher than the previous conservative preset.
  const inferIntensityPreset = (intensityText) => {
    const t = String(intensityText || '').trim();
    // UI options seen in App.tsx:
    // - 保留結構（輕改）
    // - 明顯改造（推薦）
    // - 大改造（更大變化）
    if (!t) return 'recommended';
    if (t.includes('輕') || t.includes('轻') || t.includes('保留')) return 'light';
    if (t.includes('大')) return 'bold';
    if (t.includes('明顯') || t.includes('明显') || t.includes('推薦') || t.includes('推荐')) return 'recommended';
    return 'recommended';
  };

  const intensityPreset = inferIntensityPreset(renderIntake?.intensity);

  const defaultI2I = (() => {
    if (intensityPreset === 'light') {
      return { sw: 0.45, st: 34, cfg: 6.6 };
    }
    if (intensityPreset === 'bold') {
      return { sw: 0.82, st: 46, cfg: 7.6 };
    }
    // recommended (明显改造)
    return { sw: 0.70, st: 42, cfg: 7.2 };
  })();

  const finalSourceWeight =
    typeof source_weight === 'number' && source_weight > 0 && source_weight <= 1
      ? source_weight
      : defaultI2I.sw;

  // Keep i2i stable: clamp steps/cfg to avoid runaway latency.
  const requestedSteps = Number.isInteger(steps) ? steps : undefined;
  const requestedCfg = (typeof cfg_scale === 'number') ? cfg_scale : undefined;

  // Default to a "proposal render" preset (more designed & photoreal than the previous conservative preset).
  const finalSteps =
    typeof requestedSteps === 'number' && requestedSteps >= 1
      ? Math.min(Math.max(requestedSteps, 1), 50)
      : Math.min(Math.max(defaultI2I.st, 1), 50);

  const finalCfgScale =
    typeof requestedCfg === 'number' && requestedCfg >= 1
      ? Math.min(Math.max(requestedCfg, 1), 8.5)
      : Math.min(Math.max(defaultI2I.cfg, 1), 8.5);

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

    // --- Finish level inference for "bare shell vs finished" strategy ---
    // Returns: 'bare_shell' | 'semi_finished' | 'finished' | 'unknown'
    const normalizeFinishLevel = (raw) => {
      const s0 = String(raw || '').trim();
      const s = s0.toLowerCase();
      if (!s0) return 'unknown';

      // Explicit marker (we ask Vision to add: "完成度：毛坯/半装/已装")
      if (s0.includes('完成度')) {
        if (s0.includes('毛坯') || s0.includes('清水') || s.includes('bare')) return 'bare_shell';
        if (s0.includes('半装') || s0.includes('半裝') || s.includes('semi')) return 'semi_finished';
        if (s0.includes('已装') || s0.includes('已裝') || s0.includes('精装') || s0.includes('精裝') || s.includes('finished') || s.includes('furnished')) return 'finished';
      }

      const bareKeys = [
        '毛坯', '清水', '未裝修', '未装修', '水泥', '批蕩', '批荡', '工地',
        '裸牆', '裸墙', '未鋪', '未铺', 'unfinished', 'bare', 'construction', 'raw concrete'
      ];
      const finishedKeys = [
        '已裝修', '已装修', '精裝', '精装', '完成面',
        '地板', '木地板', '地砖', '地磚', '瓷砖', '瓷磚',
        '乳胶漆', '油漆', '窗簾', '窗帘', '吊顶', '天花',
        'furnished', 'finished'
      ];
      if (bareKeys.some(k => s0.includes(k) || s.includes(String(k).toLowerCase()))) return 'bare_shell';
      if (finishedKeys.some(k => s0.includes(k) || s.includes(String(k).toLowerCase()))) return 'finished';
      return 'unknown';
    };

    const extractFinishLevelFromText = (text) => {
      const t = String(text || '');
      const m = t.match(/完成度\s*[:：]\s*(毛坯|半装|半裝|已装|已裝|精装|精裝)/);
      if (m?.[1]) return normalizeFinishLevel(m[1]);
      return normalizeFinishLevel(t);
    };

    const getLightingScriptEn = ({ spaceKind, vibe }) => {
      const v = String(vibe || '');
      const vL = v.toLowerCase();
      const isHotel = v.includes('酒店') || v.includes('高級') || v.includes('高级') || vL.includes('hotel') || vL.includes('luxury');
      const isBright = v.includes('明亮') || vL.includes('bright') || vL.includes('airy');

      const base = [
        'Lighting: layered lighting plan, warm white 2700-3000K, CRI 90+, dimmable, balanced exposure, realistic global illumination (GI).'
      ];
      if (spaceKind === 'bath') {
        base.push('Ceiling lighting: recessed downlights (no harsh hotspots) + mirror/vanity light, soft shadows.');
      } else {
        base.push('Ceiling lighting: slim recessed cove lighting with hidden LED strip + evenly spaced recessed downlights, soft indirect bounce.');
      }

      if (spaceKind === 'living') base.push('Accent lighting: TV wall wash / grazing light + cabinet display niche lighting (subtle).');
      if (spaceKind === 'dining') base.push('Accent lighting: pendant lights centered above dining table (warm glow) + sideboard niche lighting.');
      if (spaceKind === 'living_dining') base.push('Accent lighting: TV wall wash + cabinet niche lighting + pendant lights centered above dining table, unified warm glow.');
      if (spaceKind === 'bedroom') base.push('Accent lighting: bedside wall lights + headboard wash light, warm and calm.');
      if (spaceKind === 'bedroom_small') base.push('Accent lighting: slim bedside wall lights + wardrobe edge lighting, keep it space-saving and calm.');
      if (spaceKind === 'study') base.push('Accent lighting: desk task lamp + shelf lighting to add depth.');
      if (spaceKind === 'kitchen') base.push('Accent lighting: under-cabinet task lighting + subtle toe-kick strip, keep worktop bright but not blown-out.');
      if (spaceKind === 'entry') base.push('Accent lighting: shoe cabinet niche lighting + soft mirror light, welcoming.');
      if (spaceKind === 'corridor') base.push('Accent lighting: linear cove or wall wash to avoid dark corners, visually elongate corridor.');

      if (isHotel) base.push('Mood: premium hotel-like, controlled highlights, elegant contrast (no overexposure).');
      else if (isBright) base.push('Mood: bright and airy, clean white balance, soft shadows.');
      else base.push('Mood: warm cozy, gentle contrast, comfortable.');

      return base.join(' ');
    };

    const buildSpec = async (intake, opts) => {
      const normalize = (s) => String(s || '').trim();
      const compact = (s, max = 420) => {
        const t = normalize(s).replace(/\s+/g, ' ');
        return t.length > max ? t.slice(0, max) + '…' : t;
      };

      const finishLevel =
        normalizeFinishLevel(intake?.finishLevel) !== 'unknown'
          ? normalizeFinishLevel(intake?.finishLevel)
          : extractFinishLevelFromText(intake?.visionSummary || intake?.requirements || '');

      const payload = {
        space: normalize(intake?.space),
        style: normalize(intake?.style),
        color: normalize(intake?.color),
        focus: normalize(intake?.focus),
        bedType: normalize(intake?.bedType),
        storage: normalize(intake?.storage),
        vibe: normalize(intake?.vibe),
        decor: normalize(intake?.decor),
        priority: normalize(intake?.priority),
        intensity: normalize(intake?.intensity),
        housingType: normalize(intake?.housingType),
        needsWorkstation: normalize(intake?.needsWorkstation),
        finishLevel,
        constraints: compact(intake?.visionSummary || intake?.requirements || '', 520),
      };

      const mustInclude = Array.isArray(opts?.mustInclude) ? opts.mustInclude : [];
      const system = `You are a senior Hong Kong interior designer specialized in public housing (公屋) and subsidized home ownership (居屋) layouts.
Produce a compact, executable design spec that will be used for image-to-image generation.
Output MUST be valid JSON only, no extra text.
Rules:
- The generated image MUST look like a finished photorealistic interior render (V-Ray/Corona style).
- The render MUST look like a real interior design proposal: coherent material palette, cabinetry detailing, and a beautiful lighting mood (not flat).
- INTERIOR ONLY: do NOT redesign balcony/outdoor view; keep balcony as background unchanged.
- Do NOT move windows/doors/beams/columns; keep camera viewpoint/perspective.
- Preserve object geometry: keep window frames, doors, straight vertical/horizontal lines; do NOT warp/melt/stretch objects; no bent walls, no distorted windows.
- Must include: ceiling detail, finished flooring, finished wall surfaces, built-in cabinetry, lighting plan, and soft furnishings (as applicable).
- Use finishLevel (bare_shell / semi_finished / finished / unknown) to decide how much to change:
  - bare_shell: MUST do full fit-out (ceiling design + walls + flooring + skirting + curtains) and make it look fully complete, not a site photo.
  - semi_finished: keep what's finished, add missing finishes, then unify materials and lighting.
  - finished: keep the original STRUCTURE and camera perspective, but you can boldly redesign the interior look (upgrade/replace finishes, cabinetry, lighting layers and soft furnishings) so it reads like a NEW design proposal render.
- Lighting requirements (MUST be explicit in prompt_en, not vague):
  - Write a layered lighting script: cove/indirect + downlights + accent lights (wall wash / cabinet / pendant / bedside / under-cabinet depending on space).
  - Specify warm white 2700-3000K (bathroom can be neutral up to 3500K), CRI 90+, dimmable, realistic GI, balanced exposure, soft shadows.
- Never output an office grid ceiling / mineral fiber ceiling tiles.
- For bedrooms: bed MUST be a residential bed (no hospital bed, no metal guardrails).
- The spec MUST match the final render and also match the explanation.
- The explanation MUST reflect the user's selections (style/color/focus/storage/vibe/decor) and be visually verifiable.
- Keep prompt_en <= 900 characters.

Space-specific must-haves:
- living room: MUST include TV + TV console + TV feature wall storage; sofa and coffee table (keep if present, otherwise add).
- dining room: MUST include dining table for 4 + chairs + pendant above table + dining sideboard/tall pantry.
- bedroom: MUST include bed + full-height wardrobe.
- kitchen: MUST include base cabinets + wall cabinets + countertop + sink/cooktop zone.
- bathroom: MUST include vanity cabinet + mirror cabinet + shower screen/zone + anti-slip floor tile.
- entryway: MUST include shoe cabinet + bench + full-length mirror + concealed clutter storage.
- corridor: MUST include shallow storage along corridor + clear circulation width.
- study: MUST include desk + bookcase/storage + task lighting.

Hong Kong constraints to respect:
- Small units, narrow corridors, low ceiling height: use slim cove/linear lighting, avoid bulky ceiling drops.
- Common issues: window bay (窗台深), A/C unit position (冷气机位), diamond living room (钻石厅), wasted corridor corners.
- Cabinetry should be practical: full-height storage, shallow cabinets in corridors, toe-kick, integrated handles, durable easy-clean surfaces.

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
MUST include these items in prompt_en and explain_zh (if applicable): ${mustInclude.join(', ') || '(none)'}.
Also MUST embed an explicit layered lighting script into prompt_en (concrete components + Kelvin), based on this reference: ${getLightingScriptEn({ spaceKind: String(opts?.spaceKind || 'other'), vibe: payload.vibe })}.`;

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

    const inferSpaceKind = (spaceText, focusText, reqText, bedTypeText) => {
      const s0 = String(spaceText || '');
      const s = s0.toLowerCase();
      const f0 = String(focusText || '');
      const f = f0.toLowerCase();
      const r0 = String(reqText || '');
      const r = r0.toLowerCase();
      const b0 = String(bedTypeText || '');
      const b = b0.toLowerCase();

      // If user picked "其他/other", infer from focus/requirements to avoid missing must-haves.
      const hint = `${f0} ${r0} ${b0}`;
      const hintL = `${f} ${r} ${b}`;
      const has = (arr) => arr.some(k => hint.includes(k) || hintL.includes(String(k).toLowerCase()));
      // HK combined living+dining
      const isLivingDiningText = s0.includes('客餐') || s.includes('living') && s.includes('dining') || (s0.includes('客') && s0.includes('餐'));
      if (isLivingDiningText) return 'living_dining';
      if (has(['廚', '厨', '廚櫃', '橱柜', '吊櫃', '吊柜', '星盆', '爐頭', '炉头', 'kitchen', 'cooktop', 'sink'])) return 'kitchen';
      if (has(['浴', '厕', '衛', '卫', '洗手', '浴室櫃', '浴室柜', '鏡櫃', '镜柜', 'bath', 'vanity', 'shower'])) return 'bath';
      if (has(['入户', '玄', '關', '关', '鞋', '鞋櫃', '鞋柜', 'entry', 'shoe cabinet'])) return 'entry';
      if (has(['書', '书', '書枱', '书台', '書桌', '书桌', '工作位', 'study', 'desk', 'bookcase'])) return 'study';
      if (has(['大睡房', '主人房', '主卧', 'master'])) return 'bedroom';
      if (has(['小睡房', '次卧', '眼镜房', '儿童房', 'small bedroom'])) return 'bedroom_small';
      if (has(['床', '睡', '卧', '房', '衣櫃', '衣柜', '榻榻米', '地台', 'bed', 'wardrobe', 'closet'])) return 'bedroom';
      if (has(['餐', '餐桌', '餐邊', '餐边', 'dining', 'dining table'])) return 'dining';
      if (has(['電視', '电视', 'tv', 'sofa', '客厅', '客廳', 'living'])) return 'living';

      // Living / dining
      if (s0.includes('客') || s.includes('living')) return 'living';
      if (s0.includes('餐') || s.includes('dining')) return 'dining';
      // Bedroom / study
      if (s0.includes('書') || s0.includes('书') || s.includes('study')) return 'study';
      if (s0.includes('大睡房') || s0.includes('主人房') || s.includes('master')) return 'bedroom';
      if (s0.includes('小睡房') || s0.includes('次卧') || s0.includes('眼镜房') || s.includes('small bedroom')) return 'bedroom_small';
      if (s0.includes('睡') || s0.includes('卧') || s0.includes('房') || s.includes('bed')) return 'bedroom';
      // Kitchen / bath
      if (s0.includes('廚') || s0.includes('厨') || s.includes('kitchen')) return 'kitchen';
      if (s0.includes('浴') || s0.includes('厕') || s0.includes('衛') || s0.includes('卫') || s.includes('bath')) return 'bath';
      // Entry / corridor / hallway
      if (s0.includes('入户') || s0.includes('玄') || s0.includes('关') || s0.includes('關') || s.includes('entry')) return 'entry';
      if (s0.includes('走廊') || s0.includes('通道') || s.includes('corridor') || s.includes('hallway')) return 'corridor';
      return 'other';
    };

    const validateMustHave = (spaceKind, spec, finishLevel = 'unknown') => {
      const p = String(spec?.prompt_en || '').toLowerCase();
      if (!p) return false;

      // Universal "finished render" elements (these make it look like a real proposal)
      const universal = ['ceiling', 'floor', 'wall finish', 'lighting', 'built-in', 'cabinet', 'soft'];
      if (!universal.every(k => p.includes(k))) return false;

      const hasAny = (arr) => arr.some(k => p.includes(String(k).toLowerCase()));

      // Lighting script tokens: keep it strict enough to improve "漂亮灯光" consistency
      // Bathroom is special: may not use cove, but must have mirror/vanity light.
      if (spaceKind !== 'bath') {
        if (!hasAny(['cove lighting', 'recessed cove', 'recessed led strip', 'led strip'])) return false;
      }
      if (!hasAny(['downlight', 'downlights', 'recessed downlight', 'recessed spot'])) return false;
      if (!hasAny(['warm white', '3000k', '2700k', '2800k', '2900k'])) {
        if (!(spaceKind === 'bath' && hasAny(['3500k', 'neutral']))) return false;
      }

      if (spaceKind === 'living') {
        if (!p.includes('tv')) return false;
        if (!(p.includes('tv console') || p.includes('media console') || p.includes('tv cabinet'))) return false;
        if (!(p.includes('sofa') || p.includes('sectional'))) return false;
        if (!hasAny(['wall wash', 'grazing light', 'accent lighting', 'niche lighting', 'cabinet lighting'])) return false;
        return true;
      }
      if (spaceKind === 'living_dining') {
        // Must satisfy BOTH living and dining essentials
        if (!p.includes('tv')) return false;
        if (!(p.includes('tv console') || p.includes('media console') || p.includes('tv cabinet'))) return false;
        if (!(p.includes('sofa') || p.includes('sectional'))) return false;
        if (!p.includes('dining table')) return false;
        if (!(p.includes('chairs') || p.includes('dining chair'))) return false;
        if (!(p.includes('pendant') || p.includes('chandelier'))) return false;
        if (!hasAny(['sideboard', 'pantry', 'buffet'])) return false;
        if (!hasAny(['wall wash', 'grazing light', 'accent lighting', 'niche lighting', 'cabinet lighting'])) return false;
        return true;
      }
      if (spaceKind === 'dining') {
        if (!p.includes('dining table')) return false;
        if (!(p.includes('chairs') || p.includes('dining chair'))) return false;
        if (!(p.includes('pendant') || p.includes('chandelier'))) return false;
        if (!hasAny(['sideboard', 'pantry', 'buffet'])) return false;
        return true;
      }
      if (spaceKind === 'bedroom') {
        if (!p.includes('bed')) return false;
        if (!(p.includes('wardrobe') || p.includes('closet'))) return false;
        if (!hasAny(['bedside', 'wall light', 'sconce'])) return false;
        return true;
      }
      if (spaceKind === 'bedroom_small') {
        if (!p.includes('bed')) return false;
        if (!(p.includes('wardrobe') || p.includes('closet'))) return false;
        // Encourage space-saving solutions
        if (!hasAny(['platform bed', 'tatami', 'murphy', 'hidden bed', 'storage bed', 'space-saving'])) return false;
        return true;
      }
      if (spaceKind === 'study') {
        if (!(p.includes('desk') || p.includes('work desk') || p.includes('study desk'))) return false;
        if (!(p.includes('bookcase') || p.includes('bookshelf') || p.includes('storage'))) return false;
        if (!hasAny(['task lighting', 'desk lamp'])) return false;
        return true;
      }
      if (spaceKind === 'kitchen') {
        if (!(p.includes('countertop') || p.includes('worktop'))) return false;
        if (!(p.includes('backsplash') || p.includes('tile backsplash'))) return false;
        if (!(p.includes('sink') || p.includes('cooktop') || p.includes('stove'))) return false;
        if (!hasAny(['under-cabinet', 'under cabinet', 'task lighting'])) return false;
        return true;
      }
      if (spaceKind === 'bath') {
        if (!(p.includes('vanity') || p.includes('vanity cabinet'))) return false;
        if (!(p.includes('mirror cabinet') || p.includes('medicine cabinet') || p.includes('mirror'))) return false;
        if (!(p.includes('shower') || p.includes('shower screen') || p.includes('wet area'))) return false;
        if (!(p.includes('non-slip') || p.includes('anti-slip'))) return false;
        if (!hasAny(['mirror light', 'vanity light'])) return false;
        return true;
      }
      if (spaceKind === 'entry') {
        if (!(p.includes('shoe cabinet') || p.includes('shoe storage'))) return false;
        if (!(p.includes('bench') || p.includes('seat'))) return false;
        if (!(p.includes('mirror') || p.includes('full-length mirror'))) return false;
        if (!hasAny(['niche lighting', 'accent lighting'])) return false;
        return true;
      }
      if (spaceKind === 'corridor') {
        if (!(p.includes('shallow cabinet') || p.includes('wall cabinet') || p.includes('storage along corridor'))) return false;
        if (!(p.includes('clear walkway') || p.includes('clear circulation'))) return false;
        if (!hasAny(['wall wash', 'linear', 'cove'])) return false;
        return true;
      }
      return true;
    };

    // Construct Prompt Server-Side if renderIntake is provided
    let finalPrompt = prompt;
    let designExplanation = '';
    let designSpec = null;
    if (renderIntake) {
        // Reliability-first: avoid extra LLM calls inside /api/design/generate to keep under 60s.
        // We rely on deterministic prompt templates (below) and async /api/design/qa for explanation.
        const ENABLE_SPEC_LLM = process.env.ENABLE_DESIGN_SPEC_LLM === '1';
        if (ENABLE_SPEC_LLM) {
          // Build a spec first (prompt + explanation from same source) to keep them consistent
          try {
            const spaceKind = inferSpaceKind(renderIntake?.space, renderIntake?.focus, renderIntake?.requirements, renderIntake?.bedType);
            const finishLevel =
              normalizeFinishLevel(renderIntake?.finishLevel) !== 'unknown'
                ? normalizeFinishLevel(renderIntake?.finishLevel)
                : extractFinishLevelFromText(renderIntake?.visionSummary || renderIntake?.requirements || '');
            const mustInclude = (() => {
              const base = [
                'CEILING detail (cove/false ceiling + downlights)',
                'FLOOR finish (engineered wood / porcelain tile)',
                'WALL finish',
                'BUILT-IN CABINETRY',
                'LIGHTING plan',
                'SOFT FURNISHINGS',
                'Layered lighting (cove/indirect + downlights + accent), warm white 2700-3000K, CRI90+',
                'INTERIOR ONLY (do not change balcony/outdoor view)',
                'DO NOT warp/melt objects'
              ];
              if (spaceKind === 'living') return base.concat(['TV', 'TV console', 'TV feature wall storage', 'sofa', 'coffee table', 'rug', 'curtains']);
              if (spaceKind === 'living_dining') return base.concat(['TV', 'TV console', 'TV feature wall storage', 'sofa', 'coffee table', 'rug', 'curtains', 'dining table for 4', 'chairs', 'pendant above table', 'dining sideboard/tall pantry']);
              if (spaceKind === 'dining') return base.concat(['dining table for 4', 'chairs', 'pendant above table', 'dining sideboard/tall pantry']);
              if (spaceKind === 'bedroom') return base.concat(['residential bed (no hospital bed, no metal rails)', 'full-height wardrobe', 'bedside', 'curtains']);
              if (spaceKind === 'bedroom_small') return base.concat(['space-saving residential bed (platform/tatami/murphy)', 'full-height wardrobe (slim)', 'integrated desk/shelves (if suitable)', 'curtains']);
              if (spaceKind === 'study') return base.concat(['desk', 'bookcase/storage', 'task lighting']);
              if (spaceKind === 'kitchen') return base.concat(['base cabinets', 'wall cabinets', 'countertop/worktop', 'sink', 'cooktop', 'backsplash tiles', 'under-cabinet task lighting']);
              if (spaceKind === 'bath') return base.concat(['vanity cabinet', 'mirror cabinet', 'shower screen/zone', 'anti-slip floor tiles', 'mirror vanity light']);
              if (spaceKind === 'entry') return base.concat(['shoe cabinet', 'bench/seat', 'full-length mirror', 'concealed clutter storage', 'niche lighting']);
              if (spaceKind === 'corridor') return base.concat(['shallow cabinets along corridor', 'clear walkway/circulation', 'wall wash / linear lighting']);
              return base;
            })();

            designSpec = await buildSpec({ ...(renderIntake || {}), finishLevel }, { mustInclude, spaceKind });
            // If missing critical items, retry once with stronger mustInclude
            if (!validateMustHave(spaceKind, designSpec, finishLevel)) {
              const retryExtra =
                spaceKind === 'living'
                  ? ['MUST mention TV explicitly', 'MUST include TV feature wall with storage', 'MUST include cove lighting + downlights + wall wash/cabinet accent lights']
                  : spaceKind === 'kitchen'
                    ? ['MUST include sink + cooktop triangle workflow', 'MUST include tall pantry/electrical cabinet if space allows', 'MUST include under-cabinet task lighting']
                    : spaceKind === 'bath'
                      ? ['MUST include dry-wet separation', 'MUST include anti-slip floor tiles', 'MUST include mirror vanity light + soft downlights']
                      : spaceKind === 'entry'
                        ? ['MUST include shoe storage with bench + mirror', 'MUST include niche lighting / soft mirror light']
                        : spaceKind === 'corridor'
                          ? ['MUST keep clear circulation width', 'use shallow storage only', 'MUST include wall wash / linear lighting to avoid dark corners']
                          : ['Ensure all must-haves are explicitly present in prompt', 'Include layered lighting with 2700-3000K'];
              designSpec = await buildSpec({ ...(renderIntake || {}), finishLevel }, { mustInclude: mustInclude.concat(retryExtra), spaceKind });
            }
            if (designSpec?.prompt_en) {
              finalPrompt = designSpec.prompt_en;
              // NOTE: explanation is handled by async /api/design/qa to match the final image.
            }
          } catch (e) {
            console.warn('[Design Gen] buildSpec failed:', e?.message || e);
          }
        }

        // If spec generation failed, fallback to heuristic prompt builder below
        const { space, style, color, requirements, focus, storage, vibe, decor, priority, intensity } = renderIntake;

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

        const mapVibe = (kw) => {
            const k = normalize(kw);
            if (!k) return '';
            if (k.includes('明亮')) return 'Vibe: bright and airy; balanced daylight + clean downlights.';
            if (k.includes('酒店') || k.includes('高級') || k.includes('高级')) return 'Vibe: premium hotel-like mood; layered warm lighting and refined highlights.';
            if (k.includes('暖')) return 'Vibe: warm cozy ambient lighting; comfortable and soft.';
            return `Vibe: ${k}.`;
        };

        const mapDecor = (kw) => {
            const k = normalize(kw);
            if (!k) return '';
            if (k.includes('克制') || k.includes('清爽')) return 'Soft furnishings: minimal, clean, a few key pieces only.';
            if (k.includes('豐富') || k.includes('丰富')) return 'Soft furnishings: richer styling (curtains/rug/art/plants/cushions) but still tidy.';
            if (k.includes('標準') || k.includes('标准') || k.includes('推薦') || k.includes('推荐')) return 'Soft furnishings: balanced standard styling, natural and livable.';
            return `Soft furnishings: ${k}.`;
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
        const vibeHint = mapVibe(vibe);
        const decorHint = mapDecor(decor);
        const priorityHint = mapPriority(priorityKw);
        const intensityHint = mapIntensity(intensityKw);

        const spaceEn = mapSpace(space);
        const styleEn = mapStyle(style);
        const colorEn = mapColor(color);
        const finishLevelFallback = extractFinishLevelFromText(renderIntake?.visionSummary || requirements || '');
        const finishPolicy =
          finishLevelFallback === 'bare_shell'
            ? 'Finish level: bare shell; complete full fit-out (ceiling + walls + floor + skirting + curtains), then furniture + cabinetry + layered lighting. Make it a bold, magazine-quality new design render.'
            : finishLevelFallback === 'semi_finished'
              ? 'Finish level: semi-finished; keep existing finished parts, add missing finishes, then unify materials and lighting. Make it clearly redesigned (not minor tweaks).'
              : finishLevelFallback === 'finished'
                ? 'Finish level: finished; keep original structure/perspective but boldly redesign finishes, cabinetry, lighting layers and soft furnishings so it reads like a NEW design proposal render.'
                : 'Finish level: unknown; keep original structure/perspective, but still produce a clearly redesigned, fully finished design proposal render.';
        const spaceKindFallback = inferSpaceKind(space, focus, requirements, renderIntake?.bedType);
        const lightingScript = getLightingScriptEn({ spaceKind: spaceKindFallback, vibe });

        // Keep prompt within StepFun's 1024 chars.
        // Prioritize user selections + executable layout/cabinet instructions first, THEN constraints.
        const hardRules = [
            'Photorealistic NEW interior design proposal render, V-Ray/Corona style, magazine quality (not a site photo).',
            'Keep exact structure & camera perspective; do NOT move windows/doors/beams/columns; keep straight lines (no warping/fisheye).',
            'INTERIOR ONLY: do NOT change balcony/outdoor view; keep exterior as background unchanged.',
            'No office grid ceiling; use slim gypsum ceiling with cove lighting + downlights.',
            'Must look fully finished (ceiling + walls + flooring + skirting + curtains as applicable).',
        ].join(' ');

        const mustHave = [
            'Must include: full design finishes (ceiling+walls+floor), built-in cabinetry with details (full-height, toe-kick, integrated handles/shadow gaps), and a complete furniture layout + soft furnishings.',
            'Lighting MUST be layered: ceiling cove/indirect + recessed downlights + space-appropriate accent lights, warm white 2700-3000K, CRI 90+, dimmable, realistic GI, balanced exposure.',
            spaceEn.includes('dining') ? 'Dining: table for 4 + chairs + pendant above table + dining sideboard/tall pantry.' : '',
        ].filter(Boolean).join(' ');

        const quality = [
            'Materials: ENF-grade multi-layer wood/plywood cabinetry, realistic matte finishes, clean textures.',
            'Avoid: empty room, unfinished concrete, muddy textures, toy-like CGI, distorted straight lines, fisheye, melted objects, overexposed highlights.'
        ].join(' ');

        const extraReq = compact(requirements, 380);

        if (!designSpec?.prompt_en) {
          // Make the first ~250 chars fully reflect user selections, so they won't be truncated.
          finalPrompt = trimPrompt([
              `Space: ${spaceEn}. Style: ${styleEn}. Color palette: ${colorEn}.`,
              // User intent as executable instructions (placement/cabinet emphasis)
              focusHint,
              storageHint,
              vibeHint,
              decorHint,
              priorityHint,
              intensityHint,
              mustHave,
              finishPolicy,
              lightingScript,
              hardRules,
              quality,
              extraReq ? `Notes: ${extraReq}` : ''
          ].filter(Boolean).join(' '));

          // Ensure explanation is still aligned (same-source) even when spec JSON build fails
          if (!designExplanation) {
            const bullets = [
              space ? `空间：${normalize(space)}` : '',
              style ? `风格：${normalize(style)}` : '',
              color ? `色系：${normalize(color)}` : '',
              focus ? `重点方案：${normalize(focus)}` : '',
              storage ? `收纳取向：${normalize(storage)}` : '',
              vibe ? `氛围：${normalize(vibe)}` : '',
              decor ? `软装丰富度：${normalize(decor)}` : '',
              `完成面：天花＋墙面＋地面＋灯光已补齐，做成真实照片质感`,
              `结构约束：不改门窗梁柱，保持原视角透视，默认保留冷气机位并预留检修`
            ].filter(Boolean).slice(0, 7);
            designExplanation = bullets.map(x => `- ${x}`).join('\n');
          }
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

    // Explanation strategy:
    // - Prefer generating explanation from the FINAL image (most consistent with what user sees)
    // - Fallback to generating from finalPrompt only if image-based explanation fails
    const ensureDesignExplanation = async () => {
        if (designExplanation && String(designExplanation).trim()) return;
        try {
            const explainSystem =
              `You are a senior interior designer. Given a final image-to-image prompt, output ONLY 5-7 bullet points in Simplified Chinese.\n` +
              `Rules:\n` +
              `- Each bullet MUST be directly reflected in the prompt (visually verifiable).\n` +
              `- Mention layout (bed/sofa/TV/dining/kitchen/bath) only if present in the prompt.\n` +
              `- Mention lighting as layered (cove + downlights + accents) with warm 2700-3000K.\n` +
              `- No marketing, no pricing, no extra text besides bullet points.\n`;
            const explainUser =
              `FINAL_PROMPT_EN:\n${finalPrompt}\n\nReturn bullet list now.`;
            const resp = await fetch('https://api.stepfun.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model: 'step-1-8k',
                    temperature: 0.2,
                    max_tokens: 260,
                    messages: [
                        { role: 'system', content: explainSystem },
                        { role: 'user', content: explainUser }
                    ]
                })
            });
            if (!resp.ok) return;
            const data = await resp.json();
            const content = String(data.choices?.[0]?.message?.content || '').trim();
            if (!content) return;
            // Keep as-is; front-end already expects "- xxx" lines.
            designExplanation = content;
        } catch (e) {
            // non-fatal
        }
    };

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
        // StepFun may enforce very low concurrency (e.g. limit=1). Add a small retry for 429.
        const doFetch = async () =>
          await fetch('https://api.stepfun.com/v1/images/image2image', {
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

        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        let r = await doFetch();
        if (r.status === 429) {
          console.warn('[Design Gen] 429 rate limited, retrying...');
          await sleep(900);
          r = await doFetch();
        }
        if (r.status === 429) {
          console.warn('[Design Gen] 429 rate limited again, retrying...');
          await sleep(1400);
          r = await doFetch();
        }
        return r;
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
            st: Math.min(36, finalSteps),
            cfg: Math.min(7.2, finalCfgScale)
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

    const normalizeImageForVision = async (urlOrDataUrl) => {
        const u = String(urlOrDataUrl || '').trim();
        if (!u) return null;
        if (u.startsWith('data:')) return u;
        // StepFun vision can often consume URLs, but make it robust with a base64 fallback.
        try {
            const ab = await fetchUrlToB64(u);
            if (ab?.b64) return `data:${ab.mime || 'image/jpeg'};base64,${ab.b64}`;
        } catch {}
        return u;
    };

    // Single vision call: QA + explanation together (reduces latency vs 2 separate calls)
    const callVisionQaAndExplain = async ({ imageUrl, spaceKind, intake }) => {
        const finalImageUrl = await normalizeImageForVision(imageUrl);
        if (!finalImageUrl) return null;

        const must = (() => {
            if (spaceKind === 'bedroom') return ['bed', 'wardrobe', 'curtains', 'layered lighting (cove+downlights+accent)'];
            if (spaceKind === 'living') return ['tv', 'tv console', 'sofa', 'layered lighting (cove+downlights+accent)'];
            if (spaceKind === 'dining') return ['dining table', 'chairs', 'pendant lights above table', 'sideboard/pantry', 'layered lighting'];
            if (spaceKind === 'kitchen') return ['base cabinets', 'wall cabinets', 'countertop', 'sink/cooktop zone', 'under-cabinet lighting'];
            if (spaceKind === 'bath') return ['vanity cabinet', 'mirror cabinet', 'shower zone/screen', 'anti-slip floor', 'mirror/vanity light'];
            if (spaceKind === 'entry') return ['shoe cabinet', 'bench', 'full-length mirror', 'niche/accent lighting'];
            if (spaceKind === 'corridor') return ['shallow storage', 'clear circulation', 'wall wash/linear lighting'];
            return ['built-in cabinetry', 'finished ceiling/walls/floor', 'curtains/soft furnishings', 'layered lighting'];
        })();

        const system =
          `You are an interior design QA inspector and design summarizer. Judge ONLY from the image.\n` +
          `Output MUST be valid JSON only (no extra text).\n` +
          `Criteria:\n` +
          `- Must look like a NEW, magazine-quality photorealistic interior design proposal render (not a site photo).\n` +
          `- Lighting must be layered: cove/indirect + recessed downlights + space-appropriate accent lights; warm 2700-3000K; no flat lighting.\n` +
          `- Keep straight lines; report any warped windows/doors/walls or fisheye distortion.\n` +
          `- Required objects for this space MUST be visible.\n` +
          `Return schema:\n` +
          `{\n` +
          `  "pass": true/false,\n` +
          `  "missing": ["..."],\n` +
          `  "issues": ["..."],\n` +
          `  "lighting_layered": true/false,\n` +
          `  "distortion": true/false,\n` +
          `  "scores": { "design_render": 0-10, "lighting": 0-10, "realism": 0-10 },\n` +
          `  "suggest_suffix_en": "short English refine instruction <= 240 chars",\n` +
          `  "explain_zh": ["- 5-7 bullet points in Simplified Chinese, each visually verifiable from the image, include layout + cabinetry + layered lighting"]\n` +
          `}\n`;

        const user =
          `Space kind: ${spaceKind}\n` +
          `User selections (for reference, do not hallucinate): ${JSON.stringify({
              style: intake?.style,
              color: intake?.color,
              focus: intake?.focus,
              storage: intake?.storage,
              vibe: intake?.vibe,
              decor: intake?.decor,
          })}\n` +
          `Required visible items: ${must.join(', ')}\n` +
          `Now evaluate this image.`;

        const resp = await fetch('https://api.stepfun.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: 'step-1v-8k',
                temperature: 0.1,
                max_tokens: 520,
                messages: [
                    { role: 'system', content: system },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: user },
                            { type: 'image_url', image_url: { url: finalImageUrl } }
                        ]
                    }
                ]
            })
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content || '';
        return safeJsonParse(content);
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

    // Under 60s limit, only refine if we still have enough time budget.
    // Otherwise return first-pass image and let user request "再精修" explicitly.
    const allowRefineNow = shouldRefine && timeLeftMs() > 22000;

    if (allowRefineNow) {
        try {
            const refineSource =
                resultUrl
                    ? resultUrl
                    : (resultImageB64 ? `data:image/jpeg;base64,${resultImageB64}` : null);
            if (refineSource) {
                const refinePrompt = (() => {
                    const suffix =
                      ' Refine into magazine-quality photorealistic interior render: ONLY enhance materials, cabinetry detailing, and layered lighting. Lighting must be beautiful and realistic: warm white 2700-3000K, CRI 90+, dimmable; ceiling cove/indirect + recessed downlights + space-appropriate accent lights (wall wash / cabinet niche / pendant / bedside / under-cabinet). Keep balanced exposure, soft shadows, realistic GI; avoid overexposed highlights. Do NOT change layout or move furniture/cabinets. Keep straight lines; no distorted windows/doors; no fisheye; no office grid ceiling; no hospital bed/medical rails. Keep structure and perspective unchanged. Avoid empty room, blank walls, unfinished concrete, muddy textures, melted objects.';
                    const t = String(finalPrompt + suffix).replace(/\s+/g, ' ').trim();
                    return t.length > 1024 ? t.slice(0, 1021) + '...' : t;
                })();
                const refineRes = await callStepFun({
                    urlToUse: refineSource,
                    rf: 'url',
                    promptToUse: refinePrompt,
                    // Lower weight to preserve the (already designed) first-pass image
                    sw: Math.min(0.32, finalSourceWeight),
                    st: Math.min(36, finalSteps),
                    cfg: Math.min(6.8, finalCfgScale)
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

    // --- Post-check loop (vision QA) and one extra auto-refine if needed ---
    const spaceKindForCheck = renderIntake ? inferSpaceKind(renderIntake?.space, renderIntake?.focus, renderIntake?.requirements, renderIntake?.bedType) : 'other';
    let qa = null;
    let qa2 = null;
    let autoRefined = false;
    let qaSkipped = false;
    try {
        const currentImg = resultUrl ? resultUrl : (resultImageB64 ? `data:image/jpeg;base64,${resultImageB64}` : null);
        if (currentImg && renderIntake) {
            // Skip QA if we're close to Vercel timeout (avoid 504)
            if (timeLeftMs() < 14000) {
                qaSkipped = true;
            } else {
                qa = await callVisionQaAndExplain({ imageUrl: currentImg, spaceKind: spaceKindForCheck, intake: renderIntake });
            }

            // If we already have image-based explain bullets, use them (ensures match)
            if (!designExplanation) {
                const arr = Array.isArray(qa?.explain_zh) ? qa.explain_zh : null;
                if (arr && arr.length) {
                    designExplanation = arr.map(x => String(x).trim()).filter(Boolean).slice(0, 8).join('\n');
                }
            }
            const pass = Boolean(qa?.pass);
            if (!qaSkipped && !pass && timeLeftMs() > 18000) {
                const suggestion = String(qa?.suggest_suffix_en || '').replace(/\s+/g, ' ').trim();
                const refineSource = currentImg;
                const refinePrompt2 = (() => {
                    const suffix =
                      ` Refine to pass QA: ensure required layout items for ${spaceKindForCheck} are clearly visible; make it look like a NEW magazine-quality interior design render. ` +
                      `Lighting MUST be layered (cove/indirect + recessed downlights + accent lights) warm 2700-3000K, CRI 90+, realistic GI, balanced exposure; avoid flat lighting. ` +
                      `Do NOT warp straight lines; no fisheye; keep structure and perspective. ` +
                      (suggestion ? `Extra: ${suggestion}` : '');
                    const t = String(finalPrompt + suffix).replace(/\s+/g, ' ').trim();
                    return t.length > 1024 ? t.slice(0, 1021) + '...' : t;
                })();

                const refineRes2 = await callStepFun({
                    urlToUse: refineSource,
                    rf: 'url',
                    promptToUse: refinePrompt2,
                    sw: Math.min(0.30, finalSourceWeight),
                    st: Math.min(34, finalSteps),
                    cfg: Math.min(6.6, finalCfgScale)
                });
                if (refineRes2.ok) {
                    const refineData2 = await readStepFunJson(refineRes2);
                    const refined2 = extractResult(refineData2);
                    if (refined2.resultUrl || refined2.resultImageB64) {
                        autoRefined = true;
                        finishReason = refined2.finishReason || finishReason;
                        resultSeed = refined2.resultSeed ?? resultSeed;
                        resultImageB64 = refined2.resultImageB64 || resultImageB64;
                        resultUrl = refined2.resultUrl || resultUrl;
                        const img2 = refined2.resultUrl ? refined2.resultUrl : (refined2.resultImageB64 ? `data:image/jpeg;base64,${refined2.resultImageB64}` : null);
                        if (img2 && timeLeftMs() > 9000) {
                            qa2 = await callVisionQaAndExplain({ imageUrl: img2, spaceKind: spaceKindForCheck, intake: renderIntake });
                            // Prefer refined image explanation if available
                            const arr2 = Array.isArray(qa2?.explain_zh) ? qa2.explain_zh : null;
                            if (arr2 && arr2.length) {
                                designExplanation = arr2.map(x => String(x).trim()).filter(Boolean).slice(0, 8).join('\n');
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.warn('[Design Gen] QA loop error:', e?.message || e);
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

    // Fallback: prompt-based explanation only if we still have time
    if (!designExplanation && timeLeftMs() > 6000) {
        await ensureDesignExplanation();
    }

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
        finish_reason: finishReason,
        qa_pass: qa ? Boolean(qa?.pass) : undefined,
        qa_auto_refined: autoRefined,
        qa_skipped: qaSkipped,
        ms_spent: Date.now() - startedAt,
        qa_last: qa2 || qa || undefined
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
