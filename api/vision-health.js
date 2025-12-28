export default async function handler(req, res) {
    // Single source of truth (same key as chat/vision/i2i).
    const key = process.env.STEPFUN_API_KEY;
    if (!key) {
        res.status(200).json({ ok: false, errorCode: 'MISSING_KEY' });
        return;
    }

    // Minimal 1x1 pixel image (data URL)
    const minimalImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    let lastError = null;

    try {
        const response = await fetch('https://api.stepfun.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`
            },
            body: JSON.stringify({
                model: 'step-1v-8k',
                temperature: 0.0,
                max_tokens: 16,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Health check: reply OK." },
                            { type: "image_url", image_url: { url: minimalImage } }
                        ]
                    }
                ]
            })
        });

        if (response.ok) {
            const data = await response.json();
            res.status(200).json({
                ok: true,
                usedKey: 'STEPFUN_API_KEY',
                requestId: data.id
            });
            return;
        }

        const text = await response.text();
        lastError = { status: response.status, details: text, usedKey: 'STEPFUN_API_KEY' };
    } catch (e) {
        lastError = { message: e?.message || String(e), usedKey: 'STEPFUN_API_KEY' };
    }

    res.status(200).json({
        ok: false,
        errorCode: 'UPSTREAM_ERROR',
        upstreamStatus: lastError?.status,
        details: lastError
    });
}
