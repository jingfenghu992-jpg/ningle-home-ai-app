import fs from 'fs';
import path from 'path';

// --- KEYWORD MATCHING LOGIC ---

// Normalize text: lowercase, remove special chars, simplified to traditional check (basic)
function normalizeText(text) {
  return text.toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()？。，！\s]/g, "") // Remove punctuation/spaces
    .replace(/定制/g, "訂造") // Mainland term to HK term normalization
    .replace(/量尺/g, "度尺")
    .replace(/傢俬/g, "傢俬") // Ensure consistency
    .replace(/源頭/g, "源頭");
}

// Business Keywords Pattern
const BUSINESS_KEYWORDS = [
    // 【板材 / 五金】
    "板材", "板料", "夾板", "纖維板", "實木", "e0", "e1", "enf", "甲醛",
    "五金", "鉸鏈", "路軌", "拉手", "阻尼", "緩衝", "五金件", "plywood", "formica", "飾面", "木皮", "烤漆",
    
    // 【報價 / 價錢】
    "價錢", "幾錢", "幾多錢", "幾銀", "報價", "收費", "預算", "折扣", "優惠", "套餐", "price", "cost", "quote", "平定貴", "貴唔貴",
    
    // 【訂造 / 家居】
    "全屋訂造", "全屋定制", "衣櫃", "廚櫃", "書櫃", "鞋櫃", "玄關櫃", "榻榻米", "電視櫃", "傢俬", "家具", "furniture", "cabinet", "地台", "床",
    
    // 【流程 / 服務】
    "度尺", "量尺", "設計", "出圖", "施工", "安裝", "工期", "保養", "售後", "維修", "保修", "design", "install", "流程", "幾耐", "時間",
    
    // 【地點 / 公司】
    "門店", "分店", "展廳", "地址", "工廠", "源頭工廠", "廠房", "源頭", "公司", "location", "factory", "showroom", "shop", "惠州", "香港",
    
    // 【戶型 / 香港常見】
    "公屋", "居屋", "私樓", "新樓", "細單位", "收納", "開則", "nanoflat", "hkhome", "裝修"
];

function isBusinessQuery(text) {
    if (!text) return false;
    const normalized = normalizeText(text);
    return BUSINESS_KEYWORDS.some(kw => normalized.includes(kw));
}

// Read Knowledge Base (Load ALL .md files in knowledge folder)
function getKnowledgeBaseContent() {
    try {
        const kbDir = path.join(process.cwd(), 'knowledge');
        if (!fs.existsSync(kbDir)) {
            console.warn("Knowledge directory not found.");
            return "";
        }

        const files = fs.readdirSync(kbDir).filter(file => file.endsWith('.md'));
        if (files.length === 0) return "";

        let allContent = "";
        files.forEach(file => {
            const filePath = path.join(kbDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            allContent += `\n\n--- [FILE: ${file}] ---\n${content}`;
        });
        return allContent;
    } catch (error) {
        console.error("Error reading KB files:", error);
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
    
    // Determine if we should enforce strict KB logic
    // Even in 'design' mode, if the user asks a specific business question (e.g. "how much is this?"), 
    // we should prioritize the KB answer over generic design chatter.
    const isBiz = isBusinessQuery(userText);
    
    // Always load KB content for context, but enforce strictness if isBiz is true
    const kbContent = getKnowledgeBaseContent();

    // --- INLINED PROMPTS ---
    
    const CONSULTANT_PERSONA = `你係「寧樂家居」嘅資深全屋訂造設計顧問。
語氣：地道香港廣東話（用「係」、「嘅」、「唔」、「好的」等），貼心、自然、專業，好似真人同客傾計。
嚴禁事項：
1. **絕對唔可以** 出現「AI」、「人工智能」、「模型」、「數據庫」、「知識庫」、「API」、「系統」等技術字眼。
2. **絕對唔可以** 講粗口或攻擊性語言。如果客人講粗口，你要禮貌降温，帶返去服務正題。
3. **絕對唔可以** 亂作資料。`;

    // Strict Business Logic (when keywords matched)
    const BUSINESS_LOGIC_INSTRUCTIONS = `【重要任務：解答業務查詢】
客人問緊關於產品、價錢、流程或公司嘅問題。你必須**完全基於**以下公司內部資料回答：

====================
${kbContent}
====================

回答規則：
1. **只引用上述資料**：唔好用你嘅通用常識去答（例如唔好亂報出面嘅市價，只報我哋嘅價）。
2. **語氣自然**：用「我哋一般會...」、「根據我哋做法...」、「通常香港做法係...」來包裝資料，**唔好**講「根據文件」、「資料顯示」。
3. **資料不足時**：如果你搵唔到答案，要老實同禮貌講：「呢方面我要再同工廠/師傅確認下，不過通常...（只講已知事實）」，或者問客攞更多資料。
4. **推銷與引導**：解答完問題後，可以輕輕帶一句：「你有無圖則或者大約尺寸？我可以幫你預算下。」`;

    // General Design Logic (when no specific business keywords, or explicitly design mode)
    const DESIGN_LOGIC_INSTRUCTIONS = `【重要任務：設計諮詢】
客人想傾設計風格、空間規劃。
原則：
1. **極速回覆，短版優先**：首句即答重點，列點清晰（最多 3 點），字數控制喺 120 字內。
2. **結構鎖 (Structure Lock)**：如涉及出圖，絕不改動原圖結構。
3. **專業建議**：畀出具體、可行嘅建議（配色、收納佈局）。`;

    let systemPrompt = "";
    let appliedPromptName = "";

    if (isBiz) {
        systemPrompt = `${CONSULTANT_PERSONA}\n\n${BUSINESS_LOGIC_INSTRUCTIONS}`;
        appliedPromptName = "HK_CONSULTANT_BIZ_STRICT";
    } else if (mode === 'design') {
        systemPrompt = `${CONSULTANT_PERSONA}\n\n${DESIGN_LOGIC_INSTRUCTIONS}\n\n(你是智能設計師，專注視覺效果同結構鎖定)`;
        appliedPromptName = "HK_DESIGN";
    } else {
        // Default Consultant Mode (Non-Biz)
        systemPrompt = `${CONSULTANT_PERSONA}\n\n${DESIGN_LOGIC_INSTRUCTIONS}`;
        appliedPromptName = "HK_CONSULTANT_GENERAL";
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
        max_tokens: 450,
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
    console.error("API Error:", error);
    res.status(500).json({ 
        error: 'Internal Server Error', 
        message: error.message 
    });
  }
}
