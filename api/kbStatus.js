import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method Not Allowed' });
        return;
    }

    try {
        const kbDir = path.join(process.cwd(), 'knowledge_text');
        
        let availableDocs = [];
        let kbLoaded = false;

        if (fs.existsSync(kbDir)) {
            availableDocs = fs.readdirSync(kbDir).filter(file => file.endsWith('.txt'));
            kbLoaded = availableDocs.length > 0;
        }

        res.status(200).json({
            ok: true,
            kbLoaded,
            availableDocs: availableDocs.map(d => d.replace('.txt', '')),
            docCount: availableDocs.length,
            // Example match logic test (no content returned)
            testMatch: {
                "板材": availableDocs.find(d => d.includes('板材')) || null
            }
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            error: 'Internal Server Error',
            message: error.message
        });
    }
}
