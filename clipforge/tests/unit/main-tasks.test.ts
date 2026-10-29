import { describe, expect, it } from 'vitest'
import { TaskQueue, CancelledError } from '../../src/main/tasks'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('görev kuyruğu', () => {
  it('ilerleme raporlar ve tamamlanır', async () => {
    const q = new TaskQueue()
    const seen: number[] = []
    q.onUpdate((t) => seen.push(t.progress))
    const t = q.add({ kind: 'import', title: 'a', run: async (c) => { c.progress(0.5, 'yarı'); await sleep(150); c.progress(1) } })
    const done = await q.wait(t.id)
    expect(done.status).toBe('done')
    expect(Math.max(...seen)).toBe(1)
    expect(seen).toContain(0.5)
  })

  it('aynı türden ağır işler sırayla çalışır', async () => {
    const q = new TaskQueue()
    const order: string[] = []
    const mk = (n: string) => q.add({ kind: 'transcribe', title: n, run: async () => { order.push(`${n}+`); await sleep(40); order.push(`${n}-`) } })
    const a = mk('a')
    const b = mk('b')
    await q.wait(b.id)
    await q.wait(a.id)
    expect(order).toEqual(['a+', 'a-', 'b+', 'b-'])
  })

  it('çalışan görev iptal edilir (signal), kuyruktaki görev hiç başlamaz', async () => {
    const q = new TaskQueue()
    let startedB = false
    const a = q.add({
      kind: 'export',
      title: 'a',
      run: (c) => new Promise<void>((_, rej) => c.signal.addEventListener('abort', () => rej(new CancelledError())))
    })
    const b = q.add({ kind: 'export', title: 'b', run: async () => { startedB = true } })
    await sleep(20)
    q.cancel(b.id)
    q.cancel(a.id)
    expect((await q.wait(a.id)).status).toBe('cancelled')
    expect((await q.wait(b.id)).status).toBe('cancelled')
    expect(startedB).toBe(false)
  })

  it('hata kullanıcı mesajıyla failed olur, uygulama çökmez', async () => {
    const q = new TaskQueue()
    const t = q.add({ kind: 'proxy', title: 'x', run: async () => { throw Object.assign(new Error('teknik'), { userMessage: 'Anlaşılır mesaj' }) } })
    const r = await q.wait(t.id)
    expect(r.status).toBe('failed')
    expect(r.error).toBe('Anlaşılır mesaj')
  })
})
