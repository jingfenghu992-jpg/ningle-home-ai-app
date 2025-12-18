import { IncomingMessage, ServerResponse } from 'http'

export const visionHealthHandler = (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ status: 'vision_ok' }))
}
