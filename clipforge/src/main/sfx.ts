import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { runTool } from './ffmpeg'

/** Kendi ürettiğimiz (telifsiz) kısa ses efektleri: ffmpeg lavfi kaynağı + filtre */
export const SFX: Record<string, { src: string; af: string }> = {
  whoosh: { src: 'anoisesrc=d=0.8:c=pink:r=48000:a=0.7', af: 'highpass=f=250,lowpass=f=5500,afade=t=in:d=0.35:curve=qsin,afade=t=out:st=0.35:d=0.45:curve=qsin,volume=3' },
  swish: { src: 'anoisesrc=d=0.4:c=white:r=48000:a=0.5', af: 'highpass=f=1200,lowpass=f=9000,afade=t=in:d=0.12,afade=t=out:st=0.12:d=0.28,volume=2' },
  pop: { src: 'aevalsrc=0.8*sin(2*PI*(900*t-2200*t*t)):d=0.16:s=48000', af: 'afade=t=out:st=0.02:d=0.14' },
  ding: { src: 'aevalsrc=0.5*sin(2*PI*1318*t)+0.25*sin(2*PI*2637*t):d=1.3:s=48000', af: 'afade=t=in:d=0.005,afade=t=out:st=0:d=1.3:curve=exp' },
  boom: { src: 'aevalsrc=0.9*sin(2*PI*(95*t-110*t*t))*exp(-3*t):d=1:s=48000', af: 'lowpass=f=300,afade=t=in:d=0.004,afade=t=out:st=0.5:d=0.5' },
  shutter: { src: 'anoisesrc=d=0.18:c=white:r=48000:a=0.8', af: 'highpass=f=2000,afade=t=in:d=0.002,afade=t=out:st=0.03:d=0.15,volume=1.6' },
  click: { src: 'aevalsrc=0.8*sin(2*PI*2200*t)*exp(-90*t):d=0.08:s=48000', af: 'afade=t=out:st=0.04:d=0.04' },
  notify: { src: 'aevalsrc=0.45*sin(2*PI*880*t)*(t<0.12)+0.45*sin(2*PI*1320*t)*(t>=0.12)*exp(-6*(t-0.12)):d=0.6:s=48000', af: 'afade=t=out:st=0.35:d=0.25' },
  riser: { src: 'aevalsrc=0.35*sin(2*PI*(180*t+170*t*t)):d=2:s=48000', af: 'afade=t=in:d=1.6,afade=t=out:st=1.85:d=0.15' }
}


/** Efekti ffmpeg ile üretir (`<dir>/<tür>.wav`, 48 kHz stereo) ve yolunu döndürür */
export async function renderSfx(ffmpeg: string, type: string, dir: string): Promise<string> {
  const rec = SFX[type]
  if (!rec) throw new Error(`Bilinmeyen efekt: ${type}`)
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${type}.wav`)
  await runTool(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', rec.src, '-af', `${rec.af},aformat=sample_rates=48000:channel_layouts=stereo`, file])
  return file
}
