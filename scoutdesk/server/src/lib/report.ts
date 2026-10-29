import fs from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import { PHOTO_DIR, SNAPSHOT_DIR } from '../config.js'
import { prisma } from '../db.js'
import { displayClips, type DisplayClip } from './display.js'
import { computeHeat } from './heat.js'
import { allPlayerStats, radarFor, type Stats } from './stats.js'

const INK = '#111827'
const MUTED = '#6b7280'
const LINE = '#e5e7eb'
const ACCENT = '#3f6212'
const PAGE = { w: 595.28, h: 841.89, m: 42 }
const W = PAGE.w - PAGE.m * 2

/** Standard PDF fonts only cover WinAnsi: keep Latin text, swap the rest for "?". */
const clean = (s: string | null | undefined) => (s ?? '').replace(/[→←↑↓✓✗]/g, '-').replace(/[^\x09\x0A\x20-\x7E -ÿ–—‘’“”•…]/g, '?')
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export interface ReportInput {
  notes?: string
  clipIds?: string[]
  snapshotIds?: string[]
}

function newDoc(title: string) {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE.m, bufferPages: true, info: { Title: title, Author: 'ScoutDesk', Creator: 'ScoutDesk' } })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))))
  return { doc, done }
}

function footer(doc: PDFKit.PDFDocument, label: string) {
  const range = doc.bufferedPageRange()
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i)
    doc.page.margins.bottom = 0
    doc.fontSize(8).fillColor(MUTED).font('Helvetica')
    doc.text(`ScoutDesk · ${clean(label)} · ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`, PAGE.m, PAGE.h - 28, { width: W * 0.8, lineBreak: false })
    doc.text(`Page ${i + 1} of ${range.count}`, PAGE.m, PAGE.h - 28, { width: W, align: 'right', lineBreak: false })
  }
}

const need = (doc: PDFKit.PDFDocument, h: number) => {
  if (doc.y + h > PAGE.h - PAGE.m - 16) doc.addPage()
}

function heading(doc: PDFKit.PDFDocument, text: string) {
  need(doc, 60)
  doc.moveDown(0.8)
  doc.font('Helvetica-Bold').fontSize(11).fillColor(ACCENT).text(clean(text).toUpperCase(), PAGE.m, doc.y, { characterSpacing: 0.6 })
  const y = doc.y + 2
  doc.moveTo(PAGE.m, y).lineTo(PAGE.m + W, y).lineWidth(0.7).strokeColor(LINE).stroke()
  doc.y = y + 8
  doc.fillColor(INK)
}

function statCards(doc: PDFKit.PDFDocument, cards: { label: string; value: string; sub?: string }[]) {
  const cols = 4
  const gap = 8
  const w = (W - gap * (cols - 1)) / cols
  const h = 46
  let y = doc.y
  cards.forEach((c, i) => {
    if (i % cols === 0) {
      need(doc, h + gap)
      y = doc.y
    }
    const x = PAGE.m + (i % cols) * (w + gap)
    doc.roundedRect(x, y, w, h, 4).fillAndStroke('#f9fafb', LINE)
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(clean(c.label).toUpperCase(), x + 8, y + 7, { width: w - 16, lineBreak: false })
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text(clean(c.value), x + 8, y + 18, { width: w - 16, lineBreak: false })
    if (c.sub) doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(clean(c.sub), x + 8, y + 36, { width: w - 16, lineBreak: false })
    if (i % cols === cols - 1 || i === cards.length - 1) doc.y = y + h + gap
  })
  doc.fillColor(INK)
}

function pitchHeat(doc: PDFKit.PDFDocument, x: number, y: number, w: number, points: { x: number; y: number }[]) {
  const h = (w * 68) / 105
  doc.save()
  doc.rect(x, y, w, h).fill('#2f6b3f')
  const hg = computeHeat(points)
  const cw = w / hg.cols
  const ch = h / hg.rows
  hg.cells.forEach((v, i) => {
    if (v < 0.05) return
    doc.rect(x + (i % hg.cols) * cw, y + Math.floor(i / hg.cols) * ch, cw + 0.3, ch + 0.3).fillOpacity(Math.min(0.9, v * 0.95)).fill('#fde047')
  })
  doc.fillOpacity(1).lineWidth(0.7).strokeColor('#ffffff').strokeOpacity(0.8)
  const px = (v: number) => x + (v / 105) * w
  const py = (v: number) => y + (v / 68) * h
  doc.rect(x, y, w, h).stroke()
  doc.moveTo(px(52.5), y).lineTo(px(52.5), y + h).stroke()
  doc.circle(px(52.5), py(34), (9.15 / 105) * w).stroke()
  doc.rect(x, py(13.84), px(16.5) - x, py(54.16) - py(13.84)).stroke()
  doc.rect(px(88.5), py(13.84), px(105) - px(88.5), py(54.16) - py(13.84)).stroke()
  doc.rect(x, py(24.84), px(5.5) - x, py(43.16) - py(24.84)).stroke()
  doc.rect(px(99.5), py(24.84), px(105) - px(99.5), py(43.16) - py(24.84)).stroke()
  doc.strokeOpacity(1).restore()
  doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('Attacking direction: left to right', x, y + h + 3, { width: w, align: 'center' })
  return h
}

function bars(doc: PDFKit.PDFDocument, axes: { label: string; value: number; avg: number }[], avgLabel: string) {
  const labelW = 110
  const bw = W - labelW - 40
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
  need(doc, axes.length * 20 + 24)
  const y0 = doc.y
  doc.rect(PAGE.m + labelW, y0 + 1, 8, 6).fill(ACCENT)
  doc.fillColor(MUTED).text('Player', PAGE.m + labelW + 12, y0, { lineBreak: false })
  doc.rect(PAGE.m + labelW + 60, y0 + 1, 8, 6).fill('#9ca3af')
  doc.fillColor(MUTED).text(clean(avgLabel), PAGE.m + labelW + 72, y0, { lineBreak: false })
  doc.y = y0 + 14
  for (const a of axes) {
    const y = doc.y
    doc.fillColor(INK).font('Helvetica').fontSize(8.5).text(clean(a.label), PAGE.m, y + 1, { width: labelW - 6, lineBreak: false })
    doc.rect(PAGE.m + labelW, y, bw, 6).fill('#f3f4f6')
    doc.rect(PAGE.m + labelW, y, (bw * a.value) / 100, 6).fill(ACCENT)
    doc.rect(PAGE.m + labelW, y + 8, bw, 4).fill('#f3f4f6')
    doc.rect(PAGE.m + labelW, y + 8, (bw * a.avg) / 100, 4).fill('#9ca3af')
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(8).text(String(a.value), PAGE.m + labelW + bw + 6, y, { width: 28, lineBreak: false })
    doc.y = y + 20
  }
}

async function clipTable(doc: PDFKit.PDFDocument, clips: DisplayClip[], matchLabel: Map<string, string>) {
  const cols = [
    { k: 'Time', w: 38 }, { k: 'Tag', w: 92 }, { k: 'Out', w: 46 }, { k: 'Match', w: 100 }, { k: 'Notes', w: W - 38 - 92 - 46 - 100 },
  ]
  const head = () => {
    need(doc, 30)
    let x = PAGE.m
    const y = doc.y
    doc.rect(PAGE.m, y - 2, W, 14).fill('#f3f4f6')
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5)
    for (const c of cols) { doc.text(c.k.toUpperCase(), x + 4, y + 1, { width: c.w - 6, lineBreak: false }); x += c.w }
    doc.y = y + 16
  }
  head()
  for (const c of clips) {
    const notes = clean(c.notes) || ''
    const rowH = Math.max(14, doc.font('Helvetica').fontSize(8).heightOfString(notes, { width: cols[4]!.w - 8 }) + 5)
    if (doc.y + rowH > PAGE.h - PAGE.m - 16) { doc.addPage(); head() }
    const y = doc.y
    let x = PAGE.m
    const cells = [clock(c.timeSec), c.tag, c.outcome === 'success' ? 'Success' : c.outcome === 'fail' ? 'Fail' : '-', matchLabel.get(c.matchId) ?? '', notes]
    cells.forEach((t, i) => {
      doc.fillColor(i === 2 ? (c.outcome === 'success' ? '#15803d' : c.outcome === 'fail' ? '#b91c1c' : MUTED) : INK).font(i === 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
      doc.text(clean(t), x + 4, y + 2, { width: cols[i]!.w - 8, height: rowH, ellipsis: true })
      x += cols[i]!.w
    })
    doc.moveTo(PAGE.m, y + rowH).lineTo(PAGE.m + W, y + rowH).lineWidth(0.4).strokeColor(LINE).stroke()
    doc.y = y + rowH
  }
  doc.fillColor(INK)
}

async function snapshots(doc: PDFKit.PDFDocument, ids: string[]) {
  const rows = (await prisma.snapshot.findMany({ where: { id: { in: ids } } })).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
  const usable = rows.filter((s) => fs.existsSync(path.join(SNAPSHOT_DIR, path.basename(s.filePath))))
  if (!usable.length) return
  heading(doc, 'Tactical snapshots')
  const gap = 12
  const w = (W - gap) / 2
  const h = (w * 9) / 16
  for (let i = 0; i < usable.length; i += 2) {
    need(doc, h + 34)
    const y = doc.y
    usable.slice(i, i + 2).forEach((s, j) => {
      const x = PAGE.m + j * (w + gap)
      try {
        doc.image(path.join(SNAPSHOT_DIR, path.basename(s.filePath)), x, y, { fit: [w, h], align: 'center', valign: 'center' })
        doc.rect(x, y, w, h).lineWidth(0.5).strokeColor(LINE).stroke()
      } catch {
        doc.rect(x, y, w, h).fill('#f3f4f6')
      }
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(`${clock(s.timeSec)}${s.caption ? ` · ${clean(s.caption)}` : ''}`, x, y + h + 3, { width: w, height: 22, ellipsis: true })
    })
    doc.y = y + h + 28
  }
  doc.fillColor(INK)
}

function notesSection(doc: PDFKit.PDFDocument, title: string, ...texts: (string | null | undefined)[]) {
  const t = texts.map((x) => clean(x).trim()).filter(Boolean)
  heading(doc, title)
  need(doc, 80)
  if (t.length === 0) {
    // leave writing space for hand-written notes
    for (let i = 0; i < 6; i++) { const y = doc.y + 16; doc.moveTo(PAGE.m, y).lineTo(PAGE.m + W, y).lineWidth(0.4).strokeColor(LINE).stroke(); doc.y = y }
    return
  }
  doc.font('Helvetica').fontSize(9.5).fillColor(INK)
  for (const x of t) doc.text(x, PAGE.m, doc.y, { width: W, lineGap: 2 }).moveDown(0.6)
}

const statCardsFor = (s: Stats) => [
  { label: 'Matches tagged', value: String(s.matches) },
  { label: 'Goals', value: String(s.goals), sub: `${s.shots} shots · ${s.shotsOnTarget} on target` },
  { label: 'Passing', value: s.passAccuracy == null ? '-' : `${s.passAccuracy}%`, sub: `${s.passesCompleted}/${s.passesAttempted} completed` },
  { label: 'Key passes', value: String(s.keyPasses) },
  { label: 'Dribbles won', value: `${s.dribblesWon}/${s.dribblesAttempted}` },
  { label: 'Tackles won', value: `${s.tacklesWon}/${s.tackles}`, sub: `${s.interceptions} interceptions · ${s.blocks} blocks` },
  { label: 'Duels won', value: s.duelsWonPct == null ? '-' : `${s.duelsWonPct}%`, sub: `${s.duelsWon} won · ${s.duelsLost} lost` },
  { label: 'Pressing / recoveries', value: `${s.pressures} / ${s.recoveries}` },
  { label: 'Errors', value: String(s.errors) },
  { label: 'Lost possession', value: String(s.lostPossession) },
  { label: 'Fouls', value: String(s.fouls) },
  { label: 'Cards', value: String(s.cards) },
]

const KEY_TAGS = ['goal', 'shot on target', 'key pass', 'run in behind', 'dribble', 'interception', 'tackle', 'save']

async function matchLabels(ids: string[]) {
  const matches = await prisma.match.findMany({ where: { id: { in: ids } }, include: { homeTeam: true, awayTeam: true } })
  return new Map(matches.map((m) => [m.id, `${m.homeTeam.shortName} v ${m.awayTeam.shortName} ${m.date.toISOString().slice(0, 10)}`]))
}

export async function playerReport(playerId: string, input: ReportInput): Promise<{ pdf: Buffer; name: string }> {
  const { rows } = await allPlayerStats()
  const me = rows.find((r) => r.player.id === playerId)
  if (!me) throw new Error('Player not found')
  const p = me.player
  const team = p.teamId ? await prisma.team.findUnique({ where: { id: p.teamId } }) : null
  const allClips = await prisma.clip.findMany({ where: { playerId }, orderBy: { timeSec: 'asc' } })
  const disp = await displayClips(allClips)
  const picked = input.clipIds?.length
    ? input.clipIds.map((id) => disp.find((c) => c.id === id)).filter((c): c is DisplayClip => !!c)
    : [...disp].sort((a, b) => KEY_TAGS.indexOf(a.tag.toLowerCase()) - KEY_TAGS.indexOf(b.tag.toLowerCase()) || 0).filter((c) => KEY_TAGS.includes(c.tag.toLowerCase())).slice(0, 14).sort((a, b) => a.matchId.localeCompare(b.matchId) || a.timeSec - b.timeSec)
  const radar = radarFor(me, rows)

  const { doc, done } = newDoc(`Scouting report - ${p.name}`)
  // Header
  doc.rect(0, 0, PAGE.w, 8).fill(ACCENT)
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('PLAYER SCOUTING REPORT', PAGE.m, 34, { characterSpacing: 1 })
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(26).text(clean(p.name), PAGE.m, 48, { width: W - 90 })
  const bits = [team?.name, (p.positions as string[]).join(' / '), p.jersey != null ? `#${p.jersey}` : null].filter(Boolean).join('  ·  ')
  doc.font('Helvetica').fontSize(11).fillColor(MUTED).text(clean(bits), PAGE.m, doc.y + 2)
  const facts = [p.age ? `Age ${p.age}` : null, p.nationality, p.foot ? `${p.foot[0]!.toUpperCase()}${p.foot.slice(1)}-footed` : null, p.heightCm ? `${p.heightCm} cm` : null].filter(Boolean).join('   ')
  doc.fontSize(9.5).text(clean(facts), PAGE.m, doc.y + 2)
  if (p.photoUrl && !p.photoUrl.startsWith('http')) {
    const file = path.join(PHOTO_DIR, path.basename(p.photoUrl.split('?')[0]!))
    if (fs.existsSync(file)) try { doc.image(file, PAGE.m + W - 72, 30, { fit: [72, 72] }) } catch { /* unsupported image: skip */ }
  }
  doc.y = Math.max(doc.y, 104) + 6

  heading(doc, 'Summary')
  statCards(doc, statCardsFor(me.stats))
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`Counts come from analyst tags in ${me.stats.matches} match${me.stats.matches === 1 ? '' : 'es'}; they describe tagged actions, not full-match totals.`, PAGE.m, doc.y, { width: W })

  heading(doc, 'Profile vs ' + (radar.peers === 'position' ? `${radar.group} peers` : radar.peers === 'everyone' ? 'all other players' : 'peers'))
  if (radar.peers === 'none') doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('No other tagged players in the database to compare against yet.', PAGE.m, doc.y, { width: W }).moveDown(0.5)
  bars(doc, radar.axes, radar.peers === 'none' ? 'Peer average' : `Avg of ${radar.peerCount} ${radar.peers === 'position' ? radar.group + ' ' : ''}player${radar.peerCount === 1 ? '' : 's'}`)
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text('Counts are per tagged match, scaled so the best player in the database = 100. Discipline is inverted (higher is better).', PAGE.m, doc.y, { width: W })

  const pts = allClips.filter((c) => c.x != null && c.y != null).map((c) => ({ x: c.x!, y: c.y! }))
  if (pts.length) {
    heading(doc, `Action heatmap (${pts.length} located actions)`)
    need(doc, 220)
    const w = Math.min(W, 340)
    const h = pitchHeat(doc, PAGE.m + (W - w) / 2, doc.y, w, pts)
    doc.y += h + 16
  }

  heading(doc, input.clipIds?.length ? 'Selected clips' : 'Key clips')
  if (picked.length === 0) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No clips tagged for this player yet.', PAGE.m, doc.y)
  else await clipTable(doc, picked, await matchLabels([...new Set(picked.map((c) => c.matchId))]))

  if (input.snapshotIds?.length) await snapshots(doc, input.snapshotIds)
  notesSection(doc, 'Scouting notes', input.notes, p.notes ? `Profile notes: ${p.notes}` : null)
  footer(doc, `${p.name} scouting report`)
  doc.end()
  return { pdf: await done, name: `${p.name.replace(/[^\w]+/g, '_')}_scouting_report.pdf` }
}

export async function teamReport(teamId: string, input: ReportInput): Promise<{ pdf: Buffer; name: string }> {
  const team = await prisma.team.findUnique({ where: { id: teamId } })
  if (!team) throw new Error('Team not found')
  const [matches, clips, { rows }] = await Promise.all([
    prisma.match.findMany({ where: { OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] }, orderBy: { date: 'desc' }, include: { homeTeam: true, awayTeam: true } }),
    prisma.clip.findMany({ where: { teamId }, orderBy: { timeSec: 'asc' } }),
    allPlayerStats(),
  ])
  const disp = await displayClips(clips)
  const roster = rows.filter((r) => r.player.teamId === teamId).sort((a, b) => (a.player.jersey ?? 99) - (b.player.jersey ?? 99))
  const rec = { W: 0, D: 0, L: 0, gf: 0, ga: 0 }
  for (const m of matches) {
    if (m.homeScore == null || m.awayScore == null) continue
    const [f, a] = m.homeTeamId === teamId ? [m.homeScore, m.awayScore] : [m.awayScore, m.homeScore]
    rec.gf += f; rec.ga += a
    rec[f > a ? 'W' : f < a ? 'L' : 'D']++
  }
  const { doc, done } = newDoc(`Team report - ${team.name}`)
  doc.rect(0, 0, PAGE.w, 8).fill(team.color)
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('TEAM SCOUTING REPORT', PAGE.m, 34, { characterSpacing: 1 })
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(26).text(clean(team.name), PAGE.m, 48, { width: W })
  doc.font('Helvetica').fontSize(11).fillColor(MUTED).text(clean([team.isOwn ? 'Own team' : 'Opponent', team.country, `Usual shape ${team.formation}`].filter(Boolean).join('  ·  ')), PAGE.m, doc.y + 2)
  doc.y += 8

  heading(doc, 'Results')
  statCards(doc, [
    { label: 'Matches', value: String(matches.length) }, { label: 'Record', value: `${rec.W}W ${rec.D}D ${rec.L}L` },
    { label: 'Goals for', value: String(rec.gf) }, { label: 'Goals against', value: String(rec.ga) },
  ])
  const labels = await matchLabels(matches.map((m) => m.id))
  for (const m of matches.slice(0, 8)) {
    need(doc, 14)
    const home = m.homeTeamId === teamId
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(`${m.date.toISOString().slice(0, 10)}   ${home ? 'vs' : '@'} ${clean(home ? m.awayTeam.name : m.homeTeam.name)}   ${m.homeScore ?? '-'} - ${m.awayScore ?? '-'}   ${clean(m.competition)}`, PAGE.m, doc.y, { width: W })
  }

  heading(doc, 'What they do: tagged actions by category')
  const byCat = new Map<string, { n: number; color: string }>()
  for (const c of disp) byCat.set(c.category, { n: (byCat.get(c.category)?.n ?? 0) + 1, color: c.color })
  const max = Math.max(1, ...[...byCat.values()].map((v) => v.n))
  for (const [name, v] of byCat) {
    need(doc, 16)
    const y = doc.y
    doc.fillColor(INK).font('Helvetica').fontSize(9).text(clean(name), PAGE.m, y, { width: 110, lineBreak: false })
    doc.rect(PAGE.m + 115, y + 1, ((W - 160) * v.n) / max, 8).fill(v.color)
    doc.fillColor(INK).text(String(v.n), PAGE.m + 120 + ((W - 160) * v.n) / max, y, { lineBreak: false })
    doc.y = y + 15
  }
  const pts = clips.filter((c) => c.x != null && c.y != null && ['shot', 'shot on target', 'goal', 'cross', 'key pass'].includes(disp.find((d) => d.id === c.id)?.tag.toLowerCase() ?? '')).map((c) => ({ x: c.x!, y: c.y! }))
  if (pts.length) {
    heading(doc, `Where they create: chance locations (${pts.length})`)
    need(doc, 220)
    const w = Math.min(W, 340)
    const h = pitchHeat(doc, PAGE.m + (W - w) / 2, doc.y, w, pts)
    doc.y += h + 16
  }

  heading(doc, 'Squad (from tagged actions)')
  need(doc, 40)
  const cols = [{ k: '#', w: 28 }, { k: 'Player', w: 150 }, { k: 'Pos', w: 50 }, { k: 'Goals', w: 44 }, { k: 'Shots', w: 44 }, { k: 'Key P', w: 44 }, { k: 'Tkl', w: 44 }, { k: 'Duel %', w: 50 }, { k: 'Clips', w: W - 454 }]
  let y = doc.y
  doc.rect(PAGE.m, y - 2, W, 14).fill('#f3f4f6')
  let x = PAGE.m
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5)
  for (const c of cols) { doc.text(c.k.toUpperCase(), x + 4, y + 1, { width: c.w - 6, lineBreak: false }); x += c.w }
  doc.y = y + 16
  for (const r of roster) {
    need(doc, 16)
    y = doc.y
    x = PAGE.m
    const s = r.stats
    ;[String(r.player.jersey ?? ''), r.player.name, (r.player.positions as string[]).join('/'), s.goals, s.shots, s.keyPasses, s.tackles, s.duelsWonPct == null ? '-' : `${s.duelsWonPct}%`, s.clips].forEach((t, i) => {
      doc.fillColor(INK).font(i === 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).text(clean(String(t)), x + 4, y + 1, { width: cols[i]!.w - 8, lineBreak: false })
      x += cols[i]!.w
    })
    doc.moveTo(PAGE.m, y + 14).lineTo(PAGE.m + W, y + 14).lineWidth(0.4).strokeColor(LINE).stroke()
    doc.y = y + 15
  }
  if (roster.length === 0) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No players on this team yet.', PAGE.m, doc.y)

  const key = (input.clipIds?.length ? input.clipIds.map((id) => disp.find((c) => c.id === id)).filter((c): c is DisplayClip => !!c) : disp.filter((c) => ['goal', 'shot on target', 'key pass', 'counter-attack', 'corner', 'free kick', 'penalty'].includes(c.tag.toLowerCase())).slice(0, 14))
  heading(doc, input.clipIds?.length ? 'Selected clips' : 'Key moments')
  if (key.length === 0) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No clips tagged for this team yet.', PAGE.m, doc.y)
  else await clipTable(doc, key, labels)

  if (input.snapshotIds?.length) await snapshots(doc, input.snapshotIds)
  notesSection(doc, 'Scouting notes', input.notes, team.notes ? `Team notes: ${team.notes}` : null)
  footer(doc, `${team.name} team report`)
  doc.end()
  return { pdf: await done, name: `${team.name.replace(/[^\w]+/g, '_')}_team_report.pdf` }
}
