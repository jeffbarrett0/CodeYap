import type { SearchOptions, SearchResult, Transcript } from '../types'
import { DEFAULT_SEARCH_OPTIONS, searchTranscript, TranscriptIndex } from './engine'
import { buildSemanticWindows, rankWindows, type EmbeddingProvider, type SemanticWindow } from './semantic'

interface Entry {
  transcript: Transcript
  index: TranscriptIndex
  windows?: SemanticWindow[]
  vectors?: number[][]
  vectorsFor?: string
}

/** Transkript indekslerini bellekte tutar; sözcük + (isteğe bağlı) anlamsal aramayı birleştirir. */
export class SearchService {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly embedder: () => EmbeddingProvider | null = () => null) {}

  load(assetId: string, transcript: Transcript): void {
    this.entries.set(assetId, { transcript, index: new TranscriptIndex(transcript.words, transcript.segments) })
  }

  has(assetId: string): boolean {
    return this.entries.has(assetId)
  }

  clear(): void {
    this.entries.clear()
  }

  unload(assetId: string): void {
    this.entries.delete(assetId)
  }

  get(assetId: string): Transcript | undefined {
    return this.entries.get(assetId)?.transcript
  }

  lexical(assetId: string, query: string, options: Partial<SearchOptions> = {}): SearchResult[] {
    const e = this.entries.get(assetId)
    if (!e) throw new Error('Bu medya için transkript yok. Önce transkripsiyon başlatın.')
    return searchTranscript(e.index, query, { ...DEFAULT_SEARCH_OPTIONS, ...options })
  }

  async semantic(assetId: string, query: string, context = 2, signal?: AbortSignal): Promise<SearchResult[]> {
    const e = this.entries.get(assetId)
    const provider = this.embedder()
    if (!e) throw new Error('Bu medya için transkript yok.')
    if (!provider) throw new Error('Anlamsal arama için bir gömme (embedding) sağlayıcısı yapılandırılmamış (Ayarlar → Anlamsal arama).')
    if (!e.vectors || e.vectorsFor !== provider.id) {
      e.windows = buildSemanticWindows(e.transcript.segments)
      e.vectors = []
      for (let i = 0; i < e.windows.length; i += 64) {
        e.vectors.push(...(await provider.embed(e.windows.slice(i, i + 64).map((w) => w.text), signal)))
      }
      e.vectorsFor = provider.id
    }
    const [qv] = await provider.embed([query], signal)
    return rankWindows(qv, e.windows as SemanticWindow[], e.vectors, e.transcript.segments, context)
  }

  /** Sözcük sonuçları + yakınında sözcük sonucu olmayan anlamsal sonuçlar, zamana göre sıralı. */
  async search(assetId: string, query: string, options: Partial<SearchOptions> = {}, withSemantic = false): Promise<SearchResult[]> {
    const lex = this.lexical(assetId, query, options)
    if (!withSemantic) return lex
    const sem = await this.semantic(assetId, query, options.contextSentences ?? 2)
    const extra = sem.filter((s) => !lex.some((l) => l.start < s.end && s.start < l.end + 10))
    return [...lex, ...extra].sort((a, b) => a.start - b.start)
  }
}
