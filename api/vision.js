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

        const spacePrompt = spaceType ? `這是一張${spaceType}的照片。` : "";

        const response = await fetch('https://api.stepfun.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'step-1v-8k',
                messages: [
                    {
                        role: "system",
                        content: `你是一位資深香港全屋訂造設計師，專注：櫃體設計、收納分區、動線落地，並且熟悉香港公屋/居屋常見限制（窗台深、樓底矮、冷氣機位尴尬、電箱/水表位、走廊浪費位）。
${spacePrompt}

請用「人正常講嘢」嘅口吻輸出，唔好用 JSON、唔好用引號/大括號、唔好出現欄位名。
重要：必須「對住呢張相講嘢」，每段都要用到畫面可見證據（例如：窗喺正中/左牆有底盒/頂面有梁帶/地面未鋪等）。
如果某個關鍵位睇唔到（例如：門口、冷氣機位、電箱/水表位），請直接寫「未見，唔好亂估」。

請輸出 6 段（每段 1–3 句，句子短，少標點）：
1) 結構（只講睇到嘅）：門窗/窗台/梁柱/頂面狀態/牆身凸位/可見底盒（請帶方位：左牆/右牆/窗下/靠鏡頭/遠端）
2) 光線：自然光由邊度入（窗方向）＋整體偏冷/偏暖
3) 完成度：毛坯/半裝/已裝（只能三選一，並且要用畫面證據支持；睇唔清就寫你最保守嘅判斷）
4) 布置（必須落地，唔好空泛）：按相片可見結構提出家具/设备摆位＋动线
   - 卧室：必须讲清楚「床」摆放位置（靠哪面墙/是否靠窗/床头方向）＋「到顶衣柜」位置；如果相片见到窗/门冲突要写明如何避开
   - 客厅：必须讲清楚「电视墙/电视柜」位置＋「沙发」朝向与位置＋通道
   - 餐厅：必须讲清楚「4人餐桌」位置＋吊灯中心对位＋餐边柜/高柜位置
   - 厨房：必须讲清楚「水槽/炉头/雪柜」动线（不改原位）＋吊柜/地柜到顶策略
   - 卫生间：必须讲清楚「干湿分区/淋浴屏」＋浴室柜＋镜柜位置（不乱改排水位）
   - 玄关/走廊：必须讲清楚「鞋柜/换鞋凳/全身镜」或「走廊浅柜」位置＋保留净通道宽度
5) 櫃體方案 A（要具體：位置＋高度範圍〔到頂/半高/矮櫃〕＋開門方式〔趟門/平開/掩門〕＋分區）
6) 櫃體方案 B（同上，提供另一個可行擺位/組合）

補充限制：可以講「天花/燈光/牆地面完成面方向」去支持出效果圖質感；但不要講擺花等裝飾品清單。`
                    },
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "請分析這張室內圖片。" },
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
        
        // If model still returns JSON, try to extract and humanize it.
        const tryParseJson = (raw) => {
            try {
                const clean = String(raw || '').replace(/```json/g, '').replace(/```/g, '').trim();
                // Robust extraction between first { and last }
                const s = clean.indexOf('{');
                const e = clean.lastIndexOf('}');
                if (s >= 0 && e > s) {
                    return JSON.parse(clean.slice(s, e + 1));
                }
            } catch {}
            return null;
        };

        const parsed = tryParseJson(content);
        const humanize = (p) => {
            const structure = String(p?.structure || '').trim();
            const lighting = String(p?.lighting || '').trim();
            const suggestions = Array.isArray(p?.suggestions) ? p.suggestions : [];
            const s1 = suggestions[0] ? String(suggestions[0]).trim() : '';
            const s2 = suggestions[1] ? String(suggestions[1]).trim() : '';
            const lines = [
                structure ? `結構：${structure}` : '',
                lighting ? `光線：${lighting}` : '',
                s1 ? `建議：${s1}` : '',
                s2 ? `建議：${s2}` : ''
            ].filter(Boolean);
            return lines.join('\n');
        };

        const summary = parsed ? humanize(parsed) : String(content || '').trim();

        res.status(200).json({
            ok: true,
            vision_summary: summary,
            extraction: parsed
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
