export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

// Post-generation QA + explanation.
// Purpose: do NOT block /api/design/generate; run as a separate call so we won't hit Vercel maxDuration easily.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, message: 'Method Not Allowed' });
    return;
  }

  const startedAt = Date.now();
  const hardBudgetMs = 55000;
  const timeLeftMs = () => Math.max(0, hardBudgetMs - (Date.now() - startedAt));

  const { imageUrl, renderIntake } = req.body || {};
  if (!imageUrl) {
    res.status(400).json({ ok: false, message: 'Missing imageUrl' });
    return;
  }

  const apiKey = process.env.STEPFUN_API_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, message: 'Missing STEPFUN_API_KEY' });
    return;
  }

  const inferSpaceKind = (spaceText) => {
    // IMPORTANT: Space type must follow user's selected space; never reclassify to another space (e.g. study) based on desk words.
    const s0 = String(spaceText || '').trim();
    const s = s0.toLowerCase();
    if (s0.includes('客餐')) return 'living_dining';
    if (s0.includes('小睡房') || s0.includes('眼镜房') || s0.includes('次卧') || s0.includes('儿童房')) return 'bedroom_small';
    if (s0.includes('大睡房') || s0.includes('主人房') || s0.includes('主卧')) return 'bedroom';
    if (s0.includes('睡') || s0.includes('卧') || s0.includes('房') || s.includes('bed')) return 'bedroom';
    if (s0.includes('厨房') || s0.includes('廚') || s0.includes('厨') || s.includes('kitchen')) return 'kitchen';
    if (s0.includes('卫生间') || s0.includes('衛') || s0.includes('卫') || s0.includes('浴') || s0.includes('厕') || s.includes('bath')) return 'bath';
    if (s0.includes('入户') || s0.includes('玄') || s0.includes('關') || s0.includes('关') || s.includes('entry')) return 'entry';
    if (s0.includes('走廊') || s0.includes('通道') || s.includes('corridor') || s.includes('hallway')) return 'corridor';
    if (s0.includes('餐') || s.includes('dining')) return 'dining';
    if (s0.includes('客') || s.includes('living')) return 'living';
    return 'other';
  };

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

  const must = (spaceKind) => {
    if (spaceKind === 'bedroom_small') return ['bed', 'wardrobe', 'curtains', 'space-saving storage', 'layered lighting (cove+downlights+accent)'];
    if (spaceKind === 'bedroom') return ['bed', 'wardrobe', 'curtains', 'layered lighting (cove+downlights+accent)'];
    if (spaceKind === 'living') return ['tv', 'tv console', 'sofa', 'layered lighting (cove+downlights+accent)'];
    if (spaceKind === 'living_dining') return ['tv', 'tv console', 'sofa', 'dining table', 'chairs', 'pendant lights above table', 'sideboard/pantry', 'layered lighting'];
    if (spaceKind === 'dining') return ['dining table', 'chairs', 'pendant lights above table', 'sideboard/pantry', 'layered lighting'];
    if (spaceKind === 'kitchen') return ['base cabinets', 'wall cabinets', 'countertop', 'sink/cooktop zone', 'under-cabinet lighting'];
    if (spaceKind === 'bath') return ['vanity cabinet', 'mirror cabinet', 'shower zone/screen', 'anti-slip floor', 'mirror/vanity light'];
    if (spaceKind === 'entry') return ['shoe cabinet', 'bench', 'full-length mirror', 'niche/accent lighting'];
    if (spaceKind === 'corridor') return ['shallow storage', 'clear circulation', 'wall wash/linear lighting'];
    return ['built-in cabinetry', 'finished ceiling/walls/floor', 'curtains/soft furnishings', 'layered lighting'];
  };

  try {
    const intake = renderIntake || {};
    const spaceKind = inferSpaceKind(intake?.space);
    const required = must(spaceKind);

    const system =
      `You are an interior design QA inspector and design summarizer. Judge ONLY from the image.\n` +
      `Output MUST be valid JSON only.\n` +
      `Criteria:\n` +
      `- Must look like a NEW, magazine-quality photorealistic interior design proposal render.\n` +
      `- Lighting must be layered: cove/indirect + recessed downlights + space-appropriate accent lights; warm 2700-3000K; no flat lighting.\n` +
      `- Keep straight lines; report warped windows/doors/walls or fisheye distortion.\n` +
      `- Required objects for this space MUST be visible.\n` +
      `- You MUST NOT claim a different room type than the user's selected space.\n` +
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
      `Selected space (fixed): ${String(intake?.space || '').trim()}\n` +
      `Space kind (fixed): ${spaceKind}\n` +
      `User selections (reference only): ${JSON.stringify({
        style: intake?.style,
        color: intake?.color,
        focus: intake?.focus,
        storage: intake?.storage,
        vibe: intake?.vibe,
        decor: intake?.decor,
      })}\n` +
      `Required visible items: ${required.join(', ')}\n` +
      `Now evaluate this image and produce explain_zh.`;

    if (timeLeftMs() < 5000) {
      res.status(200).json({ ok: false, message: 'Time budget too low' });
      return;
    }

    const response = await fetch('https://api.stepfun.com/v1/chat/completions', {
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
              { type: 'image_url', image_url: { url: String(imageUrl) } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Upstream Error: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const qa = safeJsonParse(content);
    const explainArr = Array.isArray(qa?.explain_zh) ? qa.explain_zh : [];
    const designExplanation = explainArr
      .map(x => String(x).trim())
      .filter(Boolean)
      .slice(0, 8)
      .join('\n');

    res.status(200).json({
      ok: true,
      qa: qa || undefined,
      designExplanation: designExplanation || undefined,
      debug: { ms_spent: Date.now() - startedAt, spaceKind },
    });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'Internal error' });
  }
}

