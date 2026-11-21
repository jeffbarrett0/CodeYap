import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { SettingsStore } from '../../src/main/settings-store'

const dir = mkdtempSync(join(tmpdir(), 'cf-set-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('ayarlar: klip sayısı sınırı', () => {
  it('yeni kurulumda varsayılan SINIRSIZ (0); eski kayıtlı varsayılanlar (10 / 15) sınırsıza çevrilir; elle verilen başka değer korunur', async () => {
    const fresh = new SettingsStore(join(dir, 'yok.json'))
    const s0 = await fresh.load()
    expect(s0.autoClipsMax).toBe(0)
    expect(s0.autoClipsMaxHorizontal).toBe(0)
    writeFileSync(join(dir, 'eski.json'), JSON.stringify({ autoClipsMax: 10, autoClipsMaxHorizontal: 15 }))
    const old = await new SettingsStore(join(dir, 'eski.json')).load()
    expect(old.autoClipsMax).toBe(0)
    expect(old.autoClipsMaxHorizontal).toBe(0)
    writeFileSync(join(dir, 'ozel.json'), JSON.stringify({ autoClipsMax: 25, autoClipsMaxHorizontal: 7 }))
    const custom = await new SettingsStore(join(dir, 'ozel.json')).load()
    expect(custom.autoClipsMax).toBe(25)
    expect(custom.autoClipsMaxHorizontal).toBe(7)
  })
})
