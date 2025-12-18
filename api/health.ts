import { IncomingMessage, ServerResponse } from 'http';
import { getOptionalEnv } from './_env';
import { sendJson } from './_utils';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const hasKey = !!getOptionalEnv('DEEPSEEK_API_KEY');
  sendJson(res, { 
      status: 'ok', 
      timestamp: Date.now(),
      envOk: hasKey
  });
}
