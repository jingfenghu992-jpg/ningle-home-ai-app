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

        const spacePrompt = spaceType ? `這是一張「${spaceType}」的照片。` : "";

        const response = await fetch('https://api.stepfun.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'step-1v-8k',
                temperature: 0.2,
                max_tokens: 420,
                messages: [
                    {
                        role: "system",
                        content: `你是一位資深香港全屋訂造設計師，專注：櫃體設計、收納分區、動線落地，並且熟悉香港公屋/居屋常見限制（窗台深、樓底矮、冷氣機位尴尬、電箱/水表位、走廊浪費位）。
${spacePrompt}

請用「正常設計師」口吻輸出（簡體為主，可少量港式語氣詞），唔好用 JSON、唔好出現欄位名。
重要：
1) 必須「只對住呢張相」講，所有結論要有畫面證據
2) 用戶已確認空間類型時，只能輸出該空間內容，絕對唔好提其他空間（例如唔好講客廳/廚房/衛生間等，除非用戶確認係嗰個空間）
3) 見唔到就寫「未見，唔好亂估」

請只輸出 4 段（每段 1–3 句，句子短）：
1) 結構（只講睇到嘅）：門窗/窗台/梁柱/頂面狀態/牆身凸位/可見底盒（帶方位：左牆/右牆/窗下/靠鏡頭/遠端）
2) 光線：自然光由邊度入（窗方向）＋整體偏冷/偏暖
3) 完成度：毛坯/半裝/已裝（只能三選一，必須用畫面證據支持）
4) 布置建議（要像多年設計師落地）：只針對「${spaceType || '用戶確認的空間'}」，給出家具/柜体的精準摆位＋动线（必须讲清楚放哪面墙/靠窗/靠门、如何避开门扇/窗帘/冷气位/检修位），并补一句灯光层次建议（灯槽+筒灯+重点光）。

補充限制：不要講裝飾品清單；重點放「摆位＋柜体＋动线＋灯光层次」。`
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
