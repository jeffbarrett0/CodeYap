import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IpcChannel, IpcInvoke, IpcResult } from '../shared/ipc'
import type { AppService } from './app'
import { userMessage } from './tasks'
import { setCpuMode } from './ffmpeg'
import { AutoKickManager } from './autokick/pipeline'
import { StoryManager } from './story/pipeline'
import { autoClipCandidates, makeAutoClip } from './autoclips/pipeline'
import { AutoClipsManager, chainAutoClips } from './autoclips/run'
import { buildTrailer } from './trailer/build'
import { parseCtaManifest } from '../shared/cta'
import { transcriptionReadiness } from '../shared/autokick'
import { makeTopicClip, topicCandidates } from './autokick/clips'

type Handlers = { [C in IpcChannel]: (...args: IpcInvoke[C][0]) => Promise<IpcInvoke[C][1]> | IpcInvoke[C][1] }

const MEDIA_FILTERS = [
  { name: 'Tüm medya', extensions: ['mkv', 'mp4', 'mov', 'flv', 'm4v', 'webm', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] },
  { name: 'Video kayıtları (OBS)', extensions: ['mkv', 'mp4', 'mov', 'flv', 'm4v', 'webm'] },
  { name: 'Ses', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'] },
  { name: 'Görsel', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }
]

/** Tipli IPC kanallarını bağlar. Her hata anlaşılır bir mesaja çevrilip renderer'a Result olarak döner; main çökmez. */
export function registerIpc(app: AppService, getWindow: () => BrowserWindow | null): void {
  const story = new StoryManager({ userDataDir: app.deps.userDataDir, resourcesDir: app.deps.resourcesDir }, (s) => getWindow()?.webContents.send('story:update', s))
  const envDirs = { userDataDir: app.deps.userDataDir, resourcesDir: app.deps.resourcesDir }
  const autoClips = new AutoClipsManager(envDirs, (s) => getWindow()?.webContents.send('autoclips:update', s))
  // ZİNCİR: Auto Kick bitince (tam video dışa aktarıldıktan sonra) Auto Clips kendiliğinden başlar — arayüz açık olmasa da
  const chained = new Set<string>()
  const autoKick = new AutoKickManager(envDirs, (s) => {
    getWindow()?.webContents.send('autokick:update', s)
    chainAutoClips(s, chained, app.settings.value, autoClips)
  })
  const handlers: Handlers = {
    'autoclips:start': (r) => autoClips.start(r),
    'autoclips:cancel': (id) => autoClips.cancel(id),
    'autoclips:list': () => autoClips.list(),
    'autoclips:find': (r) => autoClipCandidates(r.projectPath, { ...(r.minSec ? { minSec: r.minSec } : {}), ...(r.maxSec ? { maxSec: r.maxSec } : {}), ...(r.max ? { max: r.max } : {}), ...(r.horizontal ? { horizontal: true } : {}) }, { userDataDir: app.deps.userDataDir, resourcesDir: app.deps.resourcesDir }),
    'autoclips:make': async (r) => {
      const out = []
      for (const p of r.picks) out.push(await makeAutoClip(r.projectPath, p, { face: r.face, facePos: r.facePos, faceShare: r.faceShare, faceZoom: r.faceZoom, faceFocus: r.faceFocus, screenZoom: r.screenZoom, horizontal: r.horizontal, captions: r.captions }, { userDataDir: app.deps.userDataDir, resourcesDir: app.deps.resourcesDir }))
      return out
    },
    'media:waveform': (r) => app.waveform(r),
    'cta:list': async () => {
      const dir = join(app.deps.resourcesDir, 'cta')
      const manifest = parseCtaManifest(await readFile(join(dir, 'cta.json'), 'utf8').then((t) => JSON.parse(t), () => null))
      return { manifest, buttons: (manifest?.buttons ?? []).map((b) => ({ id: b.id, label: b.label, path: join(dir, b.file) })) }
    },
    'trailer:build': (r) => buildTrailer(r, { userDataDir: app.deps.userDataDir, resourcesDir: app.deps.resourcesDir }),
    'audio:denoise': (r) => app.denoisePreview(r),
    'story:start': (req) => story.start(req),
    'story:cancel': (id) => story.cancel(id),
    'story:list': () => story.list(),
    'story:plan': async (p) => {
      try {
        return JSON.parse(await readFile(p, 'utf8'))
      } catch {
        return null
      }
    },
    'autokick:start': (req) => autoKick.start(req),
    'autokick:cancel': (id) => autoKick.cancel(id),
    'autokick:list': () => autoKick.list(),
    'autokick:check': async () => transcriptionReadiness(app.settings.value, await app.info()),
    'autokick:topic': (r) => topicCandidates(r.projectPath, r.topic, { ...(r.maxSec ? { maxSec: r.maxSec } : {}), ...(r.minSec ? { minSec: r.minSec } : {}) }, { userDataDir: app.deps.userDataDir, resourcesDir: app.deps.resourcesDir }),
    'autokick:makeClip': (r) => makeTopicClip(r.projectPath, r.topic, r.start, r.end, { userDataDir: app.deps.userDataDir, resourcesDir: app.deps.resourcesDir }),
    'app:info': () => app.info(),
    'settings:get': () => app.settings.value,
    'settings:set': async (patch) => {
      const v = await app.settings.update(patch)
      setCpuMode(v.cpuMode)
      return v
    },
    'dialog:openMedia': async () => {
      const r = await dialog.showOpenDialog(getWindow() ?? (undefined as never), { title: 'Medya seç (video, ses, görsel)', properties: ['openFile', 'multiSelections'], filters: MEDIA_FILTERS })
      return r.canceled ? [] : r.filePaths
    },
    'dialog:openFile': async ({ title, extensions, groups }) => {
      const filters = [{ name: groups?.length ? 'Tüm desteklenen dosyalar' : title, extensions }, ...(groups ?? []), { name: 'Tüm dosyalar', extensions: ['*'] }]
      const r = await dialog.showOpenDialog(getWindow() ?? (undefined as never), { title, properties: ['openFile'], filters })
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },
    'dialog:saveFile': async ({ defaultName, extensions }) => {
      const r = await dialog.showSaveDialog(getWindow() ?? (undefined as never), { defaultPath: defaultName, filters: [{ name: extensions.join(', '), extensions }] })
      return r.canceled ? null : (r.filePath ?? null)
    },
    'project:save': async (project, path) => {
      let target = path
      if (!target) {
        const r = await dialog.showSaveDialog(getWindow() ?? (undefined as never), { defaultPath: `${project.name}.clipforge`, filters: [{ name: 'ClipForge projesi', extensions: ['clipforge'] }] })
        if (r.canceled || !r.filePath) return null
        target = r.filePath.endsWith('.clipforge') ? r.filePath : `${r.filePath}.clipforge`
      }
      await app.saveProject(project, target)
      return { path: target }
    },
    'project:open': async (path) => {
      let target = path
      if (!target) {
        const r = await dialog.showOpenDialog(getWindow() ?? (undefined as never), { title: 'Proje aç', properties: ['openFile'], filters: [{ name: 'ClipForge projesi', extensions: ['clipforge'] }] })
        if (r.canceled || !r.filePaths[0]) return null
        target = r.filePaths[0]
      }
      return app.openProject(target)
    },
    'project:new': () => app.newProject(),
    'project:createClip': (project, assetId, name) => app.createClipProject(project, assetId, name),
    'media:import': (paths) => app.importMedia(paths),
    'media:markers': (id) => app.markers(id),
    'media:syncOffset': ({ screenAssetId, camAssetId }) => app.syncOffset(screenAssetId, camAssetId),
    'transcript:start': (req) => app.transcriptStart(req),
    'transcript:get': (id) => app.transcriptGet(id),
    'transcript:fix': (req) => app.transcriptFix(req),
    'transcript:vocab': (id) => app.transcriptApplyVocabulary(id),
    'search:run': (req) => app.searchRun(req),
    'chat:import': (req) => app.chatImport(req),
    'suggest:start': (req) => app.suggestStart(req),
    'export:start': (req) => app.exportStart(req),
    'export:dialogOutput': async (defaultName) => {
      const r = await dialog.showSaveDialog(getWindow() ?? (undefined as never), { defaultPath: defaultName, filters: [{ name: 'MP4 video', extensions: ['mp4'] }] })
      return r.canceled ? null : (r.filePath ?? null)
    },
    'task:cancel': (id) => app.queue.cancel(id),
    'ideas:generate': (req) => app.ideasGenerate(req),
    'chapters:generate': (req) => app.chaptersGenerate(req),
    'file:writeText': async (path, text) => {
      await writeFile(path, text, 'utf8')
    },
    'captions:translate': (req) => app.translateTexts(req),
    'task:list': () => app.queue.list(),
    'model:download': (size) => app.downloadModel(size),
    'shell:reveal': (p) => shell.showItemInFolder(p),
    'templates:list': () => app.templates.value,
    'templates:save': (t) => app.templates.save(t),
    'templates:delete': (id) => app.templates.remove(id),
    'dev:openDevTools': () => getWindow()?.webContents.openDevTools({ mode: 'detach' })
  }

  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    ipcMain.handle(channel, async (_e, ...args: unknown[]): Promise<IpcResult<unknown>> => {
      try {
        const fn = handlers[channel] as (...a: unknown[]) => unknown
        return { ok: true, value: await fn(...args) }
      } catch (e) {
        if (!(e && typeof e === 'object' && 'userMessage' in e)) console.error(`[ipc:${channel}]`, e)
        return { ok: false, error: userMessage(e) }
      }
    })
  }
}
