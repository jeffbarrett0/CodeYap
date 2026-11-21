import type { AutoKickRequest } from '../../shared/autokick'

/**
 * Gözetimsiz çalışma: Auto Kick geçici bir nedenle (disk anlık dolu, ffmpeg takılması…) HATA verirse kendiliğinden yeniden dener
 * (biten aşamalar atlanır, kaldığı yerden sürer). Kullanıcı İPTAL ettiyse denenmez. Her kayıt için en çok `max` kez.
 */
export function createAutoRetry(start: (req: AutoKickRequest) => string, log: (req: AutoKickRequest, msg: string) => void, opts: { delayMs?: number; max?: number } = {}) {
  const delay = opts.delayMs ?? 60_000
  const max = opts.max ?? 2
  const attempts = new Map<string, number>()
  let pending = 0
  return {
    /** Auto Kick durum olayında çağrılır */
    onStatus(s: { id: string; status: string; request: AutoKickRequest; error?: string }): void {
      if (s.status === 'done') return void attempts.delete(s.request.videoPath)
      if (s.status !== 'failed') return
      const n = (attempts.get(s.request.videoPath) ?? 0) + 1
      if (n > max) return void log(s.request, `Auto Kick ${max} kez yeniden denendi ve yine hata verdi; durduruldu (${s.error ?? ''})`)
      attempts.set(s.request.videoPath, n)
      log(s.request, `Auto Kick HATA verdi; ${Math.round(delay / 1000)} sn sonra kendiliğinden yeniden denenecek (${n}/${max}): ${s.error ?? ''}`)
      pending++
      setTimeout(() => {
        pending--
        start(s.request)
      }, delay)
    },
    pending: () => pending
  }
}
