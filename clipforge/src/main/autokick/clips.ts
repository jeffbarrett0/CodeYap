import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Session, makeService } from '../../cli/session'
import { timelineDuration } from '../../shared/timeline/model'
import { cutRange } from '../../shared/timeline/ops'
import { timelineWords } from '../../shared/timeline/transcript'
import { findTopicCandidates, type TopicCandidate, type TopicOptions } from '../../shared/topic'

type Env = { userDataDir?: string; resourcesDir?: string }

/** Proje dosyası ya da AutoKick klasörü verilebilir (klasörde tek .clipforge aranır) */
export async function resolveProjectPath(p: string): Promise<string> {
  const abs = resolve(p)
  const st = await stat(abs).catch(() => null)
  if (!st) throw new Error(`Bulunamadı: ${abs}`)
  if (st.isFile()) return abs
  const found = (await readdir(abs)).filter((f) => f.endsWith('.clipforge'))
  if (found.length !== 1) throw new Error(found.length ? `Klasörde birden çok proje var: ${found.join(', ')}` : `Klasörde .clipforge projesi yok: ${abs}`)
  return join(abs, found[0])
}

/**
 * Auto Kick projesinin (sessizleri kesilmiş) transkriptinde konuyu arar ve aday klipleri döndürür.
 * Zamanlar ÇİZELGE zamanıdır (kesim sonrası tam video ile aynı). Projeyi değiştirmez.
 */
export async function topicCandidates(projectPath: string, topic: string, opts: Partial<TopicOptions>, env: Env = {}): Promise<TopicCandidate[]> {
  const s = await Session.open(await resolveProjectPath(projectPath), await makeService(env))
  const words = timelineWords(s.timeline, s.transcripts)
  if (words.length === 0) throw new Error('Projede transkript yok: önce Auto Kick tamamlanmalı.')
  return findTopicCandidates(words, topic, opts)
}

/**
 * Seçilen aralıktan BAĞIMSIZ klip projesi: Auto Kick projesi değişmez; klip, kesilmiş çizelgenin [start, end] aralığıdır
 * (boşluksuz, ses+görüntü bağlı). Klasör: `<Auto Kick projesi>-klipler/`. Düzenleme (yüz üstte, fotoğraf altta vb.) sonraki adım.
 */
export async function makeTopicClip(projectPath: string, topic: string, start: number, end: number, env: Env = {}): Promise<{ projectPath: string; durationSec: number }> {
  const s = await Session.open(await resolveProjectPath(projectPath), await makeService(env))
  const total = timelineDuration(s.timeline)
  if (!(end > start) || start < 0 || end > total + 0.5) throw new Error(`Geçersiz aralık: ${start.toFixed(1)}–${end.toFixed(1)} (çizelge ${total.toFixed(1)} sn).`)
  const asset = s.project.assets[0]
  if (!asset) throw new Error('Projede medya yok.')
  let tl = s.timeline
  if (end < total - 1e-3) tl = cutRange(tl, end, total, true)
  if (start > 1e-3) tl = cutRange(tl, 0, start, true)
  tl = { ...tl, captions: [] }
  const dur = timelineDuration(tl)
  const name = `${topic.trim() || 'Klip'} · ${Math.round(dur)} sn`
  const created = await s.service.createClipProject(s.project, asset.id, name)
  const c = await Session.open(created.path, await makeService(env))
  c.project = { ...c.project, timeline: tl }
  await c.save()
  return { projectPath: created.path, durationSec: dur }
}

/**
 * KONU DERLEMESİ (yatay video): konunun konuşulduğu TÜM aralıklar kronolojik sırayla tek videoda birleştirilir
 * ("Lemina'yı nerede konuştuysam hepsi bir video"). Auto Kick projesi değişmez; kare olduğu gibi (16:9) kalır.
 * `ranges`: çizelge zamanında [başlangıç, bitiş] aralıkları (çakışanlar birleştirilir).
 */
export async function makeTopicCompilation(projectPath: string, topic: string, ranges: [number, number][], env: Env = {}): Promise<{ projectPath: string; durationSec: number; parts: number }> {
  const s = await Session.open(await resolveProjectPath(projectPath), await makeService(env))
  const total = timelineDuration(s.timeline)
  const asset = s.project.assets[0]
  if (!asset) throw new Error('Projede medya yok.')
  const sorted = ranges.map(([a, b]) => [Math.max(0, a), Math.min(total, b)] as [number, number]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  const merged: [number, number][] = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1] + 0.05) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  if (merged.length === 0) throw new Error('Derlenecek aralık yok.')
  // aralıklar dışındaki bölümleri sondan başa doğru kes (zamanlar kaymasın)
  let tl = s.timeline
  const gaps: [number, number][] = []
  let cur = 0
  for (const [a, b] of merged) {
    if (a > cur + 1e-3) gaps.push([cur, a])
    cur = b
  }
  if (cur < total - 1e-3) gaps.push([cur, total])
  for (const [a, b] of [...gaps].reverse()) tl = cutRange(tl, a, b, true)
  tl = { ...tl, captions: [], aspect: '16:9', aspectAuto: false }
  const dur = timelineDuration(tl)
  const created = await s.service.createClipProject(s.project, asset.id, `${topic.trim() || 'Konu'} · derleme ${Math.round(dur / 60)} dk (yatay)`)
  const c = await Session.open(created.path, await makeService(env))
  c.project = { ...c.project, timeline: tl }
  await c.save()
  return { projectPath: created.path, durationSec: dur, parts: merged.length }
}
