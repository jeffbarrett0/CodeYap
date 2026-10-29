import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = { '@shared': resolve(__dirname, 'src/shared') }

/** Geliştirme sunucusu satır içi betik (react-refresh) enjekte eder; CSP yalnızca üretim derlemesinde uygulanır. */
const devCsp = { name: 'clipforge-dev-csp', apply: 'serve' as const, transformIndexHtml: (html: string) => html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [react(), devCsp],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } }
  }
})
