import { existsSync } from 'node:fs'
import { defineConfig } from '@playwright/test'

// Sistemde önceden kurulu bir Chromium varsa onu kullan (Playwright sürümü farklı olabilir).
const preinstalled = '/opt/pw-browsers/chromium'
const executablePath = process.env.PW_CHROMIUM ?? (existsSync(preinstalled) ? preinstalled : undefined)

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5199',
    viewport: { width: 1500, height: 940 },
    launchOptions: { executablePath, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node scripts/make-fixtures.mjs && npx vite --config vite.web.config.mts',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
    timeout: 120_000
  }
})
