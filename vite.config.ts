import { defineConfig } from 'vite'

// The Ornn API only serves CORS headers to whitelisted origins, so the
// browser cannot fetch it directly from localhost. Proxy /api through the
// dev/preview server instead (endpoints in src/data.ts are relative).
const proxy = {
  '/api': {
    target: 'https://api.ornnai.com',
    changeOrigin: true,
  },
}

export default defineConfig({
  server: { proxy },
  preview: { proxy },
})
