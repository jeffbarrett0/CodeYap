import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Yavaş performans/dayanıklılık denemesi: `npm run test:perf` (60 dakikalık gerçek MKV üretir)
export default defineConfig({
  resolve: { alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) } },
  test: { include: ['tests/perf/**/*.test.ts'], testTimeout: 30 * 60_000, hookTimeout: 30 * 60_000 }
})
