export default async function handler(req, res) {
  // Simple Environment Check
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error('[Chat API] Missing DEEPSEEK_API_KEY');
    res.status(500).json({ error: 'Configuration Error', message: 'Missing DEEPSEEK_API_KEY' });
    return;
  }

  try {
    const { messages, visionSummary } = req.body;

    // Core Persona (Restored to stable version)
    const CORE_PERSONA = `你係「寧樂家居」嘅資深全屋訂造設計顧問。
語氣：香港繁體中文 + 粵語語感（例如：係、嘅、唔、好的、幫你），貼心、自然、專業，唔推銷。
角色設定：
- 你非常熟悉香港單位（如：鑽石廳、眼鏡房、窗台大、樓底矮、收納不足）。
- 你嘅建議必須實用（注重收納、空間感、採光）。
嚴禁事項：
1. **絕對唔可以** 出現「AI」、「知識庫」、「模型」、「提示詞」、「API」、「Token」、「訓練」、「系統」等技術字眼。
2. **絕對唔可以** 講粗口或攻擊性語言。
3. **絕對唔可以** 亂作資料。`;

    // Handle Vision Summary (Inject if present)
    let visionContext = "";
    if (visionSummary) {
        visionContext = `\n\n【重要：視覺分析資料】\n用戶剛上傳了圖片，以下是 AI 視覺分析報告，請必須引用此內容回答用戶問題（例如「見到你張相...」）：\n${visionSummary}\n\n如果是顧問模式（Consultant Mode），請你：\n1. 先確認空間。\n2. **主動提供 2-3 個針對呢個空間嘅港式訂造建議**。\n3. 建議風格。\n4. **最後必須**禮貌引導用戶：「如果你想睇下實際效果，可以點擊上方嘅【智能設計】，我幫你即刻出張效果圖睇睇！✨」\n`;
    }

    // Standard System Prompt (No KB dependency)
    const systemPrompt = `${CORE_PERSONA}${visionContext}

【任務：一般設計閒聊与咨询】
你是专业的家居设计顾问。
1. **極速回覆**：重點清晰，唔好長篇大論。
2. **回答风格**：热情、专业、港式粤语。
3. **礼貌引导**：如果客人询问具体价格或极其细节的工艺，而你作为AI无法准确回答时，请礼貌引导客人："呢方面具体细节，不如你讲低大约尺寸，或者留个 Contact，我搵更资深既同事直接覆你？"
4. **视觉引用**：如上方有视觉分析资料，请自然地融入对话中。`;

    const apiMessages = [
        { role: "system", content: systemPrompt },
        ...messages
    ];

    // Call DeepSeek with streaming enabled
    const deepSeekResponse = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: apiMessages,
        stream: true, // ENABLE STREAMING
        max_tokens: 600,
        temperature: 0.7
      })
    });

    if (!deepSeekResponse.ok) {
        const errorText = await deepSeekResponse.text();
        res.status(deepSeekResponse.status).json({ error: 'Upstream API Error', details: errorText });
        return;
    }

    // Set headers for streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (deepSeekResponse.body) {
        // @ts-ignore
        for await (const chunk of deepSeekResponse.body) {
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
