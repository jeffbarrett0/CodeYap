// Tarayıcı modu: Electron olmadan arayüzü (sahte IPC köprüsüyle) çalıştırır. Playwright UI testleri bunu kullanır.
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  root: here('./src/renderer'),
  publicDir: here('./tests/fixtures/public'),
  resolve: { alias: { '@shared': here('./src/shared') } },
  plugins: [react(), { name: 'dev-csp', transformIndexHtml: (html: string) => html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '') }],
  server: { port: 5199, strictPort: true }
})
