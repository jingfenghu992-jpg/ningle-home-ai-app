export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method Not Allowed' });
        return;
    }

    const apiKey = process.env.STEPFUN_VISION_API_KEY;
    if (!apiKey) {
        res.status(500).json({ error: 'Missing STEPFUN_VISION_API_KEY' });
        return;
    }

    res.status(200).json({
        ok: true,
        vision_summary: "Vision API Connection Successful (Mock Response for stability test)",
        extraction: { roomTypeGuess: "Living Room" }
    });
}
