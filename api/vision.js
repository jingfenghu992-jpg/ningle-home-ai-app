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
                        content: `你是一位專業的「香港全屋訂造」視覺分析師，核心專長是：櫃體設計、收納規劃、動線與落地可施工方案。請嚴格根據上傳圖片的真實視覺內容進行分析，避免泛泛而談的軟裝建議（例如只講擺花/裝飾品）。
${spacePrompt}
返回 JSON 格式（內容用繁體中文；只要以下欄位）：
{
  "structure": "空間結構（只講：門窗/落地窗/陽台門/窗台、橫樑/柱位、假天花/冷氣機位等）",
  "lighting": "光線來源與色溫（自然光/燈位不足等）",
  "suggestions": [
    "建議1：櫃體/收納訂造（要具體：位置/高度/開門方式/分區）",
    "建議2：櫃體/收納訂造（要具體：位置/高度/開門方式/分區）"
  ]
}
如果無法返回 JSON，請用列點方式詳細描述。`
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
        
        // Try parse JSON
        let parsed = null;
        try {
            const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
            parsed = JSON.parse(cleanContent);
        } catch (e) {}

        const formatMaybeArray = (v) => {
            if (v == null) return "";
            if (Array.isArray(v)) {
                return v.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n');
            }
            if (typeof v === 'object') return JSON.stringify(v);
            return String(v);
        };

        const shorten = (s, max = 120) => {
            const t = formatMaybeArray(s).replace(/\s+/g, ' ').trim();
            return t.length > max ? t.slice(0, max) + '…' : t;
        };

        const suggestionsText = formatMaybeArray(parsed?.suggestions);
        const summary = parsed
            ? `【視覺分析】\n結構：${shorten(parsed.structure, 220)}\n光線：${shorten(parsed.lighting, 160)}\n建議：\n${suggestionsText}`
            : content;

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
