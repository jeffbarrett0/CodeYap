import { spawn } from 'node:child_process'
import type { MediaTools } from '../media/import'

/**
 * KONUŞMA KORUMASI için gerçek ses analizi: konuşma track'i 16 kHz mono çözülür, 20 ms'lik karelerde ses seviyesi (dB) ölçülür,
 * kayıtın kendi gürültü tabanına göre "ses var" aralıkları çıkarılır. Sessizlik kesimleri bu aralıklara GİREMEZ (silence.ts `voiced`).
 * (Whisper kelime zamanları konuşmanın başlangıcını sıklıkla geç verir; ayrıca hiç yazmadığı sözler "sessizlik" sanılırdı.)
 */
export const VOICE_FRAME_SEC = 0.02

export interface VoiceAnalysis {
  /** ses olan aralıklar (KAYNAK zamanı, sn) */
  runs: [number, number][]
  thresholdDb: number
  /** kaydın gürültü tabanı (10. yüzdelik) ve konuşma seviyesi (95. yüzdelik), dB */
  noiseDb: number
  refDb: number
  /** gürültü ile konuşma arası fark çok küçükse (sürekli ses: oyun/müzik aynı kanalda) hemen her yer "ses var" çıkar → kesim çok azalır, güvenli yönde */
  continuous: boolean
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))]

/** SAF: kare dB değerlerinden "ses var" aralıkları (testlenebilir) */
export function voicedFromFrames(db: ArrayLike<number>, frameSec = VOICE_FRAME_SEC): VoiceAnalysis {
  const valid: number[] = []
  for (let i = 0; i < db.length; i++) if (db[i] > -100) valid.push(db[i])
  if (valid.length < 10) return { runs: [], thresholdDb: -100, noiseDb: -100, refDb: -100, continuous: false }
  const sorted = [...valid].sort((a, b) => a - b)
  const noise = pct(sorted, 0.1)
  const ref = pct(sorted, 0.95)
  const spread = ref - noise
  const continuous = spread < 10
  // eşik: gürültü tabanının en az 8 dB üstü ve aradaki farkın %30'u; sürekli kayıtta eşik konuşma seviyesine yakın tutulur
  const thr = continuous ? ref - 8 : Math.min(ref - 10, noise + Math.max(8, 0.3 * spread))
  const minRun = 3 // 60 ms
  const mergeGap = Math.round(0.15 / frameSec) // sözcük içi kısa çukurlar (ünsüz, nefes) tek konuşma sayılır
  const pad = 1
  const runs: [number, number][] = []
  let i = 0
  while (i < db.length) {
    if (db[i] > thr) {
      let j = i
      while (j < db.length && db[j] > thr) j++
      if (j - i >= minRun) runs.push([Math.max(0, i - pad), j + pad])
      i = j
    } else i++
  }
  const merged: [number, number][] = []
  for (const r of runs) {
    const last = merged[merged.length - 1]
    if (last && r[0] - last[1] <= mergeGap) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  // ARKA PLAN SESİ AYIKLAMA (kullanıcı: "birkaç saniye susuyorum, kesmemişsin"): oyun/müzik/oda sesi eşiği aşıp susma anlarını "konuşma" gösteriyordu.
  // Bir saniyeden uzun bir aralık, konuşma seviyesinin (95. yüzdelik) 14 dB'den fazla altında kalıyorsa konuşma sayılmaz. Kısa aralıklar (sessiz tek kelime) hep korunur.
  const keep = (a: number, b: number): boolean => {
    if (continuous) return true
    const len = (b - a) * frameSec
    if (len < 1.0) return true
    const seg: number[] = []
    for (let k = Math.max(0, a); k < Math.min(db.length, b); k++) seg.push(db[k])
    seg.sort((x, y) => x - y)
    const p90 = pct(seg, 0.9)
    if (p90 < ref - 14) return false
    return true
  }
  const speech = merged.filter(([a, b]) => keep(a, b))
  return { runs: speech.map(([a, b]) => [a * frameSec, b * frameSec] as [number, number]), thresholdDb: thr, noiseDb: noise, refDb: ref, continuous }
}

/** Kaynak zamanındaki aralıkları çizelge zamanına çevirir (yalnızca korunan klip parçalarına düşenler) */
export function mapVoicedToTimeline(runs: [number, number][], kept: { srcIn: number; srcOut: number; start: number }[]): [number, number][] {
  const out: [number, number][] = []
  for (const k of kept) {
    for (const [a, b] of runs) {
      const lo = Math.max(a, k.srcIn)
      const hi = Math.min(b, k.srcOut)
      if (hi > lo) out.push([k.start + (lo - k.srcIn), k.start + (hi - k.srcIn)])
    }
  }
  return out.sort((x, y) => x[0] - y[0])
}

/** Ses akışını çözüp kare dB dizisine çevirir (akış halinde: 2,5 saatlik kayıt bellekte ~450 bin sayıdır) ve aralıkları bulur */
export async function detectVoicedRuns(file: string, audioIndex: number, tools: MediaTools, opts: { signal?: AbortSignal; durationSec?: number; onProgress?: (f: number) => void } = {}): Promise<VoiceAnalysis> {
  const frameSamples = Math.round(16000 * VOICE_FRAME_SEC) // 320
  const db: number[] = []
  await new Promise<void>((resolve, reject) => {
    const child = spawn(tools.ffmpeg, ['-nostdin', '-v', 'error', '-i', file, '-map', `0:a:${Math.max(0, audioIndex)}`, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let leftover: Buffer = Buffer.alloc(0)
    let acc = 0
    let n = 0
    let err = ''
    const abort = () => child.kill('SIGKILL')
    opts.signal?.addEventListener('abort', abort, { once: true })
    child.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-400)))
    child.stdout.on('data', (chunk: Buffer) => {
      const buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk
      const usable = buf.length - (buf.length % 2)
      for (let o = 0; o < usable; o += 2) {
        const v = buf.readInt16LE(o) / 32768
        acc += v * v
        if (++n === frameSamples) {
          db.push(acc > 0 ? 10 * Math.log10(acc / n) : -120)
          acc = 0
          n = 0
        }
      }
      leftover = buf.subarray(usable)
      if (opts.durationSec && opts.onProgress) opts.onProgress(Math.min(1, (db.length * VOICE_FRAME_SEC) / opts.durationSec))
    })
    child.on('error', reject)
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', abort)
      if (opts.signal?.aborted) return reject(new Error('İptal edildi.'))
      if (code !== 0 && db.length === 0) return reject(new Error(`Ses çözülemedi: ${err.trim().split('\n').pop() ?? code}`))
      resolve()
    })
  })
  return voicedFromFrames(db)
}
