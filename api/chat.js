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
        message: 'Missing DEEPSEEK_API_KEY on server' 
    });
    return;
  }

  try {
    const { messages, mode } = req.body;

    console.log('[API] Sending request to DeepSeek...');

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
            { role: "system", content: "You are a helpful assistant." },
            ...messages
        ],
        stream: false // Disable stream for initial connection test to avoid buffering issues
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API] DeepSeek Error:', response.status, errorText);
      res.status(response.status).json({ 
          error: 'Upstream API Error', 
          details: errorText 
      });
      return;
    }

    const data = await response.json();
    const reply = data.choices[0]?.message?.content || "";
    
    // Mimic stream format for frontend compatibility (fake stream)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    res.write(reply);
    res.end();

  } catch (error) {
    console.error('[API] Handler Exception:', error);
    res.status(500).json({ 
        error: 'Internal Server Error', 
        message: error.message 
    });
  }
}
