export default async function handler(req, res) {
    // 统一使用同一个星辰/StepFun Key（与 /api/vision 一致）
    const key = process.env.STEPFUN_API_KEY;
    if (!key) {
        res.status(200).json({ ok: false, errorCode: 'MISSING_KEY' });
        return;
    }

    let lastError = null;

    try {
        // Minimal vision health check: 1x1 像素图片 + 少量 tokens
        const minimalImage =
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
                        role: "user",
                        content: [
                            { type: "text", text: "Test." },
                            { type: "image_url", image_url: { url: minimalImage } }
                        ]
                    }
                ],
                max_tokens: 5
            })
        });

        if (response.ok) {
            const data = await response.json();
            res.status(200).json({
                ok: true,
                usedKey: "STEPFUN_API_KEY",
                requestId: data.id
            });
            return;
        }

        const text = await response.text();
        lastError = { status: response.status, details: text };
    } catch (e) {
        lastError = { message: e.message };
    }

    res.status(200).json({
        ok: false,
        errorCode: 'UPSTREAM_ERROR',
        upstreamStatus: lastError?.status,
        details: lastError
    });
}
