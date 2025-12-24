export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.status(405).json({ error: 'Method Not Allowed' });
        return;
    }

    // 统一使用同一个星辰/StepFun Key（与 Vercel 环境变量一致）
    const apiKey = process.env.STEPFUN_API_KEY;
    if (!apiKey) {
        res.status(200).json({ ok: false, errorCode: 'MISSING_KEY' });
        return;
    }

    try {
        // Try to generate a 1024x1024 image with a simple prompt
        // Use a dummy prompt to minimize complexity.
        // If this is too expensive for a health check, we might consider another endpoint.
        // But the user asked for "minimal verification" using the key.
        const response = await fetch('https://api.stepfun.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'step-1x-medium',
                prompt: "A small red dot",
                size: "1024x1024",
                response_format: "url", // URL might be lighter than b64_json? Or similar.
                n: 1
            })
        });

        if (response.ok) {
            const data = await response.json();
            res.status(200).json({
                ok: true,
                usedKey: "STEPFUN_API_KEY",
                requestId: data.created
            });
        } else {
            const errText = await response.text();
            res.status(200).json({
                ok: false,
                errorCode: `UPSTREAM_${response.status}`,
                details: errText
            });
        }

    } catch (error) {
        res.status(200).json({
            ok: false,
            errorCode: 'INTERNAL_ERROR',
            details: error.message
        });
    }
}
