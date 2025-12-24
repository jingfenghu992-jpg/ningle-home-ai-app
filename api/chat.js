// Dynamic import handling is now inside the handler to prevent cold start crashes
// but we keep the file structure clean.

export default async function handler(req, res) {
  // Simple Environment Check
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // Fallback to StepFun keys if DEEPSEEK_API_KEY is missing
  const apiKey = 
    process.env.DEEPSEEK_API_KEY || 
    process.env.STEPFUN_IMAGE_API_KEY || 
    process.env.STEPFUN_VISION_API_KEY || 
    process.env.STEPFUN_VISION_API_KEY_2;

  if (!apiKey) {
    console.error('[Chat API] Missing API Key');
    res.status(500).json({ error: 'Configuration Error', message: 'Missing StepFun API key' });
    return;
  }

  try {
    const { messages, visionSummary } = req.body;
    const lastUserMessage = messages.slice().reverse().find(m => m.role === 'user');
    const userText = lastUserMessage ? lastUserMessage.content : "";

    // 1. RAG Retrieval (Dynamic Import to be safe)
    let contextExcerpt = "";
    let appliedDocName = "None";
    let isStrictKB = false;

    // Only attempt to load KB if BLOB_READ_WRITE_TOKEN is present (to avoid crashes)
    if (process.env.BLOB_READ_WRITE_TOKEN) {
        try {
            const { searchKnowledge, shouldUseKnowledge } = await import('../services/kbFromBlob.js');
            
            // Check if query triggers KB search
            isStrictKB = shouldUseKnowledge(userText); // This function currently returns true always
            
            if (isStrictKB) {
                const { excerpt, sources } = await searchKnowledge(userText);
                contextExcerpt = excerpt;
                if (sources && sources.length > 0) appliedDocName = sources.join(', ');
                if (contextExcerpt) {
                    console.log(`[Chat API] RAG Hit: ${appliedDocName}`);
                }
            }
        } catch (e) {
            console.error("[Chat API] KB Search Failed (Safe Fallback):", e);
            // Continue without KB context
        }
    } else {
        console.warn("[Chat API] Skipping KB: No BLOB_READ_WRITE_TOKEN found.");
    }

    // 2. Construct System Prompt
    
    // Core Persona
    const CORE_PERSONA = `你係「寧樂家居」嘅資深全屋訂造設計顧問。
語氣：香港繁體中文 + 粵語語感（例如：係、嘅、唔、好的、幫你），貼心、自然、專業，唔推銷。
角色設定：
- 你非常熟悉香港單位（如：鑽石廳、眼鏡房、窗台大、樓底矮、收納不足）。
- 你嘅建議必須實用（注重收納、空間感、採光）。
嚴禁事項：
1. **絕對唔可以** 出現「AI」、「知識庫」、「模型」、「提示詞」、「API」、「Token」、「訓練」、「系統」等技術字眼。
2. **絕對唔可以** 講粗口或攻擊性語言。
3. **絕對唔可以** 亂作資料。`;

    // Vision Context
    let visionContext = "";
    if (visionSummary) {
        visionContext = `\n\n【重要：視覺分析資料】\n用戶剛上傳了圖片，以下是 AI 視覺分析報告，請必須引用此內容回答用戶問題（例如「見到你張相...」）：\n${visionSummary}\n\n如果是顧問模式（Consultant Mode），請你：\n1. 先確認空間。\n2. **主動提供 2-3 個針對呢個空間嘅港式訂造建議**。\n3. 建議風格。\n4. **最後必須**禮貌引導用戶：「如果你想睇下實際效果，可以點擊上方嘅【智能設計】，我幫你即刻出張效果圖睇睇！✨」\n`;
    }

    // RAG Context & Strict Rules
    let kbContext = "";
    if (contextExcerpt) {
        kbContext = `\n\n【公司內部資料庫 (RAG Context)】\n以下是檢索到的相關公司資料（價單/工廠/流程/物料）：\n====================\n${contextExcerpt}\n====================\n\n【回答規則 - 嚴格執行】\n1. **優先引用資料**：回答涉及價錢、物料、工廠地址、門店位置、製作流程時，**必須**優先參考上述資料。\n2. **禁止亂估**：如果上述資料中找不到具體數值（例如某個尺寸的價錢、具體地址），**必須**回答：「呢方面具體資料我手頭暫時未有顯示，為免報錯價/地址，不如你留個 Contact 或者 WhatsApp，我搵專人覆你？」，**嚴禁**自行編造數值或地址。\n3. **語氣包裝**：用「根據我哋標準做法」、「目前資料顯示」代替「文檔說」。`;
    } else {
        // No context found
        kbContext = `\n\n【回答規則 - 嚴格執行】\n1. **一般設計建議**：可以自由發揮專業設計知識。\n2. **業務敏感問題**：如果被問及具體價錢、工廠詳細地址、門店位置，而你沒有上述資料庫支持，**絕對禁止**編造。請回答：「具體價單/地址細節我需要再確認一下，不如你點擊右上角 WhatsApp 聯絡我哋同事直接攞最新資料？」`;
    }

    // Final System Prompt
    const systemPrompt = `${CORE_PERSONA}${visionContext}${kbContext}`;

    const apiMessages = [
        { role: "system", content: systemPrompt },
        ...messages
    ];

    // Use StepFun Chat API
    const deepSeekResponse = await fetch('https://api.stepfun.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'step-1-8k', 
        messages: apiMessages,
        stream: true, 
        max_tokens: 600,
        temperature: 0.7
      })
    });

    if (!deepSeekResponse.ok) {
        const errorText = await deepSeekResponse.text();
        console.error('[Chat API] Upstream Error:', deepSeekResponse.status, errorText);
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
