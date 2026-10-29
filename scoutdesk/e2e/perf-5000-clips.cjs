// Browser-level check for ScoutDesk. Needs: `npm i -g playwright && npx playwright install chromium`,
// the app running on http://localhost:4000 (`npm run build && npm start`) and a freshly seeded DB
// (`SEED_VIDEO_FORMAT=webm npm run seed:reset` if your Chromium build lacks H.264).
require('./_pro.cjs')
const { chromium } = require('playwright')
const API = 'http://localhost:4000/api'
const N = Number(process.argv[2] || 5000)
require('fs').mkdirSync(process.argv[3] || './e2e-out', { recursive: true })
;(async () => {
  const headers = { 'content-type': 'application/json', 'x-user-id': 'u_analyst' }
  const tax = await (await fetch(`${API}/taxonomy`)).json()
  const tags = tax.flatMap(c => c.tagTypes)
  const outcomes = ['success', 'fail', 'neutral']
  const clips = Array.from({ length: N }, (_, i) => {
    const t = Math.random() * 170 + 5
    return { id: `perf_${i}`, matchId: 'm_demo', videoId: 'v_demo', tagTypeId: tags[i % tags.length].id, startSec: +(t - 3).toFixed(2), endSec: +(t + 3).toFixed(2), timeSec: +t.toFixed(2), playerId: i % 3 ? 'p_hale' : null, teamId: 't_nbfc', outcome: outcomes[i % 3], zone: `3x3:${(i % 9) + 1}`, notes: 'perf clip ' + i, labels: i % 5 ? [] : ['perf'] }
  })
  let t0 = Date.now()
  for (let i = 0; i < N; i += 2500) {
    const r = await fetch(`${API}/clips/bulk`, { method: 'POST', headers, body: JSON.stringify({ clips: clips.slice(i, i + 2500) }) })
    if (!r.ok) throw new Error('bulk create failed ' + await r.text())
  }
  console.log(`created ${N} clips via API in ${Date.now() - t0}ms`)

  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()))
  t0 = Date.now()
  await p.goto('http://localhost:4000/match/m_demo')
  await p.getByRole('table', { name: 'Clips' }).waitFor({ timeout: 30000 })
  console.log(`page → table rendered with ${N + 30} clips: ${Date.now() - t0}ms`)
  await p.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  console.log('rows in DOM:', await p.locator('[role=row][data-clip-id]').count(), '(aria-rowcount', await p.locator('[role=table]').getAttribute('aria-rowcount') + ')')
  await p.screenshot({ path: `${(process.argv[3] || './e2e-out')}/perf-dense.png` })

  // 1) timeline zoom/pan cost
  const zoom = await p.evaluate(async () => {
    const press = k => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    const times = []
    for (let i = 0; i < 30; i++) {
      const s = performance.now()
      press(i % 2 ? '-' : '=')
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      times.push(performance.now() - s)
    }
    times.sort((a, b) => a - b)
    return { median: times[15], p95: times[28], max: times[29] }
  })
  console.log('timeline zoom step (key → 2 frames painted):', JSON.stringify(zoom, (k, v) => typeof v === 'number' ? +v.toFixed(1) : v), 'ms')

  // 2) table scroll through all rows
  const scroll = await p.evaluate(async () => {
    const el = document.querySelector('[role=table]')
    const frames = []
    let last = performance.now()
    const total = el.scrollHeight
    for (let y = 0; y < total; y += 900) {
      el.scrollTop = y
      await new Promise(r => requestAnimationFrame(r))
      const now = performance.now(); frames.push(now - last); last = now
    }
    frames.sort((a, b) => a - b)
    return { frames: frames.length, median: frames[Math.floor(frames.length / 2)], p95: frames[Math.floor(frames.length * 0.95)], max: frames[frames.length - 1] }
  })
  console.log('table scroll (frame time while jumping ~30 rows/frame):', JSON.stringify(scroll, (k, v) => typeof v === 'number' ? +v.toFixed(1) : v), 'ms')

  // 3) filter latency
  const inp = p.getByLabel('Search clips')
  await p.evaluate(() => { document.querySelector('[role=table]').scrollTop = 0 })
  const s = Date.now()
  await inp.fill('perf clip 12')
  await p.waitForFunction(() => /\d+ of \d+ clips/.test(document.body.innerText))
  console.log(`text filter over ${N + 30} clips applied in ${Date.now() - s}ms (incl. Playwright overhead)`, await p.getByText(/of \d+ clips/).first().innerText())
  await inp.fill('')

  // 4) frame pacing while playing with the timeline + 5000 clips visible
  await p.evaluate(() => { document.querySelector('video').currentTime = 10 })
  await p.keyboard.press('Space')
  const pace = await p.evaluate(async () => {
    const d = []
    let last = performance.now()
    const end = last + 3000
    while (performance.now() < end) {
      await new Promise(r => requestAnimationFrame(r))
      const n = performance.now(); d.push(n - last); last = n
    }
    d.sort((a, b) => a - b)
    return { frames: d.length, median: d[Math.floor(d.length / 2)], p95: d[Math.floor(d.length * 0.95)], max: d[d.length - 1] }
  })
  console.log('rAF pacing during 3s playback:', JSON.stringify(pace, (k, v) => typeof v === 'number' ? +v.toFixed(1) : v), 'ms')
  await p.keyboard.press('Space')

  // 5) hotkey tagging latency with 5000 clips
  const lat = await p.evaluate(async () => {
    const times = []
    for (let i = 0; i < 10; i++) {
      const s = performance.now()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }))
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      times.push(performance.now() - s)
    }
    return times.map(t => +t.toFixed(1))
  })
  console.log('tag hotkey → UI updated (ms), 10 presses:', lat.join(', '))
  console.log('errors:', JSON.stringify(errs))
  await b.close()

  // cleanup: remove everything we created (perf clips + the ones from the 10 presses)
  const all = await (await fetch(`${API}/clips?matchId=m_demo`)).json()
  const doomed = all.filter(c => !c.id.startsWith('c_seed_')).map(c => c.id)
  for (let i = 0; i < doomed.length; i += 2500) await fetch(`${API}/clips/batch-delete`, { method: 'POST', headers, body: JSON.stringify({ ids: doomed.slice(i, i + 2500) }) })
  console.log('cleanup: removed', doomed.length, 'clips; remaining', (await (await fetch(`${API}/clips?matchId=m_demo`)).json()).length)
})().catch(e => { console.error('PERF FAIL', e); process.exit(1) })
