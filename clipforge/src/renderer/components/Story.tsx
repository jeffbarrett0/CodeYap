import { useEffect, useState } from 'react'
import { STORY_TYPES, type StoryContent, type StoryPlan, type StoryScene, type StoryStatus, type StoryType } from '@shared/story/types'
import { contentProblem, sanitizeContent } from '@shared/story/plan'
import { requireApi } from '../api'
import { useStore } from '../store'
import { Modal, Num, Progress } from './ui'

const MEDIA_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'mp4', 'mov', 'mkv', 'webm', 'm4v']
const fmtT = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

const TEMPLATES: Record<StoryType, StoryContent> = {
  stats: { type: 'stats', kicker: 'RAKAMLARLA', cards: [{ label: 'Etiket', value: '7', unit: 'PUAN', tone: 'good' }] },
  timeline: { type: 'timeline', kicker: 'DÖNEMLER', title: 'Zaman çizelgesi', periods: [{ label: '22/23', items: [{ text: 'Olay', tone: 'neutral' }] }, { label: '23/24', items: [{ text: 'Olay', tone: 'good' }] }] },
  list: { type: 'list', kicker: 'MADDELER', title: 'Başlık', items: [{ text: 'Madde 1' }, { text: 'Madde 2' }] },
  person: { type: 'person', role: 'UNVAN', name: 'AD SOYAD' },
  quote: { type: 'quote', text: 'Alıntı metni' },
  title: { type: 'title', text: 'BAŞLIK' },
  place: { type: 'place', to: 'Türkiye' },
  leaderboard: { type: 'leaderboard', title: 'Gol krallığı', metric: 'GOL', rows: [{ name: 'Birinci', value: 20 }, { name: 'İkinci', value: 15 }] },
  compare: { type: 'compare', left: { name: 'A' }, right: { name: 'B' }, metrics: [{ label: 'Gol', left: 10, right: 7 }] },
  teamcard: { type: 'teamcard', team: 'Galatasaray' },
  football: { type: 'football', home: { formation: '4-3-3' }, away: { formation: '4-4-2' }, players: [{ id: 'a', name: 'ATAKÇI', team: 'home', at: 'ceza-yayi' }], ball: { holder: 'a' }, actions: [{ do: 'shoot', at: 1, from: 'a', to: 'kale-sag' }] },
  media: { type: 'media', file: 'C:/klasor/gorsel.png', fit: 'cover', caption: 'Alt yazı' }
}

export function summarize(c: StoryContent): string {
  switch (c.type) {
    case 'stats':
      return c.cards.map((x) => `${x.value}${x.unit ? ' ' + x.unit : ''}`).join(' · ')
    case 'timeline':
      return c.periods.map((p) => p.label).join(' → ')
    case 'list':
      return c.items.map((i) => i.text).join(' · ')
    case 'person':
      return `${c.role ? c.role + ': ' : ''}${c.name}`
    case 'quote':
      return `“${c.text}”`
    case 'title':
      return c.text
    case 'place':
      return c.to
    case 'leaderboard':
      return `${c.dataset ?? c.rows.slice(0, 3).map((r) => r.name).join(', ')}`
    case 'compare':
      return `${c.left.name} ↔ ${c.right.name}`
    case 'teamcard':
      return c.team
    case 'football':
      return `${c.players.filter((p) => p.name).map((p) => p.name).join(', ') || 'Saha'} · ${c.actions.length} eylem`
    case 'media':
      return c.file.split(/[\\/]/).pop() ?? c.file
  }
}

function SceneRow({ sc, onChange, onDelete }: { sc: StoryScene; onChange: (s: StoryScene) => void; onDelete: () => void }) {
  const [json, setJson] = useState(() => JSON.stringify(sc.content, null, 2))
  const [err, setErr] = useState('')
  const label = STORY_TYPES.find((t) => t.id === sc.content.type)?.label ?? sc.content.type
  return (
    <div className="col story-scene" data-testid="story-scene" data-enabled={sc.enabled} style={{ gap: 4, padding: 8, border: '1px solid var(--border, #2a3a30)', borderRadius: 8, opacity: sc.enabled ? 1 : 0.55 }}>
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={sc.enabled} onChange={(e) => onChange({ ...sc, enabled: e.target.checked })} aria-label="Sahne açık" data-testid="story-scene-on" />
        <b>{label}</b>
        <span className="hint" style={{ flex: 1, minWidth: 120 }}>{summarize(sc.content)}</span>
        <span className="hint">{fmtT(sc.start)}–{fmtT(sc.end)}</span>
        <button className="btn sm danger" onClick={onDelete} data-testid="story-scene-del">Sil</button>
      </div>
      {sc.reason && <div className="hint">Anlatımda: “{sc.reason}”</div>}
      <details>
        <summary className="hint">Zaman ve içeriği düzenle</summary>
        <div className="row wrap" style={{ gap: 8, margin: '6px 0' }}>
          <label className="row" style={{ gap: 4 }}>Başlangıç (sn) <Num value={sc.start} step={0.5} min={0} label="Sahne başlangıcı" onChange={(v) => onChange({ ...sc, start: v, end: Math.max(sc.end, v + 2), source: 'manual' })} /></label>
          <label className="row" style={{ gap: 4 }}>Bitiş (sn) <Num value={sc.end} step={0.5} min={0} label="Sahne bitişi" onChange={(v) => onChange({ ...sc, end: Math.max(v, sc.start + 1), source: 'manual' })} /></label>
        </div>
        <textarea
          value={json}
          rows={Math.min(14, json.split('\n').length + 1)}
          spellCheck={false}
          aria-label="Sahne içeriği"
          data-testid="story-scene-json"
          style={{ width: '100%', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }}
          onChange={(e) => {
            setJson(e.target.value)
            try {
              const c = sanitizeContent(JSON.parse(e.target.value))
              if (!c) return setErr('Geçerli bir sahne içeriği değil (type ve alanları kontrol edin).')
              setErr(contentProblem(c) ?? '')
              onChange({ ...sc, content: c, source: 'manual' })
            } catch {
              setErr('JSON okunamadı.')
            }
          }}
        />
        {err && <div className="warnbox" role="alert">{err}</div>}
        <div className="hint">at: sahne başından saniye (kart/madde ne zaman belirsin); tone: good · bad · warn · neutral.</div>
      </details>
    </div>
  )
}

function JobView({ job }: { job: StoryStatus }) {
  const api = requireApi()
  return (
    <div className="col" data-testid="story-job" data-status={job.status} style={{ gap: 4 }}>
      {job.stages.filter((s) => s.status !== 'skipped').map((s) => (
        <div key={s.id} className="col" style={{ gap: 2 }} data-testid={`story-stage-${s.id}`} data-stage-status={s.status}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>{s.status === 'done' ? '✓ ' : s.status === 'running' ? '⏳ ' : s.status === 'failed' ? '✕ ' : '○ '}{s.label}</span>
            <span className="hint">{s.status === 'running' ? `%${Math.round(s.progress * 100)}` : ''}</span>
          </div>
          {s.status === 'running' && <Progress value={s.progress} />}
          {s.detail && <div className="hint">{s.detail}</div>}
        </div>
      ))}
      {job.error && <div className="warnbox" role="alert" data-testid="story-error">{job.error}</div>}
      {job.status === 'running' && <button className="btn sm danger" onClick={() => void api.invoke('story:cancel', job.id)} data-testid="story-cancel">İptal</button>}
    </div>
  )
}

/** Anlatım → Görsel: sesi (ya da videoyu) seç → sahne planı → düzenle → hareketli sahnelerle video projesi */
export function StoryDialog() {
  const api = requireApi()
  const { story, settings, openDialog, openProject } = useStore()
  const [media, setMedia] = useState('')
  const [useAi, setUseAi] = useState(false)
  const [aspect, setAspect] = useState<'16:9' | '9:16' | '1:1'>('16:9')
  const [plan, setPlan] = useState<StoryPlan | null>(null)
  const [planJob, setPlanJob] = useState<string>()
  const [buildJob, setBuildJob] = useState<string>()
  const [addType, setAddType] = useState<StoryType>('stats')
  const aiReady = settings.llmProvider !== 'off'
  const pj = planJob ? story[planJob] : undefined
  const bj = buildJob ? story[buildJob] : undefined

  useEffect(() => {
    if (pj?.status === 'done' && pj.result && !plan) setPlan(pj.result.plan)
  }, [pj?.status, pj?.result, plan])

  const pick = async () => {
    const p = await api.invoke('dialog:openFile', { title: 'Anlatım sesi ya da videosu', extensions: MEDIA_EXT })
    if (p) {
      setMedia(p)
      setPlan(null)
      setPlanJob(undefined)
      setBuildJob(undefined)
    }
  }
  const analyze = async () => {
    setPlan(null)
    setBuildJob(undefined)
    setPlanJob(await api.invoke('story:start', { mediaPath: media, action: 'plan', useAi: useAi && aiReady, aspect }))
  }
  const build = async () => {
    if (!plan) return
    setBuildJob(await api.invoke('story:start', { mediaPath: media, action: 'build', plan, aspect }))
  }
  const setScene = (i: number, s: StoryScene) => plan && setPlan({ ...plan, scenes: plan.scenes.map((x, j) => (j === i ? s : x)) })
  const addScene = () => {
    if (!plan) return
    const last = plan.scenes[plan.scenes.length - 1]
    const start = last ? last.end : 0
    setPlan({ ...plan, scenes: [...plan.scenes, { id: `m${Date.now().toString(36)}`, start, end: start + 8, enabled: true, source: 'manual' as const, content: structuredClone(TEMPLATES[addType]) }].sort((a, b) => a.start - b.start) })
  }
  const planning = pj?.status === 'running'
  const building = bj?.status === 'running'
  const enabledCount = plan?.scenes.filter((s) => s.enabled).length ?? 0

  return (
    <Modal title="Anlatım → Görsel — anlattığınızı hareketli sahnelerle görselleştirin" onClose={() => openDialog(null)} wide>
      <div className="col" data-testid="story-dialog" style={{ gap: 10 }}>
        <div className="infobox">Anlatımınızı (ses ya da video) seçin. ClipForge konuşmayı yazıya çevirir, <b>rakam kartları, sezon/yıl çizelgesi, isim bandı, liste, alıntı, başlık ve harita</b> sahnelerini önerir; siz düzenlersiniz, sonra sesiniz + sahnelerle bir video projesi kurulur. Sahneler konuşulan an belirir.</div>
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <button className="btn" onClick={() => void pick()} data-testid="story-pick">Anlatım dosyasını seç…</button>
          <span className="hint" style={{ wordBreak: 'break-all' }} data-testid="story-media">{media || 'Henüz seçilmedi'}</span>
        </div>
        <div className="row wrap" style={{ gap: 12, alignItems: 'center' }}>
          <label className="check" title={aiReady ? '' : 'Ayarlar → Yapay zekâ bölümünden bir sağlayıcı ve anahtar girin'}>
            <input type="checkbox" checked={useAi && aiReady} disabled={!aiReady} onChange={(e) => setUseAi(e.target.checked)} data-testid="story-ai" /> Sahneleri yapay zekâ planlasın
          </label>
          <label className="row" style={{ gap: 6 }}>Kare oranı
            <select value={aspect} onChange={(e) => setAspect(e.target.value as typeof aspect)} aria-label="Kare oranı" data-testid="story-aspect">
              <option value="16:9">16:9 (YouTube)</option>
              <option value="9:16">9:16 (Shorts/Reels)</option>
              <option value="1:1">1:1</option>
            </select>
          </label>
          <button className="btn primary" disabled={!media || planning || building} onClick={() => void analyze()} data-testid="story-plan">{planning ? 'Planlanıyor…' : plan ? 'Yeniden planla' : 'Sahneleri planla'}</button>
        </div>
        {!aiReady && <div className="hint">Yapay zekâ kapalıyken sahneler kurallarla bulunur (rakam+birim, sezon/yıl, “teknik direktör Ad Soyad”, yer adları, konu başlıkları). Daha zengin planlar için Ayarlar → Yapay zekâ.</div>}
        {pj && pj.status !== 'done' && <JobView job={pj} />}
        {plan && (
          <div className="col" style={{ gap: 8 }} data-testid="story-plan-view">
            {plan.warnings.map((w, i) => <div key={i} className="warnbox" data-testid="story-warning">⚠ {w}</div>)}
            <div className="hint">{plan.scenes.length} sahne ({plan.planner === 'ai' ? 'yapay zekâ' : 'kurallı taslak'}) · {enabledCount} tanesi açık · anlatım {fmtT(plan.totalSec)}. Bunlar ÖNERİDİR: kapatın, silin, zamanını ve içeriğini değiştirin.</div>
            <div className="col" style={{ gap: 6, maxHeight: 360, overflow: 'auto' }}>
              {plan.scenes.map((sc, i) => <SceneRow key={sc.id} sc={sc} onChange={(s) => setScene(i, s)} onDelete={() => setPlan({ ...plan, scenes: plan.scenes.filter((_, j) => j !== i) })} />)}
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <select value={addType} onChange={(e) => setAddType(e.target.value as StoryType)} aria-label="Eklenecek sahne türü" data-testid="story-add-type">
                {STORY_TYPES.map((t) => <option key={t.id} value={t.id} title={t.hint}>{t.label}</option>)}
              </select>
              <button className="btn sm" onClick={addScene} data-testid="story-add">Sahne ekle</button>
              <span style={{ flex: 1 }} />
              <button className="btn primary" disabled={enabledCount === 0 || building} onClick={() => void build()} data-testid="story-build">{building ? 'Çiziliyor…' : 'Videoyu oluştur'}</button>
            </div>
          </div>
        )}
        {bj && <JobView job={bj} />}
        {bj?.status === 'done' && bj.result && (
          <div className="col" data-testid="story-result" style={{ gap: 6 }}>
            <div className="hint"><b>✓ Hazır:</b> {bj.result.rendered?.scenes} sahne · {fmtT(bj.result.rendered?.totalSec ?? 0)} · anlatım sesi Ses katmanında, sahneler Video 1’de. Uygulamada açıp katman/kesim/altyazı ekleyebilir, dışa aktarabilirsiniz.</div>
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn primary" onClick={() => void openProject(bj.result!.projectPath).then((ok) => ok && openDialog(null))} data-testid="story-open">Projeyi uygulamada aç</button>
              <button className="btn" onClick={() => void api.invoke('shell:reveal', bj.result!.projectPath)} data-testid="story-reveal">Klasörü aç</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
