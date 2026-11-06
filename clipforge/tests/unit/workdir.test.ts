import { describe, expect, it } from 'vitest'
import { shortWorkDir } from '../../src/main/transcribe/pipeline'

describe('transkripsiyon çalışma klasörü', () => {
  it('kısa ASCII yol olduğu gibi kalır; uzun/Türkçe karakterli yol kısa geçici klasöre alınır (Windows 260 sınırı)', () => {
    const key = 'asset123_t0_tr_medium_whisper-cpp_600_5_abc'
    expect(shortWorkDir('/d/proje-data', key, '/tmp')).toBe(`/d/proje-data/tmp/${key}`)
    const long = `C:\\Users\\theno\\Videos\\AutoKick\\3 BÜYÜKLERİN YABANCI FUTBOLCULARI! HANGİ FUTBOLCULAR YOLCU [ZwqIPSEtNdo]\\3 BÜYÜKLERİN YABANCI FUTBOLCULARI! HANGİ FUTBOLCULAR YOLCU [ZwqIPSEtNdo].clipforge-data`
    const w = shortWorkDir(long, key, '/tmp')
    expect(w.startsWith('/tmp/clipforge-tr/')).toBe(true)
    expect(w.length).toBeLessThan(80)
    expect(shortWorkDir(long, key, '/tmp')).toBe(w) // kararlı
    expect(shortWorkDir(long, `${key}x`, '/tmp')).not.toBe(w)
  })
})
