/**
 * Uzun işler (Auto Kick, Auto Clips, kesitler, dışa aktarma) sürerken bilgisayarın UYKUYA GEÇMESİNİ engeller
 * (kullanıcı 8 saat evde olmayacak: Windows uykuya geçerse işler durur). İş bitince engel kalkar.
 */
export interface PowerBlocker {
  start(type: 'prevent-app-suspension'): number
  stop(id: number): void
  isStarted(id: number): boolean
}

export function createKeepAwake(blocker: PowerBlocker, isBusy: () => boolean, log: (msg: string) => void = () => undefined) {
  let id: number | null = null
  const tick = () => {
    const busy = isBusy()
    if (busy && (id === null || !blocker.isStarted(id))) {
      id = blocker.start('prevent-app-suspension')
      log('Uzun iş sürüyor: bilgisayarın uykuya geçmesi engellendi')
    } else if (!busy && id !== null) {
      if (blocker.isStarted(id)) blocker.stop(id)
      id = null
      log('İşler bitti: uyku engeli kaldırıldı')
    }
  }
  return { tick, active: () => id !== null }
}
