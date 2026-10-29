import type { Chapter, Marker } from '../types'
import { parseTimeValue } from '../chat/parse'

export function markersFromChapters(chapters: Chapter[]): Marker[] {
  return chapters.map((c) => ({ time: c.start, label: c.title || 'İşaret', source: 'chapter' as const }))
}

/**
 * Yayın sırasında alınan işaret dosyasını (obs-websocket günlüğü, OBS bölüm işaretçisi dışa aktarımı vb.) okur.
 * Tanınmayan / boş içerik HATA VERMEZ: boş liste döner (özellik sessizce devre dışı kalır).
 */
export function parseMarkerFile(text: string, fileName = ''): Marker[] {
  try {
    const clean = text.replace(/^﻿/, '').trim()
    if (!clean) return []
    if (clean.startsWith('[') || clean.startsWith('{')) {
      const data = JSON.parse(clean)
      const arr: unknown[] = Array.isArray(data) ? data : (data.markers ?? data.chapters ?? data.events ?? [])
      return toMarkers(arr.map((x) => x as Record<string, unknown>))
    }
    const out: Marker[] = []
    for (const line of clean.split(/\r?\n/)) {
      const m = /^\[?\s*((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d+)?|\d+(?:\.\d+)?)\s*\]?\s*[,;\t\-–:]?\s*(.*)$/.exec(line.trim())
      if (!m) continue
      const t = parseTimeValue(m[1])
      if (t?.kind === 'rel') out.push({ time: t.sec, label: m[2].trim() || 'İşaret', source: 'sidecar' })
    }
    return out.sort((a, b) => a.time - b.time)
  } catch {
    void fileName
    return []
  }
}

function toMarkers(items: Record<string, unknown>[]): Marker[] {
  const out: Marker[] = []
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const raw = it.time ?? it.t ?? it.timestamp ?? it.seconds ?? it.start ?? it.offset ?? it.timecode
    const t = parseTimeValue(raw)
    if (t?.kind !== 'rel') continue
    out.push({ time: t.sec, label: String(it.label ?? it.name ?? it.title ?? it.text ?? it.chapterName ?? 'İşaret'), source: 'sidecar' })
  }
  return out.sort((a, b) => a.time - b.time)
}
