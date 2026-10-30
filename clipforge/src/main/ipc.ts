import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { IpcChannel, IpcInvoke, IpcResult } from '../shared/ipc'
import type { AppService } from './app'
import { userMessage } from './tasks'

type Handlers = { [C in IpcChannel]: (...args: IpcInvoke[C][0]) => Promise<IpcInvoke[C][1]> | IpcInvoke[C][1] }

const MEDIA_FILTERS = [
  { name: 'Tüm medya', extensions: ['mkv', 'mp4', 'mov', 'flv', 'm4v', 'webm', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] },
  { name: 'Video kayıtları (OBS)', extensions: ['mkv', 'mp4', 'mov', 'flv', 'm4v', 'webm'] },
  { name: 'Ses', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'] },
  { name: 'Görsel', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }
]

/** Tipli IPC kanallarını bağlar. Her hata anlaşılır bir mesaja çevrilip renderer'a Result olarak döner; main çökmez. */
export function registerIpc(app: AppService, getWindow: () => BrowserWindow | null): void {
  const handlers: Handlers = {
    'app:info': () => app.info(),
    'settings:get': () => app.settings.value,
    'settings:set': (patch) => app.settings.update(patch),
    'dialog:openMedia': async () => {
      const r = await dialog.showOpenDialog(getWindow() ?? (undefined as never), { title: 'Medya seç (video, ses, görsel)', properties: ['openFile', 'multiSelections'], filters: MEDIA_FILTERS })
      return r.canceled ? [] : r.filePaths
    },
    'dialog:openFile': async ({ title, extensions }) => {
      const r = await dialog.showOpenDialog(getWindow() ?? (undefined as never), { title, properties: ['openFile'], filters: [{ name: title, extensions }] })
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
