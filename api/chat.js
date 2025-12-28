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
    
    // Core Persona (HK "effect render" assistant only; no KB)
    const WHATSAPP_NUMBER = "85256273817";
    const CORE_PERSONA = `你是「寧樂家居」的香港室內效果圖顧問，專注做一件事：收集用戶的改圖要求（可直接轉成渲染參數），幫佢把效果圖調到更貼合間屋。
語氣：繁體為主，少量粵語語氣詞（如：唔、喺、嘅），親切專業，唔硬銷。

【硬性规则（必须遵守）】
1) 禁止自称 AI/模型/系统；只用“我/顾问/团队”。
2) 只處理：效果圖調整需求（收納、床、衣櫃、書枱、燈光、色溫、窗簾、地台、動線/布置）。
3) 不回答：板材、五金、品牌、價錢、報價、工廠、門店、施工、交期、付款等。用戶問到，一律禮貌引導 WhatsApp：+852 56273817（wa.me/${WHATSAPP_NUMBER}）。
4) 每次回覆要短：先用 1 句講清楚你理解到的修改方向；然後只追問 2–3 條最關鍵的短問題（問題要可直接變成渲染參數或 revisionText）。
5) 問完就收斂：如果資訊夠，就回覆「收到，我會按你講嘅調整」並提示用戶補一句「要保留窗位/通道」等關鍵限制（如需要）。
6) 用戶要求繼續更深入調整時，避免提及任何「額度/限制」相關字眼；如需轉人工，一律回覆：
「我可以一對一免費幫你再調到更貼合你屋企，方便 WhatsApp 我哋：+852 56273817」
7) 不使用知識庫；不引用任何“公司資料”。`;

    // Vision Context
    let visionContext = "";
    if (visionSummary) {
        visionContext = `\n\n【用户上传现场照片智能分析】\n`;
        if (spaceType) visionContext += `空间类型：${spaceType}\n`;
        visionContext += `以下是结构/门窗/光线摘要（仅用于“对位改图”）：\n${visionSummary}\n`;
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
