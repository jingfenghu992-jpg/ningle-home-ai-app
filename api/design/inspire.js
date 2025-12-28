import { buildHKPrompt } from '../../lib/hkPrompt.js';
import { stepfunT2I, stepfunImage2Image } from '../../lib/stepfunImageClient.js';
import sharp from 'sharp';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

// Text-to-image "inspiration" render (NOT tied to user's exact structure).
// Goal: provide fast, magazine-quality reference while i2i is generating.
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
      // Vercel usually provides req.query, but keep it defensive
      // eslint-disable-next-line no-undef
      return String(req?.query?.debug || '') === '1';
    }
  })();

  const {
    renderIntake,
    // C3: dual mode
    sourceImageUrl,
    outputMode,
    i2i_strength,
    i2i_source_weight,
    keep_structure,
    qualityPreset,
    // user-selected debug (optional)
    layoutVariant,
    sizeChoice,
    styleChoice,
    size,
    response_format,
    steps,
    cfg_scale,
    seed,
  } = req.body || {};

  const allowedSizes = new Set([
    '256x256', '512x512', '768x768', '1024x1024',
    '1280x800', '800x1280',
  ]);

  const finalResponseFormat = (response_format === 'b64_json' || response_format === 'url') ? response_format : 'url';

  // Keep it fast and stable (速度优先：默认更低 steps)
  const finalSteps = Number.isInteger(steps) ? Math.min(Math.max(steps, 1), 40) : 24;
  const finalCfgScale = (typeof cfg_scale === 'number') ? Math.min(Math.max(cfg_scale, 1), 7.0) : 6.6;
  const finalSeed = Number.isInteger(seed) && seed > 0 ? seed : undefined;

  // Unified key (same as chat/vision/i2i)
  const apiKey = process.env.STEPFUN_API_KEY || process.env.STEPFUN_IMAGE_API_KEY;
  const usedKey = process.env.STEPFUN_API_KEY ? 'STEPFUN_API_KEY' : 'STEPFUN_IMAGE_API_KEY';
  if (!apiKey) {
    res.status(500).json({ ok: false, errorCode: 'MISSING_KEY', message: 'Missing STEPFUN_API_KEY' });
    return;
  }

  const normalize = (s) => String(s || '').trim();
  const cap = (s, n) => {
    const t = normalize(s);
    if (!t) return '';
    return t.length > n ? t.slice(0, n - 3) + '...' : t;
  };

  const mapSpace = (s) => {
    const t = normalize(s);
    if (t.includes('客餐')) return 'Hong Kong open-plan living-dining room';
    if (t.includes('入户') || t.includes('玄')) return 'Hong Kong entryway / foyer';
    if (t.includes('走廊')) return 'Hong Kong corridor';
    if (t.includes('厨房') || t.includes('廚') || t.includes('厨')) return 'Hong Kong kitchen';
    if (t.includes('卫生间') || t.includes('衛') || t.includes('卫') || t.includes('浴') || t.includes('洗手')) return 'Hong Kong bathroom';
    if (t.includes('大睡房') || t.includes('主人房') || t.includes('主卧')) return 'Hong Kong master bedroom';
    if (t.includes('小睡房') || t.includes('次卧') || t.includes('眼镜房') || t.includes('儿童房')) return 'Hong Kong small bedroom (compact)';
    if (t.includes('睡') || t.includes('卧') || t.includes('房')) return 'Hong Kong bedroom';
    return t ? `Hong Kong apartment ${t}` : 'Hong Kong apartment interior';
  };

  const mapStyle = (s) => {
    const t = normalize(s);
    if (t.includes('日式') || t.includes('木')) return 'Japandi / Japanese wood minimalist, warm and calm, clean lines, natural wood';
    if (t.includes('奶油')) return 'Creamy minimal style, soft warm palette, rounded details, cozy';
    if (t.includes('輕奢') || t.includes('轻奢')) return 'Light luxury modern style, subtle metal accents, refined materials';
    if (t.includes('現代') || t.includes('现代') || t.includes('簡約') || t.includes('简约')) return 'Modern minimalist, clean geometry, practical';
    return t || 'Modern minimalist';
  };

  const mapColor = (s) => {
    const t = normalize(s);
    if (t.includes('淺木') || t.includes('浅木')) return 'light oak wood + off-white, warm neutral';
    if (t.includes('胡桃')) return 'walnut wood + gray-white, warm gray neutral';
    if (t.includes('純白') || t.includes('纯白')) return 'pure white + light gray, clean and bright';
    if (t.includes('深木')) return 'dark wood + warm white, cozy contrast';
    return t || 'neutral warm';
  };

  const lightingByVibe = (vibe) => {
    const v = normalize(vibe);
    if (v.includes('明亮')) {
      return 'Lighting: bright and airy, layered ceiling cove + recessed downlights, soft indirect bounce, clean white balance, warm white 3000K.';
    }
    if (v.includes('酒店') || v.includes('高級') || v.includes('高级')) {
      return 'Lighting: premium hotel-like layered lighting, ceiling cove + downlights + accent wall wash + cabinet niche lighting, warm 2700-3000K, realistic GI, controlled highlights.';
    }
    return 'Lighting: warm cozy layered lighting, ceiling cove + recessed downlights + subtle accents, warm 2700-3000K, soft shadows, realistic GI.';
  };

  const intake = renderIntake || {};
  const bw = Number(intake?.baseWidth);
  const bh = Number(intake?.baseHeight);
  const inferredSize =
    (Number.isFinite(bw) && Number.isFinite(bh) && bw > 0 && bh > 0)
      ? (bh > bw ? '800x1280' : '1280x800')
      : '1280x800';
  const finalSize = (typeof size === 'string' && allowedSizes.has(size)) ? size : inferredSize;

  const spaceEn = mapSpace(intake?.space);
  const spaceZh = normalize(intake?.space);
  const targetUse = normalize(intake?.targetUse);
  const styleEn = mapStyle(intake?.style);
  const colorEn = mapColor(intake?.color);
  const focus = normalize(intake?.focus);
  const bedType = normalize(intake?.bedType);
  const roomWidthChi = normalize(intake?.roomWidthChi);
  const roomHeightChi = normalize(intake?.roomHeightChi);
  const storage = normalize(intake?.storage);
  const decor = normalize(intake?.decor);
  const vibe = normalize(intake?.vibe);
  const intensity = normalize(intake?.intensity);
  const housingType = normalize(intake?.housingType);
  const needsWorkstation = normalize(intake?.needsWorkstation);
  const hallType = normalize(intake?.hallType);

  // User-selected layout/circulation plan should be treated as a hard constraint.
  const layoutLine = focus ? `Selected layout plan (must follow, do not invent a different plan): ${cap(focus, 240)}.` : '';
  const bedLine = bedType ? `Bed type: ${cap(bedType, 40)}.` : '';
  const storageLine = storage ? `Storage strategy: ${storage}.` : 'Storage strategy: practical full-height cabinetry, space-saving built-ins.';
  const decorLine = decor ? `Soft furnishing density: ${decor}.` : 'Soft furnishing density: balanced and livable.';
  const intensityLine = intensity ? `Renovation intensity: ${cap(intensity, 28)}.` : '';
  const roomTypeLock = (() => {
    // 当 space=其他时，用 targetUse 锁定“目标用途”，否则模型很容易自由发挥成不相关空间
    if (spaceZh === '其他' && targetUse) {
      if (targetUse.includes('客餐')) return 'Room type lock: MUST be a Hong Kong living-dining room (modern). Do NOT depict tatami/tea room.';
      if (targetUse.includes('卧室')) return 'Room type lock: MUST be a Hong Kong bedroom (modern). Do NOT depict living room / tea room.';
      if (targetUse.includes('书房')) return 'Room type lock: MUST be a Hong Kong compact study/multi-purpose room (modern). Do NOT depict tatami/tea room.';
      if (targetUse.includes('玄关') || targetUse.includes('走廊')) return 'Room type lock: MUST be a Hong Kong entryway/corridor (modern). Do NOT depict living room / bedroom.';
      return 'Room type lock: MUST be a Hong Kong apartment interior (modern), keep it realistic.';
    }
    return spaceEn ? `Room type lock: this MUST be a ${spaceEn}. Do NOT depict any other room type.` : '';
  })();
  const dimsLine = (roomWidthChi || roomHeightChi)
    ? `Approx room size (chi): width ${cap(roomWidthChi || 'unknown', 16)}, ceiling height ${cap(roomHeightChi || 'unknown', 16)}.`
    : '';

  const builtInsFromFocus = (() => {
    const f = normalize(focus);
    if (!f) return '';
    const hits = [];
    const add = (k, v) => { if (f.includes(k)) hits.push(v); };
    add('鞋柜', 'full-height shoe cabinet + bench');
    add('玄关', 'entry storage wall');
    add('电视', 'TV wall cabinetry');
    add('電視', 'TV wall cabinetry');
    add('餐边', 'dining sideboard / pantry cabinet');
    add('餐邊', 'dining sideboard / pantry cabinet');
    add('地台', 'platform bed with under-bed storage');
    add('榻榻米', 'tatami platform with storage');
    add('隐形床', 'Murphy bed + cabinet system');
    add('隱形床', 'Murphy bed + cabinet system');
    add('活动床', 'folding bed + cabinet system');
    add('活動床', 'folding bed + cabinet system');
    add('衣柜', 'full-height wardrobe (sliding doors preferred)');
    add('衣櫃', 'full-height wardrobe (sliding doors preferred)');
    add('梳妆', 'vanity / slim dressing table');
    add('梳妝', 'vanity / slim dressing table');
    add('书桌', 'slim desk (only if selected/needed)');
    add('書桌', 'slim desk (only if selected/needed)');
    add('吊柜', 'wall cabinets to ceiling');
    add('橱柜', 'kitchen base + wall cabinets');
    add('廚櫃', 'kitchen base + wall cabinets');
    add('水槽', 'sink zone');
    add('炉头', 'cooktop zone');
    add('爐頭', 'cooktop zone');
    add('镜柜', 'mirror cabinet');
    add('鏡櫃', 'mirror cabinet');
    add('浴室柜', 'vanity cabinet');
    add('浴室櫃', 'vanity cabinet');
    if (!hits.length) return '';
    const uniq = Array.from(new Set(hits)).slice(0, 6).join('; ');
    return `Built-ins must match the selected plan: ${uniq}.`;
  })();

  // 结构约束（用于“文生图尽量像原图”）
  // 原理：把 /api/vision 的 extraction（门窗/梁柱/完成度/约束）+ 用户选择的动线/尺寸，转成可执行的英文结构锁定指令。
  // 注：t2i 不可能 100% 复刻，但我们把“房间形状、窗位置、视角、长宽比例、不可动约束”写成硬约束，目标接近 80%+。
  const structureCues = (() => {
    const ex = intake?.visionExtraction || intake?.extraction || null;
    const vs = String(intake?.visionSummary || '').trim();

    const pickLine = (prefixZhArr) => {
      if (!vs) return '';
      const lines = vs.split('\n').map(l => l.trim()).filter(Boolean);
      for (const p of prefixZhArr) {
        const hit = lines.find(l => l.startsWith(p));
        if (hit) return hit;
      }
      return '';
    };

    // 兼容旧版（繁体）与新版（简体）前缀
    const structureLine = pickLine(['结构：', '結構：']) || '';
    const constraintsLine = pickLine(['约束：', '約束：']) || '';
    const cleanSummary = [structureLine, constraintsLine]
      .filter(Boolean)
      .join(' ')
      .replace(/^结构：/,'')
      .replace(/^結構：/,'')
      .replace(/^约束：/,'')
      .replace(/^約束：/,'')
      .trim();

    const doors = normalize(ex?.doors_windows);
    const cols = normalize(ex?.columns);
    const beams = normalize(ex?.beams_ceiling);
    const notes = Array.isArray(ex?.structure_notes) ? ex.structure_notes.map(x => normalize(x)).filter(Boolean).slice(0, 3) : [];
    const fin = ex?.finish_level || {};
    const finLevel = normalize(fin?.level);
    const finEv = normalize(fin?.evidence);

    const parseWall = (t) => {
      const s = String(t || '');
      if (s.includes('右墙') || s.includes('東墙') || s.includes('东墙')) return 'right wall';
      if (s.includes('左墙') || s.includes('西墙') || s.includes('西牆')) return 'left wall';
      if (s.includes('远端墙') || s.includes('端墙') || s.includes('对面墙') || s.includes('正对')) return 'far wall';
      if (s.includes('入口侧') || s.includes('近端墙') || s.includes('门口侧')) return 'near wall (entrance side)';
      return '';
    };

    const windowSpec = (() => {
      if (!doors || doors === '未见') return '';
      if (!doors.includes('窗')) return '';
      const wall = parseWall(doors);
      const count = /两|二|2|三|3|多扇|多個|多个|多窗/.test(doors) ? 'multiple' : 'exactly 1';
      const kind = /落地|全落地|全高|通顶|大窗/.test(doors) ? 'tall window' : 'regular window';
      // 强制：不要生成一整排日式格栅落地窗
      return `Window constraint: ${count} ${kind} on the ${wall || 'same wall as in the photo'}; do NOT add extra windows; NOT floor-to-ceiling grid windows; add realistic curtains on this window.`;
    })();

    const beamSpec = (() => {
      if (!beams || beams === '未见') return '';
      const dir =
        beams.includes('左右向') || beams.includes('东西向') ? 'left-to-right'
        : beams.includes('前后向') ? 'front-to-back'
        : '';
      return `Ceiling beam constraint: visible ceiling beam/drop running ${dir || 'as in the photo'}; keep ceiling height realistic (HK).`;
    })();

    const columnSpec = (() => {
      if (!cols || cols === '未见') return '';
      const wall = parseWall(cols);
      return `Column/protrusion constraint: keep the column/protrusion on the ${wall || 'same wall as in the photo'}; do NOT remove.`;
    })();

    const dims = (roomWidthChi || roomHeightChi)
      ? `Room proportions (approx, HK chi): width ${cap(roomWidthChi || 'unknown', 16)}, ceiling height ${cap(roomHeightChi || 'unknown', 16)}.`
      : '';

    // 粗略的“长窄房间”判断：用户选的宽度档较小，或结构描述里出现“长/窄”
    const narrowHint =
      /7–8尺|7-8尺|7—8尺|7—8|7-8|7–8/.test(roomWidthChi) ||
      /狭长|长窄|窄长|走廊感|corridor|narrow/.test((doors + ' ' + cleanSummary).toLowerCase());

    const cameraHint = (() => {
      // 如果门窗描述里有“窗在房间正中”，强制“正对窗”的视角
      if (/窗在房间正中|窗在中|正中/.test(doors)) {
        return 'Camera view: standing at the entrance/door side, looking straight towards the centered window on the far wall (no angled/fisheye view).';
      }
      return 'Camera view: realistic eye-level photo perspective (no fisheye), keep straight vertical/horizontal lines.';
    })();

    const shapeHint = narrowHint
      ? 'Room geometry: a narrow rectangular room (long and slim), keep wall lengths and proportions realistic for a Hong Kong flat.'
      : 'Room geometry: keep a realistic rectangular room shape and proportions for a Hong Kong flat.';

    const lock = [
      'STRUCTURE LOCK (hard constraints):',
      shapeHint,
      // 先给“可执行”的约束，再补充原文（提升 t2i 遵循度）
      windowSpec,
      columnSpec,
      beamSpec,
      doors ? `Openings (raw): ${cap(doors, 120)}.` : '',
      cols && cols !== '未见' ? `Columns (raw): ${cap(cols, 80)}.` : '',
      beams && beams !== '未见' ? `Beams (raw): ${cap(beams, 80)}.` : '',
      notes.length ? `Other structure notes: ${cap(notes.join(' | '), 120)}.` : '',
      dims,
      cameraHint,
      'Do NOT change room shape. Do NOT warp windows/walls. Keep straight lines; no fisheye.',
      finLevel ? `Finish level reference: ${finLevel}${finEv ? ` (${cap(finEv, 60)})` : ''}.` : '',
      cleanSummary ? `Extra cues: ${cap(cleanSummary, 160)}.` : '',
    ].filter(Boolean).join(' ');

    // Keep it short to avoid StepFun t2i prompt limit (<=1024 chars)
    return lock.length > 420 ? lock.slice(0, 417) + '...' : lock;
  })();

  const mustHave = (() => {
    const s = normalize(intake?.space);
    // space=其他时按 targetUse 约束必备物（减少“跑偏”）
    if (s === '其他' && targetUse) {
      if (targetUse.includes('客餐')) return 'Must include: TV wall + sofa seating + dining table for 2-4 + dining sideboard/pantry cabinet. Modern Hong Kong flat proportions.';
      if (targetUse.includes('卧室')) return 'Must include: bed + full-height wardrobe (sliding doors preferred) + bedside + curtains. Modern Hong Kong flat proportions.';
      if (targetUse.includes('书房')) return 'Must include: slim desk + storage wall/bookcase + task lighting + optional sofa bed (if suitable). Modern Hong Kong flat proportions.';
      if (targetUse.includes('玄关') || targetUse.includes('走廊')) return 'Must include: shoe cabinet/storage + clear circulation + wall wash/linear lighting. Modern Hong Kong flat proportions.';
    }
    if (s.includes('客餐')) return 'MUST include: TV wall with built-in storage + sofa (2-3 seats) + coffee table + rug + curtains on the existing window; dining table for 4 + chairs + pendant light above table; dining sideboard/tall pantry cabinet. Keep HK compact proportions.';
    if (s.includes('厨房') || s.includes('廚') || s.includes('厨')) return 'Must include: base cabinets + wall cabinets to ceiling + countertop + sink/cooktop zones + under-cabinet task lighting.';
    if (s.includes('卫生') || s.includes('衛') || s.includes('浴') || s.includes('洗手')) return 'Must include: vanity cabinet + mirror cabinet + shower zone with screen OR compact bathtub (only if suitable) + anti-slip floor tiles + mirror/vanity light.';
    if (s.includes('入户') || s.includes('玄')) return 'Must include: full-height shoe cabinet + bench + full-length mirror + concealed clutter storage.';
    if (s.includes('走廊')) return 'Must include: shallow corridor storage + wall wash/linear lighting + clear circulation width.';
    if (s.includes('小睡房') || s.includes('眼镜房') || s.includes('次卧') || s.includes('儿童')) {
      const wantsDesk = /书桌|工作位|工作|办公/.test(storage);
      const deskLine = wantsDesk ? ' + slim desk (only if space allows)' : '';
      return `Must include: space-saving bed (${bedType || 'platform/tatami/Murphy'}) + full-height slim wardrobe with sliding doors${deskLine}.`;
    }
    if (s.includes('大睡房')) return 'MUST include: bed + headboard + 2 bedside tables + full-height wardrobe (sliding doors preferred) + curtains; layered lighting + soft rug.';
    if (s.includes('睡') || s.includes('卧') || s.includes('房')) return 'Must include: residential bed + full-height wardrobe + bedside + curtains.';
    return 'Must include: finished ceiling/walls/floor + built-in cabinetry + layered lighting + soft furnishings.';
  })();

  const avoidBySpace = (() => {
    const s = normalize(intake?.space);
    if (s === '其他') {
      return 'Avoid: traditional Japanese tatami room, shoji screens, tea room, floor-to-ceiling grid windows, extra windows/doors not in the structure lock.';
    }
    if (s.includes('小睡房') || s.includes('眼镜房') || s.includes('次卧') || s.includes('儿童')) {
      const wantsDesk = /书桌|工作位|工作|办公/.test(storage);
      return wantsDesk
        ? 'Avoid: turning it into a full study; keep desk slim and secondary.'
        : 'Avoid: study/office setup, large desk, multiple monitors.';
    }
    if (s.includes('客餐')) return 'Avoid: bedroom furniture (beds), oversized bulky cabinets that block circulation.';
    if (s.includes('大睡房')) return 'Avoid: kids bunk bed, turning the room into an office unless requested.';
    if (s.includes('厨房') || s.includes('廚') || s.includes('厨')) return 'Avoid: large island unless space clearly allows; keep it compact and practical.';
    if (s.includes('卫生') || s.includes('衛') || s.includes('浴') || s.includes('洗手')) return 'Avoid: freestanding bathtub unless requested; keep fixtures compact.';
    if (s.includes('入户') || s.includes('玄')) return 'Avoid: living-room sofa/TV; keep it as an entryway.';
    if (s.includes('走廊')) return 'Avoid: deep cabinets that narrow the corridor; avoid visual clutter.';
    return '';
  })();

  // P1: Hong Kong 6-space prompt builder (short, hard, <= 1024 chars)
  const built = buildHKPrompt({
    renderIntake: intake,
    hkAnchors: intake?.visionExtraction?.hkAnchors || intake?.extraction?.hkAnchors || intake?.hkAnchors,
    spaceType: intake?.space,
    layoutVariant,
    sizeChoice,
    styleChoice,
  });
  const prompt = String(built?.prompt || '').replace(/\s+/g, ' ').trim();
  if (!prompt) {
    res.status(400).json({ ok: false, errorCode: 'INVALID_PROMPT', message: 'Empty prompt' });
    return;
  }

  try {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const doT2I = async () =>
      await stepfunT2I({
        apiKey,
        model: 'step-1x-medium',
        prompt,
        size: finalSize,
        n: 1,
        response_format: finalResponseFormat,
        seed: finalSeed,
        steps: finalSteps,
        cfg_scale: finalCfgScale,
      });

    const decodeU32BE = (buf, off) => {
      if (!buf || off + 4 > buf.length) return null;
      return (buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3];
    };
    const parsePngWH = (buf) => {
      // PNG signature + IHDR
      if (!buf || buf.length < 24) return null;
      const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return null;
      // IHDR chunk begins at 8; type at 12
      const t = buf.slice(12, 16).toString('ascii');
      if (t !== 'IHDR') return null;
      const w = decodeU32BE(buf, 16);
      const h = decodeU32BE(buf, 20);
      if (!w || !h) return null;
      return { w, h };
    };
    const parseJpegWH = (buf) => {
      if (!buf || buf.length < 4) return null;
      if (buf[0] !== 0xff || buf[1] !== 0xd8) return null; // SOI
      let off = 2;
      while (off + 4 < buf.length) {
        if (buf[off] !== 0xff) { off++; continue; }
        let marker = buf[off + 1];
        // skip padding
        while (marker === 0xff && off + 2 < buf.length) {
          off++;
          marker = buf[off + 1];
        }
        // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
        const isSOF =
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf);
        const len = (buf[off + 2] << 8) | buf[off + 3];
        if (len < 2) return null;
        if (isSOF) {
          if (off + 2 + len > buf.length) return null;
          const h = (buf[off + 5] << 8) | buf[off + 6];
          const w = (buf[off + 7] << 8) | buf[off + 8];
          if (!w || !h) return null;
          return { w, h };
        }
        off = off + 2 + len;
      }
      return null;
    };

    const fetchProbe = async (url) => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 12000);
      try {
        // Grab first 256KB max for probing dimensions (no resize/crop).
        const r = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-262143' }, signal: controller.signal });
        const ok = r.ok && (r.status === 200 || r.status === 206);
        const ct = r.headers.get('content-type') || '';
        const cl = r.headers.get('content-length') || null;
        const ab = ok ? await r.arrayBuffer() : null;
        const bytes = ab ? ab.byteLength : 0;
        let wh = null;
        if (ab) {
          const buf = Buffer.from(ab);
          if (ct.includes('png')) wh = parsePngWH(buf);
          if (!wh && (ct.includes('jpeg') || ct.includes('jpg'))) wh = parseJpegWH(buf);
          if (!wh) {
            // Try magic sniff if content-type is missing
            wh = parsePngWH(buf) || parseJpegWH(buf);
          }
        }
        return { ok, status: r.status, contentType: ct || null, contentLength: cl, bytes, w: wh?.w || null, h: wh?.h || null };
      } catch {
        return { ok: false, status: null, contentType: null, contentLength: null, bytes: 0, w: null, h: null };
      } finally {
        clearTimeout(t);
      }
    };

    const fetchFullImageAsDataUrl = async (url) => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 20000);
      try {
        const r = await fetch(url, { method: 'GET', signal: controller.signal });
        if (!r.ok) return { ok: false, status: r.status, contentType: null, bytes: 0, dataUrl: null, w: null, h: null };
        const ct = r.headers.get('content-type') || 'image/jpeg';
        const ab = await r.arrayBuffer();
        const bytes = ab.byteLength || 0;
        if (!bytes) return { ok: false, status: r.status, contentType: ct, bytes: 0, dataUrl: null, w: null, h: null };
        const buf = Buffer.from(ab);
        const wh = (ct.includes('png') ? parsePngWH(buf) : null) || ((ct.includes('jpeg') || ct.includes('jpg')) ? parseJpegWH(buf) : null) || parsePngWH(buf) || parseJpegWH(buf);
        const dataUrl = `data:${ct};base64,${buf.toString('base64')}`;
        return { ok: true, status: r.status, contentType: ct, bytes, dataUrl, buffer: buf, w: wh?.w || null, h: wh?.h || null };
      } catch {
        return { ok: false, status: null, contentType: null, bytes: 0, dataUrl: null, buffer: null, w: null, h: null };
      } finally {
        clearTimeout(t);
      }
    };
    const parseSize = (s) => {
      const m = String(s || '').match(/^(\d+)x(\d+)$/);
      if (!m) return null;
      return { w: Number(m[1]), h: Number(m[2]) };
    };

    const letterboxPadBlur = async (inputBuf, targetW, targetH) => {
      // Build a blurred background (cover) + foreground (contain) to avoid black borders.
      const bg = await sharp(inputBuf)
        .resize(targetW, targetH, { fit: 'cover' })
        .blur(18)
        .jpeg({ quality: 82 })
        .toBuffer();
      const fg = await sharp(inputBuf)
        .resize(targetW, targetH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .jpeg({ quality: 92 })
        .toBuffer();
      const out = await sharp(bg)
        .composite([{ input: fg }])
        .jpeg({ quality: 88 })
        .toBuffer();
      return out;
    };

    const pickTargetSizeByWH = (w, h) => {
      const ww = Number(w);
      const hh = Number(h);
      if (!ww || !hh) return finalSize;
      const r = ww / hh;
      const candidates = [
        { s: '1280x800', r: 1280 / 800 },
        { s: '800x1280', r: 800 / 1280 },
        { s: '1024x1024', r: 1 },
      ];
      let best = candidates[0];
      let bestDiff = Math.abs(r - best.r);
      for (const c of candidates.slice(1)) {
        const d = Math.abs(r - c.r);
        if (d < bestDiff) { best = c; bestDiff = d; }
      }
      return best.s;
    };

    const validateSourceUrl = async (u) => {
      const raw = String(u || '').trim();
      if (!raw) return { ok: false, reason: 'EMPTY' };
      if (raw.startsWith('blob:')) return { ok: false, reason: 'BLOB_URL' };
      if (raw.startsWith('data:')) return { ok: true, reason: 'DATA_URL' };
      if (!raw.startsWith('http')) return { ok: false, reason: 'INVALID_SCHEME' };
      try {
        const p = await fetchProbe(raw);
        return { ok: p.ok, reason: p.ok ? 'OK' : (p.status ? `HTTP_${p.status}` : 'FETCH_ERROR'), probe: p };
      } catch {
        return { ok: false, reason: 'FETCH_ERROR' };
      }
    };

    const hasSource = Boolean(String(sourceImageUrl || '').trim());
    const desiredMode = outputMode === 'FAST_T2I' || outputMode === 'PRECISE_I2I'
      ? outputMode
      : (hasSource ? 'PRECISE_I2I' : 'FAST_T2I');

    const userSelected = {
      spaceType: String(intake?.space || '').trim(),
      layoutVariant: (layoutVariant === 'A' || layoutVariant === 'B') ? layoutVariant : undefined,
      sizeChoice: typeof sizeChoice === 'string' ? sizeChoice : undefined,
      styleChoice: typeof styleChoice === 'string' ? styleChoice : undefined,
    };
    const applied = {
      hkSpace: built?.hkSpace,
      layoutVariant: built?.layoutVariant,
      sizeHint: built?.sizeHintKey,
      styleKey: built?.styleKey,
      outputMode: desiredMode,
    };
    const mismatch = Boolean(
      (userSelected.layoutVariant && applied.layoutVariant && userSelected.layoutVariant !== applied.layoutVariant) ||
      (userSelected.styleChoice && applied.styleKey && !String(applied.styleKey).includes(String(userSelected.styleChoice))) // best-effort
    );

    // C7: STRUCTURE_LOCK preset (reduce distortions by preserving geometry/perspective)
    const preset = String(qualityPreset || '').trim();
    const finalKeepStructure = typeof keep_structure === 'boolean' ? keep_structure : true;
    const defaultSW = preset === 'STRUCTURE_LOCK' ? 0.90 : 0.85;
    // Product-level "strength" is tracked in debug and used to pick conservative params.
    // Upstream StepFun image2image uses source_weight as the main structure control.
    const defaultStrength = preset === 'STRUCTURE_LOCK' ? 0.35 : 0.80;
    const defaultCfg = preset === 'STRUCTURE_LOCK' ? 4.5 : finalCfgScale;
    const defaultSW2 = preset === 'STRUCTURE_LOCK' ? 0.95 : defaultSW;
    const finalI2ISourceWeight = (typeof i2i_source_weight === 'number' && i2i_source_weight > 0 && i2i_source_weight <= 1)
      ? i2i_source_weight
      : defaultSW2;
    const finalI2IStrength = (typeof i2i_strength === 'number' && i2i_strength > 0 && i2i_strength <= 1)
      ? i2i_strength
      : defaultStrength;
    const finalCfgI2I = (typeof cfg_scale === 'number') ? Math.min(Math.max(cfg_scale, 1), 7.0) : defaultCfg;

    const doI2I = async ({ sourceUrl, sizeToUse }) =>
      await stepfunImage2Image({
        apiKey,
        model: 'step-1x-medium',
        prompt,
        source_url: String(sourceUrl),
        source_weight: finalI2ISourceWeight,
        size: String(sizeToUse || finalSize),
        n: 1,
        response_format: finalResponseFormat,
        seed: finalSeed,
        steps: finalSteps,
        cfg_scale: finalCfgI2I,
      });

    let actualMode = desiredMode;
    let fallbackUsed = false;
    let fallbackErrorCode = undefined;
    let fallbackErrorMessage = undefined;

    // StepFun may enforce limit=1 concurrency. Retry lightly on 429.
    const withRetry429 = async (fn) => {
      let r = await fn();
      if (r.status === 429) {
        await sleep(800);
        r = await fn();
      }
      return r;
    };

    let response;
    let baseImage = null;
    let baseImageBytes = 0;
    let baseImageBytesSent = 0;
    let requestedEndpoint = desiredMode === 'PRECISE_I2I' ? 'image2image' : 'generations';
    let aspectRatio = null;
    let targetSizeUsed = finalSize;
    let padded = false;
    let paddingMethod = null;
    let resizeMode = 'none';
    if (desiredMode === 'PRECISE_I2I') {
      const v = await validateSourceUrl(sourceImageUrl);
      if (!v.ok) {
        res.status(400).json({
          ok: false,
          errorCode: 'BASE_IMAGE_REQUIRED',
          message: '请重新上传相片再试（更贴原相需要相片可访问）',
          debug: {
            outputMode: 'PRECISE_I2I',
            requestedEndpoint: 'image2image',
            usedKey,
            model: 'step-1x-medium',
            elapsedMs: Date.now() - startedAt,
            promptChars: built?.promptChars,
            promptHash: built?.promptHash,
            hkSpace: built?.hkSpace,
            layoutVariant: built?.layoutVariant,
            dropped: built?.dropped,
            anchorDropped: built?.anchorDropped,
            antiDistortDropped: built?.antiDistortDropped,
            userSelected,
            applied,
            mismatch,
            i2iParams: { strength: finalI2IStrength, source_weight: finalI2ISourceWeight, cfg_scale: finalCfgI2I, steps: finalSteps },
            sentSize: finalSize,
            baseImageBytes: v?.probe?.bytes || 0,
            baseImage: v?.probe ? { w: v.probe.w, h: v.probe.h, contentType: v.probe.contentType, bytes: v.probe.bytes, contentLength: v.probe.contentLength } : undefined,
            baseImageContentType: v?.probe?.contentType || null,
            baseImageWidth: v?.probe?.w || null,
            baseImageHeight: v?.probe?.h || null,
            aspectRatio: (v?.probe?.w && v?.probe?.h) ? (v.probe.w / v.probe.h) : null,
          }
        });
        return;
      }

      baseImage = v?.probe ? { w: v.probe.w, h: v.probe.h, contentType: v.probe.contentType, bytes: v.probe.bytes, contentLength: v.probe.contentLength } : null;
      baseImageBytes = v?.probe?.bytes || 0;
      aspectRatio = (v?.probe?.w && v?.probe?.h) ? (v.probe.w / v.probe.h) : null;
      if (!baseImageBytes || baseImageBytes <= 0) {
        res.status(400).json({
          ok: false,
          errorCode: 'BASE_IMAGE_REQUIRED',
          message: '请重新上传相片再试（更贴原相需要相片可访问）',
          debug: {
            outputMode: 'PRECISE_I2I',
            requestedEndpoint: 'image2image',
            usedKey,
            model: 'step-1x-medium',
            elapsedMs: Date.now() - startedAt,
            promptChars: built?.promptChars,
            promptHash: built?.promptHash,
            hkSpace: built?.hkSpace,
            layoutVariant: built?.layoutVariant,
            dropped: built?.dropped,
            anchorDropped: built?.anchorDropped,
            antiDistortDropped: built?.antiDistortDropped,
            userSelected,
            applied,
            mismatch,
            i2iParams: { strength: finalI2IStrength, source_weight: finalI2ISourceWeight, cfg_scale: finalCfgI2I, steps: finalSteps },
            sentSize: finalSize,
            baseImageBytes,
            baseImage,
            baseImageContentType: baseImage?.contentType || null,
            baseImageWidth: baseImage?.w || null,
            baseImageHeight: baseImage?.h || null,
            aspectRatio,
          }
        });
        return;
      }

      // Download the base image and send as data URL so StepFun definitely uses the same pixels.
      // No resize, no crop, preserve aspect ratio.
      const full = await fetchFullImageAsDataUrl(String(sourceImageUrl));
      if (!full.ok || !full.dataUrl || !full.bytes) {
        res.status(400).json({
          ok: false,
          errorCode: 'BASE_IMAGE_REQUIRED',
          message: '请重新上传相片再试（更贴原相需要相片可访问）',
          debug: {
            outputMode: 'PRECISE_I2I',
            requestedEndpoint: 'image2image',
            usedKey,
            model: 'step-1x-medium',
            elapsedMs: Date.now() - startedAt,
            promptChars: built?.promptChars,
            promptHash: built?.promptHash,
            hkSpace: built?.hkSpace,
            layoutVariant: built?.layoutVariant,
            dropped: built?.dropped,
            anchorDropped: built?.anchorDropped,
            antiDistortDropped: built?.antiDistortDropped,
            userSelected,
            applied,
            mismatch,
            i2iParams: { strength: finalI2IStrength, source_weight: finalI2ISourceWeight, cfg_scale: finalCfgI2I, steps: finalSteps },
            sentSize: finalSize,
            baseImageBytes: full.bytes || 0,
            baseImage: { w: full.w, h: full.h, contentType: full.contentType, bytes: full.bytes, contentLength: null },
            baseImageContentType: full.contentType,
            baseImageWidth: full.w,
            baseImageHeight: full.h,
            aspectRatio: (full.w && full.h) ? (full.w / full.h) : null,
          }
        });
        return;
      }
      baseImage = { w: full.w, h: full.h, contentType: full.contentType, bytes: full.bytes, contentLength: null };
      baseImageBytes = full.bytes;
      aspectRatio = (full.w && full.h) ? (full.w / full.h) : aspectRatio;
      const targetSize = pickTargetSizeByWH(full.w, full.h);
      targetSizeUsed = targetSize;
      const sz = parseSize(targetSize);
      let sourceUrlToSend = full.dataUrl;
      if (sz && full.buffer && full.w && full.h) {
        const r0 = full.w / full.h;
        const r1 = sz.w / sz.h;
        const diff = Math.abs(r0 - r1);
        // If aspect ratios differ meaningfully, pad (letterbox) to prevent stretched corners / vignette.
        if (diff > 0.03) {
          const paddedBuf = await letterboxPadBlur(full.buffer, sz.w, sz.h);
          padded = true;
          paddingMethod = 'blur';
          resizeMode = 'contain+blur';
          baseImageBytesSent = paddedBuf.byteLength;
          sourceUrlToSend = `data:image/jpeg;base64,${Buffer.from(paddedBuf).toString('base64')}`;
        } else {
          baseImageBytesSent = full.bytes;
        }
      } else {
        baseImageBytesSent = full.bytes;
      }
      response = await withRetry429(() => doI2I({ sourceUrl: sourceUrlToSend, sizeToUse: targetSize }));
      if (!response.ok) {
        // Only allow fallback for temporary upstream failures (NOT base image issues).
        const status = response.status;
        const errText = await response.text().catch(() => '');
        const isTemporary = status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 408;
        if (!isTemporary) {
          res.status(status).json({
            ok: false,
            errorCode: `UPSTREAM_I2I_${status}`,
            message: '精準模式生成失败（image2image）。请稍后再试，或取消勾选改用快速概念图。',
            debug: {
              outputMode: 'PRECISE_I2I',
              requestedEndpoint: 'image2image',
              usedKey,
              model: 'step-1x-medium',
              elapsedMs: Date.now() - startedAt,
              promptChars: built?.promptChars,
              promptHash: built?.promptHash,
              hkSpace: built?.hkSpace,
              layoutVariant: built?.layoutVariant,
              dropped: built?.dropped,
              anchorDropped: built?.anchorDropped,
              antiDistortDropped: built?.antiDistortDropped,
              userSelected,
              applied,
              mismatch,
              i2iParams: { strength: finalI2IStrength, source_weight: finalI2ISourceWeight, cfg_scale: finalCfgI2I, steps: finalSteps },
              sentSize: finalSize,
              baseImageBytes,
              baseImage,
              baseImageContentType: baseImage?.contentType || null,
              baseImageWidth: baseImage?.w || null,
              baseImageHeight: baseImage?.h || null,
              aspectRatio,
              upstreamStatus: status,
              upstreamError: errText ? errText.slice(0, 600) : null,
            }
          });
          return;
        }
        fallbackUsed = true;
        fallbackErrorCode = `UPSTREAM_I2I_${status}`;
        fallbackErrorMessage = errText || 'i2i failed';
        actualMode = 'FAST_T2I';
        requestedEndpoint = 'generations';
        response = await withRetry429(doT2I);
      }
    } else {
      response = await withRetry429(doT2I);
    }

    if (!response.ok) {
      if (response.status === 429) {
        res.status(429).json({
          ok: false,
          errorCode: 'RATE_LIMITED',
          message: '当前生成排队中，请稍后再试（约 20–40 秒）'
        });
        return;
      }
      const errText = await response.text();
      res.status(response.status).json({
        ok: false,
        errorCode: `UPSTREAM_${response.status}`,
        message: `Upstream error: ${errText}`,
      });
      return;
    }

    const data = await response.json();
    const first = data?.data?.[0] || {};
    const finishReason = first?.finish_reason;
    const resultSeed = first?.seed ?? data?.seed;
    const resultUrl = first?.url || first?.image_url;
    const resultB64 = first?.b64_json || first?.image || first?.base64 || first?.b64;

    if (finalResponseFormat === 'url') {
      if (!resultUrl && !resultB64) {
        res.status(502).json({ ok: false, errorCode: 'INVALID_RESPONSE', message: 'No image payload received' });
        return;
      }
      res.status(200).json({
        ok: true,
        resultUrl: resultUrl || `data:image/jpeg;base64,${resultB64}`,
        debug: {
          outputMode: actualMode,
          requestedEndpoint,
          seed: resultSeed,
          finish_reason: finishReason,
          size: finalSize,
          steps: finalSteps,
          cfg_scale: actualMode === 'PRECISE_I2I' ? finalCfgI2I : finalCfgScale,
          model: 'step-1x-medium',
          usedKey,
          elapsedMs: Date.now() - startedAt,
          promptChars: built?.promptChars,
          promptHash: built?.promptHash,
          hkSpace: built?.hkSpace,
          layoutVariant: built?.layoutVariant,
          dropped: built?.dropped,
          anchorDropped: built?.anchorDropped,
          antiDistortDropped: built?.antiDistortDropped,
          fallbackUsed,
          ...(fallbackUsed ? { fallbackErrorCode, fallbackErrorMessage } : {}),
          userSelected,
          applied: { ...applied, outputMode: actualMode },
          mismatch,
          ...(desiredMode === 'PRECISE_I2I' ? {
            i2iParams: { strength: finalI2IStrength, source_weight: finalI2ISourceWeight, cfg_scale: finalCfgI2I, steps: finalSteps },
            baseImage,
            baseImageBytes,
            baseImageBytesSent,
            baseImageContentType: baseImage?.contentType || null,
            baseImageWidth: baseImage?.w || null,
            baseImageHeight: baseImage?.h || null,
            aspectRatio,
            targetSize: targetSizeUsed,
            padded,
            paddingMethod,
            resizeMode,
            sentSize: targetSizeUsed,
            mode: 'PRECISE_I2I'
          } : {}),
          ...(debugEnabled ? { usedText: prompt } : {}),
        },
      });
      return;
    }

    if (!resultB64) {
      res.status(502).json({ ok: false, errorCode: 'INVALID_RESPONSE', message: 'No base64 image received' });
      return;
    }
    res.status(200).json({
      ok: true,
      resultUrl: `data:image/png;base64,${resultB64}`,
      debug: {
        outputMode: actualMode,
        requestedEndpoint,
        seed: resultSeed,
        finish_reason: finishReason,
        size: finalSize,
        steps: finalSteps,
        cfg_scale: actualMode === 'PRECISE_I2I' ? finalCfgI2I : finalCfgScale,
        model: 'step-1x-medium',
        usedKey,
        elapsedMs: Date.now() - startedAt,
        promptChars: built?.promptChars,
        promptHash: built?.promptHash,
        hkSpace: built?.hkSpace,
        layoutVariant: built?.layoutVariant,
        dropped: built?.dropped,
        anchorDropped: built?.anchorDropped,
        antiDistortDropped: built?.antiDistortDropped,
        fallbackUsed,
        ...(fallbackUsed ? { fallbackErrorCode, fallbackErrorMessage } : {}),
        userSelected,
        applied: { ...applied, outputMode: actualMode },
        mismatch,
        ...(desiredMode === 'PRECISE_I2I' ? {
          i2iParams: { strength: finalI2IStrength, source_weight: finalI2ISourceWeight, cfg_scale: finalCfgI2I, steps: finalSteps },
          baseImage,
          baseImageBytes,
          baseImageBytesSent,
          baseImageContentType: baseImage?.contentType || null,
          baseImageWidth: baseImage?.w || null,
          baseImageHeight: baseImage?.h || null,
          aspectRatio,
          targetSize: targetSizeUsed,
          padded,
          paddingMethod,
          resizeMode,
          sentSize: targetSizeUsed,
          mode: 'PRECISE_I2I'
        } : {}),
        ...(debugEnabled ? { usedText: prompt } : {}),
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, errorCode: 'INTERNAL_ERROR', message: e?.message || 'Internal error' });
  }
}

