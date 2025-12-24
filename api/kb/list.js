import { list } from '@vercel/blob';

const PREFIXES = ['app知识库/', '应用知识库/', '應用知識庫/'];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(200).json({ ok: false, errorCode: 'MISSING_BLOB_TOKEN' });
    return;
  }

  try {
    const results = await Promise.allSettled(PREFIXES.map((prefix) => list({ prefix })));
    const blobs = results
      .filter((r) => r.status === 'fulfilled')
      // @ts-ignore
      .flatMap((r) => r.value?.blobs || []);

    const docs = blobs
      .filter((b) => b.pathname.toLowerCase().endsWith('.docx') || b.pathname.toLowerCase().endsWith('.doc'))
      .map((b) => {
        const name = b.pathname.split('/').pop() || b.pathname;
        return {
          pathname: b.pathname,
          name,
          size: b.size,
          uploadedAt: b.uploadedAt
        };
      })
      .sort((a, b) => a.pathname.localeCompare(b.pathname));

    res.status(200).json({ ok: true, prefixes: PREFIXES, docs });
  } catch (e) {
    console.error('[KB List] Error:', e);
    res.status(500).json({ ok: false, errorCode: 'INTERNAL_ERROR', message: e.message });
  }
}

