// Colours, close-up mouse control, marker sizes, no stray rings, panel sizes that persist, calm timeline.
require('./_pro.cjs')
const { chromium } = require('playwright')
const SP = process.argv[2] || './e2e-out'
require('fs').mkdirSync(SP, { recursive: true })
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m) }
;(async () => {
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()))
  await p.goto('http://localhost:4000/match/m_demo', { waitUntil: 'networkidle' })
  await p.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  await p.evaluate(() => { document.querySelector('video').currentTime = 20 }); await p.waitForTimeout(400)
  const tb = p.getByRole('toolbar', { name: 'Frame tools' })
  const box = await p.locator('svg[aria-label="Drawing overlay"]').boundingBox()
  const X = (f) => box.x + f * box.width, Y = (f) => box.y + f * box.height
  const tool = (n) => tb.getByRole('button', { name: n, exact: true }).click()
  const nextFrame = async () => { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(250) }

  console.log('1. Colours')
  await tb.getByRole('button', { name: 'Renk ve kalınlık' }).click()
  const swatches = await p.locator('button[aria-label^="Renk #"]').count()
  assert(swatches >= 30, `a big palette (${swatches} ready colours)`)
  await p.getByLabel('Renk kodu (#rrggbb)').fill('#12ab34')
  await p.keyboard.press('Escape')
  await tool('Çizgi'); await p.mouse.move(X(0.1), Y(0.2)); await p.mouse.down(); await p.mouse.move(X(0.3), Y(0.2), { steps: 5 }); await p.mouse.up()
  const col = await p.locator('g[data-shape="line"] line').first().getAttribute('stroke')
  assert(col === '#12ab34', `a free colour typed as hex is used (${col})`)

  console.log('3. Run arrow has no circle')
  await nextFrame()
  await tool('Koşu oku'); await p.mouse.move(X(0.2), Y(0.5)); await p.mouse.down(); await p.mouse.move(X(0.5), Y(0.5), { steps: 5 }); await p.mouse.up()
  assert(await p.locator('g[data-shape="run"] ellipse').count() === 0 && await p.locator('g[data-shape="run"] polygon').count() === 1, 'the run arrow is just a dashed line with a head')

  console.log('4. Number: no ring, resizable')
  await nextFrame()
  await tool('Numara'); await p.mouse.click(X(0.3), Y(0.4)); await p.mouse.click(X(0.7), Y(0.4), { button: 'right' })
  assert(await p.locator('g[data-shape="number"] ellipse').count() === 0, 'no ring under the number')
  await p.mouse.click(X(0.3), Y(0.4)) // select it
  const rBefore = +(await p.locator('g[data-shape="number"] circle').first().getAttribute('r'))
  const hb = await p.locator('circle[data-handle="size"]').boundingBox()
  await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await p.mouse.down(); await p.mouse.move(hb.x + 60, hb.y + hb.height / 2, { steps: 5 }); await p.mouse.up()
  const rAfter = +(await p.locator('g[data-shape="number"] circle').first().getAttribute('r'))
  assert(rAfter > rBefore * 1.5, `dragging the handle enlarges the number (${rBefore.toFixed(1)} → ${rAfter.toFixed(1)})`)
  const c = await p.locator('g[data-shape="number"] circle').first().boundingBox()
  await p.mouse.move(c.x + c.width / 2, c.y + c.height / 2); await p.mouse.wheel(0, 120); await p.waitForTimeout(150)
  const rWheel = +(await p.locator('g[data-shape="number"] circle').first().getAttribute('r'))
  assert(rWheel < rAfter, 'the mouse wheel over the number shrinks it')

  console.log('5. Player: no ring, bigger text, size control')
  await nextFrame()
  await tool('Oyuncu'); await p.mouse.click(X(0.4), Y(0.5))
  assert(await p.locator('g[data-shape="player"] ellipse').count() === 0, 'no ring under the player tag')
  const fs0 = +(await p.locator('g[data-shape="player"] text').getAttribute('font-size'))
  assert(fs0 >= 14, `name text is bigger by default (font ${fs0.toFixed(1)} on a ${Math.round(box.width)}px-wide frame)`)
  const w0 = (await p.locator('g[data-shape="player"] rect').boundingBox()).width
  await p.getByLabel('Yazı boyutu').fill('2')
  const w1 = (await p.locator('g[data-shape="player"] rect').boundingBox()).width
  assert(w1 > w0 * 1.6, 'the text-size slider grows the tag')

  console.log('2. Close-up: pan, zoom, resize with the mouse')
  await nextFrame()
  await tool('Zoom'); await p.mouse.click(X(0.55), Y(0.45))
  const canvas = p.locator('canvas[data-zoom-inset]')
  const cb = await canvas.boundingBox()
  const read = () => p.evaluate(() => { const s = window.__sdShapes?.() ; return s })
  await p.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2); await p.mouse.wheel(0, -200); await p.waitForTimeout(150)
  await p.mouse.wheel(0, -200); await p.waitForTimeout(150)
  assert(parseFloat(await p.getByLabel('Close-up yakınlaştırma').inputValue()) > 1.2, 'the wheel zooms the close-up in')
  await p.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2); await p.mouse.down(); await p.mouse.move(cb.x + cb.width / 2 + 40, cb.y + cb.height / 2 + 10, { steps: 5 }); await p.mouse.up()
  assert(await p.getByRole('button', { name: 'Kaydırmayı sıfırla' }).count() === 1, 'dragging inside pans the picture (and keeps the shape selected)')
  const wBefore = (await canvas.boundingBox()).width
  const rz = await p.locator('[data-zoom-resize]').boundingBox()
  await p.mouse.move(rz.x + rz.width / 2, rz.y + rz.height / 2); await p.mouse.down(); await p.mouse.move(rz.x + 90, rz.y + 90, { steps: 6 }); await p.mouse.up()
  assert((await canvas.boundingBox()).width > wBefore * 1.15, 'the edge dot resizes the close-up window')
  assert(await p.locator('g[data-shape="zoom"]').count() === 1, 'no stray shape was created')
  await p.screenshot({ path: `${SP}/extras-closeup.png` })

  console.log('7. Calm timeline')
  const tones = await p.locator('[data-clip-marker]').evaluateAll(els => [...new Set(els.map(e => getComputedStyle(e).backgroundColor))])
  assert(tones.length <= 3, `ticks use at most 3 tones (${tones.length})`)
  assert(await p.locator('[data-clip-marker]').count() === 30, 'all 30 events are still there')

  console.log('6. Panel sizes: dragged, remembered, resettable')
  const handle = p.locator('[data-panel-resize-handle-id]').filter({ has: p.locator('span') }).first()
  const vid0 = (await p.getByRole('toolbar', { name: 'Video controls' }).boundingBox()).y
  assert(vid0 > 400, `match footage starts big (controls end at y=${Math.round(vid0)})`)
  const hbx = await handle.boundingBox()
  await p.mouse.move(hbx.x + hbx.width / 2, hbx.y + hbx.height / 2); await p.mouse.down(); await p.mouse.move(hbx.x + hbx.width / 2, hbx.y - 120, { steps: 6 }); await p.mouse.up()
  const vid1 = (await p.getByRole('toolbar', { name: 'Video controls' }).boundingBox()).y
  assert(vid1 < vid0 - 60, 'dragging a divider changes the section sizes')
  await p.waitForTimeout(500) // the layout is saved shortly after dragging
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(600)
  const vid2 = (await p.getByRole('toolbar', { name: 'Video controls' }).boundingBox()).y
  assert(Math.abs(vid2 - vid1) < 12, 'the size is still there after a reload')
  await p.getByRole('button', { name: 'Düzeni sıfırla' }).click(); await p.waitForTimeout(300)
  const vid3 = (await p.getByRole('toolbar', { name: 'Video controls' }).boundingBox()).y
  assert(Math.abs(vid3 - vid0) < 12, 'Düzeni sıfırla restores the defaults')

  console.log('errors:', JSON.stringify(errs)); assert(errs.length === 0, 'no console errors')
  await b.close()
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1) })
