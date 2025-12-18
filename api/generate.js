export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method Not Allowed' });
        return;
    }

    const apiKey = process.env.STEPFUN_IMAGE_API_KEY;
    if (!apiKey) {
        res.status(500).json({ error: 'Missing STEPFUN_IMAGE_API_KEY' });
        return;
    }

    // Mock response to verify key presence first
    const b64_json = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    res.status(200).json({
        ok: true,
        b64_json: `data:image/png;base64,${b64_json}`
    });
}
