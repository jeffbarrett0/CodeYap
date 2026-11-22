import { join } from 'node:path'
import { Session, makeService } from '../../cli/session'
import { chapterRangesToList } from '../../shared/chapters'
import { transcriptLines } from '../../shared/clipsearch'
import { timelineWords } from '../../shared/timeline/transcript'
import type { YtCutRequest } from '../../shared/ytcut'

type Env = { userDataDir?: string; resourcesDir?: string }

/**
 * AUTO YATAY VİDEO (Auto Kick'e bağlı): Auto Kick bitince, kullanıcı hazır zaman damgası listesi verdiyse, kesimli tam video
 * `YouTube yatay video` kesicisine otomatik gider: her satır ayrı yatay MP4 (+ abone butonu, +konuşma metni .txt).
 * Liste verilmediyse hiçbir şey yapılmaz. Her iş yalnızca BİR kez. Başlatılan görevin kimliğini döndürür.
 */
export async function chainAutoHorizontal(
  s: { id: string; status: string; request?: { manual?: boolean }; result?: { outDir: string; projectPath: string; fullVideoPath: string; chapterRanges?: { start: number; end: number; title: string }[] } },
  handled: Set<string>,
  settings: { autoHorizontalAfterKick: boolean; autoHorizontalCta: boolean },
  ytStart: (req: YtCutRequest) => string,
  log: (msg: string) => void,
  env: Env = {}
): Promise<string | null> {
  if (s.status !== 'done' || !s.result || handled.has(s.id)) return null
  handled.add(s.id)
  if (s.request?.manual) return null
  if (!settings.autoHorizontalAfterKick) return (log('Auto yatay video: BAŞLATILMADI (ayar kapalı)'), null)
  const ranges = s.result.chapterRanges
  if (!ranges?.length) return (log('Auto yatay video: zaman damgası listesi verilmediği için yatay kesit yapılmadı'), null)
  let lines: { start: number; end: number; text: string }[] | undefined
  try {
    const sess = await Session.open(s.result.projectPath, await makeService(env))
    lines = transcriptLines(timelineWords(sess.timeline, sess.transcripts))
  } catch (e) {
    log(`Auto yatay video: konuşma metni okunamadı (${e instanceof Error ? e.message : String(e)}); kesitler metinsiz üretilecek`)
  }
  const id = ytStart({ videoPath: s.result.fullVideoPath, list: chapterRangesToList(ranges), ranges, outDir: join(s.result.outDir, 'Yatay'), cta: settings.autoHorizontalCta, noAdjust: true, auto: true, ...(lines?.length ? { transcriptLines: lines } : {}) })
  log(`Auto yatay video: BAŞLATILDI · ${ranges.length} kesit`)
  return id
}
