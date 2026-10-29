import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ClipforgeApi, IpcEventName, IpcResult } from '../shared/ipc'

/** Renderer'a yalnızca tipli, dar bir yüzey sunulur (contextIsolation açık, nodeIntegration kapalı). */
const api: ClipforgeApi = {
  isMock: false,
  async invoke(channel, ...args) {
    const res = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<never>
    if (!res.ok) throw new Error(res.error)
    return res.value
  },
  on(event: IpcEventName, cb) {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => (cb as (p: unknown) => void)(payload)
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.removeListener(event, listener)
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  mediaUrl(asset, kind, audioIndex = 0) {
    const v = encodeURIComponent(asset.proxyPath ?? asset.thumbnailPath ?? '')
    if (kind === 'video') return asset.kind === 'video' ? `cf-media://m/${asset.id}/video?v=${v}` : null
    if (kind === 'audio') return asset.audioStreams[audioIndex] ? `cf-media://m/${asset.id}/audio/${audioIndex}?v=${v}` : null
    return asset.thumbnailPath ? `cf-media://m/${asset.id}/thumb?v=${v}` : null
  }
}

contextBridge.exposeInMainWorld('clipforge', api)
