import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { writeFileSync } from 'fs'

const PUBLIC_OUT_DIR = 'dist-public'

// `--mode public` builds the landing-only site for authentic-materials.com:
// its own entry (no app code), its own output folder so it can never be synced
// to the staging bucket by mistake, and a robots.txt without app routes.
const publicSite = (): Plugin => ({
  name: 'am-public-site',
  transformIndexHtml: {
    order: 'pre',
    handler: (html) => html.replace('/src/main.tsx', '/src/main.public.tsx'),
  },
  closeBundle() {
    writeFileSync(path.resolve(__dirname, PUBLIC_OUT_DIR, 'robots.txt'), 'User-agent: *\nAllow: /\n')
  },
})

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'public' ? [publicSite()] : [])],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: mode === 'public' ? { outDir: PUBLIC_OUT_DIR } : {},
  server: {
    port: 3000,
  },
}))
