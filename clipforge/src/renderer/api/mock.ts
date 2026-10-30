/**
 * Tarayıcı modu için sahte ana süreç. Arama, görev kuyruğu, sohbet ayrıştırma ve dışa aktarma planı
 * GERÇEK paylaşılan çekirdek kodunu kullanır; yalnızca ffmpeg/whisper/dosya sistemi taklit edilir.
 * Kullanım: `npm run dev:web` (Playwright UI testleri de bunu çalıştırır).
 */
import type { ClipforgeApi, IpcChannel, IpcEventName, IpcEvents, IpcInvoke } from '@shared/ipc'
import { parseChatLog } from '@shared/chat/parse'
import { DEFAULT_SETTINGS, normalizeSettings } from '@shared/settings'
import { DEFAULT_SEARCH_OPTIONS } from '@shared/search/engine'
import { SearchService } from '@shared/search/service'
import { buildSegments } from '@shared/transcript/sentences'
import { applyVocabulary, fixWord, parseVocabulary, withWords } from '@shared/transcript/vocabulary'
import { scoreCandidates, snapCandidate } from '@shared/suggest/score'
import { newId } from '@shared/timeline/model'
import type { MediaAsset, Settings, Transcript, TranscriptWord } from '@shared/types'
import { TaskQueue, userMessage } from '../../main/tasks'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const FILLER = [
  'Evet arkadaşlar yeni maça giriyoruz şimdi.',
  'Bu harita gerçekten çok zor bir harita olmuş.',
  'Chat ne diyorsunuz devam edelim mi?',
  'Az önce şu adamı nasıl kaçırdım anlamadım.',
  'Bugün yayına biraz geç başladık kusura bakmayın.',
  'Kahvemi alıp geliyorum bir saniye bekleyin.',
  'Oha bu ne lan inanamıyorum şu işe bak!',
  'Neyse devam ediyoruz ekibi toplayalım.'
]
const INJECT: { at: number; text: string }[] = [
  { at: 14, text: "Geçen sene Victor Nelson'dan bahsetmiştim hatırlıyor musunuz." },
  { at: 20, text: 'Adam gerçekten çok komik bir tipti.' },
  { at: 61, text: 'Viktor Nelsen diye bir yayıncı vardı ya.' },
  { at: 97, text: 'Victor Nelson yine geldi.' },
  { at: 34, text: 'Şimdi ııı eee yani hımm bakalım.' },
  { at: 75, text: 'Abdullah Kabukçu bunu yapmaz derken Kabukçu\'nun sözleri geldi.' }
]

export function demoTranscript(assetId: string, duration: number, lang: string): Transcript {
  const lines: { at: number; text: string }[] = []
  let t = 0
  let i = 0
  const near = (x: number) => INJECT.some((l) => x >= l.at - 8 && x <= l.at + 12)
  while (t < duration - 4) {
    const text = FILLER[i++ % FILLER.length]
    if (!near(t)) lines.push({ at: t, text })
    t += text.split(' ').length * 0.35 + 1.1
  }
  lines.push(...INJECT.filter((l) => l.at < duration))
  lines.sort((a, b) => a.at - b.at)
  const words: TranscriptWord[] = []
  for (const l of lines) {
    let s = l.at
    for (const w of l.text.split(' ')) {
      // güven: "Kabukçu" gibi emin olunamayan kelimeler düşük güvenli (arayüzde işaretlenir)
      words.push({ text: w, start: s, end: s + 0.31, confidence: /^Kabuk/.test(w) ? 0.32 : 0.95 })
      s += 0.35
    }
  }
  return { id: newId('tr'), assetId, language: lang, model: 'mock', provider: 'mock', audioTrack: 0, createdAt: new Date().toISOString(), durationSec: duration, words, segments: buildSegments(words) }
}

const audio = (i: number, title: string) => ({ index: i, streamIndex: i + 1, codec: 'aac', channels: 2, sampleRate: 48000, title })

function demoAsset(path: string): MediaAsset {
  const name = path.split('/').pop() as string
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    return { id: newId('asset'), name, path, kind: 'image', container: 'image', durationSec: 0, width: 900, height: 700, fps: 0, sizeBytes: 100_000, audioStreams: [], obs: { isObs: false, encoder: 'unknown', evidence: [] }, chapters: [], transcriptionTrack: 0, audioMap: { mix: 0 }, importedAt: new Date().toISOString(), role: 'image' }
  }
  if (['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg'].includes(ext)) {
    return { id: newId('asset'), name, path, kind: 'audio', container: ext, durationSec: 120, width: 0, height: 0, fps: 0, sizeBytes: 5_000_000, audioStreams: [audio(0, 'Ses')], obs: { isObs: false, encoder: 'unknown', evidence: [] }, chapters: [], transcriptionTrack: 0, audioMap: { mix: 0 }, importedAt: new Date().toISOString() }
  }
  const vertical = /dikey/i.test(name) // test: dikey (1080×1920) video
  return {
    id: newId('asset'), name, path, kind: 'video', container: 'mkv', durationSec: 120, width: vertical ? 1080 : 1920, height: vertical ? 1920 : 1080, fps: 60, videoCodec: 'h264', videoProfile: 'High', sizeBytes: 1_800_000_000, bitrate: 20_000_000,
    audioStreams: [audio(0, 'Track 1'), audio(1, 'Track 2'), audio(2, 'Track 3')],
    obs: { isObs: true, version: '30.1.2', encoder: 'x264', evidence: ['Dosya adı OBS varsayılan biçiminde', 'Kodlayıcı imzası: x264'] },
    chapters: [], transcriptionTrack: 0, audioMap: { mix: 0, game: 1, voice: 2 }, importedAt: new Date().toISOString(),
    proxyPath: 'mock/proxy.mp4', thumbnailPath: 'mock/thumb.jpg'
  }
}

export function createMockApi(): ClipforgeApi {
  const listeners = new Map<IpcEventName, Set<(p: never) => void>>()
  const emit = <E extends IpcEventName>(event: E, payload: IpcEvents[E]) => listeners.get(event)?.forEach((cb) => cb(payload as never))
  let settings: Settings = { ...DEFAULT_SETTINGS }
  const assets = new Map<string, MediaAsset>()
  const search = new SearchService()
  const queue = new TaskQueue()
  queue.onUpdate((t) => emit('task:update', t))
  let userTemplates: import('@shared/types').LayoutTemplate[] = []
  const w = window as unknown as { __mock?: { nextChat?: string; fail?: Record<string, string> } }
  w.__mock = w.__mock ?? {}

  const SAMPLE_CSV = ['time,user,message', ...Array.from({ length: 12 }, (_, i) => `00:00:${String(i * 8).padStart(2, '0')},u${i},selam`), ...Array.from({ length: 80 }, (_, i) => `00:00:${String(Math.min(59, 40 + Math.floor(i / 5))).padStart(2, '0')}.${i % 10},v${i},LUL`)].join('\n')

  const handlers: { [C in IpcChannel]: (...a: IpcInvoke[C][0]) => Promise<IpcInvoke[C][1]> | IpcInvoke[C][1] } = {
    'app:info': () => ({ version: 'dev (tarayıcı modu)', platform: 'web', ffmpeg: { ok: true, path: 'mock', version: 'ffmpeg (sahte)' }, ffprobe: { ok: true, path: 'mock', version: 'ffprobe (sahte)' }, whisperCpp: { ok: true, path: 'mock' }, models: (['tiny', 'base', 'small', 'medium'] as const).map((s) => ({ size: s, installed: s === 'small', path: `mock/ggml-${s}.bin` })), userDataDir: 'mock' }),
    'settings:get': () => settings,
    'settings:set': (p) => (settings = normalizeSettings({ ...settings, ...p })),
    'dialog:openMedia': () => ['/demo/2024-05-12 21-30-45.mkv'],
    'dialog:openFile': () => 'mock://chat',
    'dialog:saveFile': ({ defaultName }) => `/tmp/${defaultName}`,
    'project:save': (_p, path) => ({ path: path ?? '/tmp/proje.clipforge' }),
    'project:open': () => null,
    'project:new': () => ({ dataDir: 'mock' }),
    'media:import': (paths) =>
      paths.map((p) => {
        if (w.__mock?.fail?.import) return queue.add({ kind: 'import', title: `İçe aktarılıyor: ${p.split('/').pop()}`, run: async () => { throw new Error(w.__mock!.fail!.import) } }).id
        return queue.add({
          kind: 'import',
          title: `İçe aktarılıyor: ${p.split('/').pop()}`,
          run: async (ctx) => {
            for (const f of [0.3, 0.7]) (ctx.progress(f), await sleep(60))
            const a = demoAsset(p)
            assets.set(a.id, a)
            emit('asset:added', a)
          }
        }).id
      }),
    'media:markers': () => [],
    'media:syncOffset': () => 0.8,
    'transcript:start': (req) =>
      queue.add({
        kind: 'transcribe',
        title: `Transkripsiyon (Track ${req.track + 1}, ${req.language})`,
        run: async (ctx) => {
          const a = assets.get(req.assetId)
          if (!a) throw new Error('Medya bulunamadı')
          for (let i = 1; i <= 5; i++) (ctx.progress(i / 5, `Parça ${i}/5`), await sleep(60))
          let t = demoTranscript(a.id, a.durationSec, req.language)
          const vr = applyVocabulary(t.words, parseVocabulary(settings.vocabulary))
          if (vr.corrections.length) t = withWords(t, vr.words)
          search.load(a.id, t)
          emit('transcript:ready', { assetId: a.id, transcript: t, reused: false })
        }
      }).id,
    'transcript:get': (id) => search.get(id) ?? null,
    'transcript:fix': (req) => {
      const t = search.get(req.assetId)
      if (!t) throw new Error('Transkript bulunamadı.')
      const r = fixWord(t, req.index, req.text, req.all)
      search.load(req.assetId, r.transcript)
      if (req.remember) {
        const terms = parseVocabulary(settings.vocabulary)
        if (!terms.some((x) => x.toLowerCase() === req.text.trim().toLowerCase())) settings = normalizeSettings({ ...settings, vocabulary: [...terms, req.text.trim()].join('\n') })
      }
      return r
    },
    'transcript:vocab': (id) => {
      const t = search.get(id)
      if (!t) throw new Error('Transkript bulunamadı.')
      const r = applyVocabulary(t.words, parseVocabulary(settings.vocabulary))
      const next = r.corrections.length ? withWords(t, r.words) : t
      search.load(id, next)
      return { transcript: next, corrections: r.corrections.length }
    },
    'search:run': (req) => search.search(req.assetId, req.query, { ...DEFAULT_SEARCH_OPTIONS, fuzzyThreshold: settings.fuzzyThreshold, fuzzy: settings.fuzzyEnabled, windowSec: settings.windowSec, ...req.options }),
    'chat:import': (req) => {
      const text = w.__mock?.nextChat === 'bad' ? 'bu hiç sohbet dosyasına benzemiyor' : SAMPLE_CSV
      const r = parseChatLog(text, w.__mock?.nextChat === 'bad' ? 'x.txt' : 'chat.csv', { ...settings.chatColumns, ...req.mapping })
      return { chat: { id: newId('chat'), assetId: req.assetId, sourceName: 'sohbet.csv', importedAt: new Date().toISOString(), offsetSec: 0, messages: r.messages }, warnings: r.warnings }
    },
    'suggest:start': (req) =>
      queue.add({
        kind: 'analyze',
        title: 'Otomatik öneri',
        run: async (ctx) => {
          const a = assets.get(req.assetId)
          if (!a) throw new Error('Medya bulunamadı')
          for (let i = 1; i <= 4; i++) (ctx.progress(i / 4), await sleep(40))
          const db = Array.from({ length: 120 }, (_, i) => (i >= 61 && i < 65 ? -12 : -32 + Math.sin(i)))
          const tr = search.get(a.id)
          const raw = scoreCandidates(a.id, { durationSec: a.durationSec, audioDb: db, chat: req.chat?.messages, words: tr?.words })
          emit('suggest:ready', { assetId: a.id, candidates: tr ? raw.map((c) => snapCandidate(tr.segments, c, a.durationSec)) : raw })
        }
      }).id,
    'export:start': (req) =>
      queue.add({
        kind: 'export',
        title: `Dışa aktarma: ${req.name}`,
        run: async (ctx) => {
          if (w.__mock?.fail?.export) throw new Error(w.__mock.fail.export)
          for (let i = 1; i <= 5; i++) (ctx.progress(i / 5), await sleep(80))
          emit('export:done', { taskId: ctx.id, outputPath: req.outputPath })
        }
      }).id,
    'export:dialogOutput': (name) => `/tmp/${name}`,
    'task:cancel': (id) => queue.cancel(id),
    'task:list': () => queue.list(),
    'model:download': () => queue.add({ kind: 'model-download', title: 'Model indiriliyor', run: async () => { await sleep(100) } }).id,
    'templates:list': () => userTemplates,
    'templates:save': (t) => (userTemplates = [...userTemplates.filter((x) => x.id !== t.id), { ...t, builtin: false }]),
    'templates:delete': (id) => (userTemplates = userTemplates.filter((x) => x.id !== id)),
    'shell:reveal': () => undefined,
    'dev:openDevTools': () => undefined
  }

  return {
    isMock: true,
    async invoke(channel, ...args) {
      const fn = handlers[channel] as (...a: unknown[]) => unknown
      try {
        return (await fn(...args)) as never
      } catch (e) {
        // Gerçek IPC gibi: hata anlaşılır kullanıcı mesajına çevrilerek iletilir
        throw new Error(userMessage(e))
      }
    },
    on(event, cb) {
      const set = listeners.get(event) ?? new Set()
      set.add(cb as never)
      listeners.set(event, set)
      return () => set.delete(cb as never)
    },
    pathForFile: (f) => `/demo/${f.name}`,
    mediaUrl: (asset, kind, idx = 0) => (kind === 'image' ? (asset.kind === 'image' ? '/demo/image.png' : null) : kind === 'video' ? '/demo/sample.mp4' : kind === 'audio' ? (asset.audioStreams[idx] ? `/demo/audio_${idx}.m4a` : null) : null)
  }
}
