import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env)

  return {
    base: '/',
    plugins: [react()],
    server: {
      open: '/',
      proxy: {
        '/api': {
          target: 'http://localhost:3000', // For local dev if needed, or Vercel handles it
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: 'dist',
    }
  }
})
