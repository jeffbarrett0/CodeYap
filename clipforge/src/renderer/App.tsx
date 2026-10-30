import { useEffect } from 'react'
import { MediaLibrary } from './components/MediaPanel'
import { Preview } from './components/Preview'
import { Timeline } from './components/Timeline'
import { RightPanel } from './components/RightPanel'
import { ExportDialog, HelpDialog, SettingsDialog } from './components/Dialogs'
import { StatusBar, Toasts, TopBar } from './components/Chrome'
import { useStore } from './store'

function useShortcuts() {
  useEffect(() => {
    let jRate = 0
    const setRate = (r: number) => window.dispatchEvent(new CustomEvent('cf-rate', { detail: r }))
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && (el as HTMLInputElement).type !== 'range' && (el as HTMLInputElement).type !== 'checkbox' && (el as HTMLInputElement).type !== 'radio')) return
      const st = useStore.getState()
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); return }
      if (mod && k === 'y') { e.preventDefault(); st.redo(); return }
      if (mod && k === 's') { e.preventDefault(); void st.saveProject(e.shiftKey); return }
      if (mod && k === 'a' && !st.dialog) { e.preventDefault(); (st.activeLane ? st.selectLane(st.activeLane) : st.selectAllClips()); return }
      if (mod && k === 'e') { e.preventDefault(); st.openDialog('export'); return }
      if (mod || st.dialog) return
      if (e.key === ' ') {
        e.preventDefault()
        // Odaktaki düğme boşluk tuşuyla ayrıca tetiklenmesin
        if (el instanceof HTMLButtonElement) el.blur()
        if (st.viewMode !== 'timeline') st.setViewMode('timeline')
        setRate(1); jRate = 0
        st.setPlaying(!st.playing)
      } else if (k === 's') { st.splitAtPlayhead() }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        // Yalnızca o an seçili TEK öğe silinir: odak kütüphane kartındaysa dosya, değilse seçili klip, o da yoksa seçili altyazı
        const inLibrary = el?.closest?.('[data-testid="asset"]')
        if (inLibrary && st.selectedAssetId) { e.preventDefault(); st.removeAsset(st.selectedAssetId) }
        else if (st.selectedCaptionIds.length) { e.preventDefault(); st.deleteCaptions(st.selectedCaptionIds) }
        else if (st.selection.length) { e.preventDefault(); st.deleteSelection(e.shiftKey) }
        else if (st.selectedCaptionId) { e.preventDefault(); st.deleteCaption(st.selectedCaptionId) }
      }
      else if (k === 'k') { jRate = 0; setRate(1); st.setPlaying(false) }
      else if (k === 'l') {
        if (st.viewMode !== 'timeline') st.setViewMode('timeline')
        jRate = jRate > 0 ? Math.min(8, jRate * 2) : 1
        setRate(jRate); st.setPlaying(true)
      } else if (k === 'j') {
        if (st.viewMode !== 'timeline') st.setViewMode('timeline')
        jRate = jRate < 0 ? Math.max(-8, jRate * 2) : -1
        setRate(jRate); st.setPlaying(true)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const dir = e.key === 'ArrowLeft' ? -1 : 1
        const step = e.shiftKey ? 1 : 1 / st.project.timeline.fps
        if (st.viewMode === 'timeline') st.setPlayhead(st.playhead + dir * step)
        else st.setSourceTime(st.sourceTime + dir * step)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function App() {
  const { init, ready, dialog } = useStore()
  useEffect(() => { void init() }, [init])
  useShortcuts()
  if (!ready) return <div style={{ padding: 24 }}>Yükleniyor…</div>
  return (
    <div className="app">
      <TopBar />
      {/* Sol panel: yalnızca içe aktarma alanı ve medya kütüphanesi */}
      <aside className="panel" aria-label="Medya kütüphanesi">
        <MediaLibrary />
      </aside>
      <Preview />
      <RightPanel />
      <Timeline />
      <StatusBar />
      {dialog === 'export' && <ExportDialog />}
      {dialog === 'settings' && <SettingsDialog />}
      {dialog === 'help' && <HelpDialog />}
      <Toasts />
    </div>
  )
}
