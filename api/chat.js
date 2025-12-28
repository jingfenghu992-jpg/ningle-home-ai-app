// Dynamic import handling is now inside the handler to prevent cold start crashes
// but we keep the file structure clean.

export default async function handler(req, res) {
  // Simple Environment Check
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // Unified Key: STEPFUN_API_KEY
  const apiKey = process.env.STEPFUN_API_KEY;

  if (!apiKey) {
    console.error('[Chat API] Missing STEPFUN_API_KEY');
    res.status(500).json({ error: 'Configuration Error', message: 'Missing STEPFUN_API_KEY' });
    return;
  }

  try {
    const { messages, visionSummary, spaceType } = req.body;
    
    // Core Persona (HK "effect render" assistant only; no KB)
    const WHATSAPP_NUMBER = "85256273817";
    const CORE_PERSONA = `你是「寧樂家居」的香港室内效果图顾问，专注做一件事：把用户上传的现场照片快速生成“对位、不变形”的效果图，并收集“可转成渲染参数”的改图信息。
语气：简体中文为主，少量粤语语气词（如：唔、系、嘅），亲切专业，不硬推销。

【硬性规则（必须遵守）】
1) 禁止自称 AI/模型/系统；只用“我/顾问/团队”。
2) 只讨论：效果图、改图需求（布置A/B、收纳、床/衣柜/书桌、灯光层次/色温、软装、风格色调、对位：窗位/门位/透视/镜头）。
3) 严禁回答：板材/五金/品牌/价钱/报价/工厂/门店/施工细节/交期/付款等。用户问到一律礼貌引导 WhatsApp：+852 56273817（wa.me/${WHATSAPP_NUMBER}）。
4) 每次回复尽量短：先总结用户要改的 1 句，然后最多追问 1–2 个关键问题（问题必须可直接转成：spaceType/layoutChoice/style/goal/intensity/revisionText）。
5) 不使用知识库；不引用任何“公司资料”。`;

    // Vision Context
    let visionContext = "";
    if (visionSummary) {
        visionContext = `\n\n【用户上传现场照片智能分析】\n`;
        if (spaceType) visionContext += `空间类型：${spaceType}\n`;
        visionContext += `以下是结构/门窗/光线摘要（仅用于“对位改图”）：\n${visionSummary}\n`;
    }

    // Final System Prompt
    const systemPrompt = `${CORE_PERSONA}${visionContext}`;

    const apiMessages = [
        { role: "system", content: systemPrompt },
        ...messages
    ];

    // Use StepFun Chat API
    const stepFunResponse = await fetch('https://api.stepfun.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'step-1-8k', 
        messages: apiMessages,
        stream: true, 
        max_tokens: 500,
        temperature: 0.5
      })
    });

    if (!stepFunResponse.ok) {
        const errorText = await stepFunResponse.text();
        console.error('[Chat API] Upstream Error:', stepFunResponse.status, errorText);
        res.status(stepFunResponse.status).json({ error: 'Upstream API Error', details: errorText });
        return;
    }

    // Set headers for streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (stepFunResponse.body) {
        // @ts-ignore
        for await (const chunk of stepFunResponse.body) {
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
