import type { ListedChapter } from './chapters'

/** "YouTube yatay video": bütün yayından, verilen zaman damgalarının HER BİRİNİ ayrı bir yatay video olarak keser (orijinal kayıt zamanı, kesim/sessiz kırpma yok). */
export interface YtCutRequest {
  videoPath: string
  /** Zaman damgası listesi metni ("00:34:00 - Leo", "00:41:00 - 00:45:00 Deniz Gül") */
  list: string
  /** Çıkış klasörü; boşsa kaydın yanında `YouTube Yatay/<kayıt adı>/` */
  outDir?: string
  /** fast: hızlı kodlama (varsayılan); high: daha yavaş, daha küçük/iyi sıkıştırma */
  quality?: 'fast' | 'high'
}

export interface YtCutItem {
  index: number
  title: string
  start: number
  end: number
  durationSec: number
  /** üretilen dosya (hata olduysa yok) */
  path?: string
  error?: string
}

export interface YtCutResult {
  dir: string
  items: YtCutItem[]
  warnings: string[]
}

/** Dosya adı için güvenli başlık (Windows: \ / : * ? " < > | yasak; nokta/boşlukla bitmez; 80 karakter) */
export function safeFileTitle(title: string): string {
  const t = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80)
  return t || 'Bolum'
}

/** Liste → kesilecek aralıklar: bitiş yazılmışsa o, yoksa bir sonraki satırın başı (son satır: video sonu). Süreyi aşanlar kırpılır, 2 sn'den kısalar atlanır. */
export function ytCutRanges(list: ListedChapter[], videoSec: number): { items: YtCutItem[]; warnings: string[] } {
  const warnings: string[] = []
  const items: YtCutItem[] = []
  list.forEach((c, i) => {
    const end = Math.min(videoSec, c.end ?? list[i + 1]?.start ?? videoSec)
    if (c.start >= videoSec) return void warnings.push(`"${c.title}" (${Math.floor(c.start / 60)} dk) videonun süresini aşıyor; atlandı.`)
    if (end - c.start < 2) return void warnings.push(`"${c.title}" 2 saniyeden kısa; atlandı.`)
    if (c.end !== undefined && c.end > videoSec) warnings.push(`"${c.title}" bitişi video süresini aşıyor; video sonuna kadar kesildi.`)
    items.push({ index: items.length + 1, title: c.title, start: c.start, end, durationSec: end - c.start })
  })
  return { items, warnings }
}

export const ytCutFileName = (index: number, title: string, total: number): string => `${String(index).padStart(Math.max(2, String(total).length), '0')} - ${safeFileTitle(title)}.mp4`
