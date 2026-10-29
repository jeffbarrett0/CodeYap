import type { ClipforgeApi } from '@shared/ipc'

let api: ClipforgeApi | null = null

/** Electron'da preload köprüsünü, tarayıcıda (geliştirme/UI testi) sahte uygulamayı döner. */
export async function getApi(): Promise<ClipforgeApi> {
  if (api) return api
  if (window.clipforge) {
    api = window.clipforge
  } else {
    const { createMockApi } = await import('./mock')
    api = createMockApi()
  }
  return api
}

export function requireApi(): ClipforgeApi {
  if (!api) throw new Error('API henüz hazır değil')
  return api
}
