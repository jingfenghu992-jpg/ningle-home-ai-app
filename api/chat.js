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

  // --- INLINED PROMPTS START (Optimized for Speed) ---
  const HK_CONSULTANT_SYSTEM = `你係一位專業室內設計顧問。
語氣：地道香港廣東話，親切、爽快。
原則：**極速回覆，短版優先**。
1. **首句即答**：唔好客套，直接答重點。
2. **列點清晰**：最多 3 點，每點不超過 40 字。
3. **字數限制**：全段回覆控制喺 120 字內。
4. **最後反問**：引導客去下一步。
任務：解答設計疑難，引導風格需求。`;

  const HK_DESIGN_SYSTEM = `你係一位智能設計師。
語氣：地道香港廣東話，專業精準。
原則：**嚴守結構鎖，精簡解釋**。
1. **結構鎖 (Structure Lock)**：絕不改動原圖鏡頭、門窗、樑柱。
2. **Prompt生成**：確保包含 same camera angle, keep windows 等限制。
3. **解釋方案**：只講 3 個重點（佈局、配色、收納）。
4. **字數限制**：解釋部份控制喺 150 字內。`;
  // --- INLINED PROMPTS END ---

  try {
    const { messages, mode } = req.body;

    let systemPrompt = HK_CONSULTANT_SYSTEM;
    let appliedPromptName = "HK_CONSULTANT";
    
    if (mode === 'design') {
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
        max_tokens: 350, // Limit output token for speed
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
            appliedPrompt: appliedPromptName
        }
    });

  } catch (error) {
    res.status(500).json({ 
        error: 'Internal Server Error', 
        message: error.message 
    });
  }
}
