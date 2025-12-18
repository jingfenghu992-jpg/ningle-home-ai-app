import fs from 'fs';
import path from 'path';

// --- KEYWORD MATCHING LOGIC ---

// Normalize text: lowercase, remove special chars, simplified to traditional check (basic)
function normalizeText(text) {
  return text.toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()？。，！\s]/g, "") // Remove punctuation/spaces
    .replace(/定制/g, "訂造") // Mainland term to HK term normalization
    .replace(/量尺/g, "度尺");
}

// Business Keywords Pattern
const BUSINESS_KEYWORDS = [
    // 【板材 / 五金】
    "板材", "板料", "夾板", "纖維板", "實木", "e0", "e1", "enf", "甲醛",
    "五金", "鉸鏈", "路軌", "拉手", "阻尼", "緩衝", "五金件", "plywood", "formica",
    
    // 【報價 / 價錢】
    "價錢", "幾錢", "幾多錢", "幾銀", "報價", "收費", "預算", "折扣", "優惠", "套餐", "price", "cost", "quote",
    
    // 【訂造 / 家居】
    "全屋訂造", "全屋定制", "衣櫃", "廚櫃", "書櫃", "鞋櫃", "玄關櫃", "榻榻米", "電視櫃", "傢俬", "家具", "furniture", "cabinet",
    
    // 【流程 / 服務】
    "度尺", "量尺", "設計", "出圖", "施工", "安裝", "工期", "保養", "售後", "維修", "保修", "design", "install",
    
    // 【地點 / 公司】
    "門店", "分店", "展廳", "地址", "工廠", "源頭工廠", "廠房", "源頭", "公司", "location", "factory", "showroom", "shop",
    
    // 【戶型 / 香港常見】
    "公屋", "居屋", "私樓", "新樓", "細單位", "收納", "開則", "nanoflat", "hkhome"
];

function isBusinessQuery(text) {
    if (!text) return false;
    const normalized = normalizeText(text);
    return BUSINESS_KEYWORDS.some(kw => normalized.includes(kw));
}

// Read Knowledge Base
function getKnowledgeBaseContent() {
    try {
        const kbPath = path.join(process.cwd(), 'knowledge', 'kb.md');
        if (fs.existsSync(kbPath)) {
            return fs.readFileSync(kbPath, 'utf8');
        }
    } catch (error) {
        console.error("Error reading KB:", error);
    }
    return "";
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    res.status(500).json({ 
        error: 'Configuration Error', 
        message: 'Missing DEEPSEEK_API_KEY',
        errorCode: 'MISSING_KEY'
    });
    return;
  }

  try {
    const { messages, mode } = req.body;
    
    // Get the latest user message content to check for keywords
    const lastUserMessage = messages.slice().reverse().find(m => m.role === 'user');
    const userText = lastUserMessage ? lastUserMessage.content : "";
    
    const isBiz = isBusinessQuery(userText);
    const kbContent = isBiz ? getKnowledgeBaseContent() : "";

    // --- INLINED PROMPTS ---
    
    // Base instructions for HK Consultant (Business Logic Injection)
    const BASE_CONSULTANT_INSTRUCTIONS = `語氣：地道香港廣東話，親切、爽快。
原則：**極速回覆，短版優先**。
1. **首句即答**：唔好客套，直接答重點。
2. **列點清晰**：最多 3 點，每點不超過 40 字。
3. **字數限制**：全段回覆控制喺 120 字內。
4. **最後反問**：引導客去下一步。`;

    // Strict Business Logic
    const BUSINESS_LOGIC_INSTRUCTIONS = `【重要規則：業務查詢強制使用知識庫】
你現在是「寧樂家居」的專業顧問。用戶正在查詢業務相關問題。
以下是公司內部知識庫 (Knowledge Base)：
====================
${kbContent}
====================

你的回答必須嚴格遵守：
1. **只根據上述知識庫內容回答**，絕對不可使用外部常識或自行編造。
2. 如果知識庫有相關資料：請用香港廣東話整理回答。
3. 如果知識庫 **沒有** 相關資料：你必須直接回覆「我喺知識庫暫時搵唔到相關資料，你可唔可以講多少少（例如...）？」，然後引導客人提供更多資料，**嚴禁亂答**。
4. 嚴禁提及「根據知識庫」、「Knowledge Base」等字眼，要自然地以專家身份回答。
5. 保持香港專業顧問語氣，不卑不亢。`;

    let systemPrompt = `你係一位專業室內設計顧問。
${BASE_CONSULTANT_INSTRUCTIONS}
任務：解答設計疑難，引導風格需求。`;

    let appliedPromptName = "HK_CONSULTANT";

    // Logic: 
    // If Business Query -> Override System Prompt with KB-Strict Prompt
    // If Design Mode -> Use Design Prompt (unless it's a specific business question mixed in, but usually Design Mode is for image generation flow. 
    // Let's assume strict KB applies to Consultant Mode mostly, or if user asks about price in Design Mode).
    // The prompt says "Wherever user input matches keywords...". So even in design mode, if they ask price, we should probably stick to KB. 
    // But Design Mode has specific "Structure Lock" tasks. 
    // Let's prioritize KB if it's a clear business question, otherwise use mode-specifics.
    // For simplicity and safety adhering to "Strict Rules": If isBiz is true, we inject KB instructions.
    
    if (isBiz) {
        systemPrompt = `${BUSINESS_LOGIC_INSTRUCTIONS}
        
(請緊記：你只代表寧樂家居，不可推薦其他品牌或通用資訊，必須基於上述資料回答。)`;
        appliedPromptName = "HK_CONSULTANT_BIZ_STRICT";
    } else if (mode === 'design') {
        const HK_DESIGN_SYSTEM = `你係一位智能設計師。
語氣：地道香港廣東話，專業精準。
原則：**嚴守結構鎖，精簡解釋**。
1. **結構鎖 (Structure Lock)**：絕不改動原圖鏡頭、門窗、樑柱。
2. **Prompt生成**：確保包含 same camera angle, keep windows 等限制。
3. **解釋方案**：只講 3 個重點（佈局、配色、收納）。
4. **字數限制**：解釋部份控制喺 150 字內。`;
        systemPrompt = HK_DESIGN_SYSTEM;
        appliedPromptName = "HK_DESIGN";
    }

    const apiMessages = [
        { role: "system", content: systemPrompt },
        ...messages
    ];

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
        max_tokens: 450, // Slightly increased for KB answers
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      res.status(response.status).json({ 
          error: 'Upstream API Error', 
          details: errorText
      });
      return;
    }

    const data = await response.json();
    const reply = data.choices[0]?.message?.content || "";
    
    res.status(200).json({
        ok: true,
        content: reply,
        debug: {
            usedKey: "DEEPSEEK_API_KEY",
            appliedPrompt: appliedPromptName,
            isBusinessQuery: isBiz
        }
    });

  } catch (error) {
    res.status(500).json({ 
        error: 'Internal Server Error', 
        message: error.message 
    });
  }
}
