/// <reference types="node" />
import { IncomingMessage, ServerResponse } from 'http'

export const kbStatusHandler = (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ status: 'ready', docs_count: 0 }))
}

export default kbStatusHandler;
