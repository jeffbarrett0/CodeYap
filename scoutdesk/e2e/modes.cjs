// Simple vs Pro mode, and importing the user's own JSON files.
const { chromium } = require('playwright')
const fs = require('fs')
const SP = process.argv[2] || './e2e-out'
fs.mkdirSync(SP, { recursive: true })
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m) }
;(async () => {
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()))
  await p.goto('http://localhost:4000/match/m_demo', { waitUntil: 'networkidle' })
  await p.waitForFunction(() => document.querySelector('video')?.readyState >= 2)

  console.log('Simple mode is the default')
  assert(await p.getByRole('button', { name: 'Profesyonel moda geç' }).count() === 1, 'top-right button offers Pro mode')
  assert(await p.getByRole('toolbar', { name: 'Frame tools' }).count() === 1, 'frame tools are there')
  assert(await p.getByRole('button', { name: 'Ekran görüntüsü al' }).count() === 1, 'screenshot button is there')
  assert(await p.getByTestId('timeline-canvas').count() === 1, 'the timeline is there')
  for (const t of ['Tagging', 'Event log', 'Pitch']) assert(await p.getByRole('tab', { name: t }).count() === 0, `no "${t}" tab in simple mode`)
  assert(await p.getByRole('table').count() === 0, 'no clip table in simple mode')
  await p.screenshot({ path: `${SP}/mode-simple.png` })

  console.log('Switch to Pro')
  await p.getByRole('button', { name: 'Profesyonel moda geç' }).click()
  for (const t of ['Tagging', 'Clip', 'Event log', 'Pitch']) assert(await p.getByRole('tab', { name: t }).count() >= 1, `"${t}" tab appears`)
  assert(await p.getByRole('table').count() === 1, 'clip table appears')
  assert(await p.getByRole('toolbar', { name: 'Frame tools' }).count() === 1, 'frame tools stay')
  await p.reload({ waitUntil: 'networkidle' })
  assert(await p.getByRole('button', { name: 'Basit moda dön' }).count() === 1, 'the choice is remembered after reload')
  await p.getByRole('button', { name: 'Basit moda dön' }).click()
  assert(await p.getByRole('tab', { name: 'Tagging' }).count() === 0, 'back to simple')

  console.log('Import from JSON files')
  const dir = `${SP}/json`; fs.mkdirSync(dir, { recursive: true })
  const simple = { date: '2025-04-12', competition: 'Test Cup', venue: 'Json Park', homeScore: 3, awayScore: 2,
    home: { name: 'Json Home FC', formation: '4-3-3', players: [{ name: 'Jan Home', jersey: 7, position: 'RW' }, { name: 'Kim Home', jersey: 1, position: 'GK' }] },
    away: { name: 'Json Away FC', formation: '4-4-2', players: [{ name: 'Ola Away', jersey: 9, position: 'ST' }] },
    events: [{ minute: 5, second: 0, team: 'home', player: 'Jan Home', tag: 'Goal', outcome: 'success' }, { minute: 50, second: 0, team: 'away', player: 'Ola Away', tag: 'Shot' }] }
  fs.writeFileSync(`${dir}/match.json`, JSON.stringify(simple))
  fs.writeFileSync(`${dir}/bad.json`, '{ not json')
  await p.goto('http://localhost:4000/matches', { waitUntil: 'networkidle' })
  await p.getByRole('button', { name: 'Import from link' }).click()
  const d = p.getByRole('dialog', { name: /Import a match/ })
  await d.getByLabel('Choose JSON files').setInputFiles(`${dir}/bad.json`)
  await d.getByRole('alert').filter({ hasText: /isn.t valid JSON/ }).waitFor()
  assert(await d.getByRole('alert').filter({ hasText: /isn.t valid JSON/ }).count() === 1, 'a broken file gives a friendly message')
  await d.getByLabel('Choose JSON files').setInputFiles(`${dir}/match.json`)
  await d.getByText('Your JSON file').first().waitFor()
  assert(/Json Home FC/.test(await d.innerText()) && /3 : 2/.test(await d.innerText()), 'preview shows the teams and score from the file')
  assert(/ScoutDesk simple format/.test(await d.innerText()), 'it says which format it recognised')
  await d.getByLabel('Swap home and away').click(); await p.waitForTimeout(500)
  assert(/2 : 3/.test(await d.innerText()), 'swap flips the sides and the score')
  await d.getByLabel('Swap home and away').click(); await p.waitForTimeout(500)
  await d.getByLabel(/Match events as clips/).check()
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await d.getByText('Match imported').waitFor()
  const matches = await (await fetch('http://localhost:4000/api/matches', { headers: { 'x-user-id': 'u_analyst' } })).json()
  const m = matches.find(x => x.competition === 'Test Cup')
  assert(m && m.homeScore === 3, 'the match exists with its score')
  const clips = await (await fetch(`http://localhost:4000/api/clips?matchId=${m.id}`, { headers: { 'x-user-id': 'u_analyst' } })).json()
  assert(clips.length === 2, 'both events became clips')
  const players = await (await fetch('http://localhost:4000/api/players', { headers: { 'x-user-id': 'u_analyst' } })).json()
  assert(players.some(x => x.name === 'Jan Home'), 'players were added')
  // clean up what the test created so other tests see the demo data only
  const adm = { 'x-user-id': 'u_admin' }
  await fetch(`http://localhost:4000/api/matches/${m.id}`, { method: 'DELETE', headers: adm })
  for (const pl of players.filter(x => ['Jan Home', 'Kim Home', 'Ola Away'].includes(x.name))) await fetch(`http://localhost:4000/api/players/${pl.id}`, { method: 'DELETE', headers: adm })
  const teams = await (await fetch('http://localhost:4000/api/teams', { headers: adm })).json()
  for (const t of teams.filter(x => /^Json (Home|Away) FC$/.test(x.name))) await fetch(`http://localhost:4000/api/teams/${t.id}`, { method: 'DELETE', headers: adm })

  console.log('errors:', JSON.stringify(errs)); assert(errs.length === 0, 'no console errors')
  await b.close()
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1) })
