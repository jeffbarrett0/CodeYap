import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildIdeaPrompt, enhanceIdeas, isCtaText, llmConfigured, parseIdeaJson, sampleTranscript } from '../../src/main/ideas/llm'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import type { VideoIdea } from '../../src/shared/ideas'

const idea = (n: number): VideoIdea => ({ id: `idea${n}`, label: 'Yapay zeka', headline: 'Yapay zeka hakkında konuşmuşsun', kind: 'topic', start: n * 100, end: n * 100 + 900, durationSec: 900, keywords: ['yapay zeka', 'model'], summary: 's', score: 0.8, firstWord: 0, lastWord: 5, titles: ['Taslak'], titleSource: 'draft' })

afterEach(() => vi.unstubAllGlobals())

describe('başlık yazan yapay zekâ (isteğe bağlı)', () => {
  it('çağrı/yönlendirme metni tanınır ve elenir (kalıcı kural)', () => {
    expect(isCtaText('Videoyu beğenip abone olun')).toBe(true)
    expect(isCtaText('Videonun tamamı kanalımda')).toBe(true)
    expect(isCtaText('Yapay Zeka Hayatımızı Nasıl Değiştiriyor?')).toBe(false)
    const r = parseIdeaJson('Tabii: {"title":"Yapay Zeka Nasıl Çalışır?","alternatives":["Abone olmayı unutma","Modeller Nasıl Öğrenir?"],"hook":"Kanalıma gel","description":"Kısa özet."}')
    expect(r).toEqual({ title: 'Yapay Zeka Nasıl Çalışır?', alternatives: ['Modeller Nasıl Öğrenir?'], hook: undefined, description: 'Kısa özet.' })
    expect(parseIdeaJson('yanıt yok')).toBeNull()
    expect(parseIdeaJson('{"title":"Beğenmeyi unutmayın","alternatives":[]}')).toBeNull()
  })
  it('örnekleme ve istem: uzun metin kısaltılır; kurallar ve konu ipucu istemde', () => {
    const long = 'kelime '.repeat(5000)
    const s = sampleTranscript(long, 6000, 6)
    expect(s.length).toBeLessThan(6300)
    expect(s).toContain('[…]')
    expect(sampleTranscript('kısa metin')).toBe('kısa metin')
    const p = buildIdeaPrompt(idea(1), 'metin')
    expect(p).toMatch(/15 dakikalık/)
    expect(p).toMatch(/yapay zeka, model/)
    expect(p).toMatch(/çağrı\/yönlendirme metni YAZMA/)
    expect(p).toMatch(/uydurma/)
  })
  it('yapılandırma denetimi', () => {
    expect(llmConfigured({ ...DEFAULT_SETTINGS })).toMatch(/kapalı/)
    expect(llmConfigured({ ...DEFAULT_SETTINGS, llmProvider: 'anthropic' })).toMatch(/Anthropic API anahtarı/)
    expect(llmConfigured({ ...DEFAULT_SETTINGS, llmProvider: 'anthropic', anthropicApiKey: 'k' })).toBeNull()
    expect(llmConfigured({ ...DEFAULT_SETTINGS, llmProvider: 'openai', openaiApiKey: 'k' })).toBeNull()
  })
  it('Anthropic: başlıklar eklenir; bir öneride hata olursa taslak kalır ve neden döner', async () => {
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { headers: Record<string, string>; body: string }) => {
      call++
      expect(init.headers['x-api-key']).toBe('sk-test')
      expect(JSON.parse(init.body).messages[0].content).toContain('METİN:')
      if (call === 2) return { ok: false, status: 529, text: async () => 'overloaded' }
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"title":"Başlık ' + call + '","alternatives":["Alt A","Alt B"],"hook":"Açılış","description":"Özet"}' }] }) }
    }))
    const s = { ...DEFAULT_SETTINGS, llmProvider: 'anthropic' as const, anthropicApiKey: 'sk-test' }
    const r = await enhanceIdeas([idea(1), idea(2), idea(3)], () => 'konuşma metni', s)
    expect(r.failed).toBe(1)
    expect(r.error).toMatch(/HTTP 529/)
    const ai = r.ideas.filter((i) => i.titleSource === 'ai')
    expect(ai).toHaveLength(2)
    expect(ai[0].titles).toHaveLength(3)
    expect(ai[0].hook).toBe('Açılış')
    expect(r.ideas.filter((i) => i.titleSource === 'draft')[0].titles).toEqual(['Taslak'])
  })
  it('OpenAI uyumlu: chat/completions çağrılır', async () => {
    const f = vi.fn(async (url: string) => {
      expect(url).toBe('http://localhost:11434/v1/chat/completions')
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"title":"Yerel Model Başlığı","alternatives":[]}' } }] }) }
    })
    vi.stubGlobal('fetch', f)
    const r = await enhanceIdeas([idea(1)], () => 'm', { ...DEFAULT_SETTINGS, llmProvider: 'openai', openaiApiKey: 'x', openaiBaseUrl: 'http://localhost:11434/v1/' })
    expect(r.ideas[0].titles).toEqual(['Yerel Model Başlığı'])
    expect(f).toHaveBeenCalledOnce()
  })
})
