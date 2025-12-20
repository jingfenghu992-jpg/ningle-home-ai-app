import { put } from '@vercel/blob';

export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Check if we have a token (server-side only check)
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN not configured' });
    }

    const filename = req.headers['x-vercel-filename'] || 'image.jpg';
    
    // Upload to Vercel Blob - Pass `req` directly for streaming
    const blob = await put(`ningle-temp-images/${Date.now()}-${filename}`, req, {
      access: 'public',
    });

    return res.status(200).json(blob);
  } catch (error) {
    console.error('[Upload API] Error:', error);
    return res.status(500).json({ error: 'Upload failed', details: error.message });
  }
}
