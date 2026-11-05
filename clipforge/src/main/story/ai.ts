import { buildSegments } from '../../shared/transcript/sentences'
import { normalizeScenes, sanitizeContent } from '../../shared/story/plan'
import type { StoryScene } from '../../shared/story/types'
import type { Settings, TranscriptWord } from '../../shared/types'
import { ask } from '../ideas/llm'

const mmss = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`

export function buildStoryPrompt(lines: string, theme: 'tr'): string {
  void theme
  return `Bir içerik üreticisi bir konuyu sesli anlatıyor; sen anlatılanı GÖRSELLEŞTİREN hareketli sahneler planlıyorsun (haber/analiz kanallarındaki animasyonlu bilgi kartları gibi). Aşağıda anlatımın zaman damgalı cümleleri var.

Yalnızca şu JSON'u döndür: {"scenes":[ ... ]}

Her sahne: {"start": saniye, "end": saniye, "type": "...", ...alanlar}. Sahne türleri ve alanları:
- "stats": {"kicker","title","cards":[{"label","value","unit","sub","tone","at"}]}  — rakamlar (1-4 kart). value kısa: "7", "15.", "%40"; unit: "PUAN", "SIRA"…
- "timeline": {"kicker","title","periods":[{"label":"22/23","at","items":[{"text","tone","at"}]}]} — sezon/yıl/dönem akışı (2-5 dönem, dönem başına en çok 3-4 madde)
- "list": {"kicker","title","items":[{"text","tone","at"}]} — sıralı maddeler
- "person": {"role","name","sub"} — biri ilk kez tanıtılırken (unvan + ad)
- "quote": {"text","by"} — önemli bir söz
- "title": {"text","sub"} — yeni bir konuya geçerken başlık
- "place": {"to": "ülke ya da ana şehir adı", "from"?, "label"} — anlatılan yer önemliyse harita

Kurallar:
- "at": sahnenin BAŞLANGICINA göre saniye; kart/madde, o şey KONUŞULDUĞU anda belirsin. Zaman damgalarından hesapla.
- "tone": "good" (olumlu), "bad" (olumsuz), "warn" (uyarı/risk), "neutral".
- Yalnızca anlatımda GERÇEKTEN geçenleri yaz; rakam, ad ve sezonları uydurma ya da değiştirme. Yazılar kısa olsun (madde ≤ 6 kelime, BÜYÜK HARF gerekmez).
- Her önemli bilgiyi görselleştir ama her cümleye sahne koyma: ortalama 15-40 saniyede bir sahne; sahneler çakışmasın, "start" artsın.
- "Beğenin", "abone olun", "kanala gelin" gibi çağrı/yönlendirme metni ASLA yazma.
- Dil: anlatımın dili.

ANLATIM:
${lines}`
}

export function parseScenes(raw: string, offset = 0): StoryScene[] {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return []
  let j: { scenes?: unknown }
  try {
    j = JSON.parse(m[0]) as { scenes?: unknown }
  } catch {
    return []
  }
  const out: StoryScene[] = []
  for (const x of Array.isArray(j.scenes) ? j.scenes : []) {
    const o = (x ?? {}) as Record<string, unknown>
    const start = typeof o.start === 'number' ? o.start : NaN
    const end = typeof o.end === 'number' ? o.end : start + 6
    const content = sanitizeContent(o)
    if (!content || !Number.isFinite(start) || start < 0) continue
    out.push({ id: `a${offset + out.length + 1}`, start, end: Math.max(end, start + 2), enabled: true, content, source: 'ai' })
  }
  return out
}

/** Anlatımı parçalara bölüp yapay zekâya sahne planlatır; sahneler geçerli, çakışmasız bir dizi olarak döner */
export async function aiStoryScenes(words: TranscriptWord[], settings: Settings, signal?: AbortSignal): Promise<{ scenes: StoryScene[]; error?: string }> {
  const sentences = buildSegments(words)
  const chunks: string[][] = [[]]
  let size = 0
  for (const s of sentences) {
    const line = `[${mmss(s.start)}] ${s.text}`
    if (size + line.length > 5500) (chunks.push([]), (size = 0))
    chunks[chunks.length - 1].push(line)
    size += line.length
  }
  const all: StoryScene[] = []
  let error: string | undefined
  for (const c of chunks) {
    try {
      const raw = await ask(settings, buildStoryPrompt(c.join('\n'), 'tr'), signal, 3500)
      const found = parseScenes(raw, all.length)
      if (found.length === 0) error ??= 'Yapay zekâ yanıtında sahne bulunamadı.'
      all.push(...found)
    } catch (e) {
      error ??= e instanceof Error ? e.message : String(e)
    }
  }
  const total = words.length ? words[words.length - 1].end : 0
  const norm = normalizeScenes(all.sort((a, b) => a.start - b.start).filter((s, i, a) => i === 0 || s.start >= a[i - 1].start + 1.5), total)
  return { scenes: norm.map((s, i) => ({ ...s, id: `s${i + 1}` })), error }
}
