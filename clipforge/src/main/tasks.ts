import type { TaskInfo, TaskKind } from '../shared/types'

export class CancelledError extends Error {
  constructor() {
    super('İşlem iptal edildi.')
    this.name = 'CancelledError'
  }
}

export interface TaskContext {
  id: string
  signal: AbortSignal
  /** 0..1 */
  progress(fraction: number, message?: string): void
}

export interface TaskSpec {
  kind: TaskKind
  title: string
  run(ctx: TaskContext): Promise<void>
}

type Listener = (t: TaskInfo) => void

/** Aynı türden eşzamanlı iş sayısı (ağır işler sırayla çalışır) */
const DEFAULT_LIMITS: Record<TaskKind, number> = { import: 2, proxy: 1, transcribe: 1, analyze: 1, export: 1, 'model-download': 1 }

/**
 * İptal edilebilir, ilerlemesi raporlanan görev kuyruğu.
 * Görevler `AbortSignal` ile iptal edilir; çalışan alt süreçler (ffmpeg, whisper) signal'i dinleyip sonlanır.
 */
export class TaskQueue {
  private readonly tasks = new Map<string, { info: TaskInfo; spec: TaskSpec; ctrl: AbortController }>()
  private readonly order: string[] = []
  private readonly listeners = new Set<Listener>()
  private seq = 0
  /** done/failed/cancelled görev sayısı bunu aşarsa en eskiler listeden atılır */
  private readonly keepFinished = 50

  constructor(private readonly limits: Record<TaskKind, number> = DEFAULT_LIMITS) {}

  onUpdate(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  list(): TaskInfo[] {
    return this.order.map((id) => ({ ...(this.tasks.get(id) as { info: TaskInfo }).info }))
  }

  get(id: string): TaskInfo | undefined {
    const t = this.tasks.get(id)
    return t ? { ...t.info } : undefined
  }

  add(spec: TaskSpec): TaskInfo {
    const id = `task-${++this.seq}`
    const info: TaskInfo = { id, kind: spec.kind, title: spec.title, status: 'queued', progress: 0, createdAt: Date.now() }
    this.tasks.set(id, { info, spec, ctrl: new AbortController() })
    this.order.push(id)
    this.emit(info)
    queueMicrotask(() => this.pump())
    return { ...info }
  }

  cancel(id: string): void {
    const t = this.tasks.get(id)
    if (!t) return
    if (t.info.status === 'queued') {
      this.finish(t.info, 'cancelled')
    } else if (t.info.status === 'running') {
      t.ctrl.abort()
    }
  }

  /** Bir görev bitene kadar bekler (test ve ardışık işler için) */
  async wait(id: string): Promise<TaskInfo> {
    const cur = this.get(id)
    if (cur && ['done', 'failed', 'cancelled'].includes(cur.status)) return cur
    return new Promise((resolve) => {
      const off = this.onUpdate((t) => {
        if (t.id === id && ['done', 'failed', 'cancelled'].includes(t.status)) {
          off()
          resolve(t)
        }
      })
    })
  }

  private emit(info: TaskInfo) {
    for (const l of this.listeners) l({ ...info })
  }

  private finish(info: TaskInfo, status: 'done' | 'failed' | 'cancelled', error?: string) {
    info.status = status
    info.finishedAt = Date.now()
    if (status === 'done') info.progress = 1
    if (error) info.error = error
    this.emit(info)
    const finished = this.order.filter((id) => ['done', 'failed', 'cancelled'].includes(this.tasks.get(id)!.info.status))
    while (finished.length > this.keepFinished) {
      const old = finished.shift() as string
      this.tasks.delete(old)
      this.order.splice(this.order.indexOf(old), 1)
    }
    queueMicrotask(() => this.pump())
  }

  private pump() {
    for (const id of this.order) {
      const t = this.tasks.get(id)
      if (!t || t.info.status !== 'queued') continue
      const running = [...this.tasks.values()].filter((x) => x.info.kind === t.info.kind && x.info.status === 'running').length
      if (running >= (this.limits[t.info.kind] ?? 1)) continue
      void this.start(t)
    }
  }

  private async start(t: { info: TaskInfo; spec: TaskSpec; ctrl: AbortController }) {
    t.info.status = 'running'
    this.emit(t.info)
    let last = 0
    const ctx: TaskContext = {
      id: t.info.id,
      signal: t.ctrl.signal,
      progress: (fraction, message) => {
        t.info.progress = Math.min(1, Math.max(0, fraction))
        if (message !== undefined) t.info.message = message
        const now = Date.now()
        if (now - last > 100 || t.info.progress >= 1) {
          last = now
          this.emit(t.info)
        }
      }
    }
    try {
      await t.spec.run(ctx)
      if (t.ctrl.signal.aborted) this.finish(t.info, 'cancelled')
      else this.finish(t.info, 'done')
    } catch (e) {
      if (t.ctrl.signal.aborted || e instanceof CancelledError) this.finish(t.info, 'cancelled')
      else this.finish(t.info, 'failed', userMessage(e))
    }
  }
}

/** Kullanıcıya gösterilecek hata metni: anlaşılır mesaj varsa onu, yoksa genel mesajı verir. */
export function userMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'userMessage' in e && typeof (e as { userMessage: unknown }).userMessage === 'string') {
    return (e as { userMessage: string }).userMessage
  }
  return e instanceof Error ? e.message : String(e)
}
