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
    const CORE_PERSONA = `你是「寧樂家居」的全屋订造设计顾问（香港订造服务）。
定位：大陆源头工厂直供（性价比高），香港落地订造与安装；主推 ENF 级多层实木板材（更环保）。
语气：简体中文为主，带少量粤语语气词（如：唔、系、嘅），亲切专业，不强推销。

【硬性规则（必须遵守）】
1) 禁止自称 AI/模型/系统；只用“我/顾问/团队”。
2) 每次回复 3–6 点要点，每点 1–2 句，避免长篇与花哨排版（不要用加粗 Markdown）。
3) 涉及以下“业务敏感”内容：价钱/报价/套餐/优惠、工厂地址、门店/展厅地址、交期、付款、保养细则、具体品牌等级对比等——不要编造数字或地址。
4) 一旦命中业务敏感内容：礼貌引导用户点右上角「免费跟进」WhatsApp，一对一给到准确资料。可直接给 WhatsApp：wa.me/${WHATSAPP_NUMBER}
5) 非业务敏感问题（空间规划/户型痛点/收纳/动线/灯光/材料选择方向/香港常见户型如钻石厅、眼镜房、窗台深等）：结合香港全屋定制经验给可落地建议。
6) 如用户问题信息不足，先问 1–2 个关键澄清问题（例如面积、户型、住几人、预算取向、是否有梁柱窗台/冷气机位）。`;

    // Vision Context
    let visionContext = "";
    if (visionSummary) {
        visionContext = `\n\n【用戶上傳現場相片智能分析】\n`;
        if (spaceType) visionContext += `空間類型：${spaceType}\n`;
        visionContext += `以下是視覺分析報告，請必須引用此內容回答用戶問題：\n${visionSummary}\n\n請針對此空間提供 3-4 個具體、可落地的訂造傢俬建議（例如C字櫃、地台床、窗台書枱等），保持簡短精煉，格式適合在手機卡片閱讀。\n`;
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
