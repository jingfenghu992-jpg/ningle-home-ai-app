export default async function handler(req, res) {
    // Prefer unified key used across the app.
    // Keep legacy fallback keys for backward compatibility.
    const candidates = [
        { key: process.env.STEPFUN_API_KEY, label: 'STEPFUN_API_KEY' },
        { key: process.env.STEPFUN_VISION_API_KEY, label: 'STEPFUN_VISION_API_KEY' },
        { key: process.env.STEPFUN_VISION_API_KEY_2, label: 'STEPFUN_VISION_API_KEY_2' },
    ].filter(x => Boolean(x.key));

    if (candidates.length === 0) {
        res.status(200).json({ ok: false, errorCode: 'MISSING_KEY' });
        return;
    }

    // Minimal 1x1 pixel image (data URL)
    const minimalImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    let lastError = null;

    for (const c of candidates) {
        const key = c.key;
        try {
            // Real vision-style request: send text + image_url content array.
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
                    usedKey: c.label,
                    requestId: data.id
                });
                return;
            }

            const text = await response.text();
            lastError = { status: response.status, details: text, usedKey: c.label };
        } catch (e) {
            lastError = { message: e?.message || String(e), usedKey: c.label };
        }
    }

    res.status(200).json({
        ok: false,
        errorCode: 'UPSTREAM_ERROR',
        upstreamStatus: lastError?.status,
        details: lastError
    });
}
