import { cmd } from '@shared/timeline/commands'
import { clipDuration, findClip, groupMembers, TRACK_IDS } from '@shared/timeline/model'
import type { AspectRatio, LayoutPreset } from '@shared/types'
import { aspectSize } from '@shared/timeline/model'
import { useStore } from '../store'
import { LayersPanel } from './Layers'
import { fmt, Field, Num, Slider } from './ui'

const FONTS = ['Arial', 'Impact', 'Verdana', 'Tahoma', 'Georgia', 'Trebuchet MS', 'Courier New']

function DraftPanel() {
  const { clipDraft: d, patchDraft, recomputeDraft, commitDraft, snapDraft, settings } = useStore()
  if (!d) return null
  const dur = d.end - d.start
  return (
    <div className="panel-body" data-testid="draft-panel">
      <div className="section-title">Klip taslağı</div>
      <div className="hint">{d.title}</div>

      <div className="grid2">
        <Field label="Önce (pre-roll, sn)"><Num value={d.preRoll} min={0} step={1} label="Pre-roll" onChange={(v) => recomputeDraft({ preRoll: v })} /></Field>
        <Field label="Sonra (post-roll, sn)"><Num value={d.postRoll} min={0} step={1} label="Post-roll" onChange={(v) => recomputeDraft({ postRoll: v })} /></Field>
      </div>
      <Field label="Hedef süre">
        <select aria-label="Hedef süre" value={d.targetSec} onChange={(e) => recomputeDraft({ targetSec: Number(e.target.value) })}>
          <option value={0}>Pre/post-roll kullan</option>
          <option value={15}>15 sn</option>
          <option value={30}>30 sn</option>
          <option value={60}>60 sn</option>
        </select>
      </Field>
      <div className="hint">Sınırlar otomatik olarak cümle başına/sonuna yapışır; konuşmanın ortasından kesilmez.</div>

      <div className="grid2">
        <Field label="Başlangıç (sn)"><Num value={d.start} step={0.1} min={0} label="Başlangıç" onChange={(v) => patchDraft({ start: v })} /></Field>
        <Field label="Bitiş (sn)"><Num value={d.end} step={0.1} min={0} label="Bitiş" onChange={(v) => patchDraft({ end: v })} /></Field>
      </div>
      <div className="row wrap">
        <button className="btn sm" onClick={() => patchDraft({ start: d.start - 0.5 })}>Baş −0.5</button>
        <button className="btn sm" onClick={() => patchDraft({ start: d.start + 0.5 })}>Baş +0.5</button>
        <button className="btn sm" onClick={() => patchDraft({ end: d.end - 0.5 })}>Son −0.5</button>
        <button className="btn sm" onClick={() => patchDraft({ end: d.end + 0.5 })}>Son +0.5</button>
        <button className="btn sm" onClick={() => snapDraft('start')}>Başı cümleye</button>
        <button className="btn sm" onClick={() => snapDraft('end')}>Sonu cümleye</button>
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>Süre: <b data-testid="draft-duration">{dur.toFixed(1)} sn</b></span>
        <span className="hint">{fmt(d.start, true)} → {fmt(d.end, true)}</span>
      </div>
      {d.warnings.map((w, i) => <div key={i} className="warnbox" role="alert" data-testid="draft-warning">⚠ {w.message}</div>)}
      <div className="hint">Platform sınırı: {settings.exportDefaults.maxDurationSec ?? 60} sn (TikTok/Reels/Shorts).</div>
      <div className="row">
        <button className="btn primary grow" onClick={commitDraft} data-testid="add-to-timeline">Zaman çizelgesine ekle</button>
        <button className="btn" onClick={() => useStore.setState({ clipDraft: null })}>Vazgeç</button>
      </div>
    </div>
  )
}

function Inspector() {
  const { project, selection, exec } = useStore()
  const tl = project.timeline
  const f = selection[0] ? findClip(tl, selection[0]) : null
  if (!f) return <div className="empty">Ayarlarını görmek için zaman çizelgesinden bir klip seçin.</div>
  const { clip, track } = f
  const members = groupMembers(tl, clip.id)
  const asset = project.assets.find((a) => a.id === clip.assetId)
  return (
    <div className="col" data-testid="inspector">
      <div className="section-title">Klip</div>
      <Field label="Ad"><input type="text" value={clip.label} onChange={(e) => exec(cmd.updateClip(clip.id, { label: e.target.value }, true))} aria-label="Klip adı" /></Field>
      <dl className="kv">
        <dt>İz</dt><dd>{track.name}</dd>
        <dt>Zaman çizelgesi</dt><dd>{fmt(clip.start, true)} → {fmt(clip.start + clipDuration(clip), true)} ({clipDuration(clip).toFixed(1)} sn)</dd>
        <dt>Kaynak</dt><dd>{asset?.name ?? '?'} · {fmt(clip.srcIn, true)} → {fmt(clip.srcOut, true)}</dd>
        {clip.origin?.query && (<><dt>Arama</dt><dd>"{clip.origin.query}" {clip.origin.matchTime !== undefined && `(eşleşme ${fmt(clip.origin.matchTime)})`}</dd></>)}
        {clip.origin?.candidateId && (<><dt>Kaynak</dt><dd>Otomatik öneri</dd></>)}
        {members.length > 1 && (<><dt>Bağlı klipler</dt><dd>{members.length} (görüntü/ses birlikte taşınır)</dd></>)}
      </dl>
      {track.kind !== 'video' && <Slider label="Klip ses seviyesi" value={clip.volume} min={0} max={1} onChange={(v) => exec(cmd.updateClip(clip.id, { volume: v }, true))} format={(v) => `${Math.round(v * 100)}%`} />}
      {track.role === 'webcam' && clip.crop && (
        <div className="grid2">
          {(['x', 'y', 'w', 'h'] as const).map((k) => (
            <Field key={k} label={`Kırpma ${k.toUpperCase()}`}><Num value={clip.crop![k]} step={0.01} min={0} max={1} label={`Kırpma ${k}`} onChange={(v) => exec(cmd.updateClip(clip.id, { crop: { ...clip.crop!, [k]: Math.min(1, Math.max(0, v)) } }, true))} /></Field>
          ))}
        </div>
      )}
    </div>
  )
}

function AudioMixer() {
  const { project, exec } = useStore()
  const tl = project.timeline
  const tracks = tl.tracks.filter((t) => t.kind === 'audio')
  return (
    <div className="col" data-testid="mixer">
      <div className="section-title">Ses dengesi</div>
      {tracks.map((t) => (
        <div key={t.id} className="col" style={{ gap: 4 }}>
          <Slider label={`${t.name}${t.clips.length === 0 ? ' (boş)' : ''}`} value={t.volume} min={0} max={1.5} onChange={(v) => exec(cmd.track(t.id, { volume: v }, true))} format={(v) => `${Math.round(v * 100)}%`} />
          <label className="check"><input type="checkbox" checked={t.muted} onChange={(e) => exec(cmd.track(t.id, { muted: e.target.checked }))} /> Sustur</label>
        </div>
      ))}
      <div className="hint">Oyun sesi ve konuşma farklı ses track'lerinde ise ayrı izlerde (A1/A2) yer alır ve dışa aktarmada ayrı seviyelerle karıştırılır. Tek karışım track'i varsa yalnızca "Oyun sesi" izi kullanılır. Dışa aktarmada ses −14 LUFS'a dengelenir (şablonda açıksa).</div>
    </div>
  )
}

function Captions() {
  const { project, exec, generateCaptions } = useStore()
  const tl = project.timeline
  const st = tl.captionStyle
  const set = (p: Partial<typeof st>) => exec(cmd.captionStyle(p))
  return (
    <div className="col" data-testid="captions-panel">
      <div className="section-title">Otomatik altyazı</div>
      <button className="btn primary" onClick={generateCaptions} data-testid="gen-captions">Transkriptten altyazı üret</button>
      <label className="check"><input type="checkbox" checked={st.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Altyazıyı göster / dışa aktar</label>
      <Field label="Yazı tipi"><select value={st.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })} aria-label="Yazı tipi">{FONTS.map((f) => <option key={f}>{f}</option>)}</select></Field>
      <Slider label="Boyut" value={st.fontSize} min={24} max={140} step={1} onChange={(v) => set({ fontSize: v })} format={(v) => `${v}px`} />
      <div className="grid2">
        <Field label="Renk"><input type="color" value={st.color} onChange={(e) => set({ color: e.target.value })} aria-label="Yazı rengi" /></Field>
        <Field label="Kontur"><input type="color" value={st.outlineColor} onChange={(e) => set({ outlineColor: e.target.value })} aria-label="Kontur rengi" /></Field>
      </div>
      <Slider label="Kontur kalınlığı" value={st.outlineWidth} min={0} max={12} step={1} onChange={(v) => set({ outlineWidth: v })} format={(v) => `${v}px`} />
      <Slider label="Konum (alt → üst)" value={st.positionY} min={0} max={1} onChange={(v) => set({ positionY: v })} format={(v) => `${Math.round(v * 100)}%`} />
      <Slider label="Satır başına karakter" value={st.maxCharsPerLine} min={10} max={40} step={1} onChange={(v) => set({ maxCharsPerLine: v })} format={(v) => String(v)} />
      <div className="row wrap">
        <label className="check"><input type="checkbox" checked={st.bold} onChange={(e) => set({ bold: e.target.checked })} /> Kalın</label>
        <label className="check"><input type="checkbox" checked={st.uppercase} onChange={(e) => set({ uppercase: e.target.checked })} /> BÜYÜK HARF</label>
      </div>
      <div className="section-title">Satırlar ({tl.captions.length})</div>
      <div className="col" style={{ maxHeight: 220, overflow: 'auto' }}>
        {tl.captions.length === 0 && <div className="hint">Henüz altyazı yok.</div>}
        {tl.captions.map((c, i) => (
          <div key={c.id} className="capline">
            <span className="hint tc" style={{ minWidth: 0 }}>{fmt(c.start)}</span>
            <input type="text" value={c.text} aria-label={`Altyazı ${i + 1}`} onChange={(e) => exec(cmd.captions(tl.captions.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x))))} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function RightPanel() {
  const { rightTab, setRightTab, clipDraft } = useStore()
  const tabs: [typeof rightTab, string][] = [['inspector', 'Klip'], ['layout', 'Katmanlar'], ['audio', 'Ses'], ['captions', 'Altyazı']]
  return (
    <aside className="panel right" aria-label="Özellikler">
      {clipDraft ? (
        <DraftPanel />
      ) : (
        <>
          <div className="tabs" role="tablist">
            {tabs.map(([id, name]) => <button key={id} role="tab" aria-selected={rightTab === id} className={`tab${rightTab === id ? ' active' : ''}`} onClick={() => setRightTab(id)} data-testid={`rtab-${id}`}>{name}</button>)}
          </div>
          <div className="panel-body">
            {rightTab === 'inspector' && <Inspector />}
            {rightTab === 'layout' && <LayersPanel />}
            {rightTab === 'audio' && <AudioMixer />}
            {rightTab === 'captions' && <Captions />}
          </div>
        </>
      )}
    </aside>
  )
}

void TRACK_IDS
