import { createDefaultTimeline, newId } from '../timeline/model'
import { PROJECT_VERSION, type MediaAsset, type Project } from '../types'

/** Klibin kaynağıyla birlikte gereken varlıklar: kendisi + ayrı kaynak track'leri + kamera */
export function assetsNeededFor(source: Project, assetId: string): MediaAsset[] {
  const a = source.assets.find((x) => x.id === assetId)
  if (!a) return []
  const ids = new Set<string>([a.id, ...Object.values(a.sources ?? {}).filter((v): v is string => typeof v === 'string')])
  if (a.webcamAssetId) ids.add(a.webcamAssetId)
  return source.assets.filter((x) => ids.has(x.id))
}

/**
 * Arama sonucundan BAĞIMSIZ yeni proje: yalnızca ilgili medya (aynı dosyalar, kopyalanmaz) ve boş varsayılan zaman çizelgesi.
 * Kaynak proje değiştirilmez (yeni nesne üretilir; varlıklar derin kopyalanır).
 */
export function buildClipProject(source: Project, assetId: string, name: string): Project | null {
  const assets = assetsNeededFor(source, assetId)
  if (assets.length === 0) return null
  const now = new Date().toISOString()
  return {
    version: PROJECT_VERSION,
    id: newId('proj'),
    name,
    createdAt: now,
    updatedAt: now,
    assets: structuredClone(assets),
    timeline: createDefaultTimeline(),
    chatLogs: [],
    candidates: [],
    markers: Object.fromEntries(assets.filter((a) => source.markers[a.id]).map((a) => [a.id, structuredClone(source.markers[a.id])])),
    searchHistory: [],
    transcriptRefs: {},
    exportJobs: []
  }
}

/** Dosya adında sakıncalı karakterleri temizler (Windows/macOS) */
export function safeFileName(s: string): string {
  const t = s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
  return (t || 'klip').slice(0, 80)
}
