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
      : 44;

  const finalCfgScale =
    typeof cfg_scale === 'number' && cfg_scale >= 1 && cfg_scale <= 10
      ? cfg_scale
      : 7.2;

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
      if (spaceKind === 'bedroom') base.push('Accent lighting: bedside wall lights + headboard wash light, warm and calm.');
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
  - finished: keep existing ceiling/walls/floor as much as possible; mainly enhance cabinetry, lighting layers, material harmony and soft furnishings.
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
      if (has(['廚', '厨', '廚櫃', '橱柜', '吊櫃', '吊柜', '星盆', '爐頭', '炉头', 'kitchen', 'cooktop', 'sink'])) return 'kitchen';
      if (has(['浴', '厕', '衛', '卫', '洗手', '浴室櫃', '浴室柜', '鏡櫃', '镜柜', 'bath', 'vanity', 'shower'])) return 'bath';
      if (has(['玄', '關', '关', '鞋', '鞋櫃', '鞋柜', 'entry', 'shoe cabinet'])) return 'entry';
      if (has(['書', '书', '書枱', '书台', '書桌', '书桌', '工作位', 'study', 'desk', 'bookcase'])) return 'study';
      if (has(['床', '睡', '卧', '房', '衣櫃', '衣柜', '榻榻米', '地台', 'bed', 'wardrobe', 'closet'])) return 'bedroom';
      if (has(['餐', '餐桌', '餐邊', '餐边', 'dining', 'dining table'])) return 'dining';
      if (has(['電視', '电视', 'tv', 'sofa', '客厅', '客廳', 'living'])) return 'living';

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
            if (spaceKind === 'dining') return base.concat(['dining table for 4', 'chairs', 'pendant above table', 'dining sideboard/tall pantry']);
            if (spaceKind === 'bedroom') return base.concat(['residential bed (no hospital bed, no metal rails)', 'full-height wardrobe', 'bedside', 'curtains']);
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
            if (Array.isArray(designSpec.explain_zh) && designSpec.explain_zh.length) {
              designExplanation = designSpec.explain_zh.map(x => `- ${x}`).join('\n');
            }
          }
        } catch (e) {
          console.warn('[Design Gen] buildSpec failed:', e?.message || e);
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
            ? 'Finish level: bare shell; complete full fit-out (ceiling + walls + floor + skirting + curtains), then furniture + cabinetry + layered lighting.'
            : finishLevelFallback === 'semi_finished'
              ? 'Finish level: semi-finished; keep existing finished parts and add missing finishes, then unify materials and lighting.'
              : finishLevelFallback === 'finished'
                ? 'Finish level: finished; keep existing ceiling/walls/floor as much as possible, mainly upgrade cabinetry, lighting layers, and soft furnishings.'
                : 'Finish level: unknown; prioritize keeping structure, and ensure the render looks fully finished.';
        const spaceKindFallback = inferSpaceKind(space, focus, requirements, renderIntake?.bedType);
        const lightingScript = getLightingScriptEn({ spaceKind: spaceKindFallback, vibe });

        // Hard constraints for HK apartment + balcony cases
        const hardRules = [
            'Photorealistic high-end interior design rendering, V-Ray/Corona render style, magazine quality, beautiful and finished.',
            'This must look like a real interior design proposal render, NOT an empty room.',
            'Hong Kong apartment practicality, built-in cabinetry is the main change.',
            'INTERIOR ONLY: do NOT redesign the balcony or outdoor view; keep balcony/exterior as background unchanged.',
            'Do NOT add balcony furniture; do NOT change balcony floor/walls/railings/exterior facade.',
            'Keep the exact room structure and perspective: do NOT move windows/doors/beams/columns; keep camera viewpoint.',
            'Do NOT generate office grid ceiling / mineral fiber ceiling tiles; use gypsum board ceiling with slim cove lighting instead.',
            'Bedroom bed must be residential; avoid hospital bed / medical rails.',
            'Do NOT leave bare concrete floor or unfinished walls; fully finish the interior.',
        ].join(' ');

        const mustHave = [
            'Must include: finished flooring (engineered wood or large-format porcelain tiles with skirting), finished wall surfaces, and a proper ceiling design (gypsum board flat ceiling / slim cove lighting + downlights).',
            'Must include: built-in cabinetry plan with real details (full-height cabinets, toe-kick, shadow gap or integrated handles, internal compartments).',
            'Must include: a complete furniture layout + soft furnishings (curtains, rug, artwork, plants), warm realistic lighting, coherent styling.',
            'Must include: a layered lighting script (cove/indirect + downlights + accent) with warm white 2700-3000K, CRI90+, dimmable, realistic GI and balanced exposure.',
            spaceEn.includes('dining') ? 'Dining must-have: dining table for 4 + chairs with clear circulation, pendant light above table, and a dining sideboard/tall pantry storage with display niche lighting.' : '',
        ].filter(Boolean).join(' ');

        const quality = [
            'Materials: ENF-grade multilayer wood/plywood cabinetry.',
            'Lighting: warm, natural; balanced exposure; not oversharpened.',
            'Clean realistic textures; no cartoon/CGI look; no low-poly.',
            'Avoid: empty room, blank walls, unfinished concrete, muddy textures, toy-like 3D, distorted straight lines, fisheye, bent walls, melted objects, overexposed highlights.'
        ].join(' ');

        const extraReq = compact(requirements, 380);

        if (!designSpec?.prompt_en) {
          // Keep prompt explicit and mostly English for better adherence.
          // Put hard constraints + must-have early to avoid being truncated away.
          finalPrompt = trimPrompt([
              hardRules,
              mustHave,
              finishPolicy,
              lightingScript,
              `Space: ${spaceEn}.`,
              `Style: ${styleEn}.`,
              `Color palette: ${colorEn}.`,
              focusHint,
              storageHint,
              vibeHint,
              decorHint,
              priorityHint,
              intensityHint,
              quality,
              extraReq ? `Constraints/notes: ${extraReq}` : ''
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
