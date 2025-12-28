/**
 * HK "render" endpoint (single-pass i2i) – lightweight wrapper.
 *
 * Notes:
 * - We DO NOT import sharp here to avoid Vercel deploy packaging issues.
 * - We call /api/vision?mode=FAST to get hkAnchorsLite quickly (structure lock hints).
 * - We then call /api/design/inspire (PRECISE_I2I) which already handles:
 *   - base image fetch bytes proof
 *   - aspect ratio & optional letterbox padding
 *   - strong prompt locks & i2i params
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, message: 'Method Not Allowed' });
    return;
  }

  const startedAt = Date.now();
  const debugEnabled = (() => {
    try {
      const u = new URL(req.url || '', 'http://localhost');
      return u.searchParams.get('debug') === '1';
    } catch {
      // eslint-disable-next-line no-undef
      return String(req?.query?.debug || '') === '1';
    }
  })();

  const {
    imageUrl,
    spaceType,
    styleKey,
    goalKey,
    intensityKey,
  } = req.body || {};

  const img = String(imageUrl || '').trim();
  if (!img || !img.startsWith('http')) {
    res.status(400).json({
      ok: false,
      errorCode: 'IMAGE_URL_UNREACHABLE',
      message: '图片链接访问失败（可能过期/无权限）。请重新上传同一张图片再试一次。',
    });
    return;
  }

  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim();
  const proto = String(req.headers['x-forwarded-proto'] || 'https').trim();
  const origin = host ? `${proto}://${host}` : '';

  const spaceHint = String(spaceType || '').trim();
  const callJson = async (url, body, timeoutMs) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => null);
      return { ok: r.ok, status: r.status, data };
    } finally {
      clearTimeout(t);
    }
  };

  // 1) FAST anchors (structure hints)
  let hkAnchorsLite = null;
  let fastDebug = null;
  try {
    const url = origin ? `${origin}/api/vision?mode=FAST${debugEnabled ? '&debug=1' : ''}` : `/api/vision?mode=FAST${debugEnabled ? '&debug=1' : ''}`;
    const r = await callJson(url, { imageUrl: img, spaceHint }, 9000);
    if (r.ok && r.data?.ok && r.data?.hkAnchorsLite) {
      hkAnchorsLite = r.data.hkAnchorsLite;
      fastDebug = r.data?.debug || null;
    } else {
      // FAST anchors are best-effort, but we still proceed with strict structure locks in prompt.
      hkAnchorsLite = null;
      fastDebug = r.data?.debug || null;
    }
  } catch {
    hkAnchorsLite = null;
  }

  // 2) i2i params by intensity (must be <= 0.35)
  const intensity = String(intensityKey || '').trim();
  const isBold = intensity.includes('明显') || intensity.includes('明顯') || intensity.includes('更有设计') || intensity.includes('更有設計');
  const i2i_strength = isBold ? 0.32 : 0.22;
  const i2i_source_weight = isBold ? 0.95 : 0.98;

  // 3) Build renderIntake for inspire (PRECISE_I2I). hkAnchorsLite is passed through to prompt builder.
  const renderIntake = {
    space: String(spaceType || '').trim(),
    style: String(styleKey || '').trim(),
    priority: String(goalKey || '').trim(),
    intensity: String(intensityKey || '').trim(),
    hkAnchorsLite,
  };

  const inspireUrl = origin
    ? `${origin}/api/design/inspire${debugEnabled ? '?debug=1' : ''}`
    : `/api/design/inspire${debugEnabled ? '?debug=1' : ''}`;

  const payload = {
    renderIntake,
    sourceImageUrl: img,
    outputMode: 'PRECISE_I2I',
    keep_structure: true,
    qualityPreset: 'STRUCTURE_LOCK',
    i2i_strength,
    i2i_source_weight,
    cfg_scale: 5.0,
    steps: isBold ? 24 : 22,
    response_format: 'url',
    debug: debugEnabled,
  };

  const r2 = await callJson(inspireUrl, payload, 180000);
  const data2 = r2.data || {};
  if (!r2.ok || !data2?.ok) {
    res.status(r2.status || 500).json(data2 || {
      ok: false,
      errorCode: 'UPSTREAM_RENDER',
      message: 'render failed',
    });
    return;
  }

  const mergedDebug = debugEnabled ? ({
    ...(data2.debug || {}),
    usedEndpoint: (data2.debug?.usedEndpoint || data2.debug?.requestedEndpoint || 'image2image'),
    hkAnchorsLite,
    fast: fastDebug ? { debug: fastDebug } : undefined,
    renderParams: { i2i_strength, i2i_source_weight, cfg_scale: 5.0, steps: isBold ? 24 : 22 },
    elapsedMs: Date.now() - startedAt,
  }) : undefined;

  res.status(200).json({
    ok: true,
    resultUrl: data2.resultUrl,
    ...(debugEnabled ? { debug: mergedDebug } : {})
  });
}

