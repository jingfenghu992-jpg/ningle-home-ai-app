import { HK_CONSULTANT_SYSTEM, HK_DESIGN_SYSTEM } from './prompts/hk.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    console.error('Missing DEEPSEEK_API_KEY');
    res.status(500).json({ 
        error: 'Configuration Error', 
        message: 'Missing DEEPSEEK_API_KEY on server',
        errorCode: 'MISSING_KEY'
    });
    return;
  }

  try {
    const { messages, mode } = req.body;

    // Select System Prompt based on mode
    let systemPrompt = HK_CONSULTANT_SYSTEM;
    let appliedPromptName = "HK_CONSULTANT";
    
    if (mode === 'design') {
        systemPrompt = HK_DESIGN_SYSTEM;
        appliedPromptName = "HK_DESIGN";
    }

    console.log(`[API] Sending request to DeepSeek (Mode: ${mode})...`);

    // Prepare messages: Prepend System Prompt
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
        stream: false // We use full response then stream on frontend
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API] DeepSeek Error:', response.status, errorText);
      res.status(response.status).json({ 
          error: 'Upstream API Error', 
          details: errorText,
          requestId: response.headers.get('x-request-id') 
      });
      return;
    }

    const data = await response.json();
    const reply = data.choices[0]?.message?.content || "";
    
    // Return standard JSON with debug info
    res.status(200).json({
        ok: true,
        content: reply,
        debug: {
            usedKey: "DEEPSEEK_API_KEY",
            appliedPrompt: appliedPromptName,
            requestId: data.id || response.headers.get('x-request-id')
        }
    });

  } catch (error) {
    console.error('[API] Handler Exception:', error);
    res.status(500).json({ 
        error: 'Internal Server Error', 
        message: error.message 
    });
  }
}
