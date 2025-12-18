import fs from 'fs';
import path from 'path';

// --- CONFIG ---
const KB_TEXT_DIR = path.join(process.cwd(), 'knowledge_text');

// --- KEYWORD DEFINITIONS ---
const KEYWORDS = {
    MATERIALS: ["板材", "五金", "夾板", "ENF", "E0", "E1", "甲醛", "防潮", "耐磨", "封邊", "飾面", "生態板", "鉸鏈", "路軌", "滑軌", "阻尼", "緩衝", "拉手", "衣通", "層板托", "氣撐", "plywood", "hardware"],
    PRICING: ["價錢", "報價", "預算", "幾錢", "一口價", "套餐", "升級", "加錢", "減錢", "price", "cost", "quote", "平定貴"],
    HOUSING: ["公屋", "居屋", "私樓", "新樓", "細單位", "收納", "開則", "nanoflat", "hkhome", "戶型", "空間", "房"],
    PROCESS: ["全屋訂造", "訂造", "定制", "設計", "量尺", "上門", "安裝", "工期", "流程", "售後", "design", "install", "幾耐", "時間", "保養", "維修"],
    STYLE: ["風格", "配色", "色調", "木紋", "奶油風", "輕奢", "style", "color", "colour"],
    COMPANY: ["工廠", "源頭", "肇慶", "惠州", "地址", "門店", "展廳", "香港", "交付", "公司", "factory", "showroom"]
};

// --- HELPER FUNCTIONS ---

function normalizeText(text) {
    return text.toLowerCase()
        .replace(/[.,/#!$%^&*;:{}=\-_`~()？。，！\s]/g, "")
        .replace(/定制/g, "訂造")
        .replace(/量尺/g, "度尺");
}

function getRelevantDoc(userText) {
    const norm = normalizeText(userText);
    
    // Check keywords and map to document filenames
    // 1. Materials/Hardware -> 板材與五金百科
    if (KEYWORDS.MATERIALS.some(k => norm.includes(k))) return '板材與五金百科（香港全屋訂造版 V4.1）.txt';
    
    // 2. Pricing -> 一口價方案
    if (KEYWORDS.PRICING.some(k => norm.includes(k))) return '寧樂家居_全屋訂造一口價方案_Ningle-HK-Q7-2025.txt';
    
    // 3. Housing -> 戶型大全
    if (KEYWORDS.HOUSING.some(k => norm.includes(k))) return '香港戶型大全（全屋訂造 · 加強專業版 V4.1）.txt';
    
    // 4. Process/Company -> 設計指南 (Company info is merged here in build script)
    if (KEYWORDS.PROCESS.some(k => norm.includes(k)) || KEYWORDS.COMPANY.some(k => norm.includes(k))) return '香港全屋訂造設計指南（加強專業版 V4.1）.txt';
    
    // 5. Style -> 風格與配色
    if (KEYWORDS.STYLE.some(k => norm.includes(k))) return '香港家居風格與配色指南（全屋訂造版 V4.1）.txt';

    return null;
}

function getDocContent(filename) {
    if (!filename) return "";
    try {
        const filePath = path.join(KB_TEXT_DIR, filename);
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, 'utf8');
        }
    } catch (e) {
        console.error("KB Read Error:", e);
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
    res.status(500).json({ error: 'Configuration Error', message: 'Missing DEEPSEEK_API_KEY' });
    return;
  }

  try {
    const { messages, mode } = req.body;
    const lastUserMessage = messages.slice().reverse().find(m => m.role === 'user');
    const userText = lastUserMessage ? lastUserMessage.content : "";

    // 1. Determine "Strict Mode"
    const targetDoc = getRelevantDoc(userText);
    const isStrictKB = !!targetDoc;
    
    // 2. Load Context
    const contextContent = getDocContent(targetDoc);

    // 3. Construct System Prompt
    let systemPrompt = "";
    
    // Core Persona (Shared)
    const CORE_PERSONA = `你係「寧樂家居」嘅資深全屋訂造設計顧問。
語氣：地道香港廣東話（用「係」、「嘅」、「唔」、「好的」等），貼心、自然、專業，唔硬銷。
嚴禁事項：
1. **絕對唔可以** 出現「AI」、「知識庫」、「模型」、「訓練」、「提示詞」、「OpenAI」、「DeepSeek」等字眼。
2. **絕對唔可以** 講粗口或攻擊性語言。如果客人講粗口，你要禮貌降温。
3. **絕對唔可以** 亂作資料。`;

    if (isStrictKB) {
        systemPrompt = `${CORE_PERSONA}

【重要任務：業務查詢 (STRICT_KB_MODE)】
客人問緊關鍵業務問題。你必須**完全基於**以下公司文件回答，不可自由發揮：

====================
【參考文件：${targetDoc?.replace('.txt', '')}】
${contextContent.substring(0, 3000)} ... (截取部分)
====================

回答規則：
1. **唯一依據**：只用上面文件資料答。如果文件無講，就話「呢方面我要再確認下，為免講錯，不如你講多少少...」，**嚴禁編造**價錢或工藝參數。
2. **輸出結構**：
   - 第1句：簡短確認（例如「關於夾板防潮，係咁嘅...」）。
   - 第2部分：列出 3-6 個重點（Point form，清晰易讀）。
   - 第3句：一個反問確認（例如「你大約想做邊個位？」），最多問一條。
3. **語氣包裝**：用「我哋通常」、「標準做法係」代替「文件顯示」。`;
    } else {
        // General Design Chat (Non-Strict, but still persona-bound)
        systemPrompt = `${CORE_PERSONA}

【任務：一般設計閒聊】
解答設計風格、空間感問題。
原則：
1. **極速回覆**：首句即答重點，列點清晰。
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
        max_tokens: 450,
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
            appliedDoc: targetDoc || "None"
        }
    });

  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
