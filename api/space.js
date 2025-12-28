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

  const imageUrl = req.body.imageUrl || req.body.imageDataUrl || req.body.image;
  const clientId = req.body.clientId || 'anon';

  if (!imageUrl) {
    res.status(400).json({ ok: false, message: 'Missing imageUrl' });
    return;
  }

  const apiKey = process.env.STEPFUN_API_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, errorCode: 'MISSING_KEY', message: 'Missing STEPFUN_API_KEY' });
    return;
  }

  try {
    console.log('[Space API] Classifying space...', { clientId });

    // Prefer data-url to avoid public URL permission issues, but accept both.
    let finalImageUrl = imageUrl;
    if (imageUrl.startsWith('http')) {
      try {
        const imgRes = await fetch(imageUrl);
        if (imgRes.ok) {
          const ab = await imgRes.arrayBuffer();
          const b64 = Buffer.from(ab).toString('base64');
          const mime = imgRes.headers.get('content-type') || 'image/jpeg';
          finalImageUrl = `data:${mime};base64,${b64}`;
        }
      } catch (e) {
        console.warn('[Space API] Failed to convert URL to base64, using original URL');
      }
    }

    const ALLOWED = ['客餐厅', '大睡房', '小睡房', '厨房', '卫生间', '入户', '走廊', '其他'];
    const normalizeSpaceType = (t) => {
      const v = String(t || '').trim();
      const allowed = new Set(ALLOWED);
      if (allowed.has(v)) return v;
      if (v.includes('客') && v.includes('餐')) return '客餐厅';
      if (v === '客厅' || v === '餐厅') return '客餐厅';
      if (v.includes('厨') || v.includes('廚')) return '厨房';
      if (v.includes('卫') || v.includes('衛') || v.includes('浴') || v.includes('厕') || v.includes('廁')) return '卫生间';
      if (v.includes('入') || v.includes('玄') || v.includes('關') || v.includes('关')) return '入户';
      if (v.includes('走廊') || v.includes('通道') || v.includes('过道')) return '走廊';
      if (v.includes('小') && (v.includes('睡') || v.includes('卧') || v.includes('房'))) return '小睡房';
      if (v.includes('大') && (v.includes('睡') || v.includes('卧') || v.includes('房'))) return '大睡房';
      if (v === '卧室' || (v.includes('睡') || v.includes('卧') || v.includes('房'))) return '大睡房';
      return '其他';
    };

    const system = `你是一位香港家居空間分類專家。請只根據相片內容判斷空間類型（香港常見戶型）。

輸出必須是 JSON（不要多余文字），格式如下：
{
  "primary": "客餐厅/大睡房/小睡房/厨房/卫生间/入户/走廊/其他（尽量不要选其他）",
  "candidates": [
    { "space": "xxx", "confidence": 0.0 },
    { "space": "yyy", "confidence": 0.0 },
    { "space": "zzz", "confidence": 0.0 }
  ],
  "reason": "一句话说明依据（例如看到餐桌/炉灶/床/鞋柜/马桶等）"
}
规则：
1) candidates 最多 3 个，confidence 0~1，按高到低
2) 默认必须在以下 7 类里选一个最可能的 primary：客餐厅/大睡房/小睡房/厨房/卫生间/入户/走廊；只有在完全无法判断且候选置信度都很低时，才允许 primary=其他
3) 用简体中文
4) 香港常见：客餐厅经常同一空间；卧室请尽量区分大睡房/小睡房（空间窄小、眼镜房、榻榻米/地台可能性高 -> 小睡房）
5) 空间形状也要作为依据：狭长且只有一扇窗、像“长条房”通常更像小睡房；走廊通常很少有窗且更像通道；厨房/卫生间通常能看到明显设备/分区。
6) 不要输出“客厅/卧室/书房”等不在枚举里的 primary，必须映射为上述分类。`;

    const response = await fetch('https://api.stepfun.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'step-1v-8k',
        temperature: 0.1,
        max_tokens: 220,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: [
              { type: 'text', text: '请判断这张相片属于哪个室内空间类型。' },
              { type: 'image_url', image_url: { url: finalImageUrl } },
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

    const parsed = safeJsonParse(content);
    if (!parsed) {
      res.status(200).json({
        ok: true,
        primary: '其他',
        candidates: [
          { space: '客餐厅', confidence: 0.34 },
          { space: '大睡房', confidence: 0.33 },
          { space: '小睡房', confidence: 0.33 },
        ],
        reason: '模型返回非 JSON，已使用默认兜底',
        raw: String(content || '').slice(0, 300),
      });
      return;
    }

    const rawPrimary = String(parsed.primary || '其他').trim();
    const rawCandidates = Array.isArray(parsed.candidates) ? parsed.candidates.slice(0, 3) : [];
    const reason = String(parsed.reason || '').trim();

    const candidates = rawCandidates
      .map((c) => ({
        space: normalizeSpaceType(c?.space),
        confidence: typeof c?.confidence === 'number' ? Math.max(0, Math.min(1, c.confidence)) : 0,
      }))
      .filter((c) => Boolean(c.space))
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .slice(0, 3);

    let primary = normalizeSpaceType(rawPrimary);
    // 如果模型选了“其他”但候选很明确，则强制提升为最可能的那一类（减少“什么都其他”）
    if (primary === '其他' && candidates.length && (candidates[0].confidence || 0) >= 0.45) {
      primary = candidates[0].space;
    }
    if (!ALLOWED.includes(primary)) {
      primary = candidates[0]?.space || '其他';
    }

    res.status(200).json({
      ok: true,
      primary,
      candidates,
      reason,
    });
  } catch (error) {
    console.error('[Space API] Error:', error);
    res.status(500).json({ ok: false, message: error.message || 'Internal error' });
  }
}

