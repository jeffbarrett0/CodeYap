import { ADJUST_DEFS, adjustValue, cleanAdjust, adjustIsDefault, type AdjustKey } from '@shared/adjust'
import { cmd } from '@shared/timeline/commands'
import { audioCarriersOf } from '@shared/timeline/ops'
import type { Clip, ClipFx, Timeline, Track } from '@shared/types'
import { useStore } from '../store'

/** CapCut tarzı: etiket + kaydırıcı + sağda sayı kutusu; çift tık = varsayılana döner */
function SliderNum({ label, value, min, max, step = 1, def = 0, suffix, onChange, testid }: { label: string; value: number; min: number; max: number; step?: number; def?: number; suffix?: string; onChange: (v: number) => void; testid?: string }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  return (
    <div className="fx-row" data-testid={testid}>
      <div className="fx-label" onDoubleClick={() => onChange(def)} title="Çift tıkla: varsayılana dön">{label}</div>
      <div className="fx-ctl">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(clamp(Number(e.target.value)))} onDoubleClick={() => onChange(def)} aria-label={label} />
        <span className="fx-num"><input type="number" min={min} max={max} step={step} value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0} onChange={(e) => e.target.value !== '' && onChange(clamp(Number(e.target.value)))} aria-label={`${label} değeri`} />{suffix && <i>{suffix}</i>}</span>
      </div>
    </div>
  )
}

const db = (vol: number) => (vol <= 0.0001 ? '−∞' : `${(20 * Math.log10(vol)).toFixed(1)}`)

/** Ses sekmesi: ses seviyesi (% ve dB), giriş/çıkış, ses şiddetini eşitle; video klibi seçiliyse bağlı ses klibine uygulanır */
export function AudioClipPanel({ clip, track, tl }: { clip: Clip; track: Track; tl: Timeline }) {
  const exec = useStore((s) => s.exec)
  const carriers = track.kind === 'audio' ? [clip] : audioCarriersOf(tl, [clip.id])
  if (carriers.length === 0) return <div className="hint" data-testid="fx-no-audio">Bu klibin sesi yok: görüntü klibine bağlı bir ses klibi bulunmuyor.</div>
  const c0 = carriers[0]
  const setVol = (v: number) => carriers.forEach((c) => exec(cmd.updateClip(c.id, { volume: Math.max(0, v / 100) }, true)))
  const setFx = (patch: Partial<ClipFx>) => carriers.forEach((c) => exec(cmd.updateClip(c.id, { fx: { ...c.fx, ...patch } }, true)))
  return (
    <div className="col" data-testid="fx-audio">
      <div className="section-title">Ses seviyesi</div>
      <SliderNum label="Ses" value={Math.round(c0.volume * 100)} min={0} max={200} def={100} suffix="%" onChange={setVol} testid="fx-volume" />
      <div className="hint" data-testid="fx-volume-db">{db(c0.volume)} dB · 100 = özgün ses, 20 = çok kısık, 0 = sessiz{c0.muted ? ' · şu an KAPALI (M)' : ''}</div>
      <SliderNum label="Giriş (sn)" value={c0.fx?.fadeIn ?? 0} min={0} max={10} step={0.1} def={0} suffix="s" onChange={(v) => setFx({ fadeIn: v > 0 ? v : undefined })} testid="fx-fade-in" />
      <SliderNum label="Çıkış (sn)" value={c0.fx?.fadeOut ?? 0} min={0} max={10} step={0.1} def={0} suffix="s" onChange={(v) => setFx({ fadeOut: v > 0 ? v : undefined })} testid="fx-fade-out" />
      <label className="check" title="Klibin ses şiddetini yayın standardına (−16 LUFS) eşitler; dışa aktarmada uygulanır">
        <input type="checkbox" checked={!!c0.fx?.normalize} onChange={(e) => setFx({ normalize: e.target.checked || undefined })} data-testid="fx-normalize" /> Ses şiddetini eşitle (normalize)
      </label>
      <div className="row wrap">
        <button className="btn sm" onClick={() => { setVol(100); setFx({ fadeIn: undefined, fadeOut: undefined, normalize: undefined }) }} data-testid="fx-audio-reset">Sıfırla</button>
      </div>
      <div className="hint">Arka plan gürültüsü için araç çubuğundaki <b>Arka ses</b> kutusunu kullanın.</div>
    </div>
  )
}

/** Ayarla sekmesi (CapCut: Basic): renk, ışık, efektler; değerler dışa aktarmada tam uygulanır, önizlemede pozlama/kontrast/doygunluk görünür */
export function AdjustPanel({ clip, tl }: { clip: Clip; tl: Timeline }) {
  const exec = useStore((s) => s.exec)
  const toast = useStore((s) => s.toast)
  const cur = clip.fx?.adjust
  const set = (k: AdjustKey, v: number) => {
    const next = cleanAdjust({ ...cur, [k]: v })
    const fx: ClipFx = { ...clip.fx }
    if (next) fx.adjust = next
    else delete fx.adjust
    exec(cmd.updateClip(clip.id, { fx: Object.keys(fx).length ? fx : undefined }, true))
  }
  const reset = () => {
    const fx: ClipFx = { ...clip.fx }
    delete fx.adjust
    exec(cmd.updateClip(clip.id, { fx: Object.keys(fx).length ? fx : undefined }))
  }
  const applyAll = () => {
    let n = 0
    for (const t of tl.tracks) {
      if (t.kind !== 'video' && t.kind !== 'image') continue
      for (const c of t.clips) {
        if (c.id === clip.id || !c.assetId) continue
        const fx: ClipFx = { ...c.fx }
        if (cur) fx.adjust = { ...cur }
        else delete fx.adjust
        exec(cmd.updateClip(c.id, { fx: Object.keys(fx).length ? fx : undefined }))
        n++
      }
    }
    toast('success', n ? `Ayarlar ${n} klibe uygulandı.` : 'Uygulanacak başka klip yok.')
  }
  const groups = ['Renk', 'Işık', 'Efektler'] as const
  return (
    <div className="col" data-testid="fx-adjust">
      {groups.map((g) => (
        <div key={g} className="col">
          <div className="section-title">{g}</div>
          {ADJUST_DEFS.filter((d) => d.group === g).map((d) => (
            <SliderNum key={d.key} label={d.label} value={adjustValue(cur, d.key)} min={d.min} max={d.max} onChange={(v) => set(d.key, v)} testid={`adj-${d.key}`} />
          ))}
        </div>
      ))}
      <div className="row wrap">
        <button className="btn sm" onClick={reset} disabled={adjustIsDefault(cur)} data-testid="adj-reset">Sıfırla</button>
        <button className="btn sm primary" onClick={applyAll} data-testid="adj-apply-all">Tümüne uygula</button>
      </div>
      <div className="hint">Önizlemede pozlama, kontrast ve doygunluk görünür; diğer ayarlar (sıcaklık, keskinlik, netlik, tanecik, solma, vinyet…) dışa aktarılan videoda tam uygulanır.</div>
    </div>
  )
}
