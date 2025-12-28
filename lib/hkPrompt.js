import crypto from 'crypto';

/**
 * HK 六大空间标准化 prompt builder（t2i）。
 * 目标：短、硬、先结构后风格；并强制控制在 1024 chars 内。
 */

export const HK_SPACE = {
  ENTRY_CORRIDOR: 'ENTRY_CORRIDOR',
  LIVING_DINING: 'LIVING_DINING',
  MASTER_BEDROOM: 'MASTER_BEDROOM',
  SMALL_BEDROOM: 'SMALL_BEDROOM',
  KITCHEN: 'KITCHEN',
  BATHROOM: 'BATHROOM',
};

const normalize = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const cap = (s, n) => {
  const t = normalize(s);
  if (!t) return '';
  return t.length > n ? t.slice(0, n - 3) + '...' : t;
};

export function hashTextShort(text) {
  try {
    return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex').slice(0, 12);
  } catch {
    return 'hash_error';
  }
}

export function buildAnchorLock(hkAnchors) {
  const a = hkAnchors && typeof hkAnchors === 'object' ? hkAnchors : {};
  const pick = (k, allowed) => {
    const v = String(a?.[k] || '').trim();
    if (!v || v === 'UNKNOWN') return '';
    return allowed.includes(v) ? v : '';
  };

  const cameraAngle = pick('cameraAngle', ['FRONTAL', 'SLIGHT_45']);
  const cameraDistanceFeel = pick('cameraDistanceFeel', ['NEAR', 'MID', 'FAR']);
  const windowWall = pick('windowWall', ['FAR_WALL', 'SIDE_WALL', 'NONE']);
  const windowOffset = pick('windowOffset', ['CENTER', 'LEFT', 'RIGHT']);
  const daylightDirection = pick('daylightDirection', ['LEFT_TO_RIGHT', 'RIGHT_TO_LEFT']);
  const shadowType = pick('shadowType', ['HARD_LONG', 'SOFT_SHORT']);
  const finishLevel = pick('finishLevel', ['RAW_CONCRETE', 'PUTTY_LINES', 'FINISHED']);

  const cameraLine = (() => {
    if (!cameraAngle && !cameraDistanceFeel) return '';
    const aTxt = cameraAngle === 'FRONTAL' ? 'Camera frontal' : 'Camera slight 45°';
    const dTxt =
      cameraDistanceFeel === 'NEAR' ? 'near distance'
        : cameraDistanceFeel === 'MID' ? 'mid distance'
          : cameraDistanceFeel === 'FAR' ? 'far distance'
            : '';
    const parts = [aTxt, dTxt].filter(Boolean).join(', ');
    return `${parts}, eye-level, normal lens, no wide-angle.`;
  })();

  const windowLine = (() => {
    if (!windowWall) return '';
    if (windowWall === 'NONE') return 'No visible window.';
    const wallTxt = windowWall === 'FAR_WALL' ? 'far wall' : 'side wall';
    const offTxt =
      windowOffset === 'CENTER' ? 'centered'
        : windowOffset === 'LEFT' ? 'offset left'
          : windowOffset === 'RIGHT' ? 'offset right'
            : '';
    const pos = [wallTxt, offTxt].filter(Boolean).join(', ');
    return pos ? `One medium window on the ${pos} (not floor-to-ceiling).` : `One medium window on the ${wallTxt} (not floor-to-ceiling).`;
  })();

  const daylightLine = (() => {
    if (!daylightDirection) return '';
    const dirTxt = daylightDirection === 'LEFT_TO_RIGHT' ? 'from left' : 'from right';
    const shadowTxt =
      shadowType === 'HARD_LONG' ? 'long hard shadow'
        : shadowType === 'SOFT_SHORT' ? 'short soft shadow'
          : '';
    if (shadowTxt) return `Strong daylight ${dirTxt}, ${shadowTxt} on floor.`;
    return `Daylight ${dirTxt}.`;
  })();

  const finishLine = (() => {
    if (!finishLevel) return '';
    if (finishLevel === 'RAW_CONCRETE') return 'Raw concrete walls/floor.';
    if (finishLevel === 'PUTTY_LINES') return 'Walls show putty joint lines; raw cement floor.';
    if (finishLevel === 'FINISHED') return 'Finished surfaces (paint/flooring) visible.';
    return '';
  })();

  // Build a short, hard anchor lock (<= 220 chars).
  // Keep camera + (window or daylight) when possible; drop finish first if too long.
  const parts = [windowLine, daylightLine, finishLine, cameraLine].filter(Boolean);
  if (!parts.length) return '';

  const join = (arr) => normalize(arr.join(' '));
  let keep = [...parts];
  let s = join(keep);

  const mustHave = () => {
    const hasWindowOrDay = Boolean(windowLine || daylightLine);
    const hasCamera = Boolean(cameraLine);
    return { hasWindowOrDay, hasCamera };
  };

  if (s.length > 220) {
    // drop finish first
    keep = keep.filter(x => x !== finishLine);
    s = join(keep);
  }
  if (s.length > 220) {
    // then drop daylight if window exists (keep at least one of them)
    if (windowLine) {
      keep = keep.filter(x => x !== daylightLine);
      s = join(keep);
    }
  }
  if (s.length > 220) {
    // then drop camera if still too long (but try to keep either window or daylight)
    keep = keep.filter(x => x !== cameraLine);
    s = join(keep);
  }
  if (s.length > 220) {
    s = s.slice(0, 217) + '...';
  }

  const m = mustHave();
  if (!m.hasWindowOrDay && !m.hasCamera) return '';
  return s;
}

export function buildAntiDistortLock() {
  // <= 160 chars, hard constraints, never dropped
  return 'Keep original camera perspective and geometry. Keep all vertical lines straight. No lens distortion. No fisheye. No wide-angle. Do not stretch proportions.';
}

export function buildCameraLock() {
  // <= 140 chars, hard constraints, never dropped
  return 'Normal lens, realistic smartphone perspective. No wide-angle. No fisheye. Keep vertical lines straight.';
}

export function buildNoVignetteLock() {
  // <= 80 chars, never dropped
  return 'No vignette. No dark corners. No circular border.';
}

export function buildStructureLock() {
  // Hard constraints for i2i "match original" mode (never dropped).
  return [
    'Keep the original room geometry exactly the same.',
    'Keep window and door positions exactly the same.',
    'Do not add any new windows or doors.',
    'No side windows. No balcony doors.',
  ].join(' ');
}

function detectHKSpace(spaceZh) {
  const s = normalize(spaceZh);
  if (!s) return HK_SPACE.LIVING_DINING;
  if (s.includes('客餐')) return HK_SPACE.LIVING_DINING;
  if (s.includes('入户') || s.includes('玄') || s.includes('關') || s.includes('关') || s.includes('走廊') || s.includes('通道')) return HK_SPACE.ENTRY_CORRIDOR;
  if (s.includes('走廊') || s.includes('通道')) return HK_SPACE.ENTRY_CORRIDOR;
  if (s.includes('厨房') || s.includes('廚') || s.includes('厨')) return HK_SPACE.KITCHEN;
  if (s.includes('卫生间') || s.includes('衛') || s.includes('卫') || s.includes('浴') || s.includes('洗手') || s.includes('厕') || s.includes('廁')) return HK_SPACE.BATHROOM;
  if (s.includes('小睡房') || s.includes('眼镜房') || s.includes('次卧') || s.includes('儿童')) return HK_SPACE.SMALL_BEDROOM;
  if (s.includes('大睡房') || s.includes('主人房') || s.includes('主卧')) return HK_SPACE.MASTER_BEDROOM;
  if (s.includes('睡') || s.includes('卧') || s.includes('房')) return HK_SPACE.MASTER_BEDROOM;
  if (s === '其他') return HK_SPACE.LIVING_DINING;
  return HK_SPACE.LIVING_DINING;
}

function pickLayoutVariant(focusText) {
  const f = normalize(focusText);
  // If user explicitly picked something that looks like B/方案2, treat as B; otherwise A.
  if (/(^|[^A-Za-z])B([^A-Za-z]|$)/.test(f) || f.includes('方案B') || f.includes('方案2') || f.includes('第二') || f.includes('B ')) return 'B';
  return 'A';
}

function sizeHintFromIntake(intake) {
  const w = normalize(intake?.roomWidthChi);
  // 用户要求“不写尺”，所以只给 very compact/compact。
  if (!w) return 'Compact scale.';
  // 粗略：<= 8 尺视为 very compact（不输出数字）
  if (/7|8|狭|窄/.test(w)) return 'Very compact scale.';
  return 'Compact scale.';
}

function styleHint(intake) {
  const style = normalize(intake?.style);
  const color = normalize(intake?.color);
  const parts = [];
  if (style) parts.push(`Style: ${style}.`);
  if (color) parts.push(`Palette: ${color}.`);
  // 强制短句
  return parts.join(' ');
}

function lightingHint(intake) {
  const vibe = normalize(intake?.vibe);
  if (!vibe) return 'Lighting: layered cove + downlights + accents, warm 2700-3000K, realistic GI.';
  if (vibe.includes('明亮')) return 'Lighting: bright layered cove + downlights, warm 3000K, balanced exposure.';
  if (vibe.includes('酒店') || vibe.includes('高级') || vibe.includes('高級')) return 'Lighting: premium layered (cove+downlights+wall wash+niches), warm 2700-3000K, controlled highlights.';
  if (vibe.includes('暖')) return 'Lighting: warm cozy layered (cove+downlights+accents), warm 2700-3000K, soft shadows.';
  return 'Lighting: layered cove + downlights + accents, warm 2700-3000K, realistic GI.';
}

function goalHint(intake) {
  const p = normalize(intake?.priority);
  if (!p) return '';
  if (p.includes('收纳')) return 'Goal: storage-first; add more full-height built-ins and hidden storage (no structure change).';
  if (p.includes('氛围')) return 'Goal: cozy mood; improve layered lighting + soft furnishings (no structure change).';
  if (p.includes('显大') || p.includes('顯大')) return 'Goal: airy and visually larger; light palette + clean lines (no structure change).';
  return `Goal: ${cap(p, 36)}.`;
}

const RULES = {
  [HK_SPACE.ENTRY_CORRIDOR]: {
    lock: 'HK entryway/corridor. Narrow passage. Storage wall mandatory.',
    layoutA: 'A: Full-height shoe cabinet + bench + full-length mirror; shallow cabinets to keep clear walkway.',
    layoutB: 'B: One-side shallow storage wall to ceiling; end-wall utility cabinet; keep circulation wide and unobstructed.',
    negativeExtra: 'No living room sofa/TV. No deep cabinets that block walkway.',
  },
  [HK_SPACE.LIVING_DINING]: {
    lock: 'HK open-plan living-dining room. Compact and buildable.',
    layoutA: 'A: TV wall storage + 2-3 seat sofa facing TV; dining table for 4 with sideboard near circulation.',
    layoutB: 'B: Slim TV wall (no bulky) + clear main passage; dining-led layout with tall pantry/sideboard, keep sofa compact.',
    negativeExtra: 'No bedroom furniture. No oversized sectional. No luxury double-height space.',
  },
  [HK_SPACE.MASTER_BEDROOM]: {
    lock: 'HK master bedroom. Compact, practical, residential.',
    layoutA: 'A: Bed + headboard on solid wall; full-height sliding wardrobe on one wall; clear bedside circulation.',
    layoutB: 'B: Wardrobe to ceiling + integrated vanity/desk (slim); bed on opposite solid wall; keep access to window/AC.',
    negativeExtra: 'No kids bunk bed. No office setup as primary. No hotel lobby scale.',
  },
  [HK_SPACE.SMALL_BEDROOM]: {
    lock: 'HK small bedroom (very compact). Space-saving mandatory.',
    layoutA: 'A: Platform bed/tatami aligned to window wall; drawers under bed; full-height sliding wardrobe; minimal slim shelf/desk.',
    layoutB: 'B: Murphy bed integrated in full-height storage wall; wardrobe+bed as one built-in; compact integrated desk/shelf.',
    negativeExtra: 'No luxury big empty space. No large desk or full study setup. No king-size bed.',
  },
  [HK_SPACE.KITCHEN]: {
    lock: 'HK kitchen. Narrow galley or compact L-shape. Practical cabinetry.',
    layoutA: 'A: One-wall galley: sink-stove-fridge compact; upper cabinets to ceiling; clean worktop + under-cabinet lighting.',
    layoutB: 'B: Compact L-shape: tight aisle; practical work triangle; tall pantry/appliance cabinet if space allows.',
    negativeExtra: 'No big island. No luxury open kitchen scale. No oversized windows added.',
  },
  [HK_SPACE.BATHROOM]: {
    lock: 'HK bathroom. Small enclosed. Compact fixtures, buildable.',
    layoutA: 'A: Wet-dry separation with glass; compact vanity + mirror cabinet; wall storage niches.',
    layoutB: 'B: Max wall storage; compact shower; vanity+mirror cabinet; anti-slip tiles, easy-clean.',
    negativeExtra: 'No large bathtub. No luxury spa scale. No double vanity.',
  },
};

const GLOBAL_LOCK = [
  'HK apartment.',
  'Buildable design.',
  'Compact scale.',
  'Ceiling feels 2.5-2.6m.',
  'Eye-level 1.55m.',
  'Level horizon.',
  'Normal lens.',
  'NO wide-angle.',
  'NO fisheye.',
  'Keep straight vertical/horizontal lines.',
  'Keep room shape and window/door positions as in the photo.',
].join(' ');

const NEGATIVE_COMMON = [
  'No luxury scale.',
  'No European palace style.',
  'No double-height ceiling.',
  'No showroom/hotel lobby scale.',
  'No oversized furniture.',
  'No unrealistic layout.',
  'No extra windows/doors.',
  'No distortion, warped walls, bent windows.',
  'No CGI toy look, no low-poly, no cartoon.',
  // Double insurance against lens artifacts
  'fisheye, wide angle, ultra wide, lens distortion, warped, stretched, curved lines, panoramic, vignette, dark corners, circular frame, tunnel view',
].join(' ');

/**
 * buildHKPrompt({ renderIntake, hkAnchors?, spaceType?, layoutVariant?, sizeChoice?, styleChoice? })
 * => { prompt, promptChars, promptHash, hkSpace, layoutVariant, sizeHintKey, styleKey, anchorLock, dropped, anchorDropped }
 */
export function buildHKPrompt({ renderIntake, hkAnchors, spaceType, layoutVariant, sizeChoice, styleChoice }) {
  const intake = renderIntake || {};
  const hkSpace = detectHKSpace(spaceType || intake?.space);
  const rules = RULES[hkSpace] || RULES[HK_SPACE.LIVING_DINING];
  const inferredVariant = pickLayoutVariant(intake?.focus);
  const finalLayoutVariant = (layoutVariant === 'A' || layoutVariant === 'B') ? layoutVariant : inferredVariant;
  const layoutFromRules = finalLayoutVariant === 'B' ? rules.layoutB : rules.layoutA;

  const inferredAnchors =
    hkAnchors ||
    intake?.hkAnchors ||
    intake?.visionExtraction?.hkAnchors ||
    intake?.visionExtraction?.hkanchors ||
    intake?.extraction?.hkAnchors ||
    intake?.extraction?.hkanchors ||
    null;
  const anchorLock = buildAnchorLock(inferredAnchors);
  const antiDistortLock = buildAntiDistortLock();
  const cameraLock = buildCameraLock();
  const noVignetteLock = buildNoVignetteLock();
  const structureLock = buildStructureLock();

  const sizeHint = sizeHintFromIntake(intake);
  const sizeHintKey = sizeHint.includes('Very') ? 'VERY_COMPACT' : 'COMPACT';
  const styleKey = normalize(styleChoice || intake?.style || '');

  const segments = {
    camera: cameraLock,
    global: GLOBAL_LOCK,
    structure: structureLock,
    novig: noVignetteLock,
    anti: antiDistortLock,
    anchor: anchorLock,
    space: rules.lock,
    size: sizeHint,
    // Focus text may be long (中文带多字段). Cap it to protect NEGATIVE from being truncated.
    layout: normalize(intake?.focus) ? `Layout (must follow): ${cap(intake?.focus, 240)}.` : layoutFromRules,
    goal: goalHint(intake),
    style: styleChoice ? `Style: ${normalize(styleChoice)}.` : styleHint(intake),
    light: lightingHint(intake),
    negative: `Negative: ${NEGATIVE_COMMON} ${rules.negativeExtra}`.trim(),
  };

  const order = ['camera', 'global', 'structure', 'novig', 'anti', 'anchor', 'space', 'size', 'layout', 'goal', 'style', 'light', 'negative'];
  const join = (keys) => keys.map(k => segments[k]).filter(Boolean).join(' ');

  const dropped = [];
  let keys = [...order];
  let prompt = normalize(join(keys));

  // Hard cap: StepFun t2i prompt must be 1..1024 chars.
  // Soft cap: if > 980, drop STYLE/LIGHT only (never drop GLOBAL/ANCHOR/SPACE/SIZE/LAYOUT/NEGATIVE).
  if (prompt.length > 980) {
    for (const k of ['goal', 'style', 'light']) {
      if (keys.includes(k)) {
        keys = keys.filter(x => x !== k);
        dropped.push(k);
        prompt = normalize(join(keys));
        if (prompt.length <= 980) break;
      }
    }
  }

  if (prompt.length > 1024) {
    // Final fallback: preserve hard parts (camera/global/structure/novig/anti/anchor/space/size/layout/negative), then slice.
    const keepKeys = ['camera', 'global', 'structure', 'novig', 'anti', 'anchor', 'space', 'size', 'layout', 'negative'].filter(k => keys.includes(k));
    prompt = normalize(join(keepKeys));
    if (prompt.length > 1024) {
      prompt = prompt.slice(0, 1021) + '...';
    }
  }

  return {
    prompt,
    promptChars: prompt.length,
    promptHash: hashTextShort(prompt),
    hkSpace,
    layoutVariant: finalLayoutVariant,
    sizeHintKey,
    styleKey,
    anchorLock,
    dropped,
    anchorDropped: false,
    antiDistortDropped: false,
    cameraDropped: false,
    noVignetteDropped: false,
    structureDropped: false,
  };
}

