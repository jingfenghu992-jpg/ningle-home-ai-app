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

    // Support both parameter names for robustness
    const imageUrl = req.body.imageUrl || req.body.imageDataUrl || req.body.image;

    if (!imageUrl) {
        res.status(400).json({ error: 'Missing imageUrl or imageDataUrl' });
        return;
    }

    const keys = [
        process.env.STEPFUN_VISION_API_KEY,
        process.env.STEPFUN_VISION_API_KEY_2
    ].filter(Boolean);

    if (keys.length === 0) {
        res.status(500).json({ 
            ok: false,
            errorCode: 'MISSING_KEY',
            message: 'No STEPFUN_VISION_API_KEY configured' 
        });
        return;
    }

    let lastError = null;
    let usedKey = '';

    for (const key of keys) {
        try {
            usedKey = key === process.env.STEPFUN_VISION_API_KEY ? 'KEY_1' : 'KEY_2';
            console.log(`[Vision API] Trying with ${usedKey}...`);

            const response = await fetch('https://api.stepfun.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`
                },
                body: JSON.stringify({
                    model: 'step-1v-8k',
                    messages: [
                        {
                            role: "system",
                            content: `你是一位專業的室內設計視覺分析師。請分析圖片並返回以下 JSON 格式（不要使用 Markdown 代碼塊，直接返回 JSON）：
{
  "perspective": "視角與鏡頭高度（例如：平視、俯視、透視感）",
  "structure": "空間結構、主要物件（窗、門、樑柱）及其位置",
  "lighting": "光線來源、色溫（例如：暖黃、白光）及陰影",
  "materials": "主要材質與質感（例如：木地板、乳膠漆牆、玻璃）",
  "notes": "任何模糊或被遮擋的不確定區域"
}
如果無法返回 JSON，請用列點方式詳細描述上述內容。`
                        },
                        {
                            role: "user",
                            content: [
                                { type: "text", text: "請分析這張室內圖片。" },
                                { type: "image_url", image_url: { url: imageUrl } }
                            ]
                        }
                    ]
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                console.warn(`[Vision API] Failed with ${usedKey}: ${response.status} - ${errText}`);
                
                // If 401 (Unauthorized) or 429 (Rate Limit), continue to next key
                if (response.status === 401 || response.status === 429) {
                    lastError = { status: response.status, message: errText };
                    continue;
                }
                
                lastError = { status: response.status, message: errText };
                continue;
            }

            const data = await response.json();
            const content = data.choices[0]?.message?.content || "";
            
            // Try to parse JSON, fallback to raw text
            let parsed = null;
            try {
                // Remove markdown code blocks if present
                const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
                parsed = JSON.parse(cleanContent);
            } catch (e) {
                console.warn("[Vision API] JSON parse failed, using raw text", e);
            }

            const formattedSummary = parsed 
                ? `【視覺分析報告】
- 視角：${parsed.perspective}
- 結構：${parsed.structure}
- 光線：${parsed.lighting}
- 材質：${parsed.materials}
- 備註：${parsed.notes}`
                : content;

            res.status(200).json({
                ok: true,
                vision_summary: formattedSummary,
                extraction: parsed || { rawAnalysis: content },
                debug: {
                    usedKey: usedKey,
                    requestId: data.id
                }
            });
            return;

        } catch (error) {
            console.error(`[Vision API] Error with ${usedKey}:`, error);
            lastError = { message: error.message };
        }
    }

    res.status(502).json({
        ok: false,
        errorCode: 'UPSTREAM_FAILED',
        message: 'All vision keys failed',
        lastError
    });
}
