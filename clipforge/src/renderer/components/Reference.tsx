import { useEffect, useState } from 'react'
import { aspectLabel, type ReferenceEntry } from '@shared/reference'
import { requireApi } from '../api'
import { useStore } from '../store'
import { fmt, Modal } from './ui'

/**
 * Referans: beğendiğin bir videoyu at → ölçümleri (boyut, plan değişimi, bölme çizgisi) + kare tabloları çıkarılır.
 * Claude Code bu tablolara bakıp videonun tarzını (yerleşim, altyazı, geçişler, tempo) inceler ve ClipForge'a uyarlar.
 */
export function ReferenceDialog() {
  const api = requireApi()
  const { openDialog, toast } = useStore()
  const [list, setList] = useState<ReferenceEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [sheets, setSheets] = useState<string[]>([])
  const [error, setError] = useState('')

  const reload = async () => setList(await api.invoke('reference:list'))
  useEffect(() => {
    void reload()
  }, [])
  useEffect(() => {
    setSheets([])
    if (open) void api.invoke('reference:sheets', open).then(setSheets, () => undefined)
  }, [open])

  const add = async () => {
    const f = await api.invoke('dialog:openFile', { title: 'Referans video seç', extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v'] })
    if (!f) return
    setBusy(true)
    setError('')
    try {
      const e = await api.invoke('reference:add', f)
      await reload()
      setOpen(e.id)
      toast('success', 'Referans eklendi. Claude Code\'a "referansı incele ve uyarla" yaz.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const cur = list.find((r) => r.id === open)
  const cmd = cur ? `"${cur.name}" referans videosunu incele (referans id: ${cur.id}) ve ClipForge'a uyarla.` : ''

  return (
    <Modal title="Referans — beğendiğin videoyu at, siteye uyarlansın" onClose={() => openDialog(null)} wide>
      <p className="muted" style={{ marginTop: 0 }}>Beğendiğin bir videoyu ekle. Ölçümleri ve kare tablolarını çıkarırım; sonra Claude Code'a söyleyince videoyu inceleyip tarzını (yerleşim, altyazı, geçişler, tempo) ClipForge'a uyarlar. Videon kopyalanmaz, yerinde okunur; başka kanalların adı/logosu kopyalanmaz.</p>
      <div className="row">
        <button className="btn primary" onClick={() => void add()} disabled={busy} data-testid="reference-add">{busy ? 'İnceleniyor…' : '＋ Referans video ekle'}</button>
        {error && <span className="err" data-testid="reference-error">{error}</span>}
      </div>
      <div className="ref-list" data-testid="reference-list" style={{ display: 'grid', gap: 6, margin: '12px 0' }}>
        {list.length === 0 && <div className="muted">Henüz referans yok.</div>}
        {list.map((r) => (
          <button key={r.id} className={`btn${open === r.id ? ' primary' : ''}`} style={{ textAlign: 'left' }} onClick={() => setOpen(open === r.id ? null : r.id)} data-testid="reference-item">
            {r.name} · {aspectLabel(r.width, r.height)} · {fmt(r.durationSec)} {r.status === 'adapted' ? '· ✔ uyarlandı' : ''}
          </button>
        ))}
      </div>
      {cur && (
        <div data-testid="reference-detail">
          <div className="muted">
            {cur.width}×{cur.height} · {cur.fps} fps · {cur.hasAudio ? 'sesli' : 'sessiz'} · {cur.cuts.length} plan değişimi (ortalama {cur.avgShotSec} sn){cur.splitLine !== null ? ` · olası yatay çizgi: yüksekliğin %${Math.round(cur.splitLine * 100)}'inde (yaklaşık; kare tablosundan doğrula)` : ' · bölme çizgisi yok'}
          </div>
          <div style={{ display: 'grid', gap: 6, margin: '8px 0' }}>
            {sheets.map((s, i) => <img key={i} src={s} alt={`Kare tablosu ${i + 1}`} style={{ maxWidth: '100%', borderRadius: 6 }} />)}
          </div>
          <label className="muted">Notların (neyi beğendin?)
            <textarea value={cur.notes} rows={3} style={{ width: '100%' }} data-testid="reference-notes" onChange={(e) => setList(list.map((x) => (x.id === cur.id ? { ...x, notes: e.target.value } : x)))} onBlur={() => void api.invoke('reference:update', { id: cur.id, notes: cur.notes })} />
          </label>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => { void navigator.clipboard?.writeText(cmd); toast('info', 'Komut kopyalandı: Claude Code\'a yapıştır.') }} data-testid="reference-copy">Claude Code komutunu kopyala</button>
            <button className="btn ghost" onClick={async () => { await api.invoke('reference:remove', cur.id); setOpen(null); await reload() }} data-testid="reference-remove">Sil</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
