import { expect, test, type Page } from '@playwright/test'

async function boot(page: Page) {
  await page.goto('/')
  await expect(page.locator('.brand')).toContainText('ClipForge')
}


/** Kütüphanedeki n. dosyayı zaman çizelgesindeki bir ize sürükleyip bırakır (şeridin başına: klip ~0. sn'de başlar) */
async function dropAsset(page: Page, index: number, laneId: string) {
  await page.getByTestId('asset').nth(index).dragTo(page.getByTestId(`lane-${laneId}`), { targetPosition: { x: 8, y: 20 } })
}

async function importAndTranscribe(page: Page) {
  await page.getByTestId('import-btn').click()
  await expect(page.getByTestId('asset')).toHaveCount(1)
  // dosya kendiliğinden seçilmez: orta alan boş kalır, kullanıcı kütüphanede tıklayınca açılır
  await expect(page.getByTestId('source-video')).toHaveCount(0)
  await page.getByTestId('asset').first().click()
  await expect(page.getByTestId('asset-detail')).toBeVisible()
  await page.getByTestId('transcribe-btn').click()
  await expect(page.getByText('Transkript hazır')).toBeVisible()
}

test.describe('ClipForge arayüzü (tarayıcı modu, sahte ana süreç)', () => {
  test('içe aktar → transkript → "Viktor Nelsen" araması → 30 sn klip → timeline → altyazı → dışa aktar', async ({ page }) => {
    await boot(page)
    await importAndTranscribe(page)

    // Arama (yazım hatalı sorgu yine de aynı bölümleri bulur)
    await page.getByTestId('tab-search').click()
    await page.getByTestId('search-input').fill('Viktor Nelsen')
    await page.getByTestId('search-btn').click()
    await expect(page.getByTestId('result')).toHaveCount(3)
    const times = await page.locator('[data-testid=result] .time').allTextContents()
    expect(times).toEqual(['00:14', '01:01', '01:37'])
    await expect(page.getByTestId('result').first().locator('mark').first()).toBeVisible()
    await expect(page.getByTestId('history')).toContainText('Viktor Nelsen')

    // Serbest cümle sorgusu aynı sonucu verir
    await page.getByTestId('search-input').fill('Victor Nelson ile ilgili konuştuğum yer')
    await page.getByTestId('search-btn').click()
    await expect(page.getByTestId('result')).toHaveCount(3)

    // Klip taslağı → 30 sn hedef → timeline'a ekle
    await page.getByTestId('make-clip').first().click()
    await expect(page.getByTestId('draft-panel')).toBeVisible()
    await page.getByLabel('Hedef süre').selectOption('30')
    const dur = Number((await page.getByTestId('draft-duration').textContent())!.replace(/[^\d.]/g, ''))
    expect(dur).toBeLessThanOrEqual(30)
    expect(dur).toBeGreaterThan(10)
    await page.getByTestId('add-to-timeline').click()
    await expect(page.getByTestId('lane-V2').getByTestId('clip')).toHaveCount(1)
    await expect(page.getByTestId('lane-A1').getByTestId('clip')).toHaveCount(1)
    await expect(page.getByTestId('lane-A2').getByTestId('clip')).toHaveCount(1)

    // Kaynak zaman damgası meta verisi denetçide
    await page.getByTestId('lane-V2').getByTestId('clip').click()
    await expect(page.getByTestId('inspector')).toContainText('Arama')
    await expect(page.getByTestId('inspector')).toContainText('"Victor Nelson ile ilgili konuştuğum yer"')

    // 9:16 varsayılan
    await expect(page.getByTestId('aspect-9:16')).toHaveCount(0) // sağ panel Klip sekmesinde
    await page.getByTestId('rtab-layout').click()
    // oran otomatik: ilk video (1920×1080) eklenince 16:9
    await expect(page.getByTestId('aspect-auto')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('aspect-info')).toContainText('1920×1080 (16:9)')

    // Altyazı
    await page.getByTestId('rtab-captions').click()
    await page.getByTestId('gen-captions').click()
    await expect(page.getByTestId('lane-CC').locator('.tl-clip').first()).toBeVisible()

    // Dışa aktar: telif hatırlatması + onay kutusu
    await page.getByTestId('export-btn').click()
    await expect(page.getByTestId('copyright-notice')).toContainText('hukuki tavsiye değildir')
    await expect(page.getByTestId('export-go')).toBeDisabled()
    await page.getByTestId('export-ack').check()
    await page.getByTestId('export-go').click()
    await expect(page.getByTestId('last-export')).toContainText('.mp4', { timeout: 10_000 })
  })

  test('zaman çizelgesi: bölme, silme, geri al/yinele, kısayollar', async ({ page }) => {
    await boot(page)
    await importAndTranscribe(page)
    await page.getByTestId('tab-search').click()
    await page.getByTestId('search-input').fill('Victor Nelson')
    await page.getByTestId('search-btn').click()
    await page.getByTestId('make-clip').first().click()
    await page.getByTestId('add-to-timeline').click()

    const v1 = page.getByTestId('lane-V2').getByTestId('clip')
    await expect(v1).toHaveCount(1)
    // oynatma başlığını klibin ortasına al (cetvel tıklaması) ve S ile böl
    const box = (await v1.boundingBox())!
    const ruler = (await page.getByTestId('ruler').boundingBox())!
    await page.mouse.click(box.x + box.width / 2, ruler.y + 10)
    await v1.click()
    await page.keyboard.press('s')
    await expect(v1).toHaveCount(2)
    await expect(page.getByTestId('lane-A1').getByTestId('clip')).toHaveCount(2) // bağlı ses de bölündü

    // geri al / yinele
    await page.keyboard.press('Control+z')
    await expect(v1).toHaveCount(1)
    await page.keyboard.press('Control+Shift+z')
    await expect(v1).toHaveCount(2)
    await page.getByTestId('undo').click()
    await expect(v1).toHaveCount(1)

    // Delete YALNIZCA seçili klibi siler: bağlı ses/diğer klipler kalır
    await v1.first().click()
    await page.keyboard.press('Delete')
    await expect(v1).toHaveCount(0)
    await expect(page.getByTestId('lane-A1').getByTestId('clip')).toHaveCount(1)
    await expect(page.getByTestId('lane-A2').getByTestId('clip')).toHaveCount(1)
    await page.keyboard.press('Control+z')
    await expect(v1).toHaveCount(1)
    // Shift+Delete bağlı klipleriyle birlikte siler
    await v1.first().click()
    await page.keyboard.press('Shift+Delete')
    await expect(v1).toHaveCount(0)
    await expect(page.getByTestId('lane-A1').getByTestId('clip')).toHaveCount(0)
    await page.keyboard.press('Control+z')
    await expect(v1).toHaveCount(1)
  })

  test('sürükleyerek taşıma ve kenardan kırpma', async ({ page }) => {
    await boot(page)
    await importAndTranscribe(page)
    await page.getByTestId('tab-search').click()
    await page.getByTestId('search-input').fill('Victor Nelson')
    await page.getByTestId('search-btn').click()
    await page.getByTestId('make-clip').first().click()
    await page.getByTestId('add-to-timeline').click()
    const v1 = page.getByTestId('lane-V2').getByTestId('clip').first()
    const b0 = (await v1.boundingBox())!
    // sağ kenardan kırp
    await page.mouse.move(b0.x + b0.width - 3, b0.y + b0.height / 2)
    await page.mouse.down()
    await page.mouse.move(b0.x + b0.width - 63, b0.y + b0.height / 2, { steps: 5 })
    await page.mouse.up()
    const b1 = (await v1.boundingBox())!
    expect(b1.width).toBeLessThan(b0.width - 40)
    // gövdeden sürükle (sağa)
    await page.mouse.move(b1.x + 30, b1.y + b1.height / 2)
    await page.mouse.down()
    await page.mouse.move(b1.x + 130, b1.y + b1.height / 2, { steps: 5 })
    await page.mouse.up()
    const b2 = (await v1.boundingBox())!
    expect(b2.x).toBeGreaterThan(b1.x + 50)
    // bağlı ses klibi de birlikte kaydı
    const a1 = (await page.getByTestId('lane-A1').getByTestId('clip').first().boundingBox())!
    expect(Math.abs(a1.x - b2.x)).toBeLessThan(2)
    // tek geri alma sürüklemeyi tamamen geri alır
    await page.keyboard.press('Control+z')
    const b3 = (await v1.boundingBox())!
    expect(Math.abs(b3.x - b1.x)).toBeLessThan(2)
  })

  test('transkript yokken arama yönlendirir; ayarlar kaydedilir; görev paneli', async ({ page }) => {
    await boot(page)
    await page.getByTestId('import-btn').click()
    await expect(page.getByTestId('asset')).toHaveCount(1)
    await page.getByTestId('asset').click() // elle seç
    await page.getByTestId('tab-search').click()
    await expect(page.getByText('henüz transkript yok')).toBeVisible()
    await page.getByTestId('settings-btn').click()
    const dlg = page.getByRole('dialog', { name: 'Ayarlar' })
    await dlg.getByRole('tab', { name: 'Arama' }).click()
    await dlg.getByRole('tab', { name: 'Klip' }).click()
    await dlg.getByLabel('Pre-roll').fill('7')
    await page.getByTestId('settings-save').click()
    await page.getByTestId('settings-btn').click()
    await page.getByRole('dialog', { name: 'Ayarlar' }).getByRole('tab', { name: 'Klip' }).click()
    await expect(page.getByRole('dialog', { name: 'Ayarlar' }).getByLabel('Pre-roll')).toHaveValue('7')
    await page.keyboard.press('Escape')
    await page.getByTestId('tasks-btn').click()
    await expect(page.getByTestId('task-panel')).toBeVisible()
  })

  test('içe aktarma hatası anlaşılır toast olarak görünür, uygulama çökmez', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => ((window as unknown as { __mock: { fail: { import: string } } }).__mock.fail = { import: 'Dosya bozuk ya da eksik görünüyor.' }))
    await page.getByTestId('import-btn').click()
    await expect(page.getByTestId('toast').first()).toContainText('Dosya bozuk')
    await expect(page.locator('.brand')).toBeVisible()
  })

  test('katmanlar: varsayılan 3 bölgeli şablon, sürükle-bırak, sayısal giriş, görünürlük, şablon kaydet/uygula', async ({ page }) => {
    await boot(page)
    await importAndTranscribe(page)
    await page.getByTestId('tab-search').click()
    await page.getByTestId('search-input').fill('Victor Nelson')
    await page.getByTestId('search-btn').click()
    await page.getByTestId('make-clip').first().click()
    await page.getByTestId('add-to-timeline').click()
    await page.getByTestId('rtab-layout').click()
    await expect(page.getByTestId('layers-panel')).toBeVisible()

    // varsayılan düzen: YALNIZCA tek Video katmanı. Orta alan/konu görseli, hazır yazı ve oyun ekranı kendiliğinden gelmez
    await expect(page.getByTestId('layer-V2')).toBeVisible()
    for (const id of ['I1', 'I2', 'V1']) await expect(page.getByTestId(`layer-${id}`)).toHaveCount(0)
    await expect(page.getByTestId('layer-list')).not.toContainText('Orta alan')
    await expect(page.getByTestId('layer-list')).not.toContainText('Konu görseli')
    await expect(page.getByTestId('layer-list')).not.toContainText('Davet')
    await expect(page.getByTestId('layer-list')).not.toContainText('webcam')
    // video alanı normal video alanı: kırpmadan sığdırılır
    await page.getByTestId('layer-V2').click()
    await expect(page.getByTestId('layer-detail').getByLabel('Sığdırma')).toHaveValue('contain')
    // oyun ekranı katmanı YALNIZCA elle eklenir
    await page.getByTestId('add-game-layer').click()
    await expect(page.getByTestId('layer-V1')).toBeVisible()
    await expect(page.getByTestId('ly-V1')).toBeVisible()
    await page.getByTestId('eye-V1').click() // gizle (seçili katman kesik çizgiyle kalır)
    await expect(page.getByTestId('ly-V1')).toHaveClass(/off/)
    await page.getByTestId('eye-V1').click() // göster
    await expect(page.getByTestId('ly-V1')).not.toHaveClass(/off/)
    await expect(page.getByTestId('add-game-layer')).toBeDisabled()
    // her katman silinebilir (içinde klip yoksa onaysız)
    await page.getByTestId('layer-V1').click()
    await page.getByTestId('remove-layer').click()
    await expect(page.getByTestId('layer-V1')).toHaveCount(0)

    // sayısal giriş: yüz katmanının yüksekliği
    await page.getByTestId('layer-V2').click()
    const detail = page.getByTestId('layer-detail')
    await detail.getByLabel('Yükseklik').fill('30')
    await expect(page.getByTestId('ly-V2')).toBeVisible()
    const h = await page.getByTestId('ly-V2').evaluate((el) => (el as HTMLElement).style.height)
    expect(h).toBe('30%')

    // önizlemede sürükle: katman aşağı kayar
    await page.getByTestId('mode-timeline').click()
    const box = (await page.getByTestId('ly-V2').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 120, { steps: 6 })
    await page.mouse.up()
    const top = await page.getByTestId('ly-V2').evaluate((el) => parseFloat((el as HTMLElement).style.top))
    expect(top).toBeGreaterThan(5)
    // tek geri alma sürüklemeyi geri alır
    await page.keyboard.press('Control+z')
    const top2 = await page.getByTestId('ly-V2').evaluate((el) => parseFloat((el as HTMLElement).style.top))
    expect(top2).toBeLessThan(1)

    // sağ-alt tutamaçla boyutlandır
    const b2 = (await page.getByTestId('ly-V2').boundingBox())!
    const hd = (await page.getByTestId('hd-V2-se').boundingBox())!
    await page.mouse.move(hd.x + hd.width / 2, hd.y + hd.height / 2)
    await page.mouse.down()
    await page.mouse.move(hd.x - 60, hd.y - 20, { steps: 5 })
    await page.mouse.up()
    expect((await page.getByTestId('ly-V2').boundingBox())!.width).toBeLessThan(b2.width - 30)

    // kullanıcının kendi eklediği metin katmanı: yazıyı kendisi yazar
    await page.getByTestId('add-text-layer').click()
    await expect(page.getByTestId('layer-text')).toHaveValue('') // boş başlar: hazır yazı yok
    await page.getByTestId('layer-text').fill('KANALIMA GEL')
    await expect(page.locator('[data-testid^=lane-L] [data-testid=clip]').first()).toContainText('KANALIMA GEL')

    // hazır şablon listesi ("YouTube Shorts · Yüz / Davet / Görsel" vb.) yok; yalnızca kullanıcının kayıtlı düzenleri
    await expect(page.getByTestId('layers-panel')).not.toContainText('YouTube Shorts')
    await expect(page.getByTestId('tpl-select')).toHaveCount(0)
    // düzeni kaydet → değiştir → kayıtlı düzeni uygula
    await page.getByTestId('layer-V2').click()
    const savedH = await page.getByTestId('layer-detail').getByLabel('Yükseklik').inputValue()
    await page.getByTestId('tpl-name').fill('Benim düzenim')
    await page.getByTestId('tpl-save').click()
    await expect(page.getByTestId('tpl-select')).toContainText('Benim düzenim')
    await page.getByTestId('layer-detail').getByLabel('Yükseklik').fill('55')
    await expect(page.getByTestId('layer-detail').getByLabel('Yükseklik')).toHaveValue('55')
    await page.getByTestId('tpl-apply').click()
    await page.getByTestId('layer-V2').click()
    await expect(page.getByTestId('layer-detail').getByLabel('Yükseklik')).toHaveValue(savedH)
    await expect(page.getByTestId('tpl-delete')).toBeVisible()
  })

  test('ayrı kaynaklar: ekran, oyun sesi, konuşma ve görsel ayrı içe aktarılır; ize eklenir; bağlı kaynaklarla klip çıkar', async ({ page }) => {
    await boot(page)
    // üç ayrı dosya + görsel (dosya diyaloğu yerine doğrudan içe aktarma)
    await page.evaluate(() => (window as unknown as { __cfApi: NonNullable<Window['clipforge']> }).__cfApi.invoke('media:import', ['/kayit/ekran kaydi.mp4', '/kayit/oyun sesi.wav', '/kayit/konusma.wav', '/kayit/konu gorseli.png']))
    await expect(page.getByTestId('asset')).toHaveCount(4)
    await expect(page.getByTestId('asset').nth(3)).toContainText('Görsel')
    await expect(page.getByTestId('asset').nth(1)).toContainText('Ses')

    // görsel katmanı kendiliğinden gelmez: elle eklenir, sonra görsel o katmana sürüklenir
    await expect(page.locator('[data-testid^="lane-L"]')).toHaveCount(0)
    await page.getByTestId('rtab-layout').click()
    await page.getByTestId('add-image-layer').click()
    const imgLane = page.locator('[data-testid^="lane-L"]').first()
    await page.getByTestId('asset').nth(3).dragTo(imgLane, { targetPosition: { x: 8, y: 20 } })
    await expect(imgLane.getByTestId('clip')).toHaveCount(1)

    // oyun sesini A1'e sürükle-bırak
    const game = page.getByTestId('asset').nth(1)
    const lane = page.getByTestId('lane-A1')
    await game.dragTo(lane)
    await expect(page.getByTestId('lane-A1').getByTestId('clip')).toHaveCount(1)
    // görsel ses izine bırakılamaz: uyarı verir
    await page.getByTestId('asset').nth(3).dragTo(page.getByTestId('lane-A2'), { targetPosition: { x: 8, y: 20 } })
    await expect(page.getByTestId('toast').filter({ hasText: 'Görsel katmanına yalnızca' }).or(page.getByTestId('toast').filter({ hasText: 'ses akışı yok' }))).toBeVisible()
    await expect(page.getByTestId('lane-A2').getByTestId('clip')).toHaveCount(0)

    // konuşma dosyası: rol + bağlı kaynaklar
    await page.getByTestId('asset').nth(2).click()
    await expect(page.getByTestId('role-select')).toHaveCount(0) // rol bölümü kaldırıldı
    await page.getByTestId('src-screen').selectOption({ label: 'ekran kaydi.mp4' })
    await page.getByTestId('src-game').selectOption({ label: 'oyun sesi.wav' })
    // konuşma dosyasını transkribe et ve ara
    await page.getByTestId('transcribe-btn').click()
    await expect(page.getByText('Transkript hazır').first()).toBeVisible()
    await page.getByTestId('tab-search').click()
    await page.getByTestId('search-input').fill('Victor Nelson')
    await page.getByTestId('search-btn').click()
    await page.getByTestId('make-clip').first().click()
    await page.getByTestId('add-to-timeline').click()
    // ekran V1, oyun sesi A1, konuşma A2 (konuşma dosyasından) — yeni klipler eklenmiş olmalı
    await expect(page.getByTestId('lane-V2').getByTestId('clip')).toHaveCount(1)
    await expect(page.getByTestId('lane-A1').getByTestId('clip')).toHaveCount(2)
    await expect(page.getByTestId('lane-A2').getByTestId('clip')).toHaveCount(1)
  })

  test('transkript: kelimeden kesme, zaman damgasına atlama, birleştirme, boşluk kapatma, geri alma', async ({ page }) => {
    await boot(page)
    await importAndTranscribe(page)
    await page.getByTestId('tab-search').click()
    await page.getByTestId('search-input').fill('Victor Nelson')
    await page.getByTestId('search-btn').click()
    await page.getByTestId('make-clip').first().click()
    await page.getByTestId('add-to-timeline').click()
    const v1 = page.getByTestId('lane-V2').getByTestId('clip')
    await expect(v1).toHaveCount(1)

    await page.getByTestId('tab-transcript').click()
    await expect(page.getByTestId('tw-word').first()).toBeVisible()
    const words = page.getByTestId('tw-word')
    const n0 = await words.count()
    expect(n0).toBeGreaterThan(5)

    // kelime aralığı seç (tıkla + Shift+tıkla) ve kes
    const dur = async () => Number((await page.getByTestId('tl-tc').textContent().catch(() => null))?.split('/')[1]?.trim().split(':').reduce((a, b) => a * 60 + Number(b), 0) ?? 0)
    await page.getByTestId('mode-timeline').click()
    const total0 = await dur()
    await words.nth(2).click()
    await words.nth(4).click({ modifiers: ['Shift'] })
    await expect(page.getByTestId('tw-selection')).toContainText('Seçili')
    await page.getByTestId('tw-cut').click()
    await expect(v1).toHaveCount(2) // klip ikiye bölündü, aradaki kısım silindi
    await expect(page.getByTestId('lane-A1').getByTestId('clip')).toHaveCount(2) // bağlı ses de
    expect(await page.getByTestId('tw-word').count()).toBe(n0 - 3)
    expect(await dur()).toBeLessThan(total0)

    // geri al → yeniden tek klip
    await page.keyboard.press('Control+z')
    await expect(v1).toHaveCount(1)
    expect(await page.getByTestId('tw-word').count()).toBe(n0)

    // zaman damgasına atla
    await page.getByTestId('tw-jump-input').fill('0:03')
    await page.getByTestId('tw-jump-go').click()
    await expect(page.getByTestId('tl-tc')).toContainText('00:03')
    await page.getByTestId('tw-jump-input').fill('abc')
    await page.getByTestId('tw-jump-go').click()
    await expect(page.getByTestId('toast').filter({ hasText: 'Zaman biçimi' })).toBeVisible()

    // böl → birleştir
    await v1.first().click()
    await page.keyboard.press('s')
    await expect(v1).toHaveCount(2)
    await v1.first().click()
    await page.getByTestId('join').click()
    await expect(v1).toHaveCount(1)

    // boşluk kapat: klibi uzağa taşı, sonra boşlukları kapat
    const b = (await v1.first().boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2 + 200, b.y + b.height / 2, { steps: 6 })
    await page.mouse.up()
    expect((await v1.first().boundingBox())!.x).toBeGreaterThan(b.x + 100)
    await page.getByTestId('close-gaps').click()
    expect(Math.abs((await v1.first().boundingBox())!.x - b.x)).toBeLessThan(3)

    // kaynak modu: seçimden klip taslağı
    await page.getByTestId('tw-mode-source').click()
    await page.getByTestId('tw-word').nth(3).click()
    await page.getByTestId('tw-word').nth(8).click({ modifiers: ['Shift'] })
    await page.getByTestId('tw-make-clip').click()
    await expect(page.getByTestId('draft-panel')).toBeVisible()
  })

  test('video katmanına bırakılan videonun sesi de ses izine eklenir (sessiz kalmaz)', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => (window as unknown as { __cfApi: NonNullable<Window['clipforge']> }).__cfApi.invoke('media:import', ['/kayit/paylasilan video.mp4']))
    await expect(page.getByTestId('asset')).toHaveCount(1)
    await expect(page.getByTestId('add-to-track')).toHaveCount(0) // "Zaman çizelgesine ekle" bölümü kaldırıldı
    await dropAsset(page, 0, 'V2')
    await expect(page.getByTestId('lane-V2').getByTestId('clip')).toHaveCount(1)
    await expect(page.getByTestId('lane-A1').getByTestId('clip')).toHaveCount(1) // sesi A1'e geldi
    await expect(page.getByTestId('toast').filter({ hasText: 'sesiyle birlikte' })).toBeVisible()
  })

  test('altyazı: transkripti olan video yüz/webcam katmanında olsa da altyazı üretilir', async ({ page }) => {
    await boot(page)
    await importAndTranscribe(page)
    // videoyu doğrudan "Yüz (webcam)" katmanına bırak (ekran katmanına değil)
    await dropAsset(page, 0, 'V2')
    await expect(page.getByTestId('lane-V2').getByTestId('clip')).toHaveCount(1)
    await page.getByTestId('rtab-captions').click()
    await page.getByTestId('gen-captions').click()
    await expect(page.getByTestId('lane-CC').locator('.tl-clip').first()).toBeVisible()
    // aynı işlem transkript sekmesinden de yapılır ve altyazı görünür duruma gelir
    await page.getByTestId('tab-transcript').click()
    await page.getByTestId('tw-gen-captions').click()
    await expect(page.getByTestId('toast').filter({ hasText: 'altyazı satırı üretildi' }).first()).toBeVisible()
  })

  test('altyazı: tıklayıp seçme, önizlemede sürükleyerek taşıma, zaman çizelgesinden seçme, sıfırlama', async ({ page }) => {
    await boot(page)
    await importAndTranscribe(page)
    await dropAsset(page, 0, 'V2')
    await page.getByTestId('rtab-captions').click()
    await page.getByTestId('gen-captions').click()
    await expect(page.getByTestId('cap-clip').first()).toBeVisible()
    // zaman çizelgesindeki altyazıya tıkla: seçilir ve önizlemede görünür
    await page.getByTestId('cap-clip').first().click()
    await expect(page.getByTestId('caption-detail')).toContainText('varsayılan konum')
    const box = page.getByTestId('cap-box').first()
    await expect(box).toBeVisible()
    const b0 = (await box.boundingBox())!
    // sürükle: yukarı ve sola
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2)
    await page.mouse.down()
    await page.mouse.move(b0.x + b0.width / 2 - 60, b0.y + b0.height / 2 - 150, { steps: 8 })
    await page.mouse.up()
    const b1 = (await page.getByTestId('cap-box').first().boundingBox())!
    expect(b1.y).toBeLessThan(b0.y - 100)
    expect(b1.x).toBeLessThan(b0.x - 30)
    await expect(page.getByTestId('caption-detail')).toContainText('özel konum')
    // yalnızca o altyazı taşındı: sayısal değerler yazılıdır
    const y = Number(await page.getByLabel('Altyazı Y').inputValue())
    expect(y).toBeLessThan(75)
    // sayısal giriş
    await page.getByLabel('Altyazı Y').fill('20')
    expect(Number(await page.getByLabel('Altyazı Y').inputValue())).toBe(20)
    // tek geri alma (sayısal değişiklik) → önceki konuma, sıfırlama → varsayılan
    await page.getByTestId('cap-reset').click()
    await expect(page.getByTestId('caption-detail')).toContainText('varsayılan konum')
    // tümüne uygula
    await page.getByLabel('Altyazı Y').fill('30')
    await page.getByTestId('cap-apply-all').click()
    await page.getByTestId('cap-clip').nth(1).click()
    expect(Number(await page.getByLabel('Altyazı Y').inputValue())).toBe(30)
  })

  test('sol panel yalnızca medya kütüphanesi; dosyaya tıklayınca otomatik oynar; diğer sekmeler sağ panelde', async ({ page }) => {
    await boot(page)
    const left = page.getByRole('complementary', { name: 'Medya kütüphanesi' })
    await expect(left.getByTestId('dropzone')).toBeVisible()
    await expect(left.getByRole('tab')).toHaveCount(0) // sekme yok
    await page.getByTestId('import-btn').click()
    await expect(left.getByTestId('asset')).toHaveCount(1)
    // sol panelde kütüphane + içe aktarma dışında hiçbir kontrol yok
    await expect(left.getByTestId('asset-detail')).toHaveCount(0)
    await expect(left.getByTestId('transcribe-btn')).toHaveCount(0)
    // arama / transkript / kaynak sağ panelde; Öneriler sekmesi kaldırıldı
    const right = page.getByRole('complementary', { name: 'Özellikler' })
    await expect(right.getByTestId('tab-suggest')).toHaveCount(0)
    for (const id of ['tab-source', 'tab-search', 'tab-transcript']) await expect(right.getByTestId(id)).toBeVisible()

    // tıklayınca otomatik oynatma
    await page.getByTestId('mode-timeline').click()
    await left.getByTestId('asset').click()
    await expect(page.getByTestId('mode-source')).toHaveClass(/active/)
    await expect(right.getByTestId('asset-detail')).toBeVisible()
    await expect.poll(() => page.evaluate(() => { const v = document.querySelector('[data-testid=source-video]') as HTMLVideoElement | null; return !!v && !v.paused && v.currentTime > 0.1 }), { timeout: 8000 }).toBe(true)
    // ikinci tıklama baştan yeniden oynatır
    await page.getByTestId('source-play').click() // duraklat
    await expect.poll(() => page.evaluate(() => (document.querySelector('[data-testid=source-video]') as HTMLVideoElement).paused)).toBe(true)
    await left.getByTestId('asset').click()
    await expect.poll(() => page.evaluate(() => !(document.querySelector('[data-testid=source-video]') as HTMLVideoElement).paused), { timeout: 8000 }).toBe(true)
  })

  test('sağ tık → Crop / Kırp: alt kenardan yukarı serbest kırpma, tutamaçlar, sıfırlama, geri alma', async ({ page }) => {
    await boot(page)
    await page.getByTestId('import-btn').click()
    await expect(page.getByTestId('asset')).toHaveCount(1)
    await dropAsset(page, 0, 'V2')
    await page.getByTestId('mode-timeline').click()
    await expect(page.getByTestId('lane-V2').getByTestId('clip')).toHaveCount(1)

    // sağ tık: menüde Crop / Kırp görünür
    const canvas = (await page.getByTestId('timeline-canvas').boundingBox())!
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.15, { button: 'right' })
    await expect(page.getByTestId('ctx-menu')).toBeVisible()
    await expect(page.getByTestId('ctx-crop')).toContainText('Crop')
    await page.getByTestId('ctx-crop').click()
    await expect(page.getByTestId('crop-overlay')).toBeVisible()
    await expect(page.getByTestId('crop-rect')).toBeVisible()

    // alt kenar tutamacını yukarı sürükle
    const rect0 = (await page.getByTestId('crop-rect').boundingBox())!
    const hd = (await page.getByTestId('crop-hd-s').boundingBox())!
    await page.mouse.move(hd.x + hd.width / 2, hd.y + hd.height / 2)
    await page.mouse.down()
    await page.mouse.move(hd.x + hd.width / 2, hd.y + hd.height / 2 - rect0.height * 0.4, { steps: 8 })
    await page.mouse.up()
    const rect1 = (await page.getByTestId('crop-rect').boundingBox())!
    expect(rect1.height).toBeLessThan(rect0.height * 0.7)
    expect(Math.abs(rect1.y - rect0.y)).toBeLessThan(2) // üst kenar yerinde
    const cut = Number(await page.getByLabel('Alttan kırp (%)').inputValue())
    expect(cut).toBeGreaterThan(25)

    // üstten de serbestçe kırp (sol-üst köşe)
    const nw = (await page.getByTestId('crop-hd-nw').boundingBox())!
    await page.mouse.move(nw.x + nw.width / 2, nw.y + nw.height / 2)
    await page.mouse.down()
    await page.mouse.move(nw.x + 40, nw.y + 30, { steps: 5 })
    await page.mouse.up()
    expect((await page.getByTestId('crop-rect').boundingBox())!.width).toBeLessThan(rect1.width - 20)

    // Bitti: mod kapanır, klip kırpılmış kalır (Klip sekmesinde sayısal değerler)
    await page.getByTestId('crop-done').click()
    await expect(page.getByTestId('crop-overlay')).toHaveCount(0)
    await page.getByTestId('lane-V2').getByTestId('clip').click()
    await page.getByTestId('rtab-inspector').click()
    await expect(page.getByTestId('inspector')).toContainText('Kırpma H')
    // sağ tık menüsünde "Kırpmayı sıfırla" çıkar ve çalışır
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.15, { button: 'right' })
    await page.getByTestId('ctx-crop-reset').click()
    await expect(page.getByTestId('inspector')).not.toContainText('Kırpma H')
    // geri al: kırpma geri gelir
    await page.keyboard.press('Control+z')
    await expect(page.getByTestId('inspector')).toContainText('Kırpma H')

    // kaynak görünümünde sağ tık da menüyü gösterir
    await page.getByTestId('mode-source').click()
    await page.mouse.click(canvas.x + 50, canvas.y + 50, { button: 'right' })
    await expect(page.getByTestId('ctx-crop')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('ctx-menu')).toHaveCount(0)
  })

  test('tek tıkla sessizlik ve ııı/eee kesme: süre kısalır, dolgu sesleri gider, tek geri alma', async ({ page }) => {
    await boot(page)
    await importAndTranscribe(page)
    await dropAsset(page, 0, 'V2')
    await page.getByTestId('mode-timeline').click()
    await page.getByTestId('tab-transcript').click()
    await expect(page.getByTestId('cut-silence')).toBeVisible()
    const durOf = async () => (await page.getByTestId('tl-tc').textContent())!.split('/')[1].trim()
    const toSec = (t: string) => t.split(':').reduce((a, b) => a * 60 + Number(b), 0)
    const before = toSec(await durOf())
    const wordsBefore = await page.getByTestId('tw-word').allTextContents()
    expect(wordsBefore.join(' ')).toContain('ııı')
    await page.getByTestId('cut-silence').click()
    await expect(page.getByTestId('toast').filter({ hasText: 'kesim yapıldı' })).toBeVisible()
    const after = toSec(await durOf())
    expect(after).toBeLessThan(before - 5)
    const wordsAfter = await page.getByTestId('tw-word').allTextContents()
    expect(wordsAfter.join(' ')).not.toContain('ııı')
    expect(wordsAfter.join(' ')).not.toContain('eee')
    expect(wordsAfter.length).toBeLessThan(wordsBefore.length)
    expect(wordsAfter.join(' ')).toContain('Victor') // gerçek konuşma korunur
    // tek geri alma her şeyi geri getirir
    await page.keyboard.press('Control+z')
    expect(toSec(await durOf())).toBe(before)
    expect((await page.getByTestId('tw-word').allTextContents()).length).toBe(wordsBefore.length)
    // araç çubuğundaki düğme de aynı işi yapar
    await page.getByTestId('cut-silence-tb').click()
    await expect(page.getByTestId('toast').filter({ hasText: 'kesim yapıldı' }).first()).toBeVisible()
  })

  test('transkript doğruluğu: emin olunamayan kelimeler işaretlenir; tümünde düzelt + sözlüğe ekle', async ({ page }) => {
    await boot(page)
    await importAndTranscribe(page)
    await dropAsset(page, 0, 'V2')
    await page.getByTestId('mode-timeline').click()
    await page.getByTestId('tab-transcript').click()
    await expect(page.getByTestId('tw-unsure-bar')).toContainText('emin olunamadı')
    await expect(page.locator('[data-testid=tw-word].unsure').first()).toContainText('Kabukçu')
    // şüpheli kelimeye git → düzeltme kartı
    await page.getByTestId('tw-next-unsure').click()
    await expect(page.getByTestId('tw-fix')).toBeVisible()
    await expect(page.getByTestId('tw-fix-input')).toHaveValue('Kabukçu')
    await page.getByTestId('tw-fix-input').fill('Kavukçu')
    await page.getByTestId('tw-fix-all').click()
    await expect(page.getByTestId('toast').filter({ hasText: 'sözlüğe eklendi' })).toBeVisible()
    const text = (await page.getByTestId('tw-word').allTextContents()).join(' ')
    expect(text).toContain('Kavukçu')
    expect(text).toContain("Kavukçu'nun")
    expect(text).not.toContain('Kabukçu')
    await expect(page.locator('[data-testid=tw-word].fixed').first()).toBeVisible()
    await expect(page.getByTestId('tw-unsure-bar')).toHaveCount(0)
    // sözlüğe eklendi: Ayarlar'da görünür
    await page.getByTestId('settings-btn').click()
    await expect(page.getByTestId('vocab-input')).toHaveValue(/Kavukçu/)
    await page.keyboard.press('Escape')
    // arama düzeltilmiş yazımı bulur
    await page.getByTestId('tab-search').click()
    await page.getByTestId('search-input').fill('Kavukçu')
    await page.getByTestId('search-btn').click()
    await expect(page.getByTestId('result').first()).toBeVisible()
  })

  test('otomatik yükleme yok: içe aktarılan dosya kendiliğinden açılmaz; orta alan, gerçek bir tıklamaya kadar boş', async ({ page }) => {
    await boot(page)
    await page.getByTestId('import-btn').click()
    await expect(page.getByTestId('asset')).toHaveCount(1)
    await page.waitForTimeout(600)
    await expect(page.getByTestId('source-video')).toHaveCount(0) // hiçbir dosya merkezde yüklenmedi
    await expect(page.getByText('Soldaki kütüphaneden bir dosya seçin.').first()).toBeVisible()
    await expect(page.getByTestId('asset-detail')).toHaveCount(0)
    await expect(page.getByTestId('lane-I2').getByTestId('clip')).toHaveCount(0) // orta alan boş
    await expect(page.getByTestId('lane-V2').getByTestId('clip')).toHaveCount(0) // üst video boş
    await expect(page.getByTestId('lane-V1')).toHaveCount(0) // oyun ekranı izi yok
    // manuel tıklama açar
    await page.getByTestId('asset').click()
    await expect(page.getByTestId('source-video')).toBeVisible()
  })

  test('üst alana bırakılan video normal boyutunda (kırpmadan) yerleşir; yüz algılama/kırpma yok', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => (window as unknown as { __cfApi: NonNullable<Window['clipforge']> }).__cfApi.invoke('media:import', ['/kayit/video.mp4']))
    await expect(page.getByTestId('asset')).toHaveCount(1)
    await dropAsset(page, 0, 'V2')
    await expect(page.getByTestId('lane-V2').getByTestId('clip')).toHaveCount(1)
    await page.getByTestId('lane-V2').getByTestId('clip').click()
    await page.getByTestId('rtab-inspector').click()
    await expect(page.getByTestId('inspector')).not.toContainText('Kırpma H') // kendiliğinden kırpma yok
    await page.getByTestId('rtab-layout').click()
    await page.getByTestId('layer-V2').click()
    await expect(page.getByTestId('layer-detail').getByLabel('Sığdırma')).toHaveValue('contain')
  })

  test('Delete: yalnızca seçili öğe silinir — kütüphane dosyası, altyazı; kullanımdaki dosya için onay', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => (window as unknown as { __cfApi: NonNullable<Window['clipforge']> }).__cfApi.invoke('media:import', ['/k/bir.mp4', '/k/iki.mp4', '/k/uc.mp3']))
    await expect(page.getByTestId('asset')).toHaveCount(3)
    // kütüphanede seçili dosya Delete ile kaldırılır; diğerleri kalır
    await page.getByTestId('asset').nth(1).click()
    await page.keyboard.press('Delete')
    await expect(page.getByTestId('asset')).toHaveCount(2)
    await expect(page.getByTestId('asset').filter({ hasText: 'iki.mp4' })).toHaveCount(0)
    await expect(page.getByTestId('asset').filter({ hasText: 'bir.mp4' })).toHaveCount(1)
    await expect(page.getByTestId('asset').filter({ hasText: 'uc.mp3' })).toHaveCount(1)
    // zaman çizelgesinde kullanılan dosya: onay istenir; reddedilirse silinmez
    await dropAsset(page, 0, 'V2')
    await expect(page.getByTestId('lane-V2').getByTestId('clip')).toHaveCount(1)
    let asked = ''
    page.once('dialog', (d) => { asked = d.message(); void d.dismiss() })
    await page.getByTestId('asset').first().click()
    await page.keyboard.press('Delete')
    await expect.poll(() => asked).toContain('zaman çizelgesinde')
    await expect(page.getByTestId('asset')).toHaveCount(2)
    await expect(page.getByTestId('lane-V2').getByTestId('clip')).toHaveCount(1)
    // onaylanırsa dosya ve klipleri kalkar
    page.once('dialog', (d) => void d.accept())
    await page.getByTestId('asset').first().click()
    await page.keyboard.press('Delete')
    await expect(page.getByTestId('asset')).toHaveCount(1)
    await expect(page.getByTestId('lane-V2').getByTestId('clip')).toHaveCount(0)
    await expect(page.getByTestId('lane-A1').getByTestId('clip')).toHaveCount(0)
  })

  test('Delete: seçili altyazıyı siler (diğerleri kalır)', async ({ page }) => {
    await boot(page)
    await importAndTranscribe(page)
    await dropAsset(page, 0, 'V2')
    await page.getByTestId('rtab-captions').click()
    await page.getByTestId('gen-captions').click()
    const n = await page.getByTestId('cap-clip').count()
    expect(n).toBeGreaterThan(2)
    await page.getByTestId('cap-clip').nth(1).click()
    await page.keyboard.press('Delete')
    await expect(page.getByTestId('cap-clip')).toHaveCount(n - 1)
  })

  test('toplu silme: altyazılar (seçilenler / tümü), zaman çizelgesi klipleri (Ctrl+A, Tümünü sil), kütüphane (seçilenleri kaldır); hepsi geri alınır', async ({ page }) => {
    await boot(page)
    await importAndTranscribe(page)
    await dropAsset(page, 0, 'V2')
    await page.getByTestId('rtab-captions').click()
    await page.getByTestId('gen-captions').click()
    const n = await page.getByTestId('cap-clip').count()
    expect(n).toBeGreaterThan(2)
    // iki altyazı işaretle → seçilenleri sil
    await page.getByTestId('cap-check').nth(0).check()
    await page.getByTestId('cap-check').nth(1).check()
    await page.getByTestId('cap-delete-sel').click()
    await expect(page.getByTestId('cap-clip')).toHaveCount(n - 2)
    // tümünü sil (onay)
    page.once('dialog', (d) => void d.accept())
    await page.getByTestId('cap-delete-all').click()
    await expect(page.getByTestId('cap-clip')).toHaveCount(0)
    await page.keyboard.press('Control+z')
    await expect(page.getByTestId('cap-clip')).toHaveCount(n - 2)

    // zaman çizelgesi: Ctrl+A ile hepsi seçilir, Sil tek adımda kaldırır
    const clips = await page.getByTestId('clip').count()
    expect(clips).toBeGreaterThan(0)
    await page.getByTestId('select-all-clips').click()
    await expect(page.locator('.tl-clip.sel')).toHaveCount(clips)
    await page.getByTestId('delete').click()
    await expect(page.getByTestId('clip')).toHaveCount(0)
    await page.keyboard.press('Control+z')
    await expect(page.getByTestId('clip')).toHaveCount(clips)
    page.once('dialog', (d) => void d.accept())
    await page.getByTestId('clear-clips').click()
    await expect(page.getByTestId('clip')).toHaveCount(0)

    // kütüphane: hepsini işaretle, kaldır
    await page.getByTestId('asset-check-all').check()
    page.once('dialog', (d) => void d.accept())
    await page.getByTestId('asset-remove-sel').click()
    await expect(page.getByTestId('asset')).toHaveCount(0)
  })

  test('otomatik en-boy oranı: video eklenmeden dayatılmaz; video eklenince videonun boyutuna göre; elle seçince otomatik kapanır', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => (window as unknown as { __cfApi: NonNullable<Window['clipforge']> }).__cfApi.invoke('media:import', ['/k/yatay.mp4', '/k/dikey video.mp4']))
    await expect(page.getByTestId('asset')).toHaveCount(2)
    await page.getByTestId('rtab-layout').click()
    // henüz video yok: oran otomatik modda, hiçbir oran seçili/dayatılmış değil
    await expect(page.getByTestId('aspect-auto')).toHaveAttribute('aria-pressed', 'true')
    for (const a of ['9:16', '1:1', '16:9']) await expect(page.getByTestId(`aspect-${a}`)).toHaveAttribute('aria-pressed', 'false')
    // 16:9 (1920×1080) video → 16:9
    await dropAsset(page, 0, 'V2')
    await expect(page.getByTestId('aspect-info')).toContainText('(16:9)')
    await expect(page.getByTestId('aspect-info')).toContainText('1920×1080')
    // ikinci (dikey) video oranı DEĞİŞTİRMEZ: zaman çizelgesinde zaten görüntü var
    await page.getByTestId('lane-V2').getByTestId('clip').click()
    await page.keyboard.press('Delete')
    await dropAsset(page, 1, 'V2') // artık görüntü yok: yeni ilk video → 9:16
    await expect(page.getByTestId('aspect-info')).toContainText('(9:16)')
    await expect(page.getByTestId('aspect-info')).toContainText('1080×1920')
    // elle seçim otomatiği kapatır ve sonraki videolar oranı değiştirmez
    await page.getByTestId('aspect-1:1').click()
    await expect(page.getByTestId('aspect-auto')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('aspect-info')).toContainText('elle seçildi')
    await page.getByTestId('lane-V2').getByTestId('clip').click()
    await page.keyboard.press('Delete')
    await dropAsset(page, 0, 'V2')
    await expect(page.getByTestId('aspect-info')).toContainText('(1:1)')
    // "Otomatik": mevcut videonun boyutuna göre yeniden ayarlar
    await page.getByTestId('aspect-auto').click()
    await expect(page.getByTestId('aspect-info')).toContainText('(16:9)')
    await expect(page.getByTestId('aspect-auto')).toHaveAttribute('aria-pressed', 'true')
    // dışa aktarma penceresi zaman çizelgesinin oranına uygun şablonla açılır
    await page.getByTestId('export-btn').click()
    await expect(page.getByTestId('export-preset')).toHaveValue('youtube')
  })

  test('takılma düzeltmesi: katman çerçevesi kare dışına taşamaz; sürükleme bittikten sonra diğer alanlara tıklanabilir', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => (window as unknown as { __cfApi: NonNullable<Window['clipforge']> }).__cfApi.invoke('media:import', ['/k/video.mp4']))
    await expect(page.getByTestId('asset')).toHaveCount(1)
    await dropAsset(page, 0, 'V2')
    await page.getByTestId('mode-timeline').click()
    await page.getByTestId('rtab-layout').click()
    await page.getByTestId('layer-V2').click()
    // çerçeveyi 'çok büyütmeye' çalış: sağ-alt tutamacı ekranın çok dışına sürükle
    const hd = (await page.getByTestId('hd-V2-se').boundingBox())!
    await page.mouse.move(hd.x + hd.width / 2, hd.y + hd.height / 2)
    await page.mouse.down()
    await page.mouse.move(hd.x + 900, hd.y + 500, { steps: 6 })
    await page.mouse.up()
    const r = await page.getByTestId('ly-V2').evaluate((el) => { const s = (el as HTMLElement).style; return { l: parseFloat(s.left), t: parseFloat(s.top), w: parseFloat(s.width), h: parseFloat(s.height) } })
    expect(r.l).toBeGreaterThanOrEqual(0)
    expect(r.t).toBeGreaterThanOrEqual(0)
    expect(r.l + r.w).toBeLessThanOrEqual(100.01)
    expect(r.t + r.h).toBeLessThanOrEqual(100.01)
    // sayısal giriş de sınırlanır
    await page.getByTestId('layer-detail').getByLabel('Genişlik').fill('300')
    await expect(page.getByTestId('layer-detail').getByLabel('Genişlik')).toHaveValue('100')
    // fare düğmesi bırakılmışken (bırakma olayı kaçırılmış gibi) hareket katmanı sürüklemez
    const before = await page.getByTestId('ly-V2').evaluate((el) => (el as HTMLElement).style.left + (el as HTMLElement).style.top)
    await page.mouse.move(400, 300)
    await page.mouse.move(700, 500, { steps: 5 })
    expect(await page.getByTestId('ly-V2').evaluate((el) => (el as HTMLElement).style.left + (el as HTMLElement).style.top)).toBe(before)
    // boş alanlara (kütüphane, sekmeler) tıklamak çalışır
    await page.getByTestId('asset').click()
    await expect(page.getByTestId('mode-source')).toHaveClass(/active/)
    await page.getByTestId('tab-search').click()
    await expect(page.getByTestId('search-input')).toBeVisible()
  })
})
