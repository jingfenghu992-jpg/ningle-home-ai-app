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
                // Keep it short for mobile UI; enforce compact 4-line output
                max_tokens: 240,
                messages: [
                    {
                        role: "system",
                        content: `你是一位資深香港全屋訂造設計師，專注：櫃體設計、收納分區、動線落地，並且熟悉香港公屋/居屋常見限制（窗台深、樓底矮、冷氣機位尴尬、電箱/水表位、走廊浪費位）。
${spacePrompt}

請用「正常設計師」口吻輸出（简体为主，可少量港式语气词），唔好用 JSON。
重要：
1) 必須「只對住呢張相」講，所有結論要有畫面證據
2) 用戶已確認空間類型時，只能輸出該空間內容，絕對唔好提其他空間（例如唔好講客廳/廚房/衛生間等，除非用戶確認係嗰個空間）
3) 見唔到就寫「未見，唔好亂估」

輸出格式【嚴格】：
- 只輸出 4 行（不要空行、不要多餘文字）
- 每行盡量短（<= 45 個中文字符左右）
- 每行固定前綴：結構： / 光線： / 完成度： / 布置：

內容要求：
結構：只講看得到的門窗/窗台/梁柱/凸位/頂面/底盒，必須帶方位（左牆/右牆/窗下/靠鏡頭/遠端）。
光線：自然光從哪入＋整體偏冷/偏暖（短句）。
完成度：只能三選一【毛坯/半裝/已裝】＋一句畫面依據（很短）。
布置：只針對「${spaceType || '用戶確認的空間'}」，只給 2 點：①主要柜体/家具摆位（带方位）②一句灯光层次（灯槽+筒灯+重点光）。不要啰嗦。`
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
