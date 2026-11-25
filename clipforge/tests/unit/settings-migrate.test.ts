import { describe, expect, it } from 'vitest'
import { normalizeSettings } from '../../src/shared/settings'

describe('otomatik klip zinciri göçü', () => {
  it('eski kayıtlı açık ayar bir kez kapatılır; sonra kullanıcı açarsa açık kalır; yeni kurulum kapalı', () => {
    expect(normalizeSettings({ autoClipsAfterKick: true }).autoClipsAfterKick).toBe(false) // eski dosya
    expect(normalizeSettings({ autoClipsAfterKick: true, chainOffMigrated: true }).autoClipsAfterKick).toBe(true) // kullanıcı sonradan açtı
    expect(normalizeSettings({}).autoClipsAfterKick).toBe(false) // yeni kurulum
  })
})
