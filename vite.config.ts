import { defineConfig, Plugin, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import healthHandler from './api/health'
import chatHandler from './api/chat'
import visionHandler from './api/vision'
import generateHandler from './api/generate'
import designGenerateHandler from './api/design/generate'
import designQaHandler from './api/design/qa'
import kbStatusHandler from './api/kbStatus'
import visionHealthHandler from './api/vision-health'
import envCheckHandler from './api/env-check'
import { IncomingMessage, ServerResponse } from 'http'

const apiMockPlugin = (): Plugin => ({
  name: 'local-api-mock',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url || !req.url.startsWith('/api/')) return next()

      const url = new URL(req.url, 'http://localhost')
      const pathname = url.pathname

      // Router dispatch
      if (pathname === '/api/health') return healthHandler(req, res)
      if (pathname === '/api/vision-health') return visionHealthHandler(req, res)
      if (pathname === '/api/chat') return chatHandler(req, res)
      if (pathname === '/api/vision') return visionHandler(req, res)
      if (pathname === '/api/generate') return generateHandler(req, res)
      if (pathname === '/api/design/generate') return designGenerateHandler(req, res)
      if (pathname === '/api/design/qa') return designQaHandler(req, res)
      if (pathname === '/api/kb-status') return kbStatusHandler(req, res)
      if (pathname === '/api/env-check') return envCheckHandler(req, res)

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
