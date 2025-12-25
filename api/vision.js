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

        const spacePrompt = spaceType ? `這是一張${spaceType}的照片。` : "";

        const response = await fetch('https://api.stepfun.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'step-1v-8k',
                messages: [
                    {
                        role: "system",
                        content: `你是一位資深香港全屋訂造設計師，專注：櫃體設計、收納分區、動線落地。
${spacePrompt}

請用「人正常講嘢」嘅口吻輸出，唔好用 JSON、唔好用引號/大括號、唔好出現欄位名。
只需要 4 段內容：
1) 結構：用 1–2 句講清楚門窗/落地窗/陽台門/窗台、橫樑柱位、假天花/冷氣機位等（只講你睇到嘅）
2) 光線：用 1 句講自然光/色溫/補光方向
3) 櫃體建議 1（要具體：位置 + 大概高度範圍 + 開門方式 + 分區）
4) 櫃體建議 2（同上）

限制：每句盡量短，少標點，不要講軟裝擺設（例如擺花、裝飾品）`
                    },
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "請分析這張室內圖片。" },
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
        
        // If model still returns JSON, try to extract and humanize it.
        const tryParseJson = (raw) => {
            try {
                const clean = String(raw || '').replace(/```json/g, '').replace(/```/g, '').trim();
                // Robust extraction between first { and last }
                const s = clean.indexOf('{');
                const e = clean.lastIndexOf('}');
                if (s >= 0 && e > s) {
                    return JSON.parse(clean.slice(s, e + 1));
                }
            } catch {}
            return null;
        };

        const parsed = tryParseJson(content);
        const humanize = (p) => {
            const structure = String(p?.structure || '').trim();
            const lighting = String(p?.lighting || '').trim();
            const suggestions = Array.isArray(p?.suggestions) ? p.suggestions : [];
            const s1 = suggestions[0] ? String(suggestions[0]).trim() : '';
            const s2 = suggestions[1] ? String(suggestions[1]).trim() : '';
            const lines = [
                structure ? `結構：${structure}` : '',
                lighting ? `光線：${lighting}` : '',
                s1 ? `建議：${s1}` : '',
                s2 ? `建議：${s2}` : ''
            ].filter(Boolean);
            return lines.join('\n');
        };

        const summary = parsed ? humanize(parsed) : String(content || '').trim();

        res.status(200).json({
            ok: true,
            vision_summary: summary,
            extraction: parsed
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
