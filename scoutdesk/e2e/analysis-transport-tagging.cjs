// Browser-level check for ScoutDesk. Needs: `npm i -g playwright && npx playwright install chromium`,
// the app running on http://localhost:4000 (`npm run build && npm start`) and a freshly seeded DB
// (`SEED_VIDEO_FORMAT=webm npm run seed:reset` if your Chromium build lacks H.264).
require('./_pro.cjs')
const { chromium } = require('playwright')
const SP = process.argv[2] || './e2e-out'
require('fs').mkdirSync(SP, { recursive: true })
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m) }
;(async () => {
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  const errs = []
  p.on('console', m => m.type() === 'error' && errs.push(m.text()))
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message))
  await p.goto('http://localhost:4000/match/m_demo', { waitUntil: 'networkidle' })
  await p.waitForFunction(() => { const v = document.querySelector('video'); return v && v.readyState >= 2 })
  const vt = () => p.evaluate(() => document.querySelector('video').currentTime)
  const tc = () => p.getByTestId('timecode').innerText()
  const clipCount = async () => (await (await p.request.get('http://localhost:4000/api/clips?matchId=m_demo')).json()).length

  console.log('Transport')
  assert(await tc() === '00:00:00.00', 'starts at 00:00:00.00 (got ' + await tc() + ')')
  await p.keyboard.press('ArrowRight')
  await p.waitForTimeout(150)
  assert(await tc() === '00:00:00.01', 'ArrowRight steps exactly one frame -> ' + await tc())
  assert(Math.abs((await vt()) - 1.5 / 25) < 1e-3, 'video.currentTime is mid-frame 1 (' + await vt() + ')')
  for (let i = 0; i < 4; i++) await p.keyboard.press('ArrowRight')
  await p.waitForTimeout(150)
  assert(await tc() === '00:00:00.05', '5 frames after 5 presses -> ' + await tc())
  await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(100)
  assert(await tc() === '00:00:00.04', 'ArrowLeft steps back one frame -> ' + await tc())
  await p.keyboard.press('Shift+ArrowRight'); await p.waitForTimeout(150)
  assert(Math.abs((await vt()) - 5.14) < 0.05, 'Shift+Right skips 5s (' + (await vt()).toFixed(2) + ')')
  await p.keyboard.press('Alt+ArrowRight'); await p.waitForTimeout(150)
  assert(Math.abs((await vt()) - 15.14) < 0.05, 'Alt+Right skips 10s (' + (await vt()).toFixed(2) + ')')

  // visual: the burned-in frame number in the footage must match the timecode frame count
  await p.keyboard.press('Home'); await p.waitForTimeout(100)
  for (let i = 0; i < 37; i++) await p.keyboard.press('ArrowRight')
  await p.waitForTimeout(400)
  console.log('  timecode after 37 steps:', await tc(), '(burned-in label should read F37)')
  await p.screenshot({ path: `${SP}/p3-frame37.png`, clip: { x: 340, y: 48, width: 640, height: 360 } })

  console.log('Speed')
  await p.keyboard.press(']')
  assert(await p.evaluate(() => document.querySelector('video').playbackRate) === 1.25, '] -> 1.25x')
  await p.keyboard.press('[')
  await p.keyboard.press('[')
  assert(await p.evaluate(() => document.querySelector('video').playbackRate) === 0.75, '[ [ -> 0.75x')
  await p.getByRole('button', { name: /Playback speed/ }).click()
  await p.getByRole('menuitem', { name: '0.25x' }).click()
  assert(await p.evaluate(() => document.querySelector('video').playbackRate) === 0.25, 'menu -> 0.25x')
  await p.getByRole('button', { name: /Playback speed/ }).click()
  await p.getByRole('menuitem', { name: '2x' }).click()
  assert(await p.evaluate(() => document.querySelector('video').playbackRate) === 2, 'menu -> 2x')

  console.log('Play / pause')
  const t0 = await vt()
  await p.keyboard.press('Space'); await p.waitForTimeout(1000)
  const t1 = await vt()
  assert(t1 - t0 > 1.2, `Space plays at 2x (advanced ${(t1 - t0).toFixed(2)}s in ~1s)`)
  await p.keyboard.press('Space'); await p.waitForTimeout(200)
  const t2 = await vt(); await p.waitForTimeout(300)
  assert(await vt() === t2, 'Space pauses')
  await p.keyboard.press('1') // 1 = Duel won; but first reset rate
  await p.keyboard.press('Control+z'); await p.waitForTimeout(300)

  console.log('Tagging + undo/redo')
  const before = await clipCount()
  await p.evaluate(() => { document.querySelector('video').currentTime = 50 }); await p.waitForTimeout(300)
  await p.keyboard.press('s') // Shot
  await p.waitForTimeout(500)
  assert(await clipCount() === before + 1, `hotkey S created a clip on the server (${before} -> ${before + 1})`)
  const clips = await (await p.request.get('http://localhost:4000/api/clips?matchId=m_demo')).json()
  const mine = clips.find(c => Math.abs(c.timeSec - 50) < 0.2)
  assert(mine && Math.abs(mine.startSec - 45) < 0.3 && Math.abs(mine.endSec - 55) < 0.3, `clip = [${mine.startSec}, ${mine.endSec}] around 50s with ±5s roll`)
  assert(mine.createdById === 'u_analyst', 'attributed to the signed-in analyst')
  await p.screenshot({ path: `${SP}/p4-tagged.png` })
  await p.keyboard.press('Control+z'); await p.waitForTimeout(500)
  assert(await clipCount() === before, 'Ctrl+Z removed it (server in sync)')
  await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(500)
  assert(await clipCount() === before + 1, 'Ctrl+Shift+Z restored it')
  await p.keyboard.press('Control+z'); await p.waitForTimeout(500)

  console.log('Timeline')
  const box = await p.getByTestId('timeline-canvas').boundingBox()
  const x = box.x + 16 + (box.width - 16 - 24) * (90 / 180)
  await p.mouse.click(x, box.y + 12) // ruler => scrub
  await p.waitForTimeout(300)
  assert(Math.abs((await vt()) - 90) < 2.5, `click on timeline seeks (~90s, got ${(await vt()).toFixed(1)})`)
  const px = await p.getByTestId('playhead').evaluate(e => e.getBoundingClientRect().left)
  assert(Math.abs(px - x) < 4, `playhead drawn at the click position (${px.toFixed(0)} vs ${x.toFixed(0)})`)
  await p.mouse.move(x, box.y + 12); await p.mouse.down(); await p.mouse.move(x + 150, box.y + 12, { steps: 5 }); await p.mouse.up()
  await p.waitForTimeout(300)
  assert((await vt()) > 105, `drag scrubs (now ${(await vt()).toFixed(1)}s)`)
  const wBefore = (await p.getByTestId('timeline-canvas').boundingBox()).width
  await p.keyboard.press('='); await p.keyboard.press('='); await p.waitForTimeout(200)
  assert((await p.getByTestId('timeline-canvas').boundingBox()).width > wBefore * 1.5, 'zoom keys widen the timeline')
  await p.screenshot({ path: `${SP}/p4-zoomed.png` })

  console.log('Errors:', JSON.stringify(errs))
  assert(errs.length === 0, 'no console errors')
  await b.close()
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1) })
