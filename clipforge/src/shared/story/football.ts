import { ease } from '../graphics/geo'
import type { FbAction, FbCameraMode, FbPlayer, FbSpot, FootballContent } from './types'

/**
 * Futbol sahası canlandırması: saf simülasyon (oyuncu/top konumları, kamera, etiketler). Çizim `footballAss.ts`'te.
 * Koordinatlar metre: x 0..105 (hücum +x), y 0..68, z yükseklik. `attack:'left'` sahneyi 180° döndürür.
 */
export const PITCH_L = 105
export const PITCH_W = 68

export const SPOTS: Record<string, [number, number]> = {
  'orta-nokta': [52.5, 34],
  'penalti-noktasi': [94, 34],
  'kale-onu': [99, 34],
  'ceza-yayi': [86, 34],
  'ceza-sahasi': [92, 34],
  'ceza-sahasi-sag': [92, 22],
  'ceza-sahasi-sol': [92, 46],
  'sag-kanat': [80, 8],
  'sol-kanat': [80, 60],
  'sag-kanat-derin': [99, 6],
  'sol-kanat-derin': [99, 62],
  'sag-capraz': [70, 20],
  'sol-capraz': [70, 48],
  'orta-saha-sag': [58, 22],
  'orta-saha-sol': [58, 46],
  'rakip-yarisaha': [72, 34],
  'kendi-yarisaha': [34, 34],
  'savunma': [28, 34],
  'kendi-ceza-sahasi': [12, 34],
  'kendi-kale': [3, 34],
  'rakip-kale': [105, 34]
}

/** Kale hedefleri [x, y, z] — hücum edilen kale (x=105); y=34 orta, 3.66 m yarım kale genişliği */
export const GOAL_TARGETS: Record<string, [number, number, number]> = {
  'kale-orta': [105, 34, 1.0],
  'kale-sag': [105, 30.8, 0.9],
  'kale-sol': [105, 37.2, 0.9],
  'kale-sag-ust': [105, 31, 2.1],
  'kale-sol-ust': [105, 37, 2.1],
  'kale-sag-alt': [105, 31, 0.3],
  'kale-sol-alt': [105, 37, 0.3]
}

export class FootballError extends Error {}

type V2 = [number, number]
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
const dist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1])
const lerp2 = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

export interface FbLabel { player: string; text: string; t0: number; t1: number }
export interface FbZone { center: V2; rx: number; ry: number; t0: number; t1: number; text?: string }
export interface FbTrail { from: V2; to: V2; t0: number; t1: number; kind: 'pass' | 'shoot' | 'line'; /** top bu çizgi boyunca gider */ travel: boolean }
export interface BallState { x: number; y: number; z: number; holder?: string }
export interface SimPlayer { id: string; team: 'home' | 'away'; name?: string; num?: number; keeper: boolean; fill: boolean; base: V2; phase: number }

export interface FootballSim {
  players: SimPlayer[]
  pos(id: string, t: number): V2
  ball(t: number): BallState
  camera: { at: number; mode: FbCameraMode }[]
  labels: FbLabel[]
  zones: FbZone[]
  trails: FbTrail[]
  goals: { t: number; x: number; y: number }[]
  endSec: number
}

/** "4-3-3" → satır sayıları; geçersizse null */
export function parseFormation(f?: string): number[] | null {
  if (!f) return null
  const rows = f.split(/[-–]/).map((x) => Number(x.trim()))
  if (rows.length < 2 || rows.length > 5 || rows.some((n) => !Number.isInteger(n) || n < 1 || n > 6) || rows.reduce((a, b) => a + b, 0) !== 10) return null
  return rows
}

function formationSpots(rows: number[], team: 'home' | 'away'): V2[] {
  const out: V2[] = [[5, 34]]
  const xs = rows.length === 1 ? [40] : rows.map((_, i) => 26 + (i * 40) / (rows.length - 1))
  rows.forEach((n, i) => {
    for (let j = 0; j < n; j++) out.push([xs[i], (68 * (j + 1)) / (n + 1)])
  })
  return team === 'home' ? out : out.map(([x, y]) => [PITCH_L - x, PITCH_W - y] as V2)
}

export function simulateFootball(c: FootballContent, durSec: number): FootballSim {
  const flip = c.attack === 'left'
  const fx = (p: V2): V2 => (flip ? [PITCH_L - p[0], PITCH_W - p[1]] : p)
  const spot = (s: FbSpot, what: string): V2 => {
    if (Array.isArray(s)) {
      if (s.length !== 2 || !Number.isFinite(s[0]) || !Number.isFinite(s[1])) throw new FootballError(`${what}: geçersiz koordinat ${JSON.stringify(s)}`)
      return fx([clamp(s[0], -5, PITCH_L + 5), clamp(s[1], -5, PITCH_W + 5)])
    }
    const p = SPOTS[s]
    if (!p) throw new FootballError(`${what}: bilinmeyen nokta "${s}". Seçenekler: ${Object.keys(SPOTS).join(', ')} ya da [x,y].`)
    return fx(p)
  }

  // ── oyuncular ──
  const players: SimPlayer[] = []
  const byId = new Map<string, SimPlayer>()
  const add = (p: SimPlayer) => {
    if (byId.has(p.id)) throw new FootballError(`Oyuncu kimliği iki kez kullanılmış: "${p.id}"`)
    byId.set(p.id, p)
    players.push(p)
  }
  c.players.forEach((p: FbPlayer, i) => {
    if (!p.id) throw new FootballError(`${i + 1}. oyuncunun id'si yok.`)
    add({ id: p.id, team: p.team === 'away' ? 'away' : 'home', name: p.name, num: p.num, keeper: !!p.keeper, fill: false, base: spot(p.at, `Oyuncu "${p.id}"`), phase: 0 })
  })
  for (const team of ['home', 'away'] as const) {
    const rows = parseFormation((team === 'home' ? c.home : c.away)?.formation)
    if (!rows) continue
    const explicit = players.filter((p) => !p.fill && p.team === team)
    const spots = formationSpots(rows, team).map((b0) => (flip ? fx(b0) : b0))
    const removed = new Set<number>()
    // açık tanımlı her oyuncu, formasyonda kendine en yakın yedeğin yerini alır (takım 11 kişi kalır)
    for (const e of explicit) {
      if (e.keeper) {
        removed.add(0)
        continue
      }
      let best = -1
      let bd = Infinity
      spots.forEach((sp, i) => {
        if (i === 0 || removed.has(i)) return
        const d = dist(sp, e.base)
        if (d < bd) (bd = d, (best = i))
      })
      if (best >= 0) removed.add(best)
    }
    spots.forEach((base, i) => {
      if (removed.has(i)) return
      add({ id: `${team === 'home' ? 'h' : 'a'}${i + 1}`, team, keeper: i === 0, fill: true, base, phase: i * 1.7 + (team === 'home' ? 0 : 0.9) })
    })
  }
  const need = (id: string, what: string) => {
    const p = byId.get(id)
    if (!p) throw new FootballError(`${what}: oyuncu bulunamadı "${id}". Tanımlı: ${players.map((x) => x.id).join(', ')}`)
    return p
  }

  // ── oyuncu hareketleri ──
  const actions = [...c.actions].filter((a) => a && Number.isFinite(a.at)).sort((a, b) => a.at - b.at)
  interface Seg { t0: number; t1: number; from: V2; to: V2 }
  const segs = new Map<string, Seg[]>()
  const posAt = (id: string, t: number): V2 => {
    const p = need(id, 'konum')
    let cur = p.base
    for (const s of segs.get(id) ?? []) {
      if (t >= s.t1) cur = s.to
      else if (t >= s.t0) return lerp2(s.from, s.to, ease.inOut((t - s.t0) / Math.max(0.01, s.t1 - s.t0)))
      else break
    }
    return cur
  }
  for (const a of actions) {
    if (a.do !== 'run' && a.do !== 'dribble') continue
    const p = need(a.player, `${a.do} @${a.at}`)
    const list = segs.get(p.id) ?? []
    const from = posAt(p.id, a.at)
    const to = spot(a.to, `${a.do} @${a.at}`)
    const dur = a.dur ?? Math.max(0.6, dist(from, to) / (a.do === 'dribble' ? 6 : 7.5))
    list.push({ t0: a.at, t1: a.at + dur, from, to })
    segs.set(p.id, list)
  }
  const sway = (p: SimPlayer, t: number): V2 => (p.fill ? [Math.sin(t * 0.8 + p.phase) * 0.9, Math.cos(t * 0.65 + p.phase * 1.3) * 0.7] : [0, 0])
  const pos = (id: string, t: number): V2 => {
    const p = need(id, 'konum')
    const q = posAt(id, t)
    const s = sway(p, t)
    return [q[0] + s[0], q[1] + s[1]]
  }

  // ── top ──
  interface BallSeg { t0: number; t1: number; from: [number, number, number]; to: [number, number, number]; arc: number; next?: string }
  const ballSegs: BallSeg[] = []
  let holder: string | undefined = c.ball?.holder
  let free: [number, number, number] | undefined
  if (holder) need(holder, 'top sahibi')
  else if (c.ball?.at) free = [...spot(c.ball.at, 'top'), 0.15]
  else if (players.length) holder = (players.find((p) => !p.fill && p.team === 'home') ?? players[0]).id
  const initHolder = holder
  const initFree = free
  const ballOf = (id: string, t: number): [number, number, number] => {
    const p = pos(id, t)
    return [p[0] + (flip ? -0.7 : 0.7), p[1], 0.15]
  }
  const trails: FbTrail[] = []
  const goals: { t: number; x: number; y: number }[] = []
  let lastEnd = 0
  for (const a of actions) {
    if (a.do !== 'pass' && a.do !== 'shoot') continue
    need(a.from, `${a.do} @${a.at}`)
    if (holder && holder !== a.from) throw new FootballError(`${a.do} @${a.at}: top şu an "${holder}" oyuncusunda, ama "${a.from}" oynatıyor. Önce topu ona pas edin ya da ball.holder'ı düzeltin.`)
    if (a.at < lastEnd - 1e-6) throw new FootballError(`${a.do} @${a.at}: önceki top hareketi ${lastEnd.toFixed(1)} sn'ye kadar sürüyor; bunu daha geç başlatın.`)
    const start: [number, number, number] = holder ? ballOf(holder, a.at) : free ?? [0, 0, 0.15]
    if (a.do === 'pass') {
      need(a.to, `pass @${a.at}`)
      const d0 = dist([start[0], start[1]], pos(a.to, a.at + 1))
      const dur = a.dur ?? clamp(d0 / 17, 0.5, 2.6)
      const end = ballOf(a.to, a.at + dur)
      ballSegs.push({ t0: a.at, t1: a.at + dur, from: start, to: end, arc: a.lob ? Math.min(7, 1.5 + d0 / 8) : 0.35, next: a.to })
      trails.push({ from: [start[0], start[1]], to: [end[0], end[1]], t0: a.at, t1: a.at + dur + 1.4, kind: 'pass', travel: true })
      holder = a.to
      lastEnd = a.at + dur
    } else {
      let tgt: [number, number, number]
      if (typeof a.to === 'string') {
        const g = GOAL_TARGETS[a.to]
        if (!g) throw new FootballError(`shoot @${a.at}: bilinmeyen hedef "${a.to}". Seçenekler: ${Object.keys(GOAL_TARGETS).join(', ')} ya da [x,y(,z)].`)
        tgt = [...fx([g[0], g[1]]), g[2]]
      } else tgt = [...fx([a.to[0], a.to[1]]), (a.to as number[])[2] ?? 0.8]
      if (a.result === 'miss') tgt = [tgt[0] + (flip ? -6 : 6), tgt[1] + (tgt[1] > PITCH_W / 2 ? 5 : -5), tgt[2] + 2.5]
      const d0 = Math.hypot(tgt[0] - start[0], tgt[1] - start[1])
      const dur = a.dur ?? clamp(0.35 + d0 / 32, 0.45, 1.8)
      ballSegs.push({ t0: a.at, t1: a.at + dur, from: start, to: tgt, arc: 1.2 })
      trails.push({ from: [start[0], start[1]], to: [tgt[0], tgt[1]], t0: a.at, t1: a.at + dur + 1.2, kind: 'shoot', travel: true })
      if ((a.result ?? 'goal') === 'goal') goals.push({ t: a.at + dur, x: tgt[0], y: tgt[1] })
      free = tgt
      holder = undefined
      lastEnd = a.at + dur
    }
  }
  const ball = (t: number): BallState => {
    let state: BallState
    if (initHolder) {
      const b = ballOf(initHolder, t)
      state = { x: b[0], y: b[1], z: b[2], holder: initHolder }
    } else state = initFree ? { x: initFree[0], y: initFree[1], z: initFree[2] } : { x: PITCH_L / 2, y: PITCH_W / 2, z: 0.15 }
    for (const s of ballSegs) {
      if (t < s.t0) break
      if (t >= s.t1) {
        if (s.next) {
          const b = ballOf(s.next, t)
          state = { x: b[0], y: b[1], z: b[2], holder: s.next }
        } else state = { x: s.to[0], y: s.to[1], z: s.to[2] }
      } else {
        const u = (t - s.t0) / Math.max(0.01, s.t1 - s.t0)
        const to = s.next ? ballOf(s.next, s.t1) : s.to
        return { x: s.from[0] + (to[0] - s.from[0]) * u, y: s.from[1] + (to[1] - s.from[1]) * u, z: Math.max(0.12, s.from[2] + (to[2] - s.from[2]) * u + s.arc * 4 * u * (1 - u)) }
      }
    }
    return state
  }

  // ── etiket / bölge / çizgi / kamera ──
  const labels: FbLabel[] = []
  const zones: FbZone[] = []
  const camera: { at: number; mode: FbCameraMode }[] = [{ at: 0, mode: c.camera ?? 'broadcast' }]
  const resolveEnd = (e: FbSpot | string, t: number, what: string): V2 => (typeof e === 'string' && byId.has(e) ? pos(e, t) : spot(e as FbSpot, what))
  for (const a of actions as FbAction[]) {
    if (a.do === 'label') {
      need(a.player, `label @${a.at}`)
      labels.push({ player: a.player, text: String(a.text).slice(0, 40), t0: a.at, t1: a.at + (a.dur ?? 2.2) })
    } else if (a.do === 'zone') zones.push({ center: spot(a.center, `zone @${a.at}`), rx: clamp(a.rx ?? 9, 2, 40), ry: clamp(a.ry ?? a.rx ?? 6, 2, 30), t0: a.at, t1: a.at + (a.dur ?? 2.5), text: a.text ? String(a.text).slice(0, 30) : undefined })
    else if (a.do === 'line') trails.push({ from: resolveEnd(a.from, a.at, `line @${a.at}`), to: resolveEnd(a.to, a.at, `line @${a.at}`), t0: a.at, t1: a.at + (a.dur ?? 2.5), kind: 'line', travel: false })
    else if (a.do === 'camera') camera.push({ at: a.at, mode: a.mode })
  }
  camera.sort((a, b) => a.at - b.at)
  const endSec = Math.max(durSec, lastEnd)
  return { players, pos, ball, camera, labels, zones, trails, goals, endSec }
}
