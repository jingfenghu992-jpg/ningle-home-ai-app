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

    const system = `你是一位香港家居空間分類專家。請只根據相片內容判斷空間類型。

輸出必須是 JSON（不要多余文字），格式如下：
{
  "primary": "客厅/餐厅/卧室/厨房/玄关/书房/卫生间/走廊/阳台/其他",
  "candidates": [
    { "space": "xxx", "confidence": 0.0 },
    { "space": "yyy", "confidence": 0.0 },
    { "space": "zzz", "confidence": 0.0 }
  ],
  "reason": "一句话说明依据（例如看到餐桌/炉灶/床/鞋柜/马桶等）"
}
规则：
1) candidates 最多 3 个，confidence 0~1，按高到低
2) 如果不确定，primary 用“其他”，并给出最可能 2-3 个 candidates
3) 用简体中文`;

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
          { space: '客厅', confidence: 0.34 },
          { space: '餐厅', confidence: 0.33 },
          { space: '卧室', confidence: 0.33 },
        ],
        reason: '模型返回非 JSON，已使用默认兜底',
        raw: String(content || '').slice(0, 300),
      });
      return;
    }

    const primary = String(parsed.primary || '其他').trim();
    const candidates = Array.isArray(parsed.candidates) ? parsed.candidates.slice(0, 3) : [];
    const reason = String(parsed.reason || '').trim();

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

