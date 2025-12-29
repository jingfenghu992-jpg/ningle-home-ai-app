import { defineConfig, Plugin, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import healthHandler from './api/health'
import chatHandler from './api/chat'
import visionHandler from './api/vision'
import generateHandler from './api/generate'
import designGenerateHandler from './api/design/generate'
import designQaHandler from './api/design/qa'
import designInspireHandler from './api/design/inspire'
import kbStatusHandler from './api/kbStatus'
import visionHealthHandler from './api/vision-health'
import envCheckHandler from './api/env-check'
import uploadHandler from './api/upload'
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
      if (pathname === '/api/design/inspire') return designInspireHandler(req, res)
      if (pathname === '/api/kb-status') return kbStatusHandler(req, res)
      if (pathname === '/api/env-check') return envCheckHandler(req, res)
      if (pathname === '/api/upload') return uploadHandler(req, res)

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

  // Internal build stamp (used ONLY when ?debug=1 in UI).
  const fullSha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.GIT_COMMIT_SHA ||
    process.env.VITE_GIT_COMMIT_SHA ||
    'unknown';
  const shortSha = (String(fullSha || 'unknown').trim() || 'unknown').slice(0, 7);
  const vercelEnv = (process.env.VERCEL_ENV || process.env.NODE_ENV || mode || 'unknown').toString();
  const buildTime = (process.env.VITE_BUILD_TIME || new Date().toISOString()).toString();

  return {
    base: '/',
    plugins: [react(), apiMockPlugin()],
    define: {
      __BUILD_SHA__: JSON.stringify(shortSha),
      __BUILD_TIME__: JSON.stringify(buildTime),
      __VERCEL_ENV__: JSON.stringify(vercelEnv),
    },
    server: {
      open: '/',
    },
    build: {
      outDir: 'dist',
    }
  }
})
