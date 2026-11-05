import { DENSITY, findChapters } from './chapters'
import { buildSegments } from './transcript/sentences'
import { foldTr } from './text'
import type { LayoutTemplate, NormRect, Placement, TranscriptWord } from './types'

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
}
export const DEFAULT_AUTOCLIP_OPTIONS: AutoClipOptions = { minSec: 20, maxSec: 90, max: 12, targetSec: 45 }

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n).replace(/\s+\S*$/, '')}…`)

export function findAutoClips(words: TranscriptWord[], options: Partial<AutoClipOptions> = {}): AutoClipCandidate[] {
  // tanımsız (undefined) alanlar varsayılanı ezmesin
  const o = { ...DEFAULT_AUTOCLIP_OPTIONS, ...Object.fromEntries(Object.entries(options).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) } as AutoClipOptions
  if (words.length < 20) return []
  const segs = buildSegments(words)
  const chapters = findChapters(words, { ...DENSITY.high, minSec: Math.max(15, o.minSec * 0.8), targetSec: o.targetSec, maxChapters: 400 })
  const cands: AutoClipCandidate[] = []
  chapters.forEach((ch) => {
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
        const tight = inside.slice(Math.max(0, idx[0] - 1), Math.min(inside.length, idx[idx.length - 1] + 2))
        if (tight[tight.length - 1].end - tight[0].start >= o.minSec) inside = tight
      }
    }
    // çok uzunsa cümle sınırlarından eşit parçalara böl
    const total = inside[inside.length - 1].end - inside[0].start
    const parts = total > o.maxSec ? Math.ceil(total / o.targetSec) : 1
    const per = Math.ceil(inside.length / parts)
    for (let p = 0; p < parts; p++) {
      const piece = inside.slice(p * per, (p + 1) * per)
      if (piece.length === 0) continue
      const start = piece[0].start
      const end = piece[piece.length - 1].end
      const dur = end - start
      if (dur < o.minSec || dur > o.maxSec + 15) continue
      const subjectWords = ch.title.split(',').map((x) => x.trim()).filter(Boolean)
      const key = subjectWords.map((x) => foldTr(x.split(' ').pop() ?? x))
      const hits = piece.filter((g) => key.some((k) => k.length >= 3 && foldTr(g.text).includes(k)))
      const pick = (hits.length >= 2 ? hits : piece).slice(0, 2)
      const mentions = hits.length
      const score = (named ? 10 : 2) + Math.min(mentions, 6) * 1.5 - Math.abs(dur - o.targetSec) / 15
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
  const pool = cands.some((c) => c.score >= 10) ? cands.filter((c) => c.score >= 10) : cands
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
  /** alttaki konuşulan görüntünün yakınlığı (1 = kareyi alanı dolduracak kadar; 1,15 = biraz daha büyük, ortalı) */
  screenZoom: number
}
/** Varsayılan yüz bölgesi kullanıcının örnek ekran görüntüsünden ölçüldü: kaynak karenin sağ altındaki kamera kutusu (x %70,3–100, y %60,6–98,1) */
export const DEFAULT_AUTOCLIP_LAYOUT: AutoClipLayout = { face: { x: 0.703, y: 0.606, w: 0.297, h: 0.375 }, facePos: 'top', faceShare: 0.415, screenZoom: 1.15 }

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
  screenZoom?: number
  /** klipleri MP4 olarak da dışa aktar */
  exportVideos?: boolean
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
