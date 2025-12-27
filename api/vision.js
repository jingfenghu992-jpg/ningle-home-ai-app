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
    const spaceType = req.body.spaceType; // New: Accept space type hint

    if (!imageUrl) {
        res.status(400).json({ error: 'Missing imageUrl' });
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
        console.log('[Vision API] Analyzing image...');
        
        let finalImageUrl = imageUrl;
        if (imageUrl.startsWith('http')) {
            try {
                const imgRes = await fetch(imageUrl);
                if (imgRes.ok) {
                    const arrayBuffer = await imgRes.arrayBuffer();
                    const base64 = Buffer.from(arrayBuffer).toString('base64');
                    const mime = imgRes.headers.get('content-type') || 'image/jpeg';
                    finalImageUrl = `data:${mime};base64,${base64}`;
                }
            } catch (e) {
                console.warn('[Vision API] Failed to convert URL to base64, using original URL');
            }
        }

        const spacePrompt = spaceType ? `This is a photo of a "${spaceType}" in a Hong Kong apartment.` : "This is a photo of an interior space in a Hong Kong apartment.";

        // We want a designer-grade layout analysis that can be fed into the i2i prompt later.
        // Output JSON only, then we will generate a compact 4-line summary for UI.
        const schema = `Return JSON only, with this schema:
{
  "space_type": "客餐厅/大睡房/小睡房/厨房/卫生间/入户/走廊/其他",
  "structure": [
    "结构点（必须带方位：左墙/右墙/远端/近端/窗下/门旁/梁位/冷气位/电箱等）",
    "..."
  ],
  "light": "自然光方向 + 冷/暖（短句）",
  "finish_level": { "level": "毛坯/半装/已装", "evidence": "一句画面证据" },
  "fixed_constraints": [
    "不可动的硬约束（门窗/梁柱/冷气/电箱/水煤位/走道宽等）"
  ],
  "layout_options": [
    {
      "title": "方案A（<=10字）",
      "plan": "一句话摆位（必须带方位）",
      "cabinetry": "柜体/收纳方案（位置+到顶/薄柜/开门方式）",
      "circulation": "动线要点（保留净通道/避开门扇/避开窗台）",
      "lighting": "灯光层次（灯槽/筒灯/重点光）",
      "risk": "一句风险提醒（例如会挡窗/太挤/门冲突）"
    }
  ],
  "recommended_index": 0
}
Rules:
- layout_options must be 2-3 options, each <= 90 Chinese chars total across fields.
- Must respect: do NOT hallucinate what you cannot see; if not visible, say "未见".
- If user confirmed space_type, MUST keep it consistent and do NOT mention other spaces.
- Focus on layout/placement/cabinet feasibility for Hong Kong flats.`;

        const response = await fetch('https://api.stepfun.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'step-1v-8k',
                temperature: 0.15,
                // Slightly larger to allow 2-3 layout options while keeping latency OK
                max_tokens: 520,
                messages: [
                    {
                        role: "system",
                        content: `You are a senior Hong Kong interior designer specialized in cabinetry, storage zoning and buildable circulation.
${spacePrompt}
You MUST output JSON only. No markdown, no extra text.
${schema}`
                    },
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Analyze this interior photo for structure, constraints, and 2-3 buildable layout options." },
                            { type: "image_url", image_url: { url: finalImageUrl } }
                        ]
                    }
                ]
            })
        });

        if (!response.ok) {
            throw new Error(`Upstream Error: ${response.status} ${await response.text()}`);
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content || "";

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

        const normalizeSpaceType = (t) => {
            const v = String(t || '').trim();
            // Keep the taxonomy aligned to /api/space
            const allowed = new Set(['客餐厅', '大睡房', '小睡房', '厨房', '卫生间', '入户', '走廊', '其他']);
            if (allowed.has(v)) return v;
            // If model returns variants, map loosely
            if (v.includes('客') && v.includes('餐')) return '客餐厅';
            if (v.includes('厨') || v.includes('廚')) return '厨房';
            if (v.includes('卫') || v.includes('衛') || v.includes('浴') || v.includes('厕') || v.includes('廁')) return '卫生间';
            if (v.includes('入') || v.includes('玄') || v.includes('關') || v.includes('关')) return '入户';
            if (v.includes('走廊') || v.includes('通道')) return '走廊';
            if (v.includes('小') && (v.includes('睡') || v.includes('卧') || v.includes('房'))) return '小睡房';
            if (v.includes('大') && (v.includes('睡') || v.includes('卧') || v.includes('房'))) return '大睡房';
            if (v.includes('睡') || v.includes('卧') || v.includes('房')) return '大睡房';
            return '其他';
        };

        const to4LineSummary = (p) => {
            if (!p) return String(content || '').trim();
            const structureArr = Array.isArray(p.structure) ? p.structure : [];
            const structure = structureArr.slice(0, 2).map(s => String(s).trim()).filter(Boolean).join('；') || '未见';
            const light = String(p.light || '').trim() || '未见';
            const fin = p.finish_level || {};
            const finLevel = String(fin.level || '').trim() || '未见';
            const finEv = String(fin.evidence || '').trim();
            const finish = finEv ? `${finLevel}，${finEv}` : finLevel;
            const opts = Array.isArray(p.layout_options) ? p.layout_options : [];
            const ri = Number.isInteger(p.recommended_index) ? p.recommended_index : 0;
            const rec = opts[ri] || opts[0] || {};
            const plan = String(rec.plan || '').trim() || '未见';
            const lighting = String(rec.lighting || '').trim();
            const layoutLine = lighting ? `${plan}｜${lighting}` : plan;
            return [
                `結構：${structure}。`,
                `光線：${light}。`,
                `完成度：${finish}。`,
                `布置：${layoutLine}。`
            ].join('\n');
        };

        // Enforce consistent spaceType if provided by user
        if (parsed) {
            parsed.space_type = spaceType ? normalizeSpaceType(spaceType) : normalizeSpaceType(parsed.space_type);
        }

        const summary = to4LineSummary(parsed);

        res.status(200).json({
            ok: true,
            vision_summary: summary,
            extraction: parsed || undefined
        });

    } catch (error) {
        console.error('[Vision API] Error:', error);
        res.status(500).json({
            ok: false,
            errorCode: 'INTERNAL_ERROR',
            message: error.message
        });
    }
}
