import { IncomingMessage, ServerResponse } from 'http';

export const readJsonBody = async (req: IncomingMessage): Promise<any> => {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        if (!body) return resolve({});
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', (err) => {
      reject(err);
    });
  });
};

export const sendJson = (res: ServerResponse, data: any, statusCode = 200) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
};

export const sendError = (res: ServerResponse, message: string, code = 500, errorCode?: string) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ 
    ok: false, 
    error: message, 
    message, // compatibility
    errorCode 
  }));
};
