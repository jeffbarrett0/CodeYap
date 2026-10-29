// Browser-level check for ScoutDesk. Needs: `npm i -g playwright && npx playwright install chromium`,
// the app running on http://localhost:4000 (`npm run build && npm start`) and a freshly seeded DB
// (`SEED_VIDEO_FORMAT=webm npm run seed:reset` if your Chromium build lacks H.264).
const { chromium } = require('playwright')
const SP = process.argv[2] || './e2e-out'
require('fs').mkdirSync(SP, { recursive: true })
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m) }
;(async () => {
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && !/403|Forbidden/.test(m.text()) && errs.push(m.text()))
  await p.addInitScript(() => localStorage.setItem('scoutdesk.app', JSON.stringify({ state: { theme: 'light', userId: 'u_viewer' }, version: 0 })))
  await p.goto('http://localhost:4000/match/m_demo', { waitUntil: 'networkidle' })
  await p.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  const count = async () => (await (await p.request.get('http://localhost:4000/api/clips?matchId=m_demo')).json()).length
  assert(await p.getByText('Read-only: viewers can’t create tags.').count() === 1, 'viewer sees the read-only banner')
  assert(await p.getByRole('button', { name: /^Shot\s*,\s*shortcut S/ }).isDisabled(), 'tag buttons are disabled')
  const n = await count()
  await p.keyboard.press('s'); await p.waitForTimeout(400)
  assert(await count() === n, 'hotkey S does nothing for a viewer')
  await p.keyboard.press('Space'); await p.waitForTimeout(500)
  assert((await p.evaluate(() => document.querySelector('video').currentTime)) > 0.2, 'viewers can still play / scrub / step')
  await p.keyboard.press('Space')
  // API enforces it too
  const r = await p.request.post('http://localhost:4000/api/clips', { headers: { 'x-user-id': 'u_viewer' }, data: { matchId: 'm_demo', tagTypeId: 'x', startSec: 0, endSec: 5, timeSec: 2 } })
  assert(r.status() === 403, 'server rejects viewer writes with 403')
  await p.screenshot({ path: `${SP}/p10-light-1280.png` })
  console.log('errors:', JSON.stringify(errs))
  await b.close()
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1) })
