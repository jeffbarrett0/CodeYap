import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// ffmpeg ile OBS tarzı çok track'li bir MKV (Türkçe + boşluklu yol)
function makeMkv(dir: string): string {
  const ffmpeg = process.env.CLIPFORGE_FFMPEG ?? require('ffmpeg-static')
  const sub = join(dir, 'Yayın Kayıtları çğış')
  mkdirSync(sub, { recursive: true })
  const out = join(sub, '2024-05-12 21-30-45.mkv')
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=30', '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'aac', out])
  return out
}

/** whisper.cpp'nin `-oj -ml 1 -sow` JSON çıktısını taklit eden sahte ikili (yalnızca ilk parçada konuşma var) */
function makeFakeWhisper(dir: string): string {
  const script = join(dir, 'whisper-cli')
  writeFileSync(
    script,
    `#!/usr/bin/env node
const fs = require('fs')
const a = process.argv
const val = (f) => a[a.indexOf(f) + 1]
const wav = val('-f'); const prefix = val('-of')
const words = / chunk_0\\.wav$/.test(' ' + wav.split('/').pop()) ? [' Geçen', ' sene', ' Viktor', ' Nelsen', "'dan", ' bahsetmiştim', '.', ' Hatırlıyor', ' musunuz', '?'] : []
let t = 3000
const transcription = [{ offsets: { from: 0, to: 100 }, text: '[_BEG_]' }]
for (const w of words) { transcription.push({ offsets: { from: t, to: t + 350 }, text: w }); t += 400 }
fs.writeFileSync(prefix + '.json', JSON.stringify({ transcription }))
`
  )
  chmodSync(script, 0o755)
  return script
}

let app: ElectronApplication
let page: Page
let tmp: string
let mkv: string

test.beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'cf-electron-'))
  mkv = makeMkv(tmp)
  const fake = makeFakeWhisper(tmp)
  mkdirSync(join(tmp, 'models'), { recursive: true })
  writeFileSync(join(tmp, 'models', 'ggml-tiny.bin'), '')
  truncateSync(join(tmp, 'models', 'ggml-tiny.bin'), 12_000_000)
  mkdirSync(join(tmp, 'userdata'), { recursive: true })
  writeFileSync(
    join(tmp, 'userdata', 'settings.json'),
    JSON.stringify({ whisperCppPath: fake, whisperModelDir: join(tmp, 'models'), whisperModel: 'tiny', language: 'tr' })
  )
  app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, CLIPFORGE_USER_DATA: join(tmp, 'userdata') } })
  page = await app.firstWindow()
  await page.waitForSelector('.brand')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(tmp, { recursive: true, force: true })
})

test('gerçek Electron: preload köprüsü, ffmpeg algılama, içe aktarma, sahte-whisper ile transkripsiyon, arama, klip, dışa aktarma', async () => {
  expect(await page.evaluate(() => !!window.clipforge && window.clipforge.isMock === false)).toBe(true)
  const info = await page.evaluate(() => window.clipforge!.invoke('app:info'))
  expect(info.ffmpeg.ok).toBe(true)
  expect(info.ffprobe.ok).toBe(true)

  // içe aktar (IPC ile: yerel dosya diyaloğu otomatikleştirilemez)
  await page.evaluate((p) => window.clipforge!.invoke('media:import', [p]), mkv)
  await expect(page.getByTestId('asset')).toHaveCount(1, { timeout: 30_000 })
  await expect(page.getByTestId('asset-detail')).toBeVisible()
  await expect(page.getByTestId('asset-detail')).not.toContainText('Track') // seçili kayıt/track ayrıntıları kaldırıldı

  // önizleme kopyası arka planda hazırlanır; bitince cf-media:// üzerinden oynatılabilir
  await expect(async () => {
    const ok = await page.evaluate(async () => {
      const s = (await window.clipforge!.invoke('task:list')).filter((t) => t.kind === 'proxy')
      return s.length > 0 && s.every((t) => t.status === 'done')
    })
    expect(ok).toBe(true)
  }).toPass({ timeout: 60_000 })
  const proxyStatus = await page.evaluate(async () => {
    const a = document.querySelector('[data-testid=asset] .thumb') as HTMLElement
    const url = getComputedStyle(a).backgroundImage.match(/url\("?(.*?)"?\)/)?.[1]
    if (!url) return 0
    return (await fetch(url)).status
  })
  expect(proxyStatus).toBe(200)

  // transkripsiyon (sahte whisper-cli → whisper.cpp JSON ayrıştırma + parçalama hattı)
  await page.getByTestId('transcribe-btn').click()
  await expect(page.getByText('Transkript hazır')).toBeVisible({ timeout: 60_000 })

  // yazım hatalı sorgu ("Victor Nelson" yerine "Viktor Nelsen" konuşuldu; "Victor Nelson" aranır)
  await page.getByTestId('tab-search').click()
  await page.getByTestId('search-input').fill('Victor Nelson')
  await page.getByTestId('search-btn').click()
  await expect(page.getByTestId('result')).toHaveCount(1)
  await expect(page.getByTestId('result')).toContainText('00:03')
  await expect(page.getByTestId('result').locator('mark')).toHaveCount(2) // Viktor, Nelsen'dan

  // klip → zaman çizelgesi
  await page.getByTestId('make-clip').click()
  await page.getByLabel('Hedef süre').selectOption('15')
  await page.getByTestId('add-to-timeline').click()
  await expect(page.getByTestId('lane-V1').getByTestId('clip')).toHaveCount(1)
  await expect(page.getByTestId('lane-A1').getByTestId('clip')).toHaveCount(1)
  await expect(page.getByTestId('lane-A2').getByTestId('clip')).toHaveCount(1)

  // altyazı + dışa aktarma (gerçek ffmpeg, 9:16). Sistem kaydet diyaloğu ana süreçte taklit edilir.
  await page.getByTestId('rtab-captions').click()
  await page.getByTestId('gen-captions').click()
  await expect(page.getByTestId('lane-CC').locator('.tl-clip').first()).toBeVisible()
  const out = join(tmp, 'çıktı klasörü', 'klip çıktı.mp4')
  await app.evaluate(({ dialog }, o) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: o })) as typeof dialog.showSaveDialog
  }, out)
  await page.getByTestId('export-btn').click()
  await page.getByTestId('export-ack').check()
  await page.getByTestId('export-go').click()
  await expect(page.getByTestId('last-export')).toContainText('klip çıktı.mp4', { timeout: 120_000 })
  expect(existsSync(out)).toBe(true)
  const ffprobe = require('@ffprobe-installer/ffprobe').path as string
  const j = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', out]).toString())
  const v = j.streams.find((x: { codec_type: string }) => x.codec_type === 'video')
  expect([v.width, v.height]).toEqual([1080, 1920])
  expect(j.streams.some((x: { codec_type: string }) => x.codec_type === 'audio')).toBe(true)
  expect(Number(j.format.duration)).toBeGreaterThan(3) // transkriptte yalnızca bir cümle var: klip o cümleyle sınırlı
})

test('hata yönetimi: bozuk dosya içe aktarılınca uygulama çökmez, anlaşılır mesaj gösterilir', async () => {
  const bad = join(tmp, 'bozuk.mp4')
  writeFileSync(bad, 'bu bir video degil '.repeat(200))
  await page.evaluate((p) => window.clipforge!.invoke('media:import', [p]), bad)
  await expect(page.getByTestId('toast').filter({ hasText: /bozuk|çözümlen|okun|Invalid|hata/i }).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.brand')).toBeVisible()
  // ana süreç hâlâ yanıt veriyor
  expect((await page.evaluate(() => window.clipforge!.invoke('app:info'))).ffmpeg.ok).toBe(true)
})
