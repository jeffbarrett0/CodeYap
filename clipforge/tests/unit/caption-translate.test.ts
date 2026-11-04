import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAss } from '../../src/shared/export/ass'
import { cmd } from '../../src/shared/timeline/commands'
import { localizeCaption, localizeCaptions, untranslated } from '../../src/shared/timeline/captions'
import { assignHighlights, presetById } from '../../src/shared/timeline/captionStyles'
import { createDefaultTimeline, DEFAULT_CAPTION_STYLE } from '../../src/shared/timeline/model'
import { buildTranslatePrompt, parseTranslation, translateLines } from '../../src/main/ideas/llm'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import type { Caption, CaptionStyle, Timeline } from '../../src/shared/types'

const ref = { ...DEFAULT_CAPTION_STYLE, ...presetById('boxed-highlight').style } as CaptionStyle
const caps: Caption[] = [
  { id: 'a', start: 0, end: 2, text: 'merhaba dünya nasılsınız' },
  { id: 'b', start: 2, end: 4, text: 'bugün hava çok güzel' }
]
const tl = (): Timeline => ({ ...createDefaultTimeline(), captions: caps, captionStyle: ref })

afterEach(() => vi.unstubAllGlobals())

describe('altyazı dili (özgün / İngilizce)', () => {
  it('çeviri komutu: metinler eklenir, dil açılır, vurgu İNGİLİZCE metne göre atanır; geri alınabilir', () => {
    const c = cmd.captionTranslations('en', { a: 'hello world how are you', b: 'the weather is great today' })
    const out = c.do(tl())
    expect(out.captionLang).toBe('en')
    expect(out.captions[0].tr!.en.text).toBe('hello world how are you')
    expect(out.captions[0].text).toBe('merhaba dünya nasılsınız') // özgün korunur
    expect(out.captions[0].tr!.en.hl).toMatchObject({ from: 3, to: 4 }) // 5 kelime → son 2
    expect(out.captions[0].hl).toBeDefined()
    expect(c.undo(out).captionLang).toBeUndefined()
    expect(untranslated(out, 'en')).toEqual([])
    expect(untranslated(tl(), 'en')).toHaveLength(2)
  })
  it('yerelleştirme: İngilizce seçiliyse çeviri, yoksa özgün; "orig" hiçbir şeyi değiştirmez', () => {
    const out = cmd.captionTranslations('en', { a: 'hello' }).do(tl())
    expect(localizeCaptions(out).map((c) => c.text)).toEqual(['hello', 'bugün hava çok güzel']) // b'nin çevirisi yok → özgün
    expect(localizeCaptions(cmd.captionLang('orig').do(out)).map((c) => c.text)).toEqual(['merhaba dünya nasılsınız', 'bugün hava çok güzel'])
    expect(localizeCaption(caps[0], 'en')).toBe(caps[0])
  })
  it('düzenleme: İngilizce modunda çeviri düzenlenir, özgün metin değişmez', () => {
    let t = cmd.captionTranslations('en', { a: 'hello there', b: 'nice day' }).do(tl())
    t = cmd.captionText('a', 'hello my friends', 'en').do(t)
    expect(t.captions[0].tr!.en.text).toBe('hello my friends')
    expect(t.captions[0].text).toBe('merhaba dünya nasılsınız')
    t = cmd.captionText('a', 'merhaba arkadaşlar', 'orig').do(t)
    expect(t.captions[0].text).toBe('merhaba arkadaşlar')
  })
  it('stil değişince çevirilerin vurgusu da yenilenir', () => {
    const t = cmd.captionTranslations('en', { a: 'hello world how are you', b: 'good day' }).do(tl())
    const off = assignHighlights(t.captions, { highlight: { enabled: false, colors: [] } })
    expect(off[0].tr!.en.hl).toBeUndefined()
  })
  it('dışa aktarma (ASS): İngilizce seçiliyse İngilizce metin, kutu ve vurgu ile', () => {
    const t = cmd.captionTranslations('en', { a: 'hello world how are you', b: 'good day' }).do(tl())
    const ass = buildAss(localizeCaptions(t), t.captionStyle, 1080, 1920)
    expect(ass).toContain('HELLO WORLD')
    expect(ass).not.toContain('MERHABA')
    expect(ass).toContain('Style: Box')
  })
})

describe('çeviri isteği (yapay zekâ)', () => {
  const s = { ...DEFAULT_SETTINGS, llmProvider: 'anthropic' as const, anthropicApiKey: 'k' }
  it('istem: sayı, sıra, bağlam kuralı ve çağrı yasağı', () => {
    const p = buildTranslatePrompt(['bir', 'iki'], 'English')
    expect(p).toContain('exactly 2 items')
    expect(p).toContain('1. bir')
    expect(p).toMatch(/no calls to action/i)
  })
  it('yanıt ayrıştırma: dizi ya da numaralı nesne; sayı tutmazsa null', () => {
    expect(parseTranslation('Sure: ["a","b"]', 2)).toEqual(['a', 'b'])
    expect(parseTranslation('{"1":"x","2":"y"}', 2)).toEqual(['x', 'y'])
    expect(parseTranslation('["a"]', 2)).toBeNull()
    expect(parseTranslation('nope', 1)).toBeNull()
  })
  it('anahtar yoksa açık hata; yanıt sayısı tutmazsa parti bölünüp yeniden denenir', async () => {
    await expect(translateLines(['a'], { ...DEFAULT_SETTINGS })).rejects.toThrow(/yapay zekâ gerekli/i)
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => {
      calls++
      const content = JSON.parse(init.body).messages[0].content as string
      const n = Number(/exactly (\d+) items/.exec(content)![1])
      // ilk istek (10 satır) bozuk dizi döner; bölünen partiler doğru döner
      const arr = calls === 1 ? ['yalnız bir'] : Array.from({ length: n }, (_, i) => `EN${i + 1}`)
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(arr) }] }) }
    }))
    const out = await translateLines(Array.from({ length: 10 }, (_, i) => `satır ${i}`), s)
    expect(out).toHaveLength(10)
    expect(calls).toBeGreaterThan(2)
  })
})
