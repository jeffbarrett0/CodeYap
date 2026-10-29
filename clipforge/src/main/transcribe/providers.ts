import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Settings, TranscriptWord, WhisperModelSize } from '../../shared/types'
import { runTool, ToolError } from '../ffmpeg'
import { CancelledError } from '../tasks'

export interface ChunkRequest {
  wavPath: string
  /** Parça başlangıcı: sağlayıcının döndürdüğü zamanlara eklenir (mutlak zaman üretmek için) */
  offsetSec: number
  language: string
  model: WhisperModelSize
  signal?: AbortSignal
  /** Geçici çıktılar için klasör */
  workDir: string
  /** Başlangıç ipucu (özel sözlük + dolgu örneği): isim/terim doğruluğunu artırır */
  prompt?: string
}

export interface TranscriptionProvider {
  readonly kind: Settings['provider']
  /** Kelime düzeyinde, MUTLAK zaman damgalı kelimeler */
  transcribeChunk(req: ChunkRequest): Promise<TranscriptWord[]>
}

// ───────────────────────── whisper.cpp ─────────────────────────

interface WhisperCppJson {
  transcription?: { offsets?: { from: number; to: number }; text?: string; tokens?: { text?: string; p?: number }[] }[]
}

const SPECIAL = /^\s*(\[[A-Z_ ]*[\]]?|<\|[^|]*\|>|\([^)]*\))\s*$/ // [_BEG_], [MUSIC], (müzik) vb.

/** `whisper-cli -oj -ml 1 -sow` çıktısını kelime listesine çevirir (noktalama bir önceki kelimeye eklenir). */
export function parseWhisperCppJson(json: WhisperCppJson, offsetSec: number): TranscriptWord[] {
  const words: TranscriptWord[] = []
  for (const seg of json.transcription ?? []) {
    const text = seg.text ?? ''
    if (!text.trim() || SPECIAL.test(text) || !seg.offsets) continue
    const start = seg.offsets.from / 1000 + offsetSec
    const end = Math.max(start, seg.offsets.to / 1000 + offsetSec)
    const clean = text.trim()
    // Kelime güveni: özel olmayan belirteçlerin olasılık ortalaması (-ojf çıktısında bulunur)
    const ps = (seg.tokens ?? []).filter((t) => typeof t.p === 'number' && !/^\[_|^<\|/.test(t.text ?? '')).map((t) => t.p as number)
    const conf = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : undefined
    const startsNewWord = /^\s/.test(text) || words.length === 0
    const punctOnly = /^[\p{P}\p{S}]+$/u.test(clean)
    if ((!startsNewWord || punctOnly) && words.length > 0) {
      const last = words[words.length - 1]
      last.text += clean
      last.end = Math.max(last.end, end)
      if (conf !== undefined && last.confidence !== undefined) last.confidence = Math.min(last.confidence, conf)
    } else {
      words.push({ text: clean, start, end, ...(conf !== undefined ? { confidence: conf } : {}) })
    }
  }
  return words
}

export function whisperModelFile(dir: string, size: WhisperModelSize): string {
  return join(dir, `ggml-${size}.bin`)
}

export class WhisperCppProvider implements TranscriptionProvider {
  readonly kind = 'whisper-cpp' as const
  constructor(
    private readonly binary: string,
    private readonly modelDir: string,
    private readonly threads = Math.max(1, Math.min(8, (globalThis.navigator?.hardwareConcurrency ?? 4) - 1))
  ) {}

  async transcribeChunk(req: ChunkRequest): Promise<TranscriptWord[]> {
    const model = whisperModelFile(this.modelDir, req.model)
    const prefix = join(req.workDir, `wcpp_${Math.round(req.offsetSec)}`)
    const args = ['-m', model, '-f', req.wavPath, '-l', req.language, '-ojf', '-of', prefix, '-ml', '1', '-sow', '-t', String(this.threads), '-np']
    if (req.prompt) args.push('--prompt', req.prompt)
    try {
      await runTool(this.binary, args, { signal: req.signal }, (stderr) => {
        if (/failed to open|no such file|could not open|error: failed to load/i.test(stderr) && /ggml|model/i.test(stderr)) {
          return `Whisper modeli yüklenemedi: ${model}. Ayarlar → Transkripsiyon bölümünden modeli indirin.`
        }
        return `whisper.cpp hatası: ${stderr.trim().split(/\r?\n/).slice(-2).join(' · ').slice(0, 300)}`
      })
    } catch (e) {
      if (e instanceof ToolError && /bulunamadı/.test(e.userMessage)) {
        throw new ToolError('whisper.cpp bulunamadı. Ayarlar → Transkripsiyon bölümünden "whisper-cli" yolunu belirtin (README: Kurulum).', e.detail)
      }
      throw e
    }
    const out = `${prefix}.json`
    const json = JSON.parse(await readFile(out, 'utf8')) as WhisperCppJson
    await rm(out, { force: true })
    return parseWhisperCppJson(json, req.offsetSec)
  }
}

// ───────────────────────── faster-whisper (Python) ─────────────────────────

export class FasterWhisperProvider implements TranscriptionProvider {
  readonly kind = 'faster-whisper' as const
  constructor(
    private readonly python: string,
    private readonly scriptPath: string
  ) {}

  async transcribeChunk(req: ChunkRequest): Promise<TranscriptWord[]> {
    const { stdout } = await runTool(this.python, [this.scriptPath, req.wavPath, req.model, req.language], { signal: req.signal, collectStdout: true }, (stderr) =>
      /No module named 'faster_whisper'/.test(stderr)
        ? 'faster-whisper kurulu değil. Terminalde: pip install faster-whisper'
        : `faster-whisper hatası: ${stderr.trim().split(/\r?\n/).slice(-2).join(' · ').slice(0, 300)}`
    )
    const data = JSON.parse(stdout) as { words: { text: string; start: number; end: number; confidence?: number }[] }
    return data.words.map((w) => ({ text: w.text, start: w.start + req.offsetSec, end: w.end + req.offsetSec, confidence: w.confidence }))
  }
}

// ───────────────────────── OpenAI Whisper API ─────────────────────────

export class OpenAIProvider implements TranscriptionProvider {
  readonly kind = 'openai-api' as const
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async transcribeChunk(req: ChunkRequest): Promise<TranscriptWord[]> {
    if (!this.apiKey) throw new ToolError('OpenAI API anahtarı girilmemiş (Ayarlar → Transkripsiyon).')
    const bytes = await readFile(req.wavPath)
    if (bytes.length > 25 * 1024 * 1024) throw new ToolError('Ses parçası OpenAI API sınırını (25 MB) aşıyor.')
    let lastErr = ''
    for (let attempt = 0; attempt < 4; attempt++) {
      if (req.signal?.aborted) throw new CancelledError()
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }), 'chunk.wav')
      form.append('model', 'whisper-1')
      form.append('response_format', 'verbose_json')
      form.append('timestamp_granularities[]', 'word')
      if (req.language && req.language !== 'auto') form.append('language', req.language)
      if (req.prompt) form.append('prompt', req.prompt)
      const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: req.signal
      }).catch((e: Error) => {
        if (req.signal?.aborted) throw new CancelledError()
        throw new ToolError(`OpenAI API'ye ulaşılamadı: ${e.message}`)
      })
      if (res.ok) {
        const data = (await res.json()) as { words?: { word: string; start: number; end: number }[] }
        return (data.words ?? []).map((w) => ({ text: w.word.trim(), start: w.start + req.offsetSec, end: w.end + req.offsetSec }))
      }
      lastErr = (await res.text()).slice(0, 300)
      if (res.status === 401) throw new ToolError('OpenAI API anahtarı geçersiz (401).')
      if (res.status === 413) throw new ToolError('Ses parçası API için çok büyük (413).')
      if (res.status !== 429 && res.status < 500) throw new ToolError(`OpenAI API hatası (${res.status}): ${lastErr}`)
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
    }
    throw new ToolError(`OpenAI API yanıt vermedi/aşırı yüklü: ${lastErr}`)
  }
}

// ───────────────────────── test / demo ─────────────────────────

/** Gerçek model olmadan hattı sınamak için: bilinen kelime akışından parçanın penceresini döndürür. */
export class MockProvider implements TranscriptionProvider {
  readonly kind = 'mock' as const
  calls = 0
  constructor(
    private readonly truth: TranscriptWord[],
    private readonly chunkSec: number
  ) {}

  async transcribeChunk(req: ChunkRequest): Promise<TranscriptWord[]> {
    this.calls++
    const lo = req.offsetSec
    const hi = req.offsetSec + this.chunkSec
    // gerçek modeller gibi: pencere kenarına denk gelen kelimeler kesilir
    return this.truth.filter((w) => w.start >= lo + 0.4 && w.end <= hi - 0.4).map((w) => ({ ...w }))
  }
}

export function createProvider(s: Settings, modelDir: string, scriptPath: string, whisperBin: string): TranscriptionProvider {
  switch (s.provider) {
    case 'openai-api':
      return new OpenAIProvider(s.openaiApiKey, s.openaiBaseUrl)
    case 'faster-whisper':
      return new FasterWhisperProvider(s.fasterWhisperPython || 'python3', scriptPath)
    case 'whisper-cpp':
    default:
      return new WhisperCppProvider(whisperBin, modelDir)
  }
}
