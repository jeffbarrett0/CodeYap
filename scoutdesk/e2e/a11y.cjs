// Accessibility audit: axe-core (WCAG 2.0/2.1 A + AA) on every screen, dark and light.
// Usage: node e2e/a11y.cjs   (app on :4000, seeded DB)
require('./_pro.cjs')
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')
const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
const API = 'http://localhost:4000/api'
const H = { 'x-user-id': 'u_admin' }
;(async () => {
  const b = await chromium.launch()
  // a playlist + share link so those screens have content
  const pl = await (await fetch(`${API}/playlists`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'A11y list', clipIds: ['c_seed_03', 'c_seed_20'] }) })).json()
  const sh = await (await fetch(`${API}/shares`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'playlist', refId: pl.id }) })).json()
  const screens = [
    ['Library', '/library'], ['Matches', '/matches'], ['Match analysis', '/match/m_demo'], ['Players', '/players'], ['Player profile', '/players/p_hale'],
    ['Compare', '/players/compare?a=p_hale&b=p_ferreira'], ['Teams', '/teams'], ['Playlists', `/playlists/${pl.id}`], ['Reports', '/reports'], ['Settings', '/settings'], ['Share page', `/s/${sh.token}`],
  ]
  let total = 0
  const seen = new Set()
  for (const theme of ['dark', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
    await ctx.addInitScript(([t]) => localStorage.setItem('scoutdesk.app', JSON.stringify({ state: { theme: t, userId: 'u_admin' }, version: 0 })), [theme])
    const p = await ctx.newPage()
    for (const [name, url] of screens) {
      await p.goto('http://localhost:4000' + url, { waitUntil: 'networkidle' })
      await p.waitForTimeout(700)
      await p.evaluate(axeSrc)
      const res = await p.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }))
      for (const v of res.violations) {
        const key = `${name}|${v.id}|${v.nodes[0].target.join(' ')}`
        if (seen.has(key) && theme === 'light') continue
        seen.add(key)
        total += v.nodes.length
        console.log(`[${theme}] ${name}: ${v.impact} · ${v.id} (${v.nodes.length}) — ${v.help}`); for (const n of v.nodes.slice(0, 8)) console.log("      ", n.target.join(" "), "::", n.html.slice(0, 140))
      }
    }
    await ctx.close()
  }
  await fetch(`${API}/playlists/${pl.id}`, { method: 'DELETE', headers: H })
  console.log(total === 0 ? 'axe: no WCAG A/AA violations on any screen' : `axe: ${total} violating nodes`)
  await b.close()
  process.exit(total === 0 ? 0 : 1)
})().catch(e => { console.error(e); process.exit(2) })
