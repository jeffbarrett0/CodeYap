import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createKeepAwake } from '../../src/main/keepawake'
import { createAutoRetry } from '../../src/main/autokick/retry'

describe('gözetimsiz çalışma (8 saat evde olmayacak)', () => {
  it('uyku engeli: iş sürerken başlar, tek kez; iş bitince kalkar; sistem engeli düşürürse yeniden alınır', () => {
    let busy = false
    const started = new Set<number>()
    let seq = 0
    const logs: string[] = []
    const blocker = { start: () => (started.add(++seq), seq), stop: (id: number) => void started.delete(id), isStarted: (id: number) => started.has(id) }
    const ka = createKeepAwake(blocker, () => busy, (m) => logs.push(m))
    ka.tick()
    expect(started.size).toBe(0)
    busy = true
    ka.tick()
    ka.tick() // ikinci kontrol yeni engel açmaz
    expect(started.size).toBe(1)
    expect(ka.active()).toBe(true)
    started.clear() // sistem engeli düşürdü
    ka.tick()
    expect(started.size).toBe(1)
    busy = false
    ka.tick()
    expect(started.size).toBe(0)
    expect(ka.active()).toBe(false)
    expect(logs.length).toBe(3)
  })

  describe('Auto Kick kendiliğinden yeniden dene', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())
    const req = { videoPath: '/v/yayin.mkv' }
    it('hata → 60 sn sonra yeniden başlatır (en çok 2 kez), sonra bırakır; başarıda sayaç sıfırlanır; iptal edileni denemez', () => {
      const starts: unknown[] = []
      const logs: string[] = []
      const r = createAutoRetry((q) => (starts.push(q), 'k'), (_q, m) => logs.push(m))
      r.onStatus({ id: 'a', status: 'cancelled', request: req })
      vi.advanceTimersByTime(120_000)
      expect(starts.length).toBe(0)
      r.onStatus({ id: 'a', status: 'failed', request: req, error: 'disk' })
      expect(r.pending()).toBe(1)
      vi.advanceTimersByTime(59_000)
      expect(starts.length).toBe(0)
      vi.advanceTimersByTime(2_000)
      expect(starts).toEqual([req])
      expect(r.pending()).toBe(0)
      r.onStatus({ id: 'b', status: 'failed', request: req, error: 'disk' })
      vi.advanceTimersByTime(61_000)
      expect(starts.length).toBe(2)
      r.onStatus({ id: 'c', status: 'failed', request: req, error: 'disk' }) // 3. hata: bırakır
      vi.advanceTimersByTime(300_000)
      expect(starts.length).toBe(2)
      expect(logs.at(-1)).toMatch(/durduruldu/)
      r.onStatus({ id: 'd', status: 'done', request: req }) // başarı sayacı sıfırlar
      r.onStatus({ id: 'e', status: 'failed', request: req })
      vi.advanceTimersByTime(61_000)
      expect(starts.length).toBe(3)
    })
  })
})
