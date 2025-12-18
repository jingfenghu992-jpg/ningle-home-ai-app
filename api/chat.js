import { shouldUseKnowledge, searchKnowledge } from '../services/kbFromBlob.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Configuration Error', message: 'Missing DEEPSEEK_API_KEY' });
    return;
  }

  try {
    const { messages, mode } = req.body;
    const lastUserMessage = messages.slice().reverse().find(m => m.role === 'user');
    const userText = lastUserMessage ? lastUserMessage.content : "";

    // 1. Determine "Strict Mode" (Business Keywords)
    const isStrictKB = shouldUseKnowledge(userText);
    
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
            // Fallback: Continue without strict context, or add a generic prompt?
            // We'll let it proceed but maybe add a system note to be generic if KB failed.
        }
    }

    // 3. Construct System Prompt
    
    // Core Persona (Shared)
    const CORE_PERSONA = `你係「寧樂家居」嘅資深全屋訂造設計顧問。
語氣：香港繁體中文 + 粵語語感（例如：係、嘅、唔、好的、幫你），貼心、自然、專業，唔推銷。
嚴禁事項：
1. **絕對唔可以** 出現「AI」、「知識庫」、「模型」、「提示詞」、「API」、「Token」、「訓練」、「系統」等技術字眼。
2. **絕對唔可以** 講粗口或攻擊性語言。
3. **絕對唔可以** 亂作資料。`;

    let systemPrompt = "";

    if (isStrictKB && contextExcerpt) {
        systemPrompt = `${CORE_PERSONA}

【重要任務：業務查詢解答】
客人問緊關鍵業務問題（板材/報價/流程/公司資料等）。你必須**優先參考**以下公司內部資料回答：

====================
${contextExcerpt}
====================

回答規則：
1. **參考資料優先**：如果上面資料有答案，請用粵語整理後回答。
2. **資料不足時**：如果上面資料搵唔到，請禮貌回答「呢方面我需要再確認下一般做法，為免講錯，不如你講多少少（例如...）？」，**嚴禁編造**具體價錢或參數。
3. **輸出結構**：
   - 先用一兩句確認問題。
   - 用 Point form 列出重點（最多 8 點）。
   - 最後加 1-2 個貼心追問（引導客提供尺寸/戶型等）。
4. **語氣包裝**：用「我哋一般」、「通常做法」代替「資料顯示」。`;
    } else if (isStrictKB && !contextExcerpt) {
        // Hit keywords but KB failed or empty
        systemPrompt = `${CORE_PERSONA}

【任務：業務查詢（資料暫缺）】
客人問緊業務問題，但暫時未能讀取詳細資料。
請憑藉你作為「資深設計顧問」嘅一般專業知識回答（例如通用板材知識、一般流程），但：
- **唔好**報具體價錢。
- **唔好**承諾具體交期。
- 強調「如果你有圖則或者具體要求，我可以幫你再準確啲分析」。`;
    } else {
        // General Design Chat
        systemPrompt = `${CORE_PERSONA}

【任務：一般設計閒聊】
解答設計風格、空間感問題。
原則：
1. **極速回覆**：重點清晰，唔好長篇大論。
2. **結構鎖**：如涉及出圖，絕不改動原圖結構。
3. **禮貌引導**：適時引導客人講出具體需求（例如戶型、預算）。`;
    }

    const apiMessages = [
        { role: "system", content: systemPrompt },
        ...messages
    ];

    // Call DeepSeek
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: apiMessages,
        stream: false,
        max_tokens: 600, // Slightly more for detailed answers
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      res.status(response.status).json({ error: 'Upstream API Error', details: errorText });
      return;
    }

    const data = await response.json();
    const reply = data.choices[0]?.message?.content || "";
    
    res.status(200).json({
        ok: true,
        content: reply,
        debug: {
            usedKey: "DEEPSEEK_API_KEY",
            mode: isStrictKB ? "STRICT_KB" : "GENERAL",
            appliedDoc: appliedDocName
        }
    });

  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
