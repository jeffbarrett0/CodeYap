import { runTool } from '../ffmpeg'

/**
 * DONANIM KODLAYICI (ekran kartı): tam video kodlaması yazılım kodlayıcıdan (libx264) kat kat hızlıdır. Kullanıcı: "Auto Kick 2–2,5 saat sürüyor, kısaltabilir miyiz?"
 * Algılama: ffmpeg derlemesi kodlayıcıyı içeriyor mu + GERÇEKTEN çalışıyor mu (1 sn'lik deneme kodlaması). Biri çalışırsa kullanılır; kodlama sırasında
 * hata olursa çağıran taraf yazılım kodlayıcıya döner. Sonuç süreç boyunca önbelleklenir.
 */
export type HwEncoder = 'nvenc' | 'qsv' | 'amf'

const CODEC: Record<HwEncoder, string> = { nvenc: 'h264_nvenc', qsv: 'h264_qsv', amf: 'h264_amf' }
export const HW_LABEL: Record<HwEncoder, string> = { nvenc: 'NVIDIA NVENC', qsv: 'Intel Quick Sync', amf: 'AMD AMF' }

let cached: Promise<HwEncoder | null> | undefined

/** SAF-ish: kodlayıcı listesi çıktısında hangi donanım kodlayıcılar var (sıra: NVENC, QSV, AMF) */
export function hwCandidates(encodersOutput: string): HwEncoder[] {
  return (Object.keys(CODEC) as HwEncoder[]).filter((k) => new RegExp(`\\b${CODEC[k]}\\b`).test(encodersOutput))
}

export function detectHwEncoder(ffmpeg: string, run: typeof runTool = runTool): Promise<HwEncoder | null> {
  cached ??= (async () => {
    try {
      const list = await run(ffmpeg, ['-hide_banner', '-encoders'], { collectStdout: true })
      for (const k of hwCandidates(list.stdout)) {
        try {
          // gerçek deneme: bu bilgisayarda çalışıyor mu (sürücü/kart yoksa hata verir)
          await run(ffmpeg, ['-hide_banner', '-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=1', '-c:v', CODEC[k], '-pix_fmt', 'yuv420p', '-f', 'null', '-'])
          return k
        } catch {
          /* bu kodlayıcı çalışmıyor: sıradakini dene */
        }
      }
    } catch {
      /* ffmpeg listesi alınamadı */
    }
    return null
  })()
  return cached
}

/** Testler için önbelleği sıfırlar */
export const resetHwEncoderCache = () => void (cached = undefined)

/**
 * Kodlayıcı argümanları. `crf` (kalite) donanım kodlayıcılarda karşılık gelen sabit-kalite değerine çevrilir; üst bit hızı sınırı aynı kalır.
 * Çıktı her durumda 8 bit yuv420p H.264 High (YouTube ile tam uyumlu).
 */
export function videoEncoderArgs(o: { crf: number; encoderPreset: string; maxrateKbps: number }, hw?: HwEncoder | null): string[] {
  const cap = Math.max(1000, o.maxrateKbps)
  const common = ['-profile:v', 'high', '-pix_fmt', 'yuv420p']
  if (hw === 'nvenc') return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', String(o.crf + 1), '-b:v', '0', '-maxrate', `${cap}k`, '-bufsize', `${cap * 2}k`, '-spatial-aq', '1', ...common]
  if (hw === 'qsv') return ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', String(o.crf + 1), '-maxrate', `${cap}k`, '-bufsize', `${cap * 2}k`, ...common]
  if (hw === 'amf') return ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', String(o.crf + 1), '-qp_p', String(o.crf + 2), '-maxrate', `${cap}k`, '-bufsize', `${cap * 2}k`, ...common]
  return ['-c:v', 'libx264', '-preset', o.encoderPreset, ...common.slice(0, 2), '-pix_fmt', 'yuv420p', '-crf', String(o.crf), '-maxrate', `${cap}k`, '-bufsize', `${cap * 2}k`]
}
