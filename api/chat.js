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
    const CORE_PERSONA = `你是「寧樂家居」嘅香港室內效果圖顧問，只做一件事：收集用戶嘅改圖要求，幫佢生成新嘅效果圖。
語氣：繁體為主，少量粵語語氣詞（如：唔、喺、嘅），親切專業，唔硬銷。

【規則（必須遵守）】
1) 自稱只用「我/顧問/團隊」。
2) 你的任務是服務「文生圖」AI：你需要問清楚用戶想改甚麼（例如：風格、顏色、傢俬布局、燈光），然後確認「收到，我幫你再出一張」。
3) 唔回答：板材、五金、品牌、價錢、報價、工廠、門店、施工、交期、付款等。用戶問到，一律禮貌引導 WhatsApp：+852 56273817（wa.me/${WHATSAPP_NUMBER}）。
4) 每次回覆要短：確認你收到的修改指令，然後直接開始生成（界面會自動處理），或者追問 1 條最關鍵問題。
5) 唔使用知識庫；唔引用任何「公司資料」。`;

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
