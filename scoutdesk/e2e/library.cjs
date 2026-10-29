// Browser-level check for ScoutDesk. Needs: `npm i -g playwright && npx playwright install chromium`,
// the app running on http://localhost:4000 (`npm run build && npm start`) and a freshly seeded DB
// (`SEED_VIDEO_FORMAT=webm npm run seed:reset` if your Chromium build lacks H.264).
const { chromium } = require('playwright')
const SP = process.argv[2] || './e2e-out'
require('fs').mkdirSync(SP, { recursive: true })
if (!require('fs').existsSync(`${SP}/upload-test.mp4`)) require('child_process').execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `${SP}/upload-test.mp4`])
;(async () => {
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  const errs = []
  p.on('console', m => m.type() === 'error' && errs.push(m.text()))
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message))
  await p.goto('http://localhost:4000/library', { waitUntil: 'networkidle' })
  await p.screenshot({ path: `${SP}/p2-library.png` })

  await p.getByRole('button', { name: /upload video/i }).click()
  await p.getByLabel('Choose video files').setInputFiles(`${SP}/upload-test.mp4`)
  await p.getByLabel(/Title for/).fill('E2E upload test')
  await p.screenshot({ path: `${SP}/p2-upload-dialog.png` })
  await p.getByRole('combobox').first().selectOption({ index: 1 }) // attach to the demo match
  await p.getByRole('button', { name: /^Upload 1 file/ }).click()

  const card = p.getByRole('article').filter({ hasText: 'E2E upload test' })
  await card.waitFor({ timeout: 10000 })
  const sawProcessing = await card.getByText('Processing').isVisible().catch(() => false)
  // wait for processing -> ready (duration badge appears)
  await card.getByText('0:12').waitFor({ timeout: 20000 })
  const img = await card.locator('img').count()
  const imgOk = await card.locator('img').evaluate(i => i.complete && i.naturalWidth > 0)
  console.log(JSON.stringify({ sawProcessing, thumbs: img, thumbLoaded: imgOk, meta: await card.innerText() }))
  await p.screenshot({ path: `${SP}/p2-library-after.png` })

  // list view + filter
  await p.getByTitle('List view').click()
  await p.getByLabel('Filter videos').fill('e2e')
  await p.screenshot({ path: `${SP}/p2-library-list.png` })

  // delete as analyst should be disabled; switch to admin and delete
  await p.getByRole('button', { name: /Sam Rivera/ }).click()
  await p.getByRole('menuitem', { name: /Alex Morgan/ }).click()
  await p.getByRole('button', { name: /Actions for E2E upload test/ }).click()
  await p.getByRole('menuitem', { name: /Delete/ }).click()
  await p.getByRole('button', { name: 'Delete', exact: true }).click()
  await p.getByText('Video deleted').waitFor()
  console.log('deleted ok; errors:', JSON.stringify(errs))
  await b.close()
})().catch(e => { console.error('E2E FAIL', e); process.exit(1) })
