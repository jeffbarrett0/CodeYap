import { useState } from 'react'
import { timelineDuration } from '@shared/timeline/model'
import { requireApi } from '../api'
import { useStore } from '../store'
import { fmt } from './ui'
import type { ChapterDensity } from '@shared/chapters'

/**
 * YouTube zaman damgaları: DÜZENLENMİŞ videonun (kesimler ve boşluk kapatma sonrası zaman çizelgesi) konu bölümleri.
 * Çıktı, YouTube açıklamasına yapıştırılacak metindir ("Saniyeler:" ardından "00:00:00 - Giriş", "00:12:42 - Ederson", …); metni burada düzenleyebilirsiniz.
 */
export function ChaptersPanel() {
  const { project, chapters, chaptersText, chaptersBusy, chaptersError, generateChapters, setChaptersText, settings, openDialog, toast } = useStore()
  const api = requireApi()
  const aiReady = settings.llmProvider !== 'off'
  const [useAi, setUseAi] = useState(true)
  const [density, setDensity] = useState<ChapterDensity>('medium')
  const total = timelineDuration(project.timeline)

  const copy = () => {
    void navigator.clipboard?.writeText(chaptersText).catch(() => undefined)
    toast('success', 'Zaman damgaları kopyalandı: YouTube açıklamasına yapıştırın.')
  }
  const save = async () => {
    const path = await api.invoke('dialog:saveFile', { defaultName: `${project.name} - zaman damgaları.txt`, extensions: ['txt'] })
    if (!path) return
    await api.invoke('file:writeText', path, chaptersText + '\n')
    toast('success', `Kaydedildi: ${path}`)
  }

  return (
    <div className="panel-body" data-testid="chapters-panel">
      <div className="infobox">Düzenlediğiniz videonun (sessizler kesilmiş, boşluklar kapanmış <b>zaman çizelgesi</b>) konu bölümlerini bulur ve YouTube açıklamasına yapıştırılacak <b>zaman damgalarını</b> çıkarır: "bu dakika arası şunu konuştum".</div>
      <div className="hint">Zaman çizelgesi: {fmt(total)}. Dışa aktardığınız videoyla aynı zamanlar kullanılır; <b>kesim/düzenleme yaptıysanız önce onu bitirin</b>, sonra oluşturun.</div>
      <label className="check" title={aiReady ? '' : 'Ayarlar → Yapay zekâ bölümünden bir sağlayıcı ve anahtar girin'}>
        <input type="checkbox" checked={useAi && aiReady} disabled={!aiReady} onChange={(e) => setUseAi(e.target.checked)} data-testid="chapters-ai" /> Başlıkları yapay zekâ yazsın
      </label>
      {!aiReady && <div className="hint">Kapalıyken başlıklar konuşulan kişi/takım adlarından üretilir ("Rafael Leao", "Chevalier, Salah"). Daha doğal başlıklar için <a href="#" onClick={(e) => { e.preventDefault(); openDialog('settings') }}>Ayarlar → Yapay zekâ</a>.</div>}
      <label className="row" style={{ gap: 6 }}>Bölüm sıklığı
        <select value={density} onChange={(e) => setDensity(e.target.value as ChapterDensity)} aria-label="Bölüm sıklığı" data-testid="chapters-density">
          <option value="low">Az (≈7 dk)</option>
          <option value="medium">Orta (≈3,5 dk)</option>
          <option value="high">Çok (≈2 dk)</option>
        </select>
      </label>
      <button className="btn primary" disabled={chaptersBusy || total <= 0} onClick={() => void generateChapters(useAi && aiReady, density)} data-testid="chapters-run">{chaptersBusy ? 'Bölümler çıkarılıyor…' : 'Zaman damgalarını oluştur'}</button>
      {chaptersError && <div className="warnbox" role="alert" data-testid="chapters-error">{chaptersError}</div>}
      {chapters?.ai.error && <div className="warnbox" data-testid="chapters-ai-error">Yapay zekâ başlığı: {chapters.ai.error}</div>}
      {chapters?.warnings.map((w, i) => <div key={i} className="warnbox" data-testid="chapters-warning">⚠ {w}</div>)}
      {chapters && (
        <>
          <div className="hint">{chapters.chapters.length} bölüm · metni düzenleyebilirsiniz</div>
          <textarea value={chaptersText} onChange={(e) => setChaptersText(e.target.value)} rows={Math.min(22, Math.max(6, chapters.chapters.length + 1))} spellCheck={false} aria-label="Zaman damgaları" data-testid="chapters-text" style={{ fontFamily: 'ui-monospace, Consolas, monospace', width: '100%' }} />
          <div className="row wrap">
            <button className="btn primary" onClick={copy} data-testid="chapters-copy">Kopyala</button>
            <button className="btn" onClick={() => void save()} data-testid="chapters-save">Dosyaya kaydet (.txt)…</button>
          </div>
        </>
      )}
    </div>
  )
}
