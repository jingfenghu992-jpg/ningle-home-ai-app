export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method Not Allowed' });
        return;
    }

    const { imageDataUrl, mode } = req.body;

    if (!imageDataUrl) {
        res.status(400).json({ error: 'Missing imageDataUrl' });
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
                            content: "你是一個專業的室內設計視覺分析師。請仔細分析圖片中的空間結構、材質、光線和佈局。"
                        },
                        {
                            role: "user",
                            content: [
                                { type: "text", text: "請分析這張室內圖片。" },
                                { type: "image_url", image_url: { url: imageDataUrl } }
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
                
                // Other errors, throw to stop (or maybe continue? safest is continue)
                lastError = { status: response.status, message: errText };
                continue;
            }

            const data = await response.json();
            const content = data.choices[0]?.message?.content || "";

            // Simple extraction logic (mocked extraction for now based on content, or just return content)
            // In a real app, we might ask LLM to output JSON. 
            // Here we return the text summary and a basic extraction object.
            
            res.status(200).json({
                ok: true,
                vision_summary: content,
                extraction: { 
                    roomTypeGuess: "Detected Room", // Simplified for now
                    rawAnalysis: content
                },
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

    // If all keys failed
    res.status(502).json({
        ok: false,
        errorCode: 'UPSTREAM_FAILED',
        message: 'All vision keys failed',
        lastError
    });
}
