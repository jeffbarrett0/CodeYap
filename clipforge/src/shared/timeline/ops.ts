import type { Caption, Clip, ID, Placement, TextSpec, Timeline, Track, TrackKind, TrackRole } from '../types'
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

export function updateTrack(tl: Timeline, trackId: ID, patch: Partial<Pick<Track, 'volume' | 'muted' | 'locked' | 'name' | 'placement' | 'textDefault'>>): Timeline {
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

// ───────────────────────── katmanlar ─────────────────────────

const VISUAL = new Set<TrackKind>(['video', 'image', 'text'])

/** Katmanın (iz) kare içindeki konumunu/boyutunu/görünürlüğünü günceller. */
export function setPlacement(tl: Timeline, trackId: ID, patch: Partial<Placement>): Timeline {
  return mapTracks(tl, (t) => (t.id === trackId && t.placement ? { ...t, placement: { ...t.placement, ...patch, rect: { ...t.placement.rect, ...(patch.rect ?? {}) } } } : t))
}

/** Yeni görsel/ses katmanı. Görsel katmanlar en üste (en öndeki katman) eklenir. */
export function addTrack(tl: Timeline, spec: { id?: ID; name: string; kind: Exclude<TrackKind, 'caption'>; role: TrackRole; placement?: Placement; textDefault?: TextSpec }): Timeline {
  const id = spec.id ?? newId(spec.kind === 'audio' ? 'A' : 'L')
  if (tl.tracks.some((t) => t.id === id)) return tl
  const track: Track = {
    id,
    name: spec.name,
    kind: spec.kind,
    role: spec.role,
    clips: [],
    muted: false,
    locked: false,
    volume: 1,
    placement: VISUAL.has(spec.kind) ? (spec.placement ?? { rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.3 }, fit: 'cover', visible: true, opacity: 1 }) : undefined,
    textDefault: spec.textDefault
  }
  return { ...tl, tracks: VISUAL.has(spec.kind) ? [track, ...tl.tracks] : [...tl.tracks, track] }
}

export function removeTrack(tl: Timeline, trackId: ID): Timeline {
  return { ...tl, tracks: tl.tracks.filter((t) => t.id !== trackId) }
}

/** Katman sırasını değiştirir (up = öne). Yalnızca görsel katmanlar kendi aralarında yer değiştirir. */
export function moveTrackOrder(tl: Timeline, trackId: ID, dir: 'up' | 'down'): Timeline {
  const visualIdx = tl.tracks.map((t, i) => (VISUAL.has(t.kind) ? i : -1)).filter((i) => i >= 0)
  const at = tl.tracks.findIndex((t) => t.id === trackId)
  const pos = visualIdx.indexOf(at)
  if (pos < 0) return tl
  const other = visualIdx[pos + (dir === 'up' ? -1 : 1)]
  if (other === undefined) return tl
  const tracks = [...tl.tracks]
  ;[tracks[at], tracks[other]] = [tracks[other], tracks[at]]
  return { ...tl, tracks }
}

export function makeTextClip(trackId: ID, start: number, duration: number, spec: TextSpec): Clip {
  return { id: newId('clip'), trackId, assetId: '', start, srcIn: 0, srcOut: duration, volume: 1, label: spec.text.split('\n')[0].slice(0, 40) || 'Metin', text: spec }
}

/** Boş metin izlerinde, izin varsayılan metni zaman çizelgesi uzunluğunca bir klip olarak oluşturur. */
export function fillTextTracks(tl: Timeline): Timeline {
  const total = tl.tracks.reduce((m, t) => (t.kind === 'text' ? m : t.clips.reduce((mm, c) => Math.max(mm, clipEnd(c)), m)), 0)
  if (total <= 0) return tl
  return mapTracks(tl, (t) => (t.kind === 'text' && t.textDefault && t.clips.length === 0 ? { ...t, clips: [makeTextClip(t.id, 0, total, t.textDefault)] } : t))
}

/** Metin klibinin (ya da görselin) süresini zaman çizelgesi sonuna kadar uzatır. */
export function extendToEnd(tl: Timeline, clipId: ID): Timeline {
  const f = findClip(tl, clipId)
  if (!f) return tl
  const total = tl.tracks.reduce((m, t) => t.clips.reduce((mm, c) => (c.id === clipId ? mm : Math.max(mm, clipEnd(c))), m), 0)
  return updateClip(tl, clipId, { srcOut: f.clip.srcIn + Math.max(MIN_CLIP_SEC, total - f.clip.start) })
}

// ───────────────────────── kesme / birleştirme ─────────────────────────

/**
 * [a, b) zaman aralığını TÜM (kilitsiz) izlerden keser. `ripple` açıkken sonrası aynı miktarda sola kayar (transkriptten kesme).
 * Aralığı kapsayan klipler ikiye bölünür, kısmi kesişenler kırpılır. Altyazılar da aynı şekilde işlenir.
 */
export function cutRange(tl: Timeline, a: number, b: number, ripple = true): Timeline {
  if (!(b - a > 1e-6)) return tl
  const gap = b - a
  const groupMap = new Map<ID, ID>()
  const suffix = newId('g')
  const tracks = tl.tracks.map((t): Track => {
    if (t.locked) return t
    const out: Clip[] = []
    for (const c of t.clips) {
      const s = c.start
      const e = clipEnd(c)
      if (e <= a + 1e-9) {
        out.push(c)
      } else if (s >= b - 1e-9) {
        out.push(ripple ? { ...c, start: s - gap } : c)
      } else if (s >= a - 1e-9 && e <= b + 1e-9) {
        // tamamen içeride → silinir
      } else if (s < a && e > b) {
        const rg = c.groupId ? (groupMap.get(c.groupId) ?? (groupMap.set(c.groupId, `${c.groupId}.${suffix}`), groupMap.get(c.groupId))) : undefined
        out.push({ ...c, srcOut: c.srcIn + (a - s) })
        out.push({ ...c, id: newId('clip'), groupId: rg, start: ripple ? a : b, srcIn: c.srcIn + (b - s) })
      } else if (s < a) {
        out.push({ ...c, srcOut: c.srcIn + (a - s) }) // sağ kısım kesildi
      } else {
        // sol kısım kesildi: kalan parça b'den başlar
        out.push({ ...c, start: ripple ? a : b, srcIn: c.srcIn + (b - s) })
      }
    }
    return { ...t, clips: out.sort((x, y) => x.start - y.start) }
  })
  const captions: Caption[] = []
  for (const c of tl.captions) {
    if (c.end <= a) captions.push(c)
    else if (c.start >= b) captions.push(ripple ? { ...c, start: c.start - gap, end: c.end - gap } : c)
    else if (c.start >= a && c.end <= b) continue
    else if (c.start < a && c.end > b) captions.push({ ...c, end: ripple ? c.end - gap : c.end })
    else if (c.start < a) captions.push({ ...c, end: a })
    else captions.push({ ...c, start: ripple ? a : b, end: ripple ? c.end - gap : c.end })
  }
  return { ...tl, tracks, captions }
}

/** Klibi, aynı kaynaktan kesintisiz devam eden hemen sonraki klibiyle (ve gruplarıyla) tek klip yapar. */
export function joinWithNext(tl: Timeline, clipId: ID): Timeline {
  const f = findClip(tl, clipId)
  if (!f || f.track.locked) return tl
  const members = groupMembers(tl, clipId)
  const drop = new Set<ID>()
  const updates = new Map<ID, Clip | null>()
  for (const m of members) {
    const track = tl.tracks.find((t) => t.id === m.trackId)
    const next = track?.clips.filter((c) => c.start >= clipEnd(m) - 1e-3).sort((x, y) => x.start - y.start)[0]
    const ok = next && Math.abs(next.start - clipEnd(m)) < 1e-3 && next.assetId === m.assetId && !m.text && !next.text && Math.abs(next.srcIn - m.srcOut) < 1e-3 && next.audioStream === m.audioStream
    if (!ok || !next) return tl // tüm üyeler birleşemiyorsa hiçbiri birleşmez
    updates.set(m.id, { ...m, srcOut: next.srcOut })
    drop.add(next.id)
  }
  for (const id of drop) updates.set(id, null)
  return replaceClips(tl, updates)
}

/** Hiçbir izde içerik olmayan boşlukları siler (sonrası sola kayar). Metin izlerindeki tam uzunluklu klipler sayılmaz. */
export function closeGaps(tl: Timeline): Timeline {
  const spans = tl.tracks
    .filter((t) => t.kind !== 'text' && t.kind !== 'caption')
    .flatMap((t) => t.clips.map((c) => [c.start, clipEnd(c)] as const))
    .sort((x, y) => x[0] - y[0])
  const gaps: [number, number][] = []
  let reach = 0
  for (const [s, e] of spans) {
    if (s > reach + 1e-3) gaps.push([reach, s])
    reach = Math.max(reach, e)
  }
  return gaps.reverse().reduce((acc, [a, b]) => cutRange(acc, a, b, true), tl)
}

/** Bir altyazının konumunu (merkez, 0..1) ayarlar; `undefined` varsayılan konuma döndürür. */
export function setCaptionPos(tl: Timeline, id: ID, pos: { x: number; y: number } | undefined): Timeline {
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return { ...tl, captions: tl.captions.map((c) => (c.id === id ? (pos ? { ...c, pos: { x: clamp(pos.x), y: clamp(pos.y) } } : { id: c.id, start: c.start, end: c.end, text: c.text }) : c)) }
}

/** Tüm altyazılara aynı konumu uygular (ya da hepsini varsayılana döndürür). */
export function setAllCaptionPos(tl: Timeline, pos: { x: number; y: number } | undefined): Timeline {
  return tl.captions.reduce((acc, c) => setCaptionPos(acc, c.id, pos), tl)
}
