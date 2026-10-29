import { describe, expect, it } from 'vitest'
import { defaultAudioMap, detectObs, isSupportedMedia, parseProbe, scanEncoderSignature, type FfprobeJson } from '@shared/media/probe'

const obsMkv: FfprobeJson = {
  format: { format_name: 'matroska,webm', duration: '3600.5', size: '9000000000', bit_rate: '20000000', tags: { ENCODER: 'Lavf60.16.100' } },
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1920, height: 1080, avg_frame_rate: '60/1', pix_fmt: 'yuv420p' },
    { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000', tags: { title: 'Track 1' } },
    { index: 2, codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000' },
    { index: 3, codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000' }
  ],
  chapters: [{ start_time: '120.0', end_time: '120.0', tags: { title: 'Chapter 1' } }]
}

describe('ffprobe ayrıştırma', () => {
  it('süre, çözünürlük, fps, ses track ve bölümleri okur', () => {
    const p = parseProbe(obsMkv, '2024-05-12 21-30-45.mkv')
    expect(p).toMatchObject({ kind: 'video', container: 'mkv', durationSec: 3600.5, width: 1920, height: 1080, fps: 60, videoCodec: 'h264' })
    expect(p.audioStreams.map((a) => a.index)).toEqual([0, 1, 2])
    expect(p.audioStreams[0].title).toBe('Track 1')
    expect(p.chapters[0]).toEqual({ start: 120, end: 120, title: 'Chapter 1' })
    expect(p.obs.isObs).toBe(true) // dosya adı OBS biçiminde
  })
  it('FLV libobs etiketinden sürüm', () => {
    const o = detectObs({ format: { format_name: 'flv', tags: { encoder: 'obs-output module (libobs version 30.1.2)' } } }, 'x.flv')
    expect(o).toMatchObject({ isObs: true, version: '30.1.2' })
  })
  it('kodlayıcı imzaları: x264 SEI, NVENC, AMF', () => {
    expect(scanEncoderSignature('...x264 - core 164 r3095 baee400...')?.encoder).toBe('x264')
    expect(scanEncoderSignature('Lavc60.3.100 h264_nvenc')?.encoder).toBe('nvenc')
    expect(scanEncoderSignature('hevc_amf')?.encoder).toBe('amf')
    expect(scanEncoderSignature('hiçbir şey')).toBeNull()
    const head = new TextEncoder().encode('xxxx x264 - core 164 r3095 options: cabac=1')
    expect(detectObs({ format: {}, streams: [] }, 'a.mkv', head).encoder).toBe('x264')
  })
  it('OBS dışı dosya', () => {
    expect(detectObs({ format: { tags: { encoder: 'Lavf58' } } }, 'tatil.mp4').isObs).toBe(false)
  })
  it('desteklenen uzantılar ve varsayılan ses eşlemesi', () => {
    expect(['a.MKV', 'a.mp4', 'a.mov', 'a.flv'].every(isSupportedMedia)).toBe(true)
    expect(isSupportedMedia('a.avi')).toBe(false)
    expect(defaultAudioMap(parseProbe(obsMkv, 'a.mkv').audioStreams)).toEqual({ mix: 0, game: 1, voice: 2 })
    expect(defaultAudioMap(parseProbe(obsMkv, 'a.mkv').audioStreams.slice(0, 1))).toEqual({ mix: 0 })
  })
})

describe('ses ve görsel dosyaları', () => {
  it('görsel: süresiz, ses akışsız, kind=image; ses dosyası: kind=audio', () => {
    const img = parseProbe({ format: { format_name: 'png_pipe' }, streams: [{ index: 0, codec_type: 'video', codec_name: 'png', width: 800, height: 600 }] }, 'konu görseli.PNG')
    expect(img).toMatchObject({ kind: 'image', durationSec: 0, width: 800, height: 600, audioStreams: [] })
    const aud = parseProbe({ format: { format_name: 'mp3', duration: '61.5' }, streams: [{ index: 0, codec_type: 'audio', codec_name: 'mp3', channels: 2, sample_rate: '44100' }] }, 'konuşma.mp3')
    expect(aud).toMatchObject({ kind: 'audio', durationSec: 61.5 })
    expect(aud.audioStreams).toHaveLength(1)
    expect(['a.wav', 'a.png', 'a.JPG', 'a.m4a', 'a.mkv'].every(isSupportedMedia)).toBe(true)
  })
})
