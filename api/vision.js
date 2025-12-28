export const config = {
    api: {
        bodyParser: {
            sizeLimit: '10mb',
        },
    },
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method Not Allowed' });
        return;
    }

    const imageUrl = req.body.imageUrl || req.body.imageDataUrl || req.body.image;
    const spaceType = req.body.spaceType; // New: Accept space type hint

    if (!imageUrl) {
        res.status(400).json({ error: 'Missing imageUrl' });
        return;
    }

    const apiKey = process.env.STEPFUN_API_KEY;

    if (!apiKey) {
        res.status(500).json({ 
            ok: false,
            errorCode: 'MISSING_KEY',
            message: 'Missing STEPFUN_API_KEY' 
        });
        return;
    }

    try {
        console.log('[Vision API] Analyzing image...');

        const normalizeSpaceType = (t) => {
            const v = String(t || '').trim();
            // Keep the taxonomy aligned to /api/space
            const allowed = new Set(['客餐厅', '大睡房', '小睡房', '厨房', '卫生间', '入户', '走廊', '其他']);
            if (allowed.has(v)) return v;
            // If model returns variants, map loosely
            if (v.includes('客') && v.includes('餐')) return '客餐厅';
            if (v.includes('厨') || v.includes('廚')) return '厨房';
            if (v.includes('卫') || v.includes('衛') || v.includes('浴') || v.includes('厕') || v.includes('廁')) return '卫生间';
            if (v.includes('入') || v.includes('玄') || v.includes('關') || v.includes('关')) return '入户';
            if (v.includes('走廊') || v.includes('通道')) return '走廊';
            if (v.includes('小') && (v.includes('睡') || v.includes('卧') || v.includes('房'))) return '小睡房';
            if (v.includes('大') && (v.includes('睡') || v.includes('卧') || v.includes('房'))) return '大睡房';
            if (v.includes('睡') || v.includes('卧') || v.includes('房')) return '大睡房';
            return '其他';
        };

        const standardLayoutOptions = (spaceTypeNorm, cues) => {
            const w = String(cues?.doors_windows || '').trim();
            const c = String(cues?.columns || '').trim();
            const b = String(cues?.beams_ceiling || '').trim();
            // Safe references (avoid hallucinating door position)
            const windowRef = w && w !== '未见' ? `以「${w}」為基準` : '以窗為正面牆';
            // For spaces where windows are often absent/unclear in HK units, anchor to "door-end" instead of guessing.
            const doorEndRef = '以门口这一端为基准';
            const baseRef =
                (spaceTypeNorm === '入户' || spaceTypeNorm === '走廊' || spaceTypeNorm === '卫生间')
                  ? doorEndRef
                  : windowRef;
            const columnRef = (c && c !== '未见') ? `（注意：${c}）` : '';
            const beamRef = (b && b !== '未见') ? `（注意：${b}）` : '';
            const keepDoor = '门位未见则保留门口净通道，不挡门扇。';

            const mk = (title, plan, cabinetry, circulation, lighting, risk) => ({
                title, plan, cabinetry, circulation, lighting, risk
            });

            if (spaceTypeNorm === '入户') {
                return [
                    mk(
                        'A 鞋柜一体',
                        `${baseRef}：门旁一侧到顶鞋柜＋换鞋凳＋全身镜。${columnRef}${beamRef}`,
                        '柜：到顶鞋柜（分常用/季节）＋中段开放格＋底部留空；可加清洁高柜（吸尘器位）。',
                        `动线：保留净通道≥80cm；不挡门扇；钥匙/包位靠出门动线。${keepDoor}`,
                        '灯：玄关筒灯＋鞋柜感应灯带/壁洗；镜前柔光。',
                        '风险：柜体过深会压通道；优先做薄柜+到顶。'
                    ),
                    mk(
                        'B 走廊浅柜',
                        `${baseRef}：走廊单侧做25–30cm浅柜到顶，端头做清洁高柜。${columnRef}${beamRef}`,
                        '柜：浅柜到顶（杂物/被褥）＋端头展示格（少量）＋清洁高柜。',
                        `动线：浅柜不压迫；端头留转身位；门口留落尘区。${keepDoor}`,
                        '灯：线性灯/壁洗拉长走廊＋柜内灯带。',
                        '风险：浅柜必须控深；端头不要做凸出把手。'
                    )
                ];
            }

            if (spaceTypeNorm === '走廊') {
                return [
                    mk(
                        'A 单侧浅柜',
                        `${baseRef}：走廊单侧25–30cm浅柜到顶，端头展示格（少量）。${columnRef}${beamRef}`,
                        '柜：浅柜到顶（杂物/清洁）＋端头展示格＋底部留空扫地机位（可选）。',
                        '动线：保留净通道≥85cm；门洞处不做转角外凸。',
                        '灯：线性灯/壁洗＋端头重点光。',
                        '风险：门洞附近柜体过深会顶门；必须控深。'
                    ),
                    mk(
                        'B 清洁高柜',
                        `${baseRef}：走廊端头做清洁高柜，侧面做浅柜分区收纳。${columnRef}${beamRef}`,
                        '柜：清洁高柜（吸尘器/拖把）＋侧浅柜（雨伞/杂物）＋隐藏门板。',
                        '动线：端头留回旋；不挤压主通道。',
                        '灯：端头洗墙光＋柜内感应灯。',
                        '风险：端头高柜要避开门套/踢脚线冲突。'
                    )
                ];
            }

            if (spaceTypeNorm === '厨房') {
                return [
                    mk(
                        'A 一字型',
                        `${windowRef}：一字型（冰箱/高柜→水槽→备餐→炉头），吊柜到顶。${columnRef}${beamRef}`,
                        '柜：地柜+吊柜到顶＋高柜电器位；台面整洁收纳（隐藏小家电）。',
                        '动线：水槽-备餐-炉头顺手；保留操作通道≥90cm；不挡窗开启（如有）。',
                        '灯：吊柜底灯＋筒灯；重点照台面。',
                        '风险：台面太短会不好用；优先保证备餐区长度。'
                    ),
                    mk(
                        'B L型',
                        `${windowRef}：L型转角（水槽与炉头分开），加转角五金与高柜。${columnRef}${beamRef}`,
                        '柜：L型地柜+吊柜到顶＋转角五金＋电器高柜/储物高柜。',
                        '动线：转角不做死角；避免开门互撞；保留通道≥90cm。',
                        '灯：底灯+筒灯+重点光；转角补光。',
                        '风险：转角规划不当会浪费；必须预留开门角度。'
                    )
                ];
            }

            if (spaceTypeNorm === '卫生间') {
                return [
                    mk(
                        'A 干湿分离',
                        `${baseRef}：门口侧浴室柜+镜柜，里侧淋浴区做干湿分离。${columnRef}${beamRef}`,
                        '柜：浴室柜+镜柜（主收纳）＋壁龛（可选）＋高柜（毛巾/清洁）。',
                        '动线：门口干区先用；淋浴区不溅水；不挡门扇。',
                        '灯：筒灯+镜前灯；淋浴区重点光。',
                        '风险：空间小则屏风尺寸要控；避免压迫。'
                    ),
                    mk(
                        'B 一字型',
                        `${baseRef}：一字型布局，浴室柜对门/侧门，淋浴在远端。${columnRef}${beamRef}`,
                        '柜：浴室柜+镜柜＋窄高柜（收纳清洁品）。',
                        '动线：保持净通道；壁龛/置物不凸出。',
                        '灯：筒灯+镜前灯+壁龛灯带（可选）。',
                        '风险：镜柜深度要控，避免撞头。'
                    )
                ];
            }

            if (spaceTypeNorm === '客餐厅') {
                return [
                    mk(
                        'A 标准厅',
                        `${windowRef}：电视墙在长墙；沙发对电视；餐桌靠窗侧；餐边高柜靠近厨房动线。${columnRef}${beamRef}`,
                        '柜：电视墙到顶收纳（下柜+侧高柜+少量展示格）＋餐边高柜/电器高柜。',
                        '动线：主通道留≥90cm；餐桌与门洞不冲突；避免挡窗帘轨。',
                        '灯：灯槽+筒灯+电视墙洗墙+餐桌吊灯（重点光）。',
                        '风险：电视墙太厚会压迫；优先薄柜+到顶。'
                    ),
                    mk(
                        'B 钻石/长厅',
                        `${windowRef}：电视墙做薄柜不压迫；餐区主导（餐桌居中/靠窗）；餐边高柜到顶。${columnRef}${beamRef}`,
                        '柜：薄电视墙柜+展示灯带（少量）＋餐边高柜到顶（咖啡/小家电）。',
                        '动线：留出钻石位/长走道净通道；避免沙发背后太挤。',
                        '灯：灯槽+筒灯+餐吊灯+柜内灯带（层次）。',
                        '风险：餐桌居中需控尺寸；否则会卡通道。'
                    )
                ];
            }

            if (spaceTypeNorm === '大睡房') {
                return [
                    mk(
                        'A 床靠实墙',
                        `${windowRef}：床头靠实墙；侧墙整排到顶衣柜（趟门优先）。${columnRef}${beamRef}`,
                        '柜：到顶衣柜（挂衣+抽屉+被褥位）＋床头背景（薄）＋床侧床头位。',
                        '动线：床侧通道≥55–60cm；衣柜趟门不占通道；不挡窗帘。',
                        '灯：灯槽+筒灯+床头壁灯/线性灯（柔光）。',
                        '风险：衣柜门型选错会顶通道；优先趟门。'
                    ),
                    mk(
                        'B 衣柜+梳妆一体',
                        `${windowRef}：衣柜到顶＋梳妆/书桌一体放窗边侧墙；床靠另一面实墙。${columnRef}${beamRef}`,
                        '柜：衣柜到顶＋梳妆/书桌一体（浅台面）＋上部开放格（少量）。',
                        '动线：桌面不挡窗开启；床尾留净通道；门位未见则保留门口转身位。',
                        '灯：桌面重点光+床头柔光+筒灯均匀。',
                        '风险：桌面过深会挡窗；控制深度。'
                    )
                ];
            }

            if (spaceTypeNorm === '小睡房') {
                return [
                    mk(
                        'A 地台/榻榻米',
                        `${windowRef}：床（地台/榻榻米）靠窗下或侧墙；到顶衣柜用趟门。${columnRef}${beamRef}`,
                        '柜：到顶薄衣柜（趟门）＋床下收纳（抽屉/上翻）＋窗边薄书架（可选）。',
                        '动线：保留门口通道；床不挡窗；柜体优先到顶但控深。',
                        '灯：灯槽+筒灯+床头重点光（壁灯/线性灯）。',
                        '风险：床放错会挡窗帘/采光；先保证窗可用。'
                    ),
                    mk(
                        'B 隐形/活动床',
                        `${windowRef}：隐形/活动床+柜一体，白天释放通道；到顶衣柜薄柜。${columnRef}${beamRef}`,
                        '柜：床柜一体＋到顶薄衣柜（趟门）＋（可选）窄书桌靠窗，不默认配置。',
                        '动线：白天留出净通道；门位未见则不压门口转身位。',
                        '灯：灯槽+筒灯+柜内灯带（氛围）。',
                        '风险：隐形床需墙体承重条件；不确定则用地台方案。'
                    )
                ];
            }

            // Fallback
            return [
                mk('A 标准', `${windowRef}：主功能靠墙，柜体到顶。${columnRef}${beamRef}`, '柜：到顶收纳为主＋少量展示。', `动线：保留净通道；不挡门窗。${keepDoor}`, '灯：灯槽+筒灯+重点光。', '风险：柜体过深会压迫通道。'),
                mk('B 备选', `${windowRef}：薄柜+功能角组合。${columnRef}${beamRef}`, '柜：薄柜到顶＋功能角（可选）。', `动线：优先通道。${keepDoor}`, '灯：线性灯+筒灯。', '风险：功能角过多会显乱。')
            ];
        };
        
        let finalImageUrl = imageUrl;
        if (imageUrl.startsWith('http')) {
            try {
                const imgRes = await fetch(imageUrl);
                if (imgRes.ok) {
                    const arrayBuffer = await imgRes.arrayBuffer();
                    const base64 = Buffer.from(arrayBuffer).toString('base64');
                    const mime = imgRes.headers.get('content-type') || 'image/jpeg';
                    finalImageUrl = `data:${mime};base64,${base64}`;
                }
            } catch (e) {
                console.warn('[Vision API] Failed to convert URL to base64, using original URL');
            }
        }

        const spacePrompt = spaceType ? `This is a photo of a "${spaceType}" in a Hong Kong apartment.` : "This is a photo of an interior space in a Hong Kong apartment.";

        // We want a designer-grade layout analysis that can be fed into the i2i prompt later.
        // Output JSON only, then we will generate a compact 4-line summary for UI (no layout line; layout is handled by selectable options below).
        const schema = `Return JSON only, with this schema:
{
  "space_type": "客餐厅/大睡房/小睡房/厨房/卫生间/入户/走廊/其他",
  "doors_windows": "门/窗/窗台位置（必须带相对方位：左墙/右墙/远端墙/入口侧；看不到写未见）",
  "columns": "墙面是否有立柱/凸位（必须带相对方位：左墙/右墙/远端墙/入口侧；没有则写未见）",
  "beams_ceiling": "天花是否有横梁/降板/灯槽条件（必须带相对方位或走向：左右向/前后向；没有则写未见）",
  "hkAnchors": {
    "cameraAngle": "FRONTAL/SLIGHT_45/UNKNOWN",
    "cameraDistanceFeel": "NEAR/MID/FAR/UNKNOWN",
    "windowWall": "FAR_WALL/SIDE_WALL/NONE/UNKNOWN",
    "windowOffset": "CENTER/LEFT/RIGHT/UNKNOWN",
    "daylightDirection": "LEFT_TO_RIGHT/RIGHT_TO_LEFT/UNKNOWN",
    "shadowType": "HARD_LONG/SOFT_SHORT/UNKNOWN",
    "finishLevel": "RAW_CONCRETE/PUTTY_LINES/FINISHED/UNKNOWN"
  },
  "structure_notes": [
    "补充结构点（可选，必须带相对方位；不确定写未见）"
  ],
  "light": "自然光方向 + 冷/暖（短句）",
  "finish_level": { "level": "毛坯/半装/已装", "evidence": "一句画面证据" },
  "fixed_constraints": [
    "不可动的硬约束（只写门窗/窗台/立柱/横梁/天花降板相关；不要提电箱/插座/开关等机电细节）"
  ],
  "layout_options": [
    {
      "title": "方案A（<=10字）",
      "plan": "一句话摆位（必须带方位）",
      "cabinetry": "柜体/收纳方案（位置+到顶/薄柜/开门方式）",
      "circulation": "动线要点（保留净通道/避开门扇/避开窗台）",
      "lighting": "灯光层次（灯槽/筒灯/重点光）",
      "risk": "一句风险提醒（例如会挡窗/太挤/门冲突）"
    }
  ],
  "recommended_index": 0
}
Rules:
- layout_options must be 2-3 options, each <= 90 Chinese chars total across fields.
- Must respect: do NOT hallucinate what you cannot see; if not visible, say "未见".
- If user confirmed space_type, MUST keep it consistent and do NOT mention other spaces.
- Relative directions MUST be based on the photo view (NOT east/west/south/north).
- hkAnchors MUST include ALL keys even if UNKNOWN. Do NOT omit keys.
- For 小睡房:
  - Always include bed + wardrobe as the core; prioritize space-saving (platform/tatami/Murphy) and sliding doors.
  - Do NOT default to calling it "书房/工作间". Only mention a desk as "可选（如需要）" unless a desk is clearly visible in the photo.
  - Ensure circulation is realistic for HK units; avoid placing bed blocking window access.
- Focus on layout/placement/cabinet feasibility for Hong Kong flats.`;

        const response = await fetch('https://api.stepfun.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'step-1v-8k',
                temperature: 0.15,
                // Slightly larger to allow 2-3 layout options while keeping latency OK
                max_tokens: 520,
                messages: [
                    {
                        role: "system",
                        content: `You are a senior Hong Kong interior designer specialized in cabinetry, storage zoning and buildable circulation.
${spacePrompt}
You MUST output JSON only. No markdown, no extra text.
Key checks you MUST explicitly answer:
- doors_windows: where are door(s)/window(s)/window sill(s)
- columns: any wall columns / protrusions (or say "未见")
- beams_ceiling: any ceiling beams / drops (or say "未见")
Forbidden:
- Do NOT mention electrical panels / switches / sockets (电箱/开关/插座/弱电/水表等). Keep structure and constraints limited to door/window/column/beam only.
Directions:
- Use relative directions only: 左墙/右墙/远端墙/入口侧, and beam direction: 左右向/前后向. Do NOT use 东西南北.
${schema}`
                    },
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Analyze this interior photo for structure, constraints, and 2-3 buildable layout options." },
                            { type: "image_url", image_url: { url: finalImageUrl } }
                        ]
                    }
                ]
            })
        });

        if (!response.ok) {
            throw new Error(`Upstream Error: ${response.status} ${await response.text()}`);
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content || "";

        const safeJsonParse = (raw) => {
            try {
                const clean = String(raw || '').replace(/```json/g, '').replace(/```/g, '').trim();
                const s = clean.indexOf('{');
                const e = clean.lastIndexOf('}');
                if (s >= 0 && e > s) return JSON.parse(clean.slice(s, e + 1));
                return JSON.parse(clean);
            } catch {
                return null;
            }
        };

        const parsed = safeJsonParse(content);

        const normalizeAnchors = (raw) => {
            const pick = (v, allowed) => {
                const s = String(v || '').trim();
                return allowed.includes(s) ? s : 'UNKNOWN';
            };
            const a = raw && typeof raw === 'object' ? raw : {};
            return {
                cameraAngle: pick(a.cameraAngle, ['FRONTAL', 'SLIGHT_45', 'UNKNOWN']),
                cameraDistanceFeel: pick(a.cameraDistanceFeel, ['NEAR', 'MID', 'FAR', 'UNKNOWN']),
                windowWall: pick(a.windowWall, ['FAR_WALL', 'SIDE_WALL', 'NONE', 'UNKNOWN']),
                windowOffset: pick(a.windowOffset, ['CENTER', 'LEFT', 'RIGHT', 'UNKNOWN']),
                daylightDirection: pick(a.daylightDirection, ['LEFT_TO_RIGHT', 'RIGHT_TO_LEFT', 'UNKNOWN']),
                shadowType: pick(a.shadowType, ['HARD_LONG', 'SOFT_SHORT', 'UNKNOWN']),
                finishLevel: pick(a.finishLevel, ['RAW_CONCRETE', 'PUTTY_LINES', 'FINISHED', 'UNKNOWN']),
            };
        };

        const to4LineSummary = (p) => {
            if (!p) return String(content || '').trim();
            const forbid = (s) => {
              const t = String(s || '').trim();
              if (!t) return '';
              const bad = ['电箱', '開關', '开关', '插座', '弱電', '弱电', '水表', '煤氣', '煤气', '插頭', '插头'];
              if (bad.some(k => t.includes(k))) return '';
              return t;
            };
            const doors = String(p.doors_windows || '').trim() || '未见';
            const cols = String(p.columns || '').trim() || '未见';
            const beams = String(p.beams_ceiling || '').trim() || '未见';
            const structure = [`门窗：${doors}`, `立柱：${cols}`, `横梁/天花：${beams}`].filter(Boolean).join('｜');
            const light = String(p.light || '').trim() || '未见';
            const fin = p.finish_level || {};
            const finLevel = String(fin.level || '').trim() || '未见';
            const finEv = String(fin.evidence || '').trim();
            const finish = finEv ? `${finLevel}，${finEv}` : finLevel;
            const constraintsArr = Array.isArray(p.fixed_constraints) ? p.fixed_constraints : [];
            const allowedKeys = ['门', '窗', '窗台', '立柱', '柱', '横梁', '梁', '天花', '降板'];
            const constraints = constraintsArr
              .map(x => forbid(x))
              .filter(Boolean)
              .filter(x => allowedKeys.some(k => x.includes(k)))
              .slice(0, 2)
              .join('；') || '门窗/梁柱不可动';
            return [
                `结构：${structure}。`,
                `光线：${light}。`,
                `完成度：${finish}。`,
                `约束：${constraints}。`
            ].join('\n');
        };

        // Enforce consistent spaceType if provided by user
        const enforcedSpace = normalizeSpaceType(spaceType || parsed?.space_type);
        const baseParsed = parsed || {};
        const hkAnchors = normalizeAnchors(baseParsed.hkAnchors);
        const extraction = {
            ...baseParsed,
            space_type: enforcedSpace,
            hkAnchors,
            // Always lock to 2 standard options for HK standardization
            layout_options: standardLayoutOptions(enforcedSpace, baseParsed),
            recommended_index: 0
        };

        const summary = to4LineSummary(extraction);

        res.status(200).json({
            ok: true,
            vision_summary: summary,
            extraction
        });

    } catch (error) {
        console.error('[Vision API] Error:', error);
        res.status(500).json({
            ok: false,
            errorCode: 'INTERNAL_ERROR',
            message: error.message
        });
    }
}
