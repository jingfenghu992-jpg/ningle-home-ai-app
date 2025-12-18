export default async function handler(req, res) {
    const keys = [
        process.env.STEPFUN_VISION_API_KEY,
        process.env.STEPFUN_VISION_API_KEY_2
    ].filter(Boolean);

    if (keys.length === 0) {
        res.status(200).json({ ok: false, errorCode: 'MISSING_KEY' });
        return;
    }

    let lastError = null;

    for (const key of keys) {
        try {
            const usedKeyLabel = key === process.env.STEPFUN_VISION_API_KEY ? 'KEY_1' : 'KEY_2';
            
            // Minimal health check - analyze a tiny 1x1 pixel image or just ask "hello" if model supports text-only (most vision models do)
            // Or use a public image URL. Since we don't have a public URL handy, let's try text-only prompt if supported, 
            // or pass a minimal base64 black pixel.
            const minimalImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

            const response = await fetch('https://api.stepfun.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`
                },
                body: JSON.stringify({
                    model: 'step-1v-8k',
                    messages: [
                        { role: "user", content: "Test." } 
                    ],
                    max_tokens: 5
                })
            });

            if (response.ok) {
                const data = await response.json();
                res.status(200).json({
                    ok: true,
                    usedKey: usedKeyLabel,
                    requestId: data.id
                });
                return;
            } else {
                const text = await response.text();
                lastError = { status: response.status, details: text };
                // If 400 (e.g. image required), it means key is working but request was bad. 
                // But we want to ensure key works.
                if (response.status === 400 && text.includes("image")) {
                     // It connected successfully but complained about missing image, which means Auth is likely OK.
                     // But strictly, we want 200.
                     // Let's try with image if text-only fails.
                }
            }
        } catch (e) {
            lastError = { message: e.message };
        }
    }

    res.status(200).json({
        ok: false,
        errorCode: 'UPSTREAM_ERROR',
        upstreamStatus: lastError?.status,
        details: lastError
    });
}
