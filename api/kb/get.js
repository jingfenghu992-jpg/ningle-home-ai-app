import { list } from '@vercel/blob';
import mammoth from 'mammoth';

const PREFIXES = ['app知识库/', '应用知识库/', '應用知識庫/'];

function getQueryParam(req, name) {
  try {
    const url = new URL(req.url, 'http://localhost');
    return url.searchParams.get(name);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(200).json({ ok: false, errorCode: 'MISSING_BLOB_TOKEN' });
    return;
  }

  const pathname = getQueryParam(req, 'pathname');
  const name = getQueryParam(req, 'name');
  if (!pathname && !name) {
    res.status(400).json({ ok: false, errorCode: 'MISSING_PARAM', message: 'Missing pathname or name' });
    return;
  }

  try {
    // Resolve target blob
    let target = null;
    if (pathname) {
      // List by folder prefix of pathname for faster lookup
      const folderPrefix = pathname.includes('/') ? pathname.split('/').slice(0, -1).join('/') + '/' : '';
      const listRes = await list({ prefix: folderPrefix });
      target = listRes.blobs.find((b) => b.pathname === pathname) || null;
    } else {
      // Find by filename across prefixes
      const results = await Promise.allSettled(PREFIXES.map((prefix) => list({ prefix })));
      const blobs = results
        .filter((r) => r.status === 'fulfilled')
        // @ts-ignore
        .flatMap((r) => r.value?.blobs || []);
      target =
        blobs.find((b) => (b.pathname.split('/').pop() || b.pathname) === name) ||
        blobs.find((b) => b.pathname === name) ||
        null;
    }

    if (!target) {
      res.status(404).json({ ok: false, errorCode: 'NOT_FOUND', message: 'Document not found' });
      return;
    }

    const r = await fetch(target.downloadUrl);
    if (!r.ok) {
      res.status(502).json({ ok: false, errorCode: 'UPSTREAM_ERROR', message: `Download failed: ${r.status}` });
      return;
    }

    const arrayBuffer = await r.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value || '';

    res.status(200).json({
      ok: true,
      doc: {
        pathname: target.pathname,
        name: target.pathname.split('/').pop() || target.pathname,
        size: target.size,
        uploadedAt: target.uploadedAt
      },
      text
    });
  } catch (e) {
    console.error('[KB Get] Error:', e);
    res.status(500).json({ ok: false, errorCode: 'INTERNAL_ERROR', message: e.message });
  }
}

