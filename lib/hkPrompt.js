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
].join(' ');

/**
 * buildHKPrompt({ renderIntake }) => { prompt, promptChars, promptHash, hkSpace, layoutVariant, dropped }
 */
export function buildHKPrompt({ renderIntake }) {
  const intake = renderIntake || {};
  const hkSpace = detectHKSpace(intake?.space);
  const rules = RULES[hkSpace] || RULES[HK_SPACE.LIVING_DINING];
  const layoutVariant = pickLayoutVariant(intake?.focus);
  const layoutFromRules = layoutVariant === 'B' ? rules.layoutB : rules.layoutA;

  const segments = {
    global: GLOBAL_LOCK,
    space: rules.lock,
    size: sizeHintFromIntake(intake),
    // Focus text may be long (中文带多字段). Cap it to protect NEGATIVE from being truncated.
    layout: normalize(intake?.focus) ? `Layout (must follow): ${cap(intake?.focus, 240)}.` : layoutFromRules,
    style: styleHint(intake),
    light: lightingHint(intake),
    negative: `Negative: ${NEGATIVE_COMMON} ${rules.negativeExtra}`.trim(),
  };

  const order = ['global', 'space', 'size', 'layout', 'style', 'light', 'negative'];
  const join = (keys) => keys.map(k => segments[k]).filter(Boolean).join(' ');

  const dropped = [];
  let keys = [...order];
  let prompt = normalize(join(keys));

  // Hard cap: StepFun t2i prompt must be 1..1024 chars.
  // Soft cap: if > 980, drop soft/style-ish fields first.
  if (prompt.length > 980) {
    for (const k of ['style', 'light']) {
      if (keys.includes(k)) {
        keys = keys.filter(x => x !== k);
        dropped.push(k);
        prompt = normalize(join(keys));
        if (prompt.length <= 980) break;
      }
    }
  }

  if (prompt.length > 1024) {
    // Final fallback: preserve hard parts (global/space/size/layout/negative), then slice.
    const keepKeys = ['global', 'space', 'size', 'layout', 'negative'].filter(k => keys.includes(k));
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
    layoutVariant,
    dropped,
  };
}

