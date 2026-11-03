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
  if (s.llmProvider === 'openai') return s.openaiApiKey ? null : 'OpenAI API anahtarı girilmemiş (Ayarlar → Başlık önerileri).'
  if (s.llmProvider === 'anthropic') return s.anthropicApiKey ? null : 'Anthropic API anahtarı girilmemiş (Ayarlar → Başlık önerileri).'
  return 'Yapay zekâ kapalı (Ayarlar → Başlık önerileri).'
}

async function ask(s: Settings, prompt: string, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(90_000)
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout
  if (s.llmProvider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': s.anthropicApiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: s.llmModel || 'claude-haiku-5-5', max_tokens: 700, messages: [{ role: 'user', content: prompt }] }),
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
