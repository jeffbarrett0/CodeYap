import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { faceTrimFilter, faceTrimGeometry } from '../../src/shared/facetrim'
import { previewFaceTrim, runFaceTrim } from '../../src/main/facetrim'

const tmp = mkdtempSync(join(tmpdir(), 'cf-facetrim-'))
const ffm = require('ffmpeg-static') as string
const ffp = require('@ffprobe-installer/ffprobe').path as string
const tools = { ffmpeg: ffm, ffprobe: ffp } as never
const probe = (f: string) => JSON.parse(execFileSync(ffp, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', f]).toString())
const src = join(tmp, 'klip.mp4')

beforeAll(() => {
  // Auto Clips düzeninde 1080x1920: üst %41,5 KIRMIZI (yüz), ortada BEYAZ şerit, alt MAVİ (ekran)
  execFileSync(ffm, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=1080x1920:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=48000:duration=3', '-vf',
    "drawbox=x=0:y=0:w=1080:h=797:color=red:t=fill,drawbox=x=77:y=756:w=928:h=82:color=white:t=fill", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src])
}, 60_000)
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('SportDeoPlus: MP4\'ten yalnızca yüz', () => {
  it('geometri: şerit payı düşülür (1080x1920 %41,5 → 750); şerit yoksa 796/797; kare/yatay/dikey biçimleri', () => {
    const base = { faceShare: 0.415, stripCut: true }
    const a = faceTrimGeometry(1080, 1920, { ...base, shape: 'asis' })
    expect(a).toMatchObject({ cropW: 1080, cropH: 750, cropX: 0, cropY: 0, outW: 1080, outH: 750 })
    expect(faceTrimGeometry(1080, 1920, { faceShare: 0.415, stripCut: false, shape: 'asis' }).cropH).toBe(796)
    const sq = faceTrimGeometry(1080, 1920, { ...base, shape: 'square' })
    expect([sq.cropW, sq.cropH, sq.outW, sq.outH]).toEqual([750, 750, 750, 750])
    expect(sq.cropX).toBe(164)
    const h = faceTrimGeometry(1080, 1920, { ...base, shape: 'horizontal' })
    expect([h.outW, h.outH, h.cropW, h.cropH]).toEqual([1920, 1080, 1076, 606])
    expect(h.cropY + h.cropH).toBeLessThanOrEqual(h.faceH)
    const v = faceTrimGeometry(1080, 1920, { ...base, shape: 'vertical' })
    expect([v.outW, v.outH]).toEqual([1080, 1920])
    expect(v.cropW).toBeLessThan(1080)
    // başka boyut (720x1280): oranlar korunur
    expect(faceTrimGeometry(720, 1280, { ...base, shape: 'asis' }).cropH).toBe(faceTrimGeometry(720, 1280, { ...base, shape: 'asis' }).outH)
    expect(faceTrimFilter(a)).toBe('crop=1080:750:0:0,setsar=1')
    expect(faceTrimFilter(v)).toMatch(/scale=1080:1920/)
  })

  it('GERÇEK kesim: çıkan MP4 yalnızca kırmızı yüz alanı — beyaz şerit ve mavi ekran YOK; ses aynen; boyut 1080x750', async () => {
    const r = await runFaceTrim(src, { faceShare: 0.415, stripCut: true, shape: 'asis' }, tools)
    expect(existsSync(r.outputPath)).toBe(true)
    expect(r.outputPath).toMatch(/ - sadece yüz\.mp4$/)
    expect(statSync(r.outputPath).size).toBeGreaterThan(1000)
    const p = probe(r.outputPath)
    const v = p.streams.find((s: any) => s.codec_type === 'video')
    expect([v.width, v.height]).toEqual([1080, 750])
    expect(p.streams.some((s: any) => s.codec_type === 'audio')).toBe(true)
    expect(Number(p.format.duration)).toBeGreaterThan(2.8)
    // piksel kontrolü: her yerde KIRMIZI (şerit beyazı ve ekran mavisi yok)
    const px = (x: number, y: number) => execFileSync(ffm, ['-v', 'error', '-i', r.outputPath, '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'ignore'] })
    for (const [x, y] of [[10, 10], [540, 400], [540, 745], [1070, 745], [100, 748]]) {
      const b = px(x, y)
      expect(b[0], `(${x},${y}) kırmızı`).toBeGreaterThan(200)
      expect(b[1]).toBeLessThan(60)
      expect(b[2]).toBeLessThan(60)
    }
    // 2. kayıt aynı yere: üzerine yazılmaz, (2) eklenir
    const r2 = await runFaceTrim(src, { faceShare: 0.415, stripCut: true, shape: 'asis' }, tools)
    expect(r2.outputPath).not.toBe(r.outputPath)
    expect(r2.outputPath).toMatch(/\(2\)\.mp4$/)
  }, 120_000)

  it('şerit kesilmezse beyaz şerit kenarı görünür (stripCut kapalı: 796 px)', async () => {
    const r = await runFaceTrim(src, { faceShare: 0.415, stripCut: false, shape: 'asis' }, tools)
    const v = probe(r.outputPath).streams.find((s: any) => s.codec_type === 'video')
    expect([v.width, v.height]).toEqual([1080, 796])
    const b = execFileSync(ffm, ['-v', 'error', '-i', r.outputPath, '-vf', 'format=rgb24,crop=1:1:540:790', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'ignore'] })
    expect(b[1]).toBeGreaterThan(200) // beyaz (şerit) görünür
  }, 120_000)

  it('önizleme: iki JPEG (data URL), geometri ve süre; olmayan dosya/yanlış tür anlaşılır hata', async () => {
    const p = await previewFaceTrim(src, { faceShare: 0.415, stripCut: true, shape: 'asis' }, tools)
    expect(p.original).toMatch(/^data:image\/jpeg;base64,/)
    expect(p.result).toMatch(/^data:image\/jpeg;base64,/)
    expect(p.geometry.outH).toBe(750)
    expect(p.probe.hasAudio).toBe(true)
    await expect(previewFaceTrim(join(tmp, 'yok.mp4'), {}, tools)).rejects.toThrow(/bulunamadı/)
    await expect(previewFaceTrim(join(tmp, 'x.txt'), {}, tools)).rejects.toThrow(/Desteklenen/)
  })
})
