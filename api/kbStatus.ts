import { IncomingMessage, ServerResponse } from 'http';
import { sendJson } from './_utils';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  sendJson(res, { 
      status: 'ready', 
      docs_count: 0,
      envOk: true 
  });
}
