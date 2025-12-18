import { defineConfig, Plugin, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import healthHandler from './api/health'
import chatHandler from './api/chat'
import visionHandler from './api/vision'
import generateHandler from './api/generate'
import kbStatusHandler from './api/kbStatus'
import visionHealthHandler from './api/vision-health'
import { IncomingMessage, ServerResponse } from 'http'

// Adapter to bridge Node.js (req, res) to Web API (Request, Response)
async function adapter(handler: (req: Request) => Promise<Response> | Response, req: IncomingMessage, res: ServerResponse) {
    try {
        // 1. Convert IncomingMessage to Request
        const protocol = (req.headers['x-forwarded-proto'] as string) || 'http';
        const host = req.headers.host || 'localhost';
        const url = new URL(req.url || '/', `${protocol}://${host}`);

        const method = req.method || 'GET';
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
            if (Array.isArray(value)) {
                value.forEach(v => headers.append(key, v));
            } else if (value) {
                headers.append(key, value);
            }
        }

        let body: any = null;
        if (method !== 'GET' && method !== 'HEAD') {
             const buffers = [];
             for await (const chunk of req) {
                 buffers.push(chunk);
             }
             body = Buffer.concat(buffers);
        }

        const request = new Request(url, {
            method,
            headers,
            body: body && body.length > 0 ? body : null
        });

        // 2. Call the handler
        const response = await handler(request);

        // 3. Convert Response to ServerResponse
        res.statusCode = response.status;
        response.headers.forEach((value, key) => {
            res.setHeader(key, value);
        });

        if (response.body) {
            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
            }
        }
        res.end();

    } catch (e) {
        console.error('API Adapter Error:', e);
        if (!res.headersSent) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
    }
}

const apiMockPlugin = (): Plugin => ({
  name: 'local-api-mock',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url || !req.url.startsWith('/api/')) return next()

      const url = new URL(req.url, 'http://localhost')
      const pathname = url.pathname

      // Router dispatch
      if (pathname === '/api/health') return adapter(healthHandler, req, res)
      if (pathname === '/api/vision-health') return adapter(visionHealthHandler, req, res)
      if (pathname === '/api/chat') return adapter(chatHandler, req, res)
      if (pathname === '/api/vision') return adapter(visionHandler, req, res)
      if (pathname === '/api/generate') return adapter(generateHandler, req, res)
      if (pathname === '/api/kb-status') return adapter(kbStatusHandler, req, res)

      // 404 for unknown /api routes
      res.statusCode = 404
      res.end('API Endpoint Not Found')
    })
  },
})

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env)

  return {
    base: '/',
    plugins: [react(), apiMockPlugin()],
    server: {
      open: '/',
    },
    build: {
      outDir: 'dist',
    }
  }
})
