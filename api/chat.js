// Remove static import to prevent load-time errors
// import { shouldUseKnowledge, searchKnowledge } from '../services/kbFromBlob.js';

export default async function handler(req, res) {
  // Debug: Log environment keys to console (visible in Vercel logs or terminal)
  // Mask the values for security, but show the keys to verify existence.
  const envKeys = Object.keys(process.env).sort();
  console.log('[Chat API] Environment Keys Available:', envKeys.join(', '));

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // Attempt to find the key in standard or alternative names
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_KEY;

  if (!apiKey) {
    console.error('[Chat API] Missing DEEPSEEK_API_KEY');
    // Return debug info to client for diagnosis
    res.status(500).json({ 
        error: 'Configuration Error', 
        message: 'Missing DEEPSEEK_API_KEY environment variable.',
        debug: {
            availableEnvKeys: envKeys
        }
    });
    return;
  }

  try {
    const { messages, mode, visionSummary } = req.body;
    const lastUserMessage = messages.slice().reverse().find(m => m.role === 'user');
    const userText = lastUserMessage ? lastUserMessage.content : "";

    // Dynamic import to isolate side effects
    let shouldUseKnowledge, searchKnowledge;
    let kbLoadError = null;

    try {
        const kbModule = await import('../services/kbFromBlob.js');
        shouldUseKnowledge = kbModule.shouldUseKnowledge;
        searchKnowledge = kbModule.searchKnowledge;
    } catch (err) {
        console.error('[Chat API] Failed to load kbFromBlob service:', err);
        kbLoadError = err.message;
    }

    // 1. Force strict mode to always be true (if module loaded)
    const isStrictKB = !!searchKnowledge;
    
    // 2. Load Context from Blob (if strict)
    let contextExcerpt = "";
    let appliedDocName = "None";

    if (isStrictKB) {
        try {
            const { excerpt, sources } = await searchKnowledge(userText);
            contextExcerpt = excerpt;
            if (sources.length > 0) appliedDocName = sources.join(', ');
        } catch (e) {
            console.error("[Chat API] KB Search Failed:", e);
            // Don't crash, just log
        }
    }

    // 3. Construct System Prompt
    
    // Core Persona (Shared)
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

    let systemPrompt = "";

    if (contextExcerpt) {
        systemPrompt = `${CORE_PERSONA}${visionContext}

【重要任務：客戶查詢解答】
**唯一資料來源**：你必須**完全依賴**以下提供的【參考資料】回答，資料入面無嘅就話唔清楚，**嚴禁**自行創作價錢、條款或流程。

====================
${contextExcerpt}
====================

回答規則：
1. **必须引用資料**：所有价钱、参数、流程必须来自上方资料。
2. **资料不足时**：如果上面资料找不到答案（例如客人问某个非常具体的尺寸或非标做法），请老实回答：「关于呢个具体细节，我手头资料暂时未有显示，为免讲错，不如你留个 WhatsApp 或者讲低大约尺寸，我帮你问问工程部同事再覆你？」。
3. **绝对禁止兜底**：不要尝试用“通常做法”来回答涉及价钱或核心业务的问题。
4. **输出结构**：
   - 确认客人问题。
   - 引用资料回答（用 Point form）。
   - 贴心追问。`;
    } else {
        // Case B: Found nothing in KB or KB failed to load
        let fallbackReason = "无法检索到资料";
        if (kbLoadError) fallbackReason += ` (系统错误: ${kbLoadError})`;
        
        systemPrompt = `${CORE_PERSONA}${visionContext}

【重要任务：${fallbackReason}】
客人提出了问题，但系统无法在知识库中找到相关资料。
**严厉警告**：
1. **绝对禁止** 编造任何价钱、套餐内容、具体工艺参数。
2. 你必须诚实地告诉客人：「唔好意思，关于呢个具体问题，我手头个资料库暂时未有相关记录。不如你直接话我知你嘅具体需求（例如大约尺寸、想做咩位置），我可以转介俾更资深嘅同事或者设计师直接联络你？」
3. **可以** 回答非常通用的设计理念（如：浅色显大、镜面增加空间感），但**绝对不能** 涉及公司具体的业务承诺（如交期、保修、具体板材型号）。`;
    }

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
