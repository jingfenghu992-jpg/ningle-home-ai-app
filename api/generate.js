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

    const { prompt, size = "1024x1024" } = req.body;
    
    // Prefer unified key; keep legacy fallback for backward compatibility.
    const apiKey = process.env.STEPFUN_API_KEY || process.env.STEPFUN_IMAGE_API_KEY;
    const usedKey = process.env.STEPFUN_API_KEY ? 'STEPFUN_API_KEY' : 'STEPFUN_IMAGE_API_KEY';
    if (!apiKey) {
        console.error('Missing STEPFUN_API_KEY / STEPFUN_IMAGE_API_KEY');
        res.status(500).json({ 
            ok: false,
            errorCode: 'MISSING_KEY',
            message: 'Missing STEPFUN_API_KEY or STEPFUN_IMAGE_API_KEY' 
        });
        return;
    }

    try {
        console.log('[Generate API] Requesting Stepfun Image API...');
        
        const response = await fetch('https://api.stepfun.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'step-1x-medium', // Assuming this is the model. If fails, might need to check docs.
                prompt: prompt,
                size: size,
                response_format: "b64_json"
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('[Generate API] Error:', response.status, errText);
            res.status(response.status).json({
                ok: false,
                errorCode: `UPSTREAM_${response.status}`,
                message: `Upstream error: ${errText}`
            });
            return;
        }

        const data = await response.json();
        const imageObj = data.data?.[0];
        
        if (!imageObj || !imageObj.b64_json) {
            console.error('[Generate API] Invalid response format:', data);
            res.status(502).json({
                ok: false,
                errorCode: 'INVALID_RESPONSE',
                message: 'No image data received from upstream'
            });
            return;
        }

        const base64Image = `data:image/png;base64,${imageObj.b64_json}`;

        res.status(200).json({
            ok: true,
            b64_json: base64Image,
            debug: {
                usedKey,
                requestId: data.created // timestamp usually
            }
        });

    } catch (error) {
        console.error('[Generate API] Exception:', error);
        res.status(500).json({
            ok: false,
            errorCode: 'INTERNAL_ERROR',
            message: error.message
        });
    }
}
