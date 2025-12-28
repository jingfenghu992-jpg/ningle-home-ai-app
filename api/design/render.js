import { stepfunImage2Image } from '../../lib/stepfunImageClient.js';

export const config = {
  api: {
    bodyParser: { sizeLimit: '2mb' },
  },
};

// Single-pass I2I render (HK delivery mode): fast first image, structure-locked.
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

  const apiKey = process.env.STEPFUN_API_KEY || process.env.STEPFUN_IMAGE_API_KEY;
  const usedKey = process.env.STEPFUN_API_KEY ? 'STEPFUN_API_KEY' : 'STEPFUN_IMAGE_API_KEY';
  if (!apiKey) {
    res.status(500).json({ ok: false, errorCode: 'MISSING_KEY', message: 'Missing STEPFUN_API_KEY' });
    return;
  }

  const {
    imageUrl,
    spaceType,
    styleKey,
    goalKey,
    intensityKey,
  } = req.body || {};

  // Lazy-load sharp to avoid deploy bundling issues.
  // (If sharp fails to load, we still render without padding/metadata.)
  let sharpLib = null;
  try {
    // eslint-disable-next-line no-undef
    const m = await import('sharp');
    sharpLib = m?.default || m;
  } catch {
    sharpLib = null;
  }

  const normalize = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const debug = {
    usedEndpoint: 'image2image',
    requestedEndpoint: 'image2image',
    usedKey,
    model: 'step-1x-medium',
    elapsedMs: undefined,
    baseImageBytes: 0,
    baseW: null,
    baseH: null,
    aspectRatio: null,
    targetSize: null,
    padded: false,
    paddingMethod: null,
    resizeMode: 'none',
    i2iParams: undefined,
  };

  const img = normalize(imageUrl);
  if (!img || !img.startsWith('http')) {
    res.status(400).json({
      ok: false,
      errorCode: 'IMAGE_URL_UNREACHABLE',
      message: '请重新上传相片再试（精準出圖需要相片可訪問）',
      ...(debugEnabled ? { debug: { ...debug, elapsedMs: Date.now() - startedAt } } : {})
    });
    return;
  }

  const allowedSizes = [
    { s: '1280x800', w: 1280, h: 800, r: 1280 / 800 },
    { s: '800x1280', w: 800, h: 1280, r: 800 / 1280 },
    { s: '1024x1024', w: 1024, h: 1024, r: 1 },
  ];

  const pickTargetSize = (w, h) => {
    const ww = Number(w), hh = Number(h);
    if (!ww || !hh) return allowedSizes[0];
    const r = ww / hh;
    let best = allowedSizes[0];
    let bestDiff = Math.abs(r - best.r);
    for (const c of allowedSizes.slice(1)) {
      const d = Math.abs(r - c.r);
      if (d < bestDiff) { best = c; bestDiff = d; }
    }
    return best;
  };

  const STRUCTURE_LOCK = [
    'Keep the original room geometry exactly the same.',
    'Keep window and door positions exactly the same. Do not add any new windows or doors.',
    'No side windows. No balcony doors.',
  ].join(' ');
  const CAMERA_LOCK = 'Realistic smartphone normal lens. No wide-angle. No fisheye. Keep vertical lines straight.';
  const NO_VIGNETTE = 'No vignette. No dark corners. No circular frame.';
  const NEGATIVE = 'fisheye, wide angle, ultra wide, panoramic, lens distortion, warped, stretched, curved lines, new window, side window, extra window, balcony door, vignette, dark corners, circular frame';

  const space = normalize(spaceType);
  const style = normalize(styleKey);
  const goal = normalize(goalKey);
  const intensity = normalize(intensityKey);

  const spaceTemplate = (() => {
    if (space.includes('入户') || space.includes('走廊')) return 'HK entry/corridor: full-height shoe cabinet + bench + full-length mirror + motion sensor strip lighting. Keep original door positions.';
    if (space.includes('客餐')) return 'HK living-dining: TV wall storage + dining sideboard, compact sofa, warm white lighting. Keep original window position.';
    if (space.includes('大睡')) return 'HK master bedroom: full-height sliding wardrobe + curtains + layered warm lighting. Keep original window position.';
    if (space.includes('小睡')) return 'HK small bedroom: platform/tatami bed + full-height sliding wardrobe + wall desk (flush to wall). Keep original window and daylight direction.';
    if (space.includes('厨') || space.includes('廚') || space.includes('厨房')) return 'HK kitchen: one-wall or compact L-shape cabinets to ceiling, under-cabinet lighting, clean countertop. Do not change any openings.';
    if (space.includes('卫') || space.includes('衛') || space.includes('卫生') || space.includes('浴')) return 'HK bathroom: wet-dry separation glass, mirror cabinet + vanity cabinet, warm white lighting. Do not change door position.';
    return 'HK interior space: compact and buildable, keep openings unchanged.';
  })();

  const styleLine = style ? `Style/material tone: ${style}.` : 'Style/material tone: modern minimalist, neutral warm.';
  const goalLine =
    goal.includes('收纳') ? 'Goal: storage-first; add more full-height built-ins (no structure change).'
      : goal.includes('氛围') ? 'Goal: cozy mood; improve layered lighting + soft furnishings (no structure change).'
        : goal.includes('显大') ? 'Goal: airy and visually larger; light palette + clean lines (no structure change).'
          : (goal ? `Goal: ${goal}.` : 'Goal: storage-first, practical.');

  // I2I preset (two levels)
  const preset =
    intensity.includes('明顯') || intensity.includes('明显')
      ? { strength: 0.40, source_weight: 0.92, cfg_scale: 5.2, steps: 24 }
      : { strength: 0.30, source_weight: 0.95, cfg_scale: 5.0, steps: 22 };
  debug.i2iParams = preset;

  // Fetch base image bytes (must be accessible). No resize/crop here.
  let inputBuf;
  let contentType = null;
  try {
    const r = await fetch(img);
    if (!r.ok) {
      res.status(400).json({
        ok: false,
        errorCode: 'IMAGE_URL_UNREACHABLE',
        message: '请重新上传相片再试（精準出圖需要相片可訪問）',
        ...(debugEnabled ? { debug: { ...debug, elapsedMs: Date.now() - startedAt } } : {})
      });
      return;
    }
    contentType = r.headers.get('content-type') || null;
    const ab = await r.arrayBuffer();
    inputBuf = Buffer.from(ab);
    debug.baseImageBytes = inputBuf.byteLength || 0;
    if (!debug.baseImageBytes) {
      res.status(400).json({
        ok: false,
        errorCode: 'IMAGE_URL_UNREACHABLE',
        message: '请重新上传相片再试（精準出圖需要相片可訪問）',
        ...(debugEnabled ? { debug: { ...debug, elapsedMs: Date.now() - startedAt } } : {})
      });
      return;
    }
  } catch {
    res.status(400).json({
      ok: false,
      errorCode: 'IMAGE_URL_UNREACHABLE',
      message: '请重新上传相片再试（精準出圖需要相片可訪問）',
      ...(debugEnabled ? { debug: { ...debug, elapsedMs: Date.now() - startedAt } } : {})
    });
    return;
  }

  // Read metadata (w/h) with sharp (no transform).
  let w = null, h = null;
  try {
    const meta = sharpLib ? await sharpLib(inputBuf).metadata() : null;
    w = meta.width || null;
    h = meta.height || null;
  } catch {
    // ignore
  }
  debug.baseW = w;
  debug.baseH = h;
  debug.aspectRatio = (w && h) ? (w / h) : null;

  const chosen = pickTargetSize(w, h);
  debug.targetSize = chosen.s;

  // Letterbox padding if aspect ratio differs too much (avoid black corners).
  let sourceBufToSend = inputBuf;
  try {
    if (sharpLib && w && h) {
      const r0 = w / h;
      const r1 = chosen.r;
      const diff = Math.abs(r0 - r1);
      if (diff > 0.03) {
        // blurred background + contain foreground
        const bg = await sharpLib(inputBuf).resize(chosen.w, chosen.h, { fit: 'cover' }).blur(18).jpeg({ quality: 82 }).toBuffer();
        const fg = await sharpLib(inputBuf).resize(chosen.w, chosen.h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).jpeg({ quality: 92 }).toBuffer();
        sourceBufToSend = await sharpLib(bg).composite([{ input: fg }]).jpeg({ quality: 88 }).toBuffer();
        debug.padded = true;
        debug.paddingMethod = 'blur';
        debug.resizeMode = 'contain+blur';
      }
    }
  } catch {
    // If padding fails, keep original bytes (still no stretch)
  }

  const sourceDataUrl = `data:image/jpeg;base64,${Buffer.from(sourceBufToSend).toString('base64')}`;

  // Build prompt (hard locks must be early; keep it short)
  let prompt = [
    CAMERA_LOCK,
    NO_VIGNETTE,
    STRUCTURE_LOCK,
    spaceTemplate,
    styleLine,
    goalLine,
    'Hong Kong apartment. Compact scale. Buildable built-ins. Keep straight lines.',
    `Negative: ${NEGATIVE}.`,
  ].filter(Boolean).join(' ');
  prompt = normalize(prompt);
  if (prompt.length > 1024) prompt = prompt.slice(0, 1021) + '...';

  try {
    const resp = await stepfunImage2Image({
      apiKey,
      model: 'step-1x-medium',
      prompt,
      source_url: sourceDataUrl,
      source_weight: preset.source_weight,
      size: chosen.s,
      n: 1,
      response_format: 'url',
      steps: preset.steps,
      cfg_scale: preset.cfg_scale,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      res.status(resp.status).json({
        ok: false,
        errorCode: `UPSTREAM_${resp.status}`,
        message: `Upstream error: ${text}`,
        ...(debugEnabled ? { debug: { ...debug, elapsedMs: Date.now() - startedAt } } : {})
      });
      return;
    }

    const data = await resp.json();
    const first = data?.data?.[0] || {};
    const resultUrl = first?.url || first?.image_url;
    const resultB64 = first?.b64_json || first?.image || first?.base64 || first?.b64;
    if (!resultUrl && !resultB64) {
      res.status(502).json({ ok: false, errorCode: 'INVALID_RESPONSE', message: 'No image payload received' });
      return;
    }
    debug.elapsedMs = Date.now() - startedAt;

    res.status(200).json({
      ok: true,
      resultUrl: resultUrl || `data:image/jpeg;base64,${resultB64}`,
      ...(debugEnabled ? { debug: { ...debug, promptChars: prompt.length } } : {})
    });
  } catch (e) {
    res.status(500).json({ ok: false, errorCode: 'INTERNAL_ERROR', message: e?.message || 'Internal error' });
  }
}

