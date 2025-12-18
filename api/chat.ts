import { IncomingMessage, ServerResponse } from 'http'

const readBody = (req: IncomingMessage): Promise<any> => {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch (e) {
        resolve({})
      }
    })
    req.on('error', reject)
  })
}

function buildDesignSystemPrompt() {
    return `You are a professional Interior Design Assistant.
Your goal is to generate a FINAL_IMAGE_PROMPT block based on the user's requirements and the structural lock.
Do NOT act as a conversational assistant. Output only the analysis and the prompt block.`
}

function buildConsultantSystemPrompt() {
    return `You are a helpful Home Design Consultant.
Answer the user's questions about interior design, renovation, and materials.
Be professional, friendly, and concise.`
}

export const chatHandler = async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end('Method Not Allowed')
    return
  }

  const body = await readBody(req)
  const { messages, mode } = body

  const systemPrompt = mode === 'design' ? buildDesignSystemPrompt() : buildConsultantSystemPrompt()
  
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const lastMsg = messages[messages.length - 1]?.content || ''
  
  let responseText = ''
  if (mode === 'design') {
      responseText = `Based on your request, I have analyzed the structure.

FINAL_IMAGE_PROMPT:
[PROMPT: realistic interior design, ${lastMsg.substring(0, 50)}..., same camera angle, same window positions, do not change structure, no people, no text]
<<<GENERATE_IMAGE>>>

PROMPT_SELF_CHECK:
The prompt includes key constraints: same camera angle, same window positions, do not change structure.`
  } else {
      responseText = `(Consultant Mode) I understand you are interested in ${lastMsg.substring(0, 20)}. Here is some advice...`
  }

  const chunks = responseText.split(/(?=[ ,.])/)
  
  for (const chunk of chunks) {
      res.write(chunk)
      await new Promise(r => setTimeout(r, 50))
  }
  
  res.end()
}

export default chatHandler;
