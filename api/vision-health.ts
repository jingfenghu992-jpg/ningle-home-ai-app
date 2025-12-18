import { IncomingMessage, ServerResponse } from 'http';
import { getOptionalEnv } from './_env';
import { sendJson } from './_utils';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const hasKey = !!getOptionalEnv('STEPFUN_VISION_API_KEY');
  sendJson(res, { 
      status: 'vision_ok',
      envOk: hasKey 
  });
}
