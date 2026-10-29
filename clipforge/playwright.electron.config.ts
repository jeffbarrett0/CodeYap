import { defineConfig } from '@playwright/test'

// Gerçek Electron uygulamasını sınar. Ekran yoksa: xvfb-run -a npx playwright test -c playwright.electron.config.ts
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /electron\.spec\.ts/,
  timeout: 120_000,
  workers: 1,
  reporter: [['list']]
})
