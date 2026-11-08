import { useEffect, useRef, useState } from 'react'
import { cmd } from '@shared/timeline/commands'
import { audioCarriersOf } from '@shared/timeline/ops'
import type { Clip, Timeline } from '@shared/types'
import { useStore } from '../store'

/** dB (-90..0) → görsel genlik 0..1 */
export const waveAmp = (db: number) => Math.pow(Math.min(1, Math.max(0, (db + 56) / 56)), 1.25)
const dbOf = (v: number) => (v <= 0.001 ? '-∞' : (20 * Math.log10(v)).toFixed(1))

/**
 * Klibin ÜZERİNDE ses dalgası (ayrı ses katmanı açmadan): video klibinin bağlı sesinin dalgası klibin alt yarısında görünür.
 * Üstündeki ince çizgi SES SEVİYESİ tutamacıdır: aşağı sürükleyince ses kısılır (0.0 dB = tam seviye). Çift tıklama: tam seviye.
 * Sesi kapalıysa dalga sönük görünür.
 */
export function ClipWave({ clip, tl, widthPx, heightPx }: { clip: Clip; tl: Timeline; widthPx: number; heightPx: number }) {
  const carriers = audioCarriersOf(tl, [clip.id])
  const carrier = carriers[0]
  const wave = useStore((s) => (carrier ? s.waveforms[`${carrier.assetId}|${carrier.audioStream ?? 0}`] : undefined))
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tip, setTip] = useState<string | null>(null)
  const muted = !!carrier && carriers.every((c) => c.muted)
  const volume = carrier ? carrier.volume : 1

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !wave || !carrier) return
    const W = Math.max(1, Math.min(3000, Math.round(widthPx)))
    const H = Math.max(8, Math.round(heightPx))
    c.width = W
    c.height = H
    const g = c.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, W, H)
    g.fillStyle = muted ? 'rgba(255,255,255,.25)' : 'rgba(150,235,225,.9)'
    const span = Math.max(0.001, carrier.srcOut - carrier.srcIn)
    const mid = H / 2
    for (let x = 0; x < W; x++) {
      const t0 = carrier.srcIn + (x / W) * span
      const t1 = carrier.srcIn + ((x + 1) / W) * span
      const i0 = Math.floor(t0 * wave.binPerSec)
      const i1 = Math.max(i0 + 1, Math.ceil(t1 * wave.binPerSec))
      let m = -90
      for (let i = i0; i < i1 && i < wave.db.length; i++) if (wave.db[i] > m) m = wave.db[i]
      const a = waveAmp(m) * volume
      const h = Math.max(1, a * H)
      g.fillRect(x, mid - h / 2, 1, h)
    }
  }, [wave, carrier?.srcIn, carrier?.srcOut, carrier?.assetId, widthPx, heightPx, muted, volume, carrier])

  if (!carrier) return null
  const setVol = (v: number) => {
    const val = Math.min(1, Math.max(0, v))
    for (const c of carriers) useStore.getState().exec(cmd.updateClip(c.id, { volume: val }, true))
  }
  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const el = e.currentTarget.parentElement as HTMLElement
    e.currentTarget.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect()
      const v = 1 - (ev.clientY - r.top) / r.height
      setVol(v)
      setTip(`${dbOf(Math.min(1, Math.max(0, v)))}dB`)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setTip(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className="clip-wave" data-testid="clip-wave" style={{ height: heightPx }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      <div
        className="vol-handle"
        data-testid="vol-handle"
        style={{ top: `${(1 - volume) * 100}%` }}
        title={`Ses seviyesi: ${dbOf(volume)} dB (aşağı sürükle: kıs; çift tıkla: sıfırla)`}
        onPointerDown={onHandleDown}
        onPointerEnter={() => setTip(`${dbOf(volume)}dB`)}
        onPointerLeave={() => setTip(null)}
        onDoubleClick={(e) => { e.stopPropagation(); setVol(1) }}
      >
        <span className="vol-dot" />
      </div>
      {tip && <div className="vol-tip" data-testid="vol-tip">{tip}</div>}
    </div>
  )
}
