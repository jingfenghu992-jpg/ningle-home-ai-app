// Dynamic import handling is now inside the handler to prevent cold start crashes
// but we keep the file structure clean.

export default async function handler(req, res) {
  // Simple Environment Check
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // Unified Key: STEPFUN_API_KEY
  const apiKey = process.env.STEPFUN_API_KEY;

  if (!apiKey) {
    console.error('[Chat API] Missing STEPFUN_API_KEY');
    res.status(500).json({ error: 'Configuration Error', message: 'Missing STEPFUN_API_KEY' });
    return;
  }

  try {
    const { messages, visionSummary, spaceType } = req.body;
    
    // Core Persona (Mainland factory + HK customization)
    const WHATSAPP_NUMBER = "85256273817";
    const CORE_PERSONA = `你是「寧樂家居」的资深全屋订造设计顾问（香港订造服务），从业 10+ 年，擅长把香港户型痛点转成可落地的柜体方案。
定位：大陆源头工厂直供（性价比高），香港落地订造与安装；主推 ENF 级多层实木板材（更环保）。
语气：简体中文为主，少量粤语语气词（如：唔、系、嘅），亲切专业，不硬推销。

【硬性规则（必须遵守）】
1) 禁止自称 AI/模型/系统；只用“我/顾问/团队”。
2) 回复要像“老练设计师”：先抓住关键约束（门窗/梁柱/窗台/冷气位/动线），再给柜体方案；不要泛泛而谈。
3) 每次回复 3–6 点要点，每点 1–2 句；若信息不足，只追问 1–2 个关键问题（例如：单位面积/住几人/预算取向/是否要留餐桌或书桌位）。
4) 输出优先级：柜体布局与收纳分区（位置+高度范围+开门方式）> 动线与尺寸要点 > 灯光/材料方向。
5) 涉及“业务敏感”内容：价钱/报价/套餐/优惠、工厂地址、门店/展厅地址、交期、付款、保养细则等——不要编造；统一礼貌引导点右上角「免费跟进」WhatsApp（wa.me/${WHATSAPP_NUMBER}）。
6) 香港语境：熟悉钻石厅、眼镜房、窗台深、冷气机位尴尬、楼底矮、走廊浪费位等常见问题，并给对应柜体解法（例如：到顶高柜、餐边高柜、电器高柜、窗台书枱柜、玄关一体柜）。`;

    // Vision Context
    let visionContext = "";
    if (visionSummary) {
        visionContext = `\n\n【用戶上傳現場相片智能分析】\n`;
        if (spaceType) visionContext += `空間類型：${spaceType}\n`;
        visionContext += `以下是視覺分析報告，請必須引用此內容回答用戶問題：\n${visionSummary}\n\n請只圍繞「櫃體/收納」給 3–5 點可落地建議（位置+高度範圍+開門方式/分區），其餘裝修話題點到即止。\n`;
    }

    // Final System Prompt
    const systemPrompt = `${CORE_PERSONA}${visionContext}`;

    const apiMessages = [
        { role: "system", content: systemPrompt },
        ...messages
    ];

    // Use StepFun Chat API
    const stepFunResponse = await fetch('https://api.stepfun.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'step-1-8k', 
        messages: apiMessages,
        stream: true, 
        max_tokens: 500,
        temperature: 0.5
      })
    });

    if (!stepFunResponse.ok) {
        const errorText = await stepFunResponse.text();
        console.error('[Chat API] Upstream Error:', stepFunResponse.status, errorText);
        res.status(stepFunResponse.status).json({ error: 'Upstream API Error', details: errorText });
        return;
    }

    // Set headers for streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (stepFunResponse.body) {
        // @ts-ignore
        for await (const chunk of stepFunResponse.body) {
            res.write(chunk);
        }
    }
    
    res.end();
  } catch (error) {
    console.error("API Error:", error);
    if (!res.headersSent) {
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    } else {
        res.end();
    }
  }
}
