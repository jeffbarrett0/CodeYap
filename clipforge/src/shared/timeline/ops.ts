import type { Caption, Clip, ID, Timeline, Track } from '../types'
import { clipDuration, clipEnd, findClip, groupMembers, MIN_CLIP_SEC, newId } from './model'

/** Saf (immutable) zaman çizelgesi işlemleri. Hepsi yeni bir Timeline döner. */

function mapTracks(tl: Timeline, f: (t: Track) => Track): Timeline {
  return { ...tl, tracks: tl.tracks.map(f) }
}

function replaceClips(tl: Timeline, updates: Map<ID, Clip | null>): Timeline {
  return mapTracks(tl, (t) => {
    if (!t.clips.some((c) => updates.has(c.id))) return t
    const clips = t.clips.flatMap((c) => (updates.has(c.id) ? (updates.get(c.id) ? [updates.get(c.id) as Clip] : []) : [c]))
    return { ...t, clips: clips.sort((a, b) => a.start - b.start) }
  })
}

function overlaps(a0: number, a1: number, b0: number, b1: number) {
  return a0 < b1 - 1e-9 && b0 < a1 - 1e-9
}

/** `members` dışındaki kliplerle çakışmadan, hepsi `delta` kadar kaydırılabilir mi? */
function canShift(tl: Timeline, members: Clip[], delta: number): boolean {
  const ids = new Set(members.map((m) => m.id))
  return members.every((m) => {
    const s = m.start + delta
    if (s < -1e-9) return false
    const e = s + clipDuration(m)
    const track = tl.tracks.find((t) => t.id === m.trackId)
    return !track || track.clips.every((o) => ids.has(o.id) || !overlaps(s, e, o.start, clipEnd(o)))
  })
}

/** İstenen kaydırmaya en yakın çakışmasız kaydırmayı bulur (komşu klip kenarlarına yapışarak). */
export function resolveShift(tl: Timeline, members: Clip[], desired: number): number {
  const ids = new Set(members.map((m) => m.id))
  const cands = new Set<number>([desired, 0])
  for (const m of members) {
    cands.add(-m.start)
    const track = tl.tracks.find((t) => t.id === m.trackId)
    for (const o of track?.clips ?? []) {
      if (ids.has(o.id)) continue
      cands.add(clipEnd(o) - m.start)
      cands.add(o.start - clipEnd(m))
    }
  }
  const sorted = [...cands].sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired))
  return sorted.find((d) => canShift(tl, members, d)) ?? 0
}

/** Klibi (ve grubunu) taşır. Hedef doluysa en yakın boş konuma yapışır. */
export function moveClip(tl: Timeline, clipId: ID, newStart: number, newTrackId?: ID): Timeline {
  const f = findClip(tl, clipId)
  if (!f || f.track.locked) return tl
  const members = groupMembers(tl, clipId)

  // Tek klip, farklı (uyumlu) iz
  if (newTrackId && newTrackId !== f.clip.trackId && members.length === 1) {
    const target = tl.tracks.find((t) => t.id === newTrackId)
    if (target && target.kind === f.track.kind && !target.locked) {
      const moved: Clip = { ...f.clip, trackId: target.id }
      const without = mapTracks(tl, (t) => (t.id === f.track.id ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t))
      const probe = mapTracks(without, (t) => (t.id === target.id ? { ...t, clips: [...t.clips, { ...moved, start: newStart }] } : t))
      const delta = resolveShift(probe, [{ ...moved, start: newStart }], 0)
      const placed = { ...moved, start: Math.max(0, newStart + delta) }
      return mapTracks(without, (t) => (t.id === target.id ? { ...t, clips: [...t.clips, placed].sort((a, b) => a.start - b.start) } : t))
    }
  }

  const delta = resolveShift(tl, members, newStart - f.clip.start)
  if (Math.abs(delta) < 1e-9) return tl
  return replaceClips(tl, new Map(members.map((m) => [m.id, { ...m, start: m.start + delta }])))
}

/** Başlangıç kenarını sürükleyerek kırpar (grup üyelerine aynı miktar uygulanır). */
export function trimStart(tl: Timeline, clipId: ID, newStart: number): Timeline {
  const f = findClip(tl, clipId)
  if (!f || f.track.locked) return tl
  const members = groupMembers(tl, clipId)
  let delta = newStart - f.clip.start
  for (const m of members) {
    const track = tl.tracks.find((t) => t.id === m.trackId)
    const prevEnd = Math.max(0, ...(track?.clips.filter((o) => o.id !== m.id && clipEnd(o) <= m.start + 1e-9).map(clipEnd) ?? [0]))
    delta = Math.max(delta, prevEnd - m.start, -m.srcIn) // öncekine girme, kaynağın başından öteye gitme
    delta = Math.min(delta, clipDuration(m) - MIN_CLIP_SEC)
  }
  if (Math.abs(delta) < 1e-9) return tl
  return replaceClips(tl, new Map(members.map((m) => [m.id, { ...m, start: m.start + delta, srcIn: m.srcIn + delta }])))
}

/** Bitiş kenarını sürükleyerek kırpar. `maxSrcOut`: kaynak süresi (klip id → süre) */
export function trimEnd(tl: Timeline, clipId: ID, newEnd: number, sourceDuration: (c: Clip) => number = () => Infinity): Timeline {
  const f = findClip(tl, clipId)
  if (!f || f.track.locked) return tl
  const members = groupMembers(tl, clipId)
  let delta = newEnd - clipEnd(f.clip)
  for (const m of members) {
    const track = tl.tracks.find((t) => t.id === m.trackId)
    const nextStart = Math.min(Infinity, ...(track?.clips.filter((o) => o.id !== m.id && o.start >= clipEnd(m) - 1e-9).map((o) => o.start) ?? []))
    delta = Math.min(delta, nextStart - clipEnd(m), sourceDuration(m) - m.srcOut)
    delta = Math.max(delta, MIN_CLIP_SEC - clipDuration(m))
  }
  if (Math.abs(delta) < 1e-9) return tl
  return replaceClips(tl, new Map(members.map((m) => [m.id, { ...m, srcOut: m.srcOut + delta }])))
}

/** Verilen zamanda klibi (ve grubunu) ikiye böler. Zaman klibin içinde değilse değişmez. */
export function splitClip(tl: Timeline, clipId: ID, time: number): Timeline {
  const f = findClip(tl, clipId)
  if (!f || f.track.locked) return tl
  const members = groupMembers(tl, clipId)
  const updates = new Map<ID, Clip | null>()
  const extra: Clip[] = []
  const suffix = newId('g')
  let did = false
  const groupMap = new Map<ID, ID>()
  for (const m of members) {
    if (time <= m.start + MIN_CLIP_SEC || time >= clipEnd(m) - MIN_CLIP_SEC) continue
    const cut = time - m.start
    const left: Clip = { ...m, srcOut: m.srcIn + cut }
    let rightGroup = m.groupId
    if (m.groupId) {
      if (!groupMap.has(m.groupId)) groupMap.set(m.groupId, `${m.groupId}.${suffix}`)
      rightGroup = groupMap.get(m.groupId)
    }
    const right: Clip = { ...m, id: newId('clip'), start: time, srcIn: m.srcIn + cut, groupId: rightGroup }
    updates.set(m.id, left)
    extra.push(right)
    did = true
  }
  if (!did) return tl
  const base = replaceClips(tl, updates)
  return mapTracks(base, (t) => {
    const add = extra.filter((c) => c.trackId === t.id)
    return add.length ? { ...t, clips: [...t.clips, ...add].sort((a, b) => a.start - b.start) } : t
  })
}

/** Klibi (ve grubunu) siler. `ripple`: sonraki klipleri aynı iz üzerinde sola kaydırır. */
export function deleteClip(tl: Timeline, clipId: ID, ripple = false): Timeline {
  const f = findClip(tl, clipId)
  if (!f || f.track.locked) return tl
  const members = groupMembers(tl, clipId)
  let out = replaceClips(tl, new Map(members.map((m) => [m.id, null])))
  if (ripple) {
    const ids = new Set(members.map((m) => m.id))
    for (const m of members) {
      const d = clipDuration(m)
      out = mapTracks(out, (t) =>
        t.id === m.trackId ? { ...t, clips: t.clips.map((c) => (!ids.has(c.id) && c.start >= m.start ? { ...c, start: Math.max(0, c.start - d) } : c)) } : t
      )
    }
  }
  return out
}

export function updateClip(tl: Timeline, clipId: ID, patch: Partial<Clip>): Timeline {
  return replaceClips(tl, new Map([[clipId, (() => { const f = findClip(tl, clipId); return f ? { ...f.clip, ...patch, id: f.clip.id, trackId: f.clip.trackId } : null })()]]))
}

/** Klibi izin ilk uygun (boş) yerine ekler; `clip.start` doluysa sonrasına kaydırır. */
export function addClip(tl: Timeline, trackId: ID, clip: Clip): Timeline {
  const track = tl.tracks.find((t) => t.id === trackId)
  if (!track) return tl
  const placed = { ...clip, trackId, start: findFreeStart(track, clip.start, clipDuration(clip)) }
  return mapTracks(tl, (t) => (t.id === trackId ? { ...t, clips: [...t.clips, placed].sort((a, b) => a.start - b.start) } : t))
}

export function findFreeStart(track: Track, desired: number, duration: number): number {
  let start = Math.max(0, desired)
  for (const c of [...track.clips].sort((a, b) => a.start - b.start)) {
    if (overlaps(start, start + duration, c.start, clipEnd(c))) start = clipEnd(c)
  }
  return start
}

export function updateTrack(tl: Timeline, trackId: ID, patch: Partial<Pick<Track, 'volume' | 'muted' | 'locked' | 'name'>>): Timeline {
  return mapTracks(tl, (t) => (t.id === trackId ? { ...t, ...patch } : t))
}

export function setCaptions(tl: Timeline, captions: Caption[]): Timeline {
  return { ...tl, captions }
}

/** Zaman çizelgesi zamanına denk gelen kaynak zamanı */
export function timelineToSource(c: Clip, t: number): number {
  return c.srcIn + (t - c.start)
}

export function clipsAt(tl: Timeline, t: number): Clip[] {
  return tl.tracks.flatMap((tr) => tr.clips.filter((c) => t >= c.start - 1e-9 && t < clipEnd(c) - 1e-9))
}

/** Oynatma kafası ve klip kenarlarına yapışma noktaları */
export function snapPoints(tl: Timeline, exclude: ID[] = []): number[] {
  const pts = new Set<number>([0])
  for (const tr of tl.tracks) for (const c of tr.clips) if (!exclude.includes(c.id)) (pts.add(c.start), pts.add(clipEnd(c)))
  return [...pts].sort((a, b) => a - b)
}
