/**
 * Shared image fetching helpers (server-side).
 * Goal: reliably convert http(s) image URL to data URL bytes for VLM/i2i,
 * without letting upstream models fetch external URLs directly.
 */

const normalize = (s) => String(s || '').trim();

const isDataUrl = (s) => /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(s);

const parseDataUrl = (dataUrl) => {
  try {
    const m = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!m) return { ok: false, reason: 'INVALID_DATA_URL', contentType: null, bytes: 0, buffer: null, dataUrl: null };
    const contentType = m[1];
    const buf = Buffer.from(m[2], 'base64');
    const bytes = buf.byteLength || 0;
    if (!bytes) return { ok: false, reason: 'EMPTY_BYTES', contentType, bytes: 0, buffer: null, dataUrl: null };
    return { ok: true, reason: 'DATA_URL', contentType, bytes, buffer: buf, dataUrl: String(dataUrl) };
  } catch {
    return { ok: false, reason: 'DATA_URL_PARSE_FAIL', contentType: null, bytes: 0, buffer: null, dataUrl: null };
  }
};

export async function fetchImageToDataUrl(input, opts = {}) {
  const startedAt = Date.now();
  const timeoutMs = Number.isFinite(opts?.timeoutMs) ? Math.max(500, Number(opts.timeoutMs)) : 5000;
  const retries = Number.isFinite(opts?.retries) ? Math.max(0, Number(opts.retries)) : 0;

  const raw = normalize(input);
  if (!raw) {
    return { ok: false, reason: 'EMPTY', status: null, finalUrl: null, contentType: null, bytes: 0, dataUrl: null, elapsedMs: Date.now() - startedAt };
  }
  if (raw.startsWith('blob:')) {
    return { ok: false, reason: 'BLOB_URL', status: null, finalUrl: null, contentType: null, bytes: 0, dataUrl: null, elapsedMs: Date.now() - startedAt };
  }
  if (isDataUrl(raw)) {
    const p = parseDataUrl(raw);
    return {
      ok: p.ok,
      reason: p.reason,
      status: 200,
      finalUrl: 'data:image/*;base64,...',
      contentType: p.contentType,
      bytes: p.bytes,
      dataUrl: p.dataUrl,
      elapsedMs: Date.now() - startedAt,
    };
  }
  if (!raw.startsWith('http')) {
    return { ok: false, reason: 'INVALID_SCHEME', status: null, finalUrl: raw.slice(0, 80), contentType: null, bytes: 0, dataUrl: null, elapsedMs: Date.now() - startedAt };
  }

  const attemptOnce = async () => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(raw, { method: 'GET', signal: controller.signal });
      const status = r.status;
      const ct = (r.headers.get('content-type') || '').trim() || null;
      if (!r.ok) {
        return { ok: false, reason: `HTTP_${status}`, status, finalUrl: raw, contentType: ct, bytes: 0, dataUrl: null };
      }
      if (!ct || !ct.startsWith('image/')) {
        // still read a small amount? we skip to keep fast.
        return { ok: false, reason: 'NON_IMAGE', status, finalUrl: raw, contentType: ct, bytes: 0, dataUrl: null };
      }
      const ab = await r.arrayBuffer();
      const buf = Buffer.from(ab);
      const bytes = buf.byteLength || 0;
      if (!bytes) return { ok: false, reason: 'EMPTY_BYTES', status, finalUrl: raw, contentType: ct, bytes: 0, dataUrl: null };
      const dataUrl = `data:${ct};base64,${buf.toString('base64')}`;
      return { ok: true, reason: 'OK', status, finalUrl: raw, contentType: ct, bytes, dataUrl };
    } catch (e) {
      const isTimeout = String(e?.name || '').includes('Abort');
      return { ok: false, reason: isTimeout ? 'FETCH_TIMEOUT' : 'FETCH_ERROR', status: null, finalUrl: raw, contentType: null, bytes: 0, dataUrl: null };
    } finally {
      clearTimeout(t);
    }
  };

  let last = await attemptOnce();
  for (let i = 0; i < retries && !last.ok; i++) {
    // quick retry
    // eslint-disable-next-line no-await-in-loop
    last = await attemptOnce();
  }

  return {
    ...last,
    elapsedMs: Date.now() - startedAt,
  };
}

