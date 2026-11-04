import type { Settings } from '../../shared/types'
import type { VideoIdea } from '../../shared/ideas'

/**
 * İsteğe bağlı yapay zekâ: her öneri için YouTube başlığı (+ 2 alternatif), açılış fikri ve kısa açıklama yazar.
 * Sağlayıcılar: OpenAI uyumlu (OpenAI, OpenRouter, yerel Ollama…) ve Anthropic. Anahtar yoksa ya da hata olursa
 * taslak başlıklar kalır; hiçbir şey kaybolmaz.
 */

export interface IdeaAi {
  title: string
  alternatives: string[]
  hook?: string
  description?: string
}

/** Kullanıcının kalıcı kuralı: başlık/açıklamada çağrı ya da kanala yönlendirme metni OLMAZ */
const CTA = /(beğen|abone|takip et|takip etmeyi|kanal(ım|ıma|ımda)|bildirim|zili|link|açıklama(da|daki)|tamamı)/i
export const isCtaText = (s: string) => CTA.test(s)

/** Uzun metni N eşit aralıktan alınan parçalarla kısaltır (başı, ortası, sonu temsil edilsin) */
export function sampleTranscript(text: string, maxChars = 6000, parts = 6): string {
  if (text.length <= maxChars) return text
  const size = Math.floor(maxChars / parts)
  const out: string[] = []
  for (let i = 0; i < parts; i++) {
    const at = Math.floor(((text.length - size) * i) / (parts - 1))
    out.push(text.slice(at, at + size))
  }
  return out.join(' […] ')
}

export function buildIdeaPrompt(idea: Pick<VideoIdea, 'durationSec' | 'keywords'>, text: string): string {
  const mins = Math.max(1, Math.round(idea.durationSec / 60))
  return `Aşağıda bir canlı yayının ${mins} dakikalık bir bölümünün konuşma metni var (uzunsa parçalar "[…]" ile ayrılmıştır). Bu bölümü YouTube'da ayrı bir video olarak yayımlamak istiyoruz.

Şunu JSON olarak döndür (başka hiçbir şey yazma):
{"title": "ana başlık", "alternatives": ["alternatif başlık 1", "alternatif başlık 2"], "hook": "videonun ilk 10 saniyesi için bir açılış cümlesi fikri", "description": "1-2 cümlelik tarafsız özet"}

Kurallar:
- Yalnızca metinde GERÇEKTEN geçenlere dayan; uydurma bilgi, uydurma iddia ya da yanlış vaat ekleme.
- Başlıklar Türkçe, en fazla 70 karakter, merak uyandırıcı ama abartısız (yanıltıcı "tık tuzağı" yok).
- "Beğenin", "abone olun", "takip edin", "kanalıma gelin" gibi çağrı/yönlendirme metni YAZMA.
- Özel isimleri metindeki gibi yaz.
- Bölümün ana konusu (ipucu: ${idea.keywords.slice(0, 4).join(', ') || 'bilinmiyor'}).

METİN:
${text}`
}

/** Modelin yanıtından ilk JSON nesnesini çıkarır ve doğrular; başlıklardan çağrı içerenleri atar */
export function parseIdeaJson(raw: string): IdeaAi | null {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    const clean = (s: string) => s && s.length <= 120 && !isCtaText(s)
    const title = str(j.title)
    const alts = (Array.isArray(j.alternatives) ? j.alternatives : []).map(str).filter(clean).slice(0, 3)
    if (!clean(title)) return alts.length ? { title: alts[0], alternatives: alts.slice(1), hook: str(j.hook) || undefined, description: str(j.description) || undefined } : null
    const hook = str(j.hook)
    const description = str(j.description)
    return { title, alternatives: alts, hook: hook && !isCtaText(hook) ? hook : undefined, description: description && !isCtaText(description) ? description : undefined }
  } catch {
    return null
  }
}

export function llmConfigured(s: Pick<Settings, 'llmProvider' | 'openaiApiKey' | 'anthropicApiKey'>): string | null {
  if (s.llmProvider === 'openai') return s.openaiApiKey ? null : 'OpenAI API anahtarı girilmemiş (Ayarlar → Yapay zekâ).'
  if (s.llmProvider === 'anthropic') return s.anthropicApiKey ? null : 'Anthropic API anahtarı girilmemiş (Ayarlar → Yapay zekâ).'
  return 'Yapay zekâ kapalı (Ayarlar → Yapay zekâ).'
}

export async function ask(s: Settings, prompt: string, signal?: AbortSignal, maxTokens = 700): Promise<string> {
  const timeout = AbortSignal.timeout(90_000)
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout
  if (s.llmProvider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': s.anthropicApiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: s.llmModel || 'claude-haiku-5-5', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
      signal: sig
    })
    if (!res.ok) throw new Error(`Anthropic yanıtı: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
    const j = (await res.json()) as { content?: { type: string; text?: string }[] }
    return (j.content ?? []).map((c) => c.text ?? '').join('')
  }
  const base = (s.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${s.openaiApiKey}` },
    body: JSON.stringify({ model: s.llmModel || 'gpt-4o-mini', temperature: 0.7, messages: [{ role: 'user', content: prompt }] }),
    signal: sig
  })
  if (!res.ok) throw new Error(`OpenAI yanıtı: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return j.choices?.[0]?.message?.content ?? ''
}

/** Önerilere yapay zekâ başlıkları ekler (en fazla 3 istek aynı anda). Hata olan önerilerde taslak başlıklar kalır. */
export async function enhanceIdeas(ideas: VideoIdea[], textOf: (i: VideoIdea) => string, s: Settings, signal?: AbortSignal): Promise<{ ideas: VideoIdea[]; failed: number; error?: string }> {
  const out = [...ideas]
  let failed = 0
  let firstError: string | undefined
  let next = 0
  const worker = async () => {
    while (next < ideas.length) {
      const i = next++
      try {
        const raw = await ask(s, buildIdeaPrompt(ideas[i], sampleTranscript(textOf(ideas[i]))), signal)
        const ai = parseIdeaJson(raw)
        if (!ai) throw new Error('Yapay zekâ yanıtı okunamadı.')
        out[i] = { ...ideas[i], titles: [ai.title, ...ai.alternatives], titleSource: 'ai', hook: ai.hook, description: ai.description }
      } catch (e) {
        failed++
        firstError ??= e instanceof Error ? e.message : String(e)
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return { ideas: out, failed, error: firstError }
}

// ───────────────────────── altyazı çevirisi ─────────────────────────

export function buildTranslatePrompt(lines: string[], to: string, from = 'Türkçe'): string {
  const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join('\n')
  return `Below are consecutive subtitle lines of a video, in ${from}, numbered. Translate each line into ${to}.

Rules:
- Return ONLY a JSON array of strings with exactly ${lines.length} items, in the same order (item i = translation of line i).
- The lines are fragments of continuous speech: use the surrounding lines for context, but put in each item only the translation of THAT line (do not merge or split lines).
- Keep each translation short and natural, like a subtitle. Keep proper names (people, teams, places) as they are.
- Do not add explanations, quotes, numbering or any text that is not in the original (no calls to action).

LINES:
${numbered}`
}

/** Modelin yanıtını (JSON dizi ya da {"1": …} nesnesi) satır sayısı doğrulanmış metin listesine çevirir; tutarsızsa null */
export function parseTranslation(raw: string, expected: number): string[] | null {
  const arr = raw.match(/\[[\s\S]*\]/)
  try {
    if (arr) {
      const j = JSON.parse(arr[0]) as unknown
      if (Array.isArray(j) && j.length === expected && j.every((x) => typeof x === 'string')) return (j as string[]).map((x) => x.trim())
    }
    const obj = raw.match(/\{[\s\S]*\}/)
    if (obj) {
      const o = JSON.parse(obj[0]) as Record<string, unknown>
      const out = Array.from({ length: expected }, (_, i) => o[String(i + 1)])
      if (out.every((x) => typeof x === 'string')) return (out as string[]).map((x) => x.trim())
    }
  } catch {
    /* geçersiz JSON */
  }
  return null
}

/**
 * Altyazı satırlarını çevirir (aynı sayıda, aynı sırada: zamanlamalar korunur). Satır sayısı tutmazsa parti ikiye bölünüp
 * yeniden denenir; çok küçük partide de tutmazsa hata verir.
 */
export async function translateLines(lines: string[], s: Settings, to = 'English', signal?: AbortSignal, from = 'Türkçe'): Promise<string[]> {
  const problem = llmConfigured(s)
  if (problem) throw new Error(`Çeviri için yapay zekâ gerekli. ${problem}`)
  const out: string[] = []
  const run = async (part: string[]): Promise<string[]> => {
    const raw = await ask(s, buildTranslatePrompt(part, to, from), signal, Math.min(4000, 200 + part.join(' ').length * 2))
    const parsed = parseTranslation(raw, part.length)
    if (parsed) return parsed
    if (part.length <= 3) throw new Error('Çeviri yanıtı okunamadı (satır sayısı tutmadı). Tekrar deneyin.')
    const mid = Math.ceil(part.length / 2)
    return [...(await run(part.slice(0, mid))), ...(await run(part.slice(mid)))]
  }
  const BATCH = 40
  for (let i = 0; i < lines.length; i += BATCH) out.push(...(await run(lines.slice(i, i + BATCH))))
  return out
}

// ───────────────────────── bölüm başlıkları ─────────────────────────

export function buildChapterPrompt(text: string, minutes: number): string {
  return `Aşağıda bir YouTube videosunun ${minutes} dakikalık bir bölümünün konuşma metni var (uzunsa parçalar "[…]" ile ayrılmıştır). Bu bölüm için YouTube "bölüm zamanları" (chapters) listesine yazılacak KISA bir başlık ver.

Yalnızca şu JSON'u döndür: {"title": "başlık"}

Kurallar:
- Türkçe, 2-6 kelime, en fazla 45 karakter; bölümde konuşulan asıl konuyu söylesin (ör. "Batrakov'un performansı", "Yapay zekâ ve gelecek").
- Yalnızca metinde GERÇEKTEN konuşulanlara dayan; uydurma ya da abartı yok; tık tuzağı yok.
- "Beğenin", "abone olun", "kanalıma gelin" gibi çağrı/yönlendirme metni YAZMA.
- Özel isimleri metindeki gibi yaz. Sonuna nokta koyma.

METİN:
${text}`
}

export function parseChapterTitle(raw: string): string | null {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const t = (JSON.parse(m[0]) as { title?: unknown }).title
    const s = typeof t === 'string' ? t.trim().replace(/[.。]+$/, '') : ''
    return s && s.length <= 60 && !isCtaText(s) ? s : null
  } catch {
    return null
  }
}

/** Bölümlere yapay zekâ başlıkları yazar (3 eşzamanlı istek); hata olan bölümde taslak başlık kalır */
export async function aiChapterTitles(texts: string[], minutes: number[], s: Settings, signal?: AbortSignal): Promise<{ titles: (string | null)[]; failed: number; error?: string }> {
  const titles: (string | null)[] = texts.map(() => null)
  let failed = 0
  let firstError: string | undefined
  let next = 0
  const worker = async () => {
    while (next < texts.length) {
      const i = next++
      try {
        const raw = await ask(s, buildChapterPrompt(sampleTranscript(texts[i], 3500, 5), minutes[i]), signal, 150)
        const t = parseChapterTitle(raw)
        if (!t) throw new Error('Yapay zekâ başlığı okunamadı.')
        titles[i] = t
      } catch (e) {
        failed++
        firstError ??= e instanceof Error ? e.message : String(e)
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return { titles, failed, error: firstError }
}
