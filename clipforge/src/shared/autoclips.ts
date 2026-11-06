import { DENSITY, findChapters } from './chapters'
import { buildSegments } from './transcript/sentences'
import { foldTr } from './text'
import type { LayoutTemplate, NormRect, Placement, Segment, TranscriptWord } from './types'

/**
 * Auto Clips: kesilmiş videonun transkriptinden "klip olarak paylaşılabilecek" konu bölümlerini bulur (kişi/takım adına göre:
 * "Lemina hakkında konuşuyoruz" → o aralık). Zamanlar verilen kelimelerin zamanıdır (Auto Kick projesinde = çizelge zamanı).
 */
export interface AutoClipCandidate {
  id: string
  start: number
  end: number
  durationSec: number
  /** Konu: o bölümde konuşulan kişi/takım adı(ları); ad yoksa anahtar kelimeler */
  subject: string
  /** Kısa net cümle: "Lemina hakkında konuşmuşsun" */
  headline: string
  /** O bölümde söylenenlerden 1-2 cümle */
  summary: string
  score: number
}

export interface AutoClipOptions {
  minSec: number
  maxSec: number
  /** en çok kaç aday */
  max: number
  /** tercih edilen klip uzunluğu */
  targetSec: number
  /** YATAY (16:9, YouTube) klip: dikeydeki 2 dk 58 sn sınırı yok; konunun doğal uzunluğu (varsayılan 45 sn – 20 dk) */
  horizontal?: boolean
}
/** Klip süresi sınırları (kullanıcı kuralı): en az 20 sn, en çok 2 dk 58 sn (178 sn). Bir konu bu aralığa sığıyorsa BÖLÜNMEZ (70 sn'de kesilmez). */
export const MIN_CLIP_SEC = 20
export const MAX_CLIP_SEC = 178
export const DEFAULT_AUTOCLIP_OPTIONS: AutoClipOptions = { minSec: MIN_CLIP_SEC, maxSec: MAX_CLIP_SEC, max: 12, targetSec: 90 }
/** Yatay klip varsayılanları: süre sınırı yok denecek kadar geniş (en az 3 dk, en çok 25 dk; tercih ~6-7 dk; az sayıda, uzun ve kaliteli klip) */
export const HORIZONTAL_CLIP_OPTIONS: AutoClipOptions = { minSec: 180, maxSec: 1500, max: 15, targetSec: 400, horizontal: true }
export const HORIZONTAL_MAX_SEC = 3600

const END_PUNCT = /[.!?…]+["'”’)\]]*$/u
/** Cümleyi bağlayan/yarım başlatan sözler: klip bunlarla başlamasın ("ve şey işte…") */
const WEAK_START = new Set(['ve', 'ama', 'ya', 'yani', 'işte', 'iste', 'şey', 'sey', 'ki', 'de', 'da', 'tamam', 'hani', 'fakat', 'çünkü', 'cunku', 'yok', 'neyse', 'hımm', 'ee', 'eee', 'ıı', 'ııı'])
const wc = (g: Segment) => g.text.split(/\s+/).filter(Boolean).length
const firstWord = (g: Segment) => foldTr(g.text.split(/\s+/)[0] ?? '').replace(/[^\p{L}]/gu, '')
const weakStart = (g: Segment) => wc(g) < 3 || WEAK_START.has(firstWord(g)) || WEAK_START.has((g.text.split(/\s+/)[0] ?? '').toLowerCase().replace(/[^\p{L}]/gu, ''))

/**
 * Klibin başı ve sonu RASTGELE olmasın: (1) bağlaçla/çok kısa cümleyle başlayan baştaki cümleler atılır (en fazla 3),
 * (2) yarım kalmış (noktasız, çok kısa) son cümle atılır ya da tamamlayan komşu cümle eklenir; (3) sözün başına 0,3 sn, sonuna 0,5 sn
 * pay verilir (komşu kelimeye taşmadan) — söz bitmeden kesilmez. Süre sınırlarını (min/max) bozmaz.
 */
export function refineClipBounds(piece: Segment[], segs: Segment[], words: TranscriptWord[], minSec: number, maxSec: number): { start: number; end: number; piece: Segment[] } {
  let a = 0
  let b = piece.length - 1
  const hasPunct = piece.some((g) => END_PUNCT.test(g.text.trim()))
  for (let k = 0; k < 3 && a < b; k++) {
    if (!weakStart(piece[a])) break
    if (piece[b].end - piece[a + 1].start < minSec) break
    a++
  }
  if (hasPunct) {
    while (b > a && !END_PUNCT.test(piece[b].text.trim()) && piece[b - 1].end - piece[a].start >= minSec) b--
    // hâlâ yarım bitiyorsa ve devamı kısa/yakınsa tamamlayıcı cümleyi ekle
    if (!END_PUNCT.test(piece[b].text.trim())) {
      const idx = segs.indexOf(piece[b])
      const nxt = idx >= 0 ? segs[idx + 1] : undefined
      if (nxt && nxt.start - piece[b].end < 1.5 && wc(nxt) <= 14 && nxt.end - piece[a].start <= maxSec) {
        piece = [...piece.slice(0, b + 1), nxt]
        b++
      }
    }
  }
  const first = piece[a]
  const last = piece[b]
  const prevEnd = first.firstWord > 0 ? words[first.firstWord - 1].end : 0
  const nextStart = last.lastWord < words.length - 1 ? words[last.lastWord + 1].start : Infinity
  const total = words[words.length - 1]?.end ?? last.end
  const start = Math.max(0, first.start - Math.min(0.3, Math.max(0, first.start - prevEnd - 0.05)))
  let end = Math.min(total, last.end + Math.min(0.5, Math.max(0, nextStart - last.end - 0.05)))
  if (end - start > maxSec) end = start + maxSec
  return { start, end, piece: piece.slice(a, b + 1) }
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n).replace(/\s+\S*$/, '')}…`)

export function findAutoClips(words: TranscriptWord[], options: Partial<AutoClipOptions> = {}): AutoClipCandidate[] {
  // tanımsız (undefined) alanlar varsayılanı ezmesin
  const horizontal = options.horizontal === true
  const o = { ...(horizontal ? HORIZONTAL_CLIP_OPTIONS : DEFAULT_AUTOCLIP_OPTIONS), ...Object.fromEntries(Object.entries(options).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) } as AutoClipOptions
  const hardMax = horizontal ? HORIZONTAL_MAX_SEC : MAX_CLIP_SEC
  o.minSec = Math.min(hardMax - 10, Math.max(MIN_CLIP_SEC, o.minSec))
  o.maxSec = Math.min(hardMax, Math.max(o.minSec + 10, o.maxSec))
  if (words.length < 20) return []
  const segs = buildSegments(words)
  const chapters = findChapters(words, horizontal ? { ...DENSITY.medium, minSec: Math.max(30, o.minSec * 0.8), targetSec: 180, maxChapters: 200 } : { ...DENSITY.high, minSec: Math.max(15, o.minSec * 0.8), targetSec: 70, maxChapters: 400 })
  const cands: AutoClipCandidate[] = []
  // Aynı konunun art arda gelen bölümleri TEK klipte birleşir (konu yarıda kesilmez); FARKLI konular birleşmez.
  // Adlı bölümler ortak bir ad/anahtar kelime taşıyorsa, adsızlar aynı başlıktaysa aynı konudur.
  const kw = (c: { keywords: string[] }) => new Set(c.keywords.map((k) => foldTr(k)))
  const sameTopic = (a: (typeof chapters)[number], b: (typeof chapters)[number]) => {
    if (a.title === 'Giriş' || a.title === 'Sohbet' || b.title === 'Giriş' || b.title === 'Sohbet') return false
    if (a.title === b.title) return true
    const ka = kw(a)
    return a.keywords.length > 0 && b.keywords.length > 0 && [...kw(b)].some((k) => ka.has(k))
  }
  const joinGap = horizontal ? 120 : 60
  const merged = chapters.reduce<typeof chapters>((acc, ch) => {
    const prev = acc[acc.length - 1]
    if (prev && sameTopic(prev, ch) && ch.start - prev.end <= joinGap && ch.end - prev.start <= o.maxSec) acc[acc.length - 1] = { ...prev, end: ch.end, keywords: [...new Set([...prev.keywords, ...ch.keywords])] }
    else acc.push({ ...ch })
    return acc
  }, [])
  merged.forEach((ch) => {
    if (ch.title === 'Giriş' || ch.title === 'Sohbet') return
    const named = ch.keywords.length > 0 // adlı bölüm: findChapters ad bulduysa keywords adları taşır
    // bölümdeki cümleler
    let inside = segs.filter((g) => g.start >= ch.start - 0.01 && g.end <= ch.end + 0.5)
    if (inside.length === 0) return
    // klip konunun gerçekten konuşulduğu cümlelerle sınırlanır (bölüm sınırı biraz taşmış olabilir): ilk/son anma ±1 cümle
    const names = ch.title.split(',').map((x) => foldTr((x.trim().split(' ').pop() ?? x).replace(/\s+/g, ''))).filter((k) => k.length >= 3)
    if (named && names.length) {
      const idx = inside.flatMap((g, i) => (names.some((k) => foldTr(g.text).includes(k)) ? [i] : []))
      if (idx.length >= 2) {
        // konu son anıldıktan sonra da birkaç cümle sürer (zamir/devam cümleleri): yarıda kesilmesin diye +3 cümle, bölüm sınırına kadar
        const tight = inside.slice(Math.max(0, idx[0] - 1), Math.min(inside.length, idx[idx.length - 1] + 4))
        if (tight[tight.length - 1].end - tight[0].start >= o.minSec) inside = tight
      }
    }
    // çok uzunsa cümle sınırlarından eşit parçalara böl
    const total = inside[inside.length - 1].end - inside[0].start
    // yalnızca en uzun süreyi aşan konu bölünür (eşit parçalara); sığan konu tek klip kalır
    const parts = total > o.maxSec ? Math.ceil(total / o.maxSec) : 1
    const per = Math.ceil(inside.length / parts)
    for (let p = 0; p < parts; p++) {
      let piece = inside.slice(p * per, (p + 1) * per)
      // en uzun süreyi aşıyorsa sondaki cümleler atılır (cümle sınırında kalır)
      while (piece.length > 1 && piece[piece.length - 1].end - piece[0].start > o.maxSec) piece = piece.slice(0, -1)
      if (piece.length === 0) continue
      // başlangıç/bitiş: rastgele başlamasın/bitmesin (bağlaçlı baş, yarım son cümle) + söz bitmeden kesilmesin (pay)
      const ref = refineClipBounds(piece, segs, words, o.minSec, o.maxSec)
      piece = ref.piece
      const start = ref.start
      const end = ref.end
      const dur = end - start
      if (dur < o.minSec || dur > o.maxSec) continue
      const subjectWords = ch.title.split(',').map((x) => x.trim()).filter(Boolean)
      const key = subjectWords.map((x) => foldTr(x.split(' ').pop() ?? x))
      const hits = piece.filter((g) => key.some((k) => k.length >= 3 && foldTr(g.text).includes(k)))
      const pick = (hits.length >= 2 ? hits : piece).slice(0, 2)
      const mentions = hits.length
      const score = (named ? 10 : 2) + Math.min(mentions, 6) * 1.5 - Math.abs(dur - o.targetSec) / Math.max(90, o.targetSec)
      cands.push({
        id: '',
        start,
        end,
        durationSec: dur,
        subject: ch.title,
        headline: named ? `${ch.title} hakkında konuşmuşsun` : `${ch.title} üzerine konuşmuşsun`,
        summary: clip(pick.map((g) => g.text).join(' '), 200),
        score: Math.round(score * 10) / 10
      })
    }
  })
  // adlı konular varsa yalnızca onlar (anahtar kelime başlıkları "Oldukça, Pilav" gibi anlamsız olabilir); hiç ad yoksa anahtar kelimelerle devam
  // yatayda adsız ama konuşmada yoğun geçen konular da (ör. "webinar") alınır; yalnızca zayıf anahtar kelime başlıkları elenir
  const pool = horizontal ? cands.filter((c) => c.score >= 8) : cands.some((c) => c.score >= 10) ? cands.filter((c) => c.score >= 10) : cands
  // en iyi N'i seç, zaman sırasına diz, kimlik ver
  const best = [...pool].sort((a, b) => b.score - a.score).slice(0, o.max).sort((a, b) => a.start - b.start)
  return best.map((c, i) => ({ ...c, id: `ac${i + 1}` }))
}

/**
 * Klip düzeni (kullanıcının örnek ekran görüntüsüne göre, 9:16): ÜSTTE yüz (kare genişliğinde, yüksekliğin ~%41,5'i), ALTTA konuşulan
 * görüntü (kaynak karenin kendisi, tam genişlik, kalan yükseklik; ortadan kırpılarak doldurur). ORTAYA YAZI KONMAZ (kullanıcı verecek).
 * `face`: kaynak karede yüzün olduğu bölge (varsayılan sağ alt köşe; oranı üst alanla uyumlu: 16:9 kaynakta w/h ≈ 0,76).
 */
export interface AutoClipLayout {
  face: NormRect
  facePos: 'top' | 'bottom'
  /** yüz alanının kare yüksekliğine oranı */
  faceShare: number
  /** üstteki yüzün yakınlığı: 1 = kamera kutusunun tamamı; 1,12 = hafif yüze odaklı (kafanın üstünde boş duvar/beyazlık kalmaz) */
  faceZoom: number
  /** yüzün (kafa merkezinin) kamera kutusu içindeki yeri, 0..1 (x sol→sağ, y üst→alt) */
  faceFocus: { x: number; y: number }
  /** alttaki konuşulan görüntünün yakınlığı (1 = kareyi alanı dolduracak kadar; 1,15 = biraz daha büyük, ortalı) */
  screenZoom: number
}
/** Varsayılan yüz bölgesi kullanıcının örnek ekran görüntüsünden ölçüldü: kaynak karenin sağ altındaki kamera kutusu (x %70,3–100, y %60,6–98,1) */
export const DEFAULT_AUTOCLIP_LAYOUT: AutoClipLayout = { face: { x: 0.703, y: 0.606, w: 0.297, h: 0.375 }, facePos: 'top', faceShare: 0.415, faceZoom: 1.12, faceFocus: { x: 0.495, y: 0.58 }, screenZoom: 1.15 }

/**
 * Üstteki yüz için kaynak kırpması: kamera kutusunun içinde, yüze (kafa merkezi `faceFocus`) odaklı ve `faceZoom` kadar yakın;
 * üst alanın en-boy oranına uyar. Kafa, kırpmanın üst ~%42'sinde durur: kafanın üstünde yalnızca küçük pay kalır (boş duvar/beyazlık yok).
 * Kırpma her zaman kamera kutusunun içinde kalır (kutunun üstündeki sayfa şeridi görünmez).
 */
export function faceCrop(layout: Pick<AutoClipLayout, 'face' | 'faceShare' | 'faceZoom' | 'faceFocus'>, srcAspect: number): NormRect {
  const f = layout.face
  const share = Math.min(0.7, Math.max(0.2, layout.faceShare))
  const slotRatio = 1080 / (1920 * share) // üst alanın piksel oranı
  const z = Math.min(4, Math.max(1, layout.faceZoom))
  let h = f.h / z
  let w = (h * slotRatio) / srcAspect
  if (w > f.w) {
    w = f.w
    h = (w * srcAspect) / slotRatio
  }
  if (h > f.h) {
    h = f.h
    w = (h * slotRatio) / srcAspect
  }
  const fx = Math.min(1, Math.max(0, layout.faceFocus.x))
  const fy = Math.min(1, Math.max(0, layout.faceFocus.y))
  const headX = f.x + fx * f.w
  const headY = f.y + fy * f.h
  const x = Math.min(f.x + f.w - w, Math.max(f.x, headX - w / 2))
  const y = Math.min(f.y + f.h - h, Math.max(f.y, headY - 0.42 * h))
  return { x, y, w, h }
}

/**
 * Alttaki konuşulan görüntü için kaynak kırpması (kare ortalı, `zoom` kadar yakın), alt alanın en-boy oranına uyar (bozulma yok).
 * Kırpma yüz kutusuna taşıyorsa (kameranın bir kısmı altta da görünmesin) sola kaydırılır; böylece yüz yalnızca üstte görünür.
 */
export function screenCrop(layout: Pick<AutoClipLayout, 'face' | 'faceShare' | 'screenZoom'>, srcAspect: number): NormRect {
  const share = Math.min(0.7, Math.max(0.2, layout.faceShare))
  const slotRatio = 1080 / (1920 * (1 - share)) // alt alanın piksel oranı (9:16 kare)
  const z = Math.min(3, Math.max(1, layout.screenZoom))
  let h = 1 / z
  let w = (h * slotRatio) / srcAspect
  if (w > 1) {
    w = 1
    h = srcAspect / slotRatio
  }
  let x = 0.5 - w / 2
  const y = 0.5 - h / 2
  const f = layout.face
  if (x + w > f.x - 0.004 && y + h > f.y && x < f.x + f.w) x = Math.max(0, f.x - 0.004 - w)
  return { x, y, w, h }
}

/** Klip projesi şablonu: V2 = yüz (webcam), V1 = konuşulan görüntü; ikisi de "cover" (alanı doldurur) */
export function autoClipTemplate(layout: Partial<AutoClipLayout> = {}): LayoutTemplate {
  const share = Math.min(0.7, Math.max(0.2, layout.faceShare ?? DEFAULT_AUTOCLIP_LAYOUT.faceShare))
  const top = (layout.facePos ?? 'top') === 'top'
  const faceRect = { x: 0, y: top ? 0 : 1 - share, w: 1, h: share }
  const screenRect = { x: 0, y: top ? share : 0, w: 1, h: 1 - share }
  const pl = (rect: NormRect): Placement => ({ rect, fit: 'cover', visible: true, opacity: 1 })
  return {
    id: 'autoclip-face-top',
    name: 'Auto Clips: yüz üstte, görüntü altta (9:16)',
    builtin: true,
    aspect: '9:16',
    background: '#000000',
    layers: [
      { id: 'V2', name: 'Yüz', kind: 'video', role: 'webcam', placement: pl(faceRect) },
      { id: 'V1', name: 'Konuşulan görüntü', kind: 'video', role: 'screen', placement: pl(screenRect) }
    ]
  }
}

/** "x,y,w,h" (0..1) → bölge; bozuksa null */
export function parseRect(v: string): NormRect | null {
  const n = v.split(/[,\s]+/).map(Number)
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x))) return null
  const [x, y, w, h] = n
  if (w <= 0.02 || h <= 0.02 || x < 0 || y < 0 || x + w > 1.001 || y + h > 1.001) return null
  return { x, y, w, h }
}

// ───────────────────────── Otomatik zincir: Auto Kick → Auto Clips (gözetimsiz) ─────────────────────────

export type AutoClipsStage = 'find' | 'make' | 'export'
export const AUTOCLIPS_STAGES: { id: AutoClipsStage; label: string }[] = [
  { id: 'find', label: 'Konuları bul' },
  { id: 'make', label: 'Klip projelerini üret' },
  { id: 'export', label: 'Klipleri MP4 olarak dışa aktar' }
]
export interface AutoClipsRequest {
  /** Auto Kick projesi (ya da klasörü) */
  projectPath: string
  minSec?: number
  maxSec?: number
  /** en çok klip */
  max?: number
  face?: NormRect
  facePos?: 'top' | 'bottom'
  faceShare?: number
  faceZoom?: number
  faceFocus?: { x: number; y: number }
  screenZoom?: number
  /** klipleri MP4 olarak da dışa aktar */
  exportVideos?: boolean
  /** dikey klipler otomatik altyazılı gelsin (2–4 kelime, iri beyaz) */
  captions?: boolean
  /** YATAY (16:9, YouTube) klipler: 2 dk 58 sn sınırı yok, yüz/şerit eklenmez, "youtube" ön ayarıyla dışa aktarılır */
  horizontal?: boolean
}
export interface AutoClipsStageState {
  id: AutoClipsStage
  label: string
  status: 'pending' | 'running' | 'done' | 'skipped' | 'failed'
  progress: number
  detail?: string
}
export interface AutoClipResultItem {
  id: string
  subject: string
  headline: string
  start: number
  end: number
  durationSec: number
  projectPath?: string
  videoPath?: string
  /** bu klip için hata (diğerleri etkilenmez) */
  error?: string
}
export interface AutoClipsResult {
  dir: string
  clips: AutoClipResultItem[]
}
export interface AutoClipsStatus {
  id: string
  request: AutoClipsRequest
  name: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  stages: AutoClipsStageState[]
  error?: string
  result?: AutoClipsResult
  startedAt: number
  finishedAt?: number
}
export const initialAutoClipsStages = (): AutoClipsStageState[] => AUTOCLIPS_STAGES.map((s) => ({ ...s, status: 'pending', progress: 0 }))

/**
 * Sosyal medya şeridi (alan adları): yüz alanı ile alttaki görüntünün KESİŞTİĞİ çizgiye ortalı yerleşir.
 * `imageRatio` = şerit görüntüsünün genişlik/yükseklik oranı; kare 9:16 (1080×1920) varsayılır. Dönen: kareye göre normalleştirilmiş dikdörtgen.
 */
export function overlayRect(faceShare: number, imageRatio: number, widthFrac = 0.86, facePos: 'top' | 'bottom' = 'top'): NormRect {
  const share = Math.min(0.7, Math.max(0.2, faceShare))
  const w = Math.min(1, Math.max(0.3, widthFrac))
  const hPx = (w * 1080) / Math.max(1, imageRatio)
  const h = hPx / 1920
  const seam = facePos === 'top' ? share : 1 - share
  return { x: (1 - w) / 2, y: Math.min(1 - h, Math.max(0, seam - h / 2)), w, h }
}
