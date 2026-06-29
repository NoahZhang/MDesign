import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { apiPlugin } from './server/apiPlugin'

// Dev proxy so the browser can reach Anthropic / OpenAI without CORS pain.
// The app calls `/llm/anthropic/*` and `/llm/openai/*`; these are rewritten to the
// real hosts. Point the targets elsewhere (Ollama, vLLM, OpenRouter, a gateway…)
// by editing the targets below, or set a direct `baseUrl` in the in-app settings.
export default defineConfig({
  plugins: [react(), apiPlugin()],
  server: {
    proxy: {
      '/llm/anthropic': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/llm\/anthropic/, ''),
      },
      '/llm/openai': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/llm\/openai/, ''),
      },
      // Volcengine Ark (Anthropic-protocol endpoint under /api/coding).
      // App base URL: /llm/ark/api/coding  ->  https://ark.cn-beijing.volces.com/api/coding
      '/llm/ark': {
        target: 'https://ark.cn-beijing.volces.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/llm\/ark/, ''),
      },
    },
  },
})
