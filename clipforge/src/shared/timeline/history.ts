/**
 * Komut deseni ile geri al / yinele.
 * Zaman çizelgesi değişmez (immutable) olduğundan her komut, uygulandığı andaki durumu "anı" olarak saklar
 * ve undo() bunu geri döner. Böylece komutlar yalnızca ileri yönde tanımlanır, tutarsızlık riski olmaz.
 */
export interface Command<S> {
  readonly label: string
  /** Aynı anahtarlı ardışık komutlar tek geri alma adımında birleşir (sürükleme gibi) */
  readonly coalesceKey?: string
  do(state: S): S
  undo(state: S): S
}

export function makeCommand<S>(label: string, forward: (s: S) => S, coalesceKey?: string): Command<S> {
  let before: S | undefined
  let captured = false
  return {
    label,
    coalesceKey,
    do(state) {
      if (!captured) {
        before = state
        captured = true
      }
      return forward(state)
    },
    undo(state) {
      return captured ? (before as S) : state
    }
  }
}

export interface HistoryState<S> {
  present: S
  past: Command<S>[]
  future: Command<S>[]
}

export class History<S> {
  private past: Command<S>[] = []
  private future: Command<S>[] = []
  private lastKey?: string
  private lastAt = 0

  constructor(public present: S, private readonly limit = 200, private readonly now: () => number = Date.now) {}

  get canUndo() {
    return this.past.length > 0
  }
  get canRedo() {
    return this.future.length > 0
  }
  get undoLabel() {
    return this.past.at(-1)?.label
  }
  get redoLabel() {
    return this.future.at(-1)?.label
  }

  execute(cmd: Command<S>): S {
    const next = cmd.do(this.present)
    if (next === this.present) return this.present // etkisiz komut geçmişe yazılmaz
    const t = this.now()
    const merge = cmd.coalesceKey && this.lastKey === cmd.coalesceKey && t - this.lastAt < 1000 && this.past.length > 0
    if (merge) {
      // önceki komutun anısı korunur; yeni komut yalnızca ileri durumu günceller
      const prev = this.past[this.past.length - 1]
      const merged: Command<S> = {
        label: prev.label,
        coalesceKey: prev.coalesceKey,
        do: (s) => cmd.do(prev.do(s)),
        undo: (s) => prev.undo(s)
      }
      // prev.do zaten uygulandı; birleşik komut yeniden uygulanırsa (redo) iki adım çalışır
      this.past[this.past.length - 1] = merged
    } else {
      this.past.push(cmd)
      if (this.past.length > this.limit) this.past.shift()
    }
    this.lastKey = cmd.coalesceKey
    this.lastAt = t
    this.future = []
    this.present = next
    return next
  }

  undo(): S {
    const cmd = this.past.pop()
    if (!cmd) return this.present
    this.present = cmd.undo(this.present)
    this.future.push(cmd)
    this.lastKey = undefined
    return this.present
  }

  redo(): S {
    const cmd = this.future.pop()
    if (!cmd) return this.present
    this.present = cmd.do(this.present)
    this.past.push(cmd)
    this.lastKey = undefined
    return this.present
  }

  clear(present: S) {
    this.present = present
    this.past = []
    this.future = []
    this.lastKey = undefined
  }
}
