import { IncomingMessage, ServerResponse } from 'http'

export const healthHandler = (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }))
}
