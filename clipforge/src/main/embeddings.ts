import type { Settings } from '../shared/types'
import type { EmbeddingProvider } from '../shared/search/semantic'
import { ToolError } from './ffmpeg'

/** OpenAI uyumlu /embeddings uç noktası (OpenAI, Ollama, LM Studio, vLLM …). */
export function createEmbeddingProvider(s: Settings, fetchImpl: typeof fetch = fetch): EmbeddingProvider | null {
  if (!s.semanticSearch) return null
  const base = s.embeddingBaseUrl.replace(/\/$/, '')
  return {
    id: `${base}|${s.embeddingModel}`,
    async embed(texts, signal) {
      const res = await fetchImpl(`${base}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(s.embeddingApiKey ? { Authorization: `Bearer ${s.embeddingApiKey}` } : {}) },
        body: JSON.stringify({ model: s.embeddingModel, input: texts }),
        signal
      }).catch((e: Error) => {
        throw new ToolError(`Gömme (embedding) servisine ulaşılamadı: ${e.message}`)
      })
      if (res.status === 401) throw new ToolError('Gömme servisi API anahtarını reddetti (401).')
      if (!res.ok) throw new ToolError(`Gömme servisi hatası (${res.status}): ${(await res.text()).slice(0, 200)}`)
      const data = (await res.json()) as { data: { embedding: number[]; index: number }[] }
      return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
    }
  }
}
