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

export const generateHandler = async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end('Method Not Allowed')
    return
  }

  const body = await readBody(req)
  const { prompt } = body

  if (!prompt) {
    res.statusCode = 400
    res.end(JSON.stringify({ ok: false, message: 'Missing prompt' }))
    return
  }

  // Mock Generation
  // In a real app, this would call OpenAI/Midjourney
  // Here we return a placeholder base64 image (1x1 pixel)
  const b64_json = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  
  res.setHeader('Content-Type', 'application/json')
  
  // Simulate delay
  await new Promise(r => setTimeout(r, 2000))

  res.end(JSON.stringify({
    ok: true,
    b64_json: b64_json
  }))
}

export default generateHandler;
