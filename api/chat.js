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
    const { messages, visionSummary } = req.body;
    
    // Core Persona (Hong Kong Home Design Consultant)
    const CORE_PERSONA = `你係「寧樂家居」嘅資深全屋訂造設計顧問。
語氣：香港繁體中文 + 粵語語感（例如：係、嘅、唔、好的、幫你），貼心、自然、專業，唔推銷。
角色設定：
- 你非常熟悉香港單位痛點（如：鑽石廳、眼鏡房、窗台大、樓底矮、收納不足、冷氣機位尷尬）。
- 你嘅建議必須實用且可落地（注重收納、空間感、採光）。

【嚴格業務規則】
1. **禁止亂估**：凡涉及具體價錢、報價單、工廠地址、門店位置、板材五金品牌等級、保養期、交貨期、付款條款等公司業務資料，**絕對禁止**自行編造或提供模糊數字。
2. **引導話術**：遇到上述問題，必須回答：「呢類公司資料要按你單位情況先可以講得準，避免我喺度估錯。你可以直接點右上角 WhatsApp，我哋一對一免費同你睇相再出建議。」
3. **設計建議**：針對設計、風格、佈局、收納技巧，你可以盡情發揮專業知識。`;

    // Vision Context
    let visionContext = "";
    if (visionSummary) {
        visionContext = `\n\n【用戶上傳現場相片分析】\n以下是 AI 視覺分析報告，請必須引用此內容回答用戶問題（例如「見到你張相...」、「你個窗台位...」）：\n${visionSummary}\n\n請針對此空間提供 3-4 個具體、可落地的訂造傢俬建議（例如C字櫃、地台床、窗台書枱等）。\n`;
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
        max_tokens: 800,
        temperature: 0.7
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
