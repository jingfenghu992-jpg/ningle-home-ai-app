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

            // Setup controller for upstream timeout (50s to avoid Vercel gateway timeout)
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 50000);

            // If imageUrl is present (Blob URL), we need to fetch it and convert to base64
            // because passing the URL directly to StepFun might fail if they can't access Vercel Blobs.
            let finalImageUrl = imageUrl;
            
            // Optimization: If StepFun supports Vercel Blob URLs directly, we should skip this fetch.
            // However, based on logs, StepFun seems to have trouble accessing them (perhaps due to anti-bot headers or geo-blocking).
            // So we fetch it server-side.
            if (imageUrl && imageUrl.startsWith('http')) {
                try {
                    // Check if it's a Vercel Blob URL to add potential optimization or logging
                    const isVercelBlob = imageUrl.includes('public.blob.vercel-storage.com');
                    console.log(`[Vision API] Fetching image from URL (Vercel Blob: ${isVercelBlob}): ${imageUrl}`);
                    
                    const imgRes = await fetch(imageUrl);
                    if (imgRes.ok) {
                        const arrayBuffer = await imgRes.arrayBuffer();
                        const buffer = Buffer.from(arrayBuffer);
                        const base64 = buffer.toString('base64');
                        const mime = imgRes.headers.get('content-type') || 'image/jpeg';
                        
                        // Check size here. If > 4MB (safe margin for Vercel 1024MB RAM), we might still fail.
                        // Vercel Hobby has 1024MB RAM. A 10MB JPEG can decompress to 100MB+ bitmap in memory depending on libs,
                        // but here we just hold base64 string which is ~1.33x size.
                        // 10MB image -> 13MB string. This is fine for memory.
                        // The issue might be request body size to StepFun? StepFun limit?
                        // Let's just log size.
                        const sizeMB = base64.length / 1024 / 1024;
                        console.log(`[Vision API] Converted image size: ${sizeMB.toFixed(2)} MB`);

                        if (sizeMB > 8) {
                             console.warn('[Vision API] Image might be too large for StepFun');
                        }
                        finalImageUrl = `data:${mime};base64,${base64}`;
                    } else {
                        console.warn(`[Vision API] Failed to fetch image from URL: ${imgRes.status}, falling back to original URL.`);
                    }
                } catch (fetchErr) {
                    console.warn(`[Vision API] Error fetching image for conversion:`, fetchErr);
                }
            }

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
                            content: `你是一位專業的室內設計視覺分析師，專精於香港住宅空間。請分析圖片並返回以下 JSON 格式：
{
  "perspective": "視角與鏡頭高度（例如：平視、俯視、透視感）",
  "structure": "空間結構（特別留意：橫樑、柱位、窗台、假天花）及其位置",
  "lighting": "光線來源、色溫（例如：暖黃、白光）及陰影",
  "materials": "主要材質與質感（例如：木地板、乳膠漆牆、玻璃）",
  "hk_notes": "香港常見戶型特徵（例如：窗台深度、冷氣機位、樓底高度感）",
  "notes": "任何模糊或被遮擋的不確定區域"
}
如果無法返回 JSON，請用列點方式詳細描述上述內容。`
                        },
                        {
                            role: "user",
                            content: [
                                { type: "text", text: "請分析這張室內圖片。" },
                                { type: "image_url", image_url: { url: finalImageUrl } }
                            ]
                        }
                    ]
                }),
                signal: controller.signal
            });
            
            clearTimeout(timeout);

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
            clearTimeout(timeout);
            console.error(`[Vision API] Error with ${usedKey}:`, error);
            
            if (error.name === 'AbortError') {
                lastError = { message: 'Upstream Vision API timed out (50s)' };
                // Specific behavior: if timed out, try next key? 
                // Usually timeout means model is slow or image is too large, changing key might not help but worth a try.
            } else {
                lastError = { message: error.message };
            }
        }
    }

    res.status(502).json({
        ok: false,
        errorCode: 'UPSTREAM_FAILED',
        message: 'All vision keys failed',
        lastError
    });
}
