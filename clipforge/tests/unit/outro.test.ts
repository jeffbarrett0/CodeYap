import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendOutro, outroFolder, resolveOutro } from '../../src/main/outro'

const tmp = mkdtempSync(join(tmpdir(), 'cf-outro-'))
const ffm = require('ffmpeg-static') as string
const ffp = require('@ffprobe-installer/ffprobe').path as string
const tools = { ffmpeg: ffm, ffprobe: ffp } as never
const probe = (f: string) => JSON.parse(execFileSync(ffp, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,sample_rate,channels:format=duration', '-of', 'json', f]).toString())
const decodes = (f: string) => execFileSync(ffm, ['-v', 'error', '-i', f, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const mk = (name: string, args: string[]) => execFileSync(ffm, ['-y', '-v', 'error', ...args, join(tmp, name)])

beforeAll(() => {
  mkdirSync(tmp, { recursive: true })
  // ana video: 640x360@30, 48k stereo ses (yt-cut'un ürettiğine benzer)
  mk('main.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=4', '-ac', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'])
  // outro: FARKLI ölçü (1280x720), farklı kare hızı (25), mono 44,1k ses
  mk('outro-ses.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=44100:duration=2', '-ac', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'])
  // outro: kare dışı oran (dikey 9:16) ve SESSİZ
  mk('outro-sessiz.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'])
}, 60_000)
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('YouTube outro (kapanış videosu) ekleme', () => {
  it('farklı ölçü/kare hızı/ses: ana videonun ölçüsüne uyar, süre = ana + outro, hatasız çözülür, ses sürer', async () => {
    const f = join(tmp, 'a.mp4')
    execFileSync(ffm, ['-y', '-v', 'error', '-i', join(tmp, 'main.mp4'), '-c', 'copy', f])
    const r = await appendOutro(f, join(tmp, 'outro-ses.mp4'), tools)
    expect(r.ok, r.error).toBe(true)
    expect(r.outroSec).toBeGreaterThan(1.8)
    const p = probe(f)
    const v = p.streams.find((s: any) => s.codec_type === 'video')
    const a = p.streams.find((s: any) => s.codec_type === 'audio')
    expect([v.width, v.height]).toEqual([640, 360])
    expect(a.sample_rate).toBe('48000')
    expect(a.channels).toBe(2)
    expect(Number(p.format.duration)).toBeGreaterThan(5.7)
    expect(Number(p.format.duration)).toBeLessThan(6.4)
    expect(decodes(f).trim()).toBe('') // hatasız çözülür
  })
  it('sessiz ve dikey outro: sessizlik eklenir (ses akışı kesintisiz), görüntü ortalanır; ana video outro süresi kadar uzar', async () => {
    const f = join(tmp, 'b.mp4')
    execFileSync(ffm, ['-y', '-v', 'error', '-i', join(tmp, 'main.mp4'), '-c', 'copy', f])
    const r = await appendOutro(f, join(tmp, 'outro-sessiz.mp4'), tools)
    expect(r.ok, r.error).toBe(true)
    const p = probe(f)
    expect(p.streams.some((s: any) => s.codec_type === 'audio')).toBe(true)
    expect(Number(p.format.duration)).toBeGreaterThan(5.7)
    expect(decodes(f).trim()).toBe('')
  })
  it('outro dosyası yoksa/bozuksa: ana video DEĞİŞMEZ ve neden döner', async () => {
    const f = join(tmp, 'c.mp4')
    execFileSync(ffm, ['-y', '-v', 'error', '-i', join(tmp, 'main.mp4'), '-c', 'copy', f])
    const size = statSync(f).size
    const miss = await appendOutro(f, join(tmp, 'yok.mp4'), tools)
    expect(miss.ok).toBe(false)
    expect(miss.error).toMatch(/bulunamadı/)
    const bad = await appendOutro(f, join(tmp, 'main.mp4.txt'), tools)
    expect(bad.ok).toBe(false)
    expect(statSync(f).size).toBe(size)
  })

  it('hangi outro: Ayarlar\'daki dosya önce; yoksa kapanış klasöründeki ilk video; hiçbiri yoksa boş', async () => {
    const ud = join(tmp, 'ud')
    expect(await resolveOutro('', ud)).toBe('') // klasör yok
    mkdirSync(outroFolder(ud), { recursive: true })
    expect(await resolveOutro(undefined, ud)).toBe('') // klasör boş
    execFileSync(ffm, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(outroFolder(ud), 'b-outro.mp4')])
    execFileSync(ffm, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(outroFolder(ud), 'a-outro.mp4')])
    expect(await resolveOutro('', ud)).toBe(join(outroFolder(ud), 'a-outro.mp4')) // ada göre ilki
    expect(await resolveOutro('/baska/outro.mp4', ud)).toBe('/baska/outro.mp4') // ayar önce
    // uygulamayla gelen outro: kullanıcı klasörü boşsa o
    const ud2 = join(tmp, 'ud2')
    const res = join(tmp, 'res')
    mkdirSync(join(res, 'outro'), { recursive: true })
    execFileSync(ffm, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(res, 'outro', 'youtube-outro.mp4')])
    expect(await resolveOutro('', ud2, res)).toBe(join(res, 'outro', 'youtube-outro.mp4'))
    expect(await resolveOutro('', ud, res)).toBe(join(outroFolder(ud), 'a-outro.mp4')) // kullanıcı klasörü bundan önce
  })
})

describe('kullanıcının gerçek outro dosyası (resources/outro/youtube-outro.mp4)', () => {
  it('gerçek 1080p/30fps SESSİZ outro, ses taşıyan 720p bir yatay videonun sonuna eklenir: süre +10 sn, ölçü korunur, ses sürer, hatasız çözülür', async () => {
    const real = join(__dirname, '../../resources/outro/youtube-outro.mp4')
    const f = join(tmp, 'gercek.mp4')
    execFileSync(ffm, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=5', '-ac', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', f])
    const r = await appendOutro(f, real, tools)
    expect(r.ok, r.error).toBe(true)
    expect(r.outroSec).toBeGreaterThan(9.8)
    const p = probe(f)
    const v = p.streams.find((s: any) => s.codec_type === 'video')
    expect([v.width, v.height]).toEqual([1280, 720]) // ana videonun ölçüsü korunur (outro küçültülür)
    expect(p.streams.some((s: any) => s.codec_type === 'audio')).toBe(true)
    expect(Number(p.format.duration)).toBeGreaterThan(14.6)
    expect(Number(p.format.duration)).toBeLessThan(15.6)
    expect(decodes(f).trim()).toBe('')
  })
})
