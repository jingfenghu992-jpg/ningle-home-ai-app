import { list } from '@vercel/blob';
import { shouldUseKnowledge } from '../services/kbFromBlob.js'; // Just reuse the util for keyword check if helpful

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method Not Allowed' });
        return;
    }

    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
        // Internal check failure, but don't expose too much to public unless debugging
        // Returning ok: false for internal monitoring
        res.status(200).json({ ok: false, error: 'MISSING_BLOB_TOKEN' });
        return;
    }

    try {
        // Check list files
        const { blobs } = await list({ prefix: '应用知识库/' });
        const docxFiles = blobs.filter(b => b.pathname.endsWith('.docx'));

        res.status(200).json({
            ok: true,
            files: docxFiles.length,
            loaded: docxFiles.length > 0,
            fileNames: docxFiles.map(b => b.pathname.split('/').pop()) // Show names for verification
        });

    } catch (error) {
        console.error('[KB Status] Error:', error);
        res.status(500).json({ 
            ok: false, 
            error: 'Blob Access Failed',
            details: error.message 
        });
    }
}
