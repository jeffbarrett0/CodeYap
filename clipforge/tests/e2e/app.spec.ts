import { expect, test, type Page } from '@playwright/test'

async function boot(page: Page) {
  await page.goto('/')
  await expect(page.locator('.brand')).toContainText('ClipForge')
}

async function importAndTranscribe(page: Page) {
  await page.getByTestId('import-btn').click()
  await expect(page.getByTestId('asset')).toHaveCount(1)
  await expect(page.getByTestId('asset-detail')).toContainText('OBS 30.1.2')
  await expect(page.getByTestId('asset-detail')).toContainText('3 ses track')
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
    await expect(page.getByTestId('lane-V1').getByTestId('clip')).toHaveCount(1)
    await expect(page.getByTestId('lane-A1').getByTestId('clip')).toHaveCount(1)
    await expect(page.getByTestId('lane-A2').getByTestId('clip')).toHaveCount(1)

    // Kaynak zaman damgası meta verisi denetçide
    await page.getByTestId('lane-V1').getByTestId('clip').click()
    await expect(page.getByTestId('inspector')).toContainText('Arama')
    await expect(page.getByTestId('inspector')).toContainText('"Victor Nelson ile ilgili konuştuğum yer"')

    // 9:16 varsayılan
    await expect(page.getByTestId('aspect-9:16')).toHaveCount(0) // sağ panel Klip sekmesinde
    await page.getByTestId('rtab-layout').click()
    await expect(page.getByTestId('aspect-9:16')).toHaveAttribute('aria-pressed', 'true')

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

    const v1 = page.getByTestId('lane-V1').getByTestId('clip')
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

    // Delete bağlı klipleri birlikte siler
    await v1.first().click()
    await page.keyboard.press('Delete')
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
    const v1 = page.getByTestId('lane-V1').getByTestId('clip').first()
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

  test('sohbet günlüğü tanınmazsa açık hata ve beklenen şema gösterilir; öneri adayları listelenir', async ({ page }) => {
    await boot(page)
    await importAndTranscribe(page)
    await page.getByTestId('tab-suggest').click()
    await page.evaluate(() => ((window as unknown as { __mock: { nextChat: string } }).__mock.nextChat = 'bad'))
    await page.getByTestId('chat-btn').click()
    await expect(page.getByTestId('chat-error')).toContainText('time,user,message')
    await page.evaluate(() => ((window as unknown as { __mock: { nextChat?: string } }).__mock.nextChat = undefined))
    await page.getByTestId('chat-btn').click()
    await expect(page.getByText('mesaj ·')).toBeVisible()
    await page.getByTestId('suggest-btn').click()
    await expect(page.getByTestId('candidate').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('candidate').first()).toContainText(/Ses seviyesi|Sohbet hızı/)
  })

  test('transkript yokken arama yönlendirir; ayarlar kaydedilir; görev paneli', async ({ page }) => {
    await boot(page)
    await page.getByTestId('import-btn').click()
    await expect(page.getByTestId('asset')).toHaveCount(1)
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

    // varsayılan düzen: orta boş görsel yeri, yüz, alt görsel, oyun ekranı; HAZIR YAZI YOK
    for (const id of ['I2', 'V2', 'I1', 'V1']) await expect(page.getByTestId(`layer-${id}`)).toBeVisible()
    await expect(page.getByTestId('layer-list')).not.toContainText('Davet')
    await expect(page.getByTestId('lane-I2').getByTestId('clip')).toHaveCount(0)
    // Yüz/kamera kaynağı olmayan bir klipte oyun ekranı katmanı otomatik açılır (aksi halde görüntü hiç görünmezdi)
    await expect(page.getByTestId('ly-V1')).toBeVisible()
    await page.getByTestId('eye-V1').click() // gizle
    await expect(page.getByTestId('ly-V1')).toHaveCount(0)
    await page.getByTestId('eye-V1').click() // göster
    await expect(page.getByTestId('ly-V1')).toBeVisible()

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

    // şablon olarak kaydet → yeni projede uygula
    await page.getByTestId('tpl-name').fill('Benim düzenim')
    await page.getByTestId('tpl-save').click()
    await expect(page.getByTestId('tpl-select')).toContainText('Benim düzenim')
    await page.getByTestId('tpl-select').selectOption({ label: 'Benim düzenim' })
    await expect(page.getByTestId('tpl-delete')).toBeVisible()
    await page.getByTestId('tpl-select').selectOption({ index: 0 })
    await page.getByTestId('tpl-apply').click()
    await page.getByTestId('layer-V2').click()
    await expect(page.getByTestId('layer-detail').getByLabel('Yükseklik')).not.toHaveValue('30')
    await page.getByTestId('tpl-select').selectOption({ label: 'Benim düzenim' })
    await page.getByTestId('tpl-apply').click()
    await page.getByTestId('layer-V2').click()
    await expect(page.getByTestId('layer-detail').getByLabel('Yükseklik')).toHaveValue(/^(2[0-9]|3[0-9])/)
  })

  test('ayrı kaynaklar: ekran, oyun sesi, konuşma ve görsel ayrı içe aktarılır; ize eklenir; bağlı kaynaklarla klip çıkar', async ({ page }) => {
    await boot(page)
    // üç ayrı dosya + görsel (dosya diyaloğu yerine doğrudan içe aktarma)
    await page.evaluate(() => (window as unknown as { __cfApi: NonNullable<Window['clipforge']> }).__cfApi.invoke('media:import', ['/kayit/ekran kaydi.mp4', '/kayit/oyun sesi.wav', '/kayit/konusma.wav', '/kayit/konu gorseli.png']))
    await expect(page.getByTestId('asset')).toHaveCount(4)
    await expect(page.getByTestId('asset').nth(3)).toContainText('Görsel')
    await expect(page.getByTestId('asset').nth(1)).toContainText('Ses')

    // görseli önce orta alana (varsayılan ilk görsel katmanı), sonra alt görsel katmanına ekle (düğmeyle)
    await page.getByTestId('asset').nth(3).click()
    await expect(page.getByTestId('target-track')).toContainText('Orta alan')
    await page.getByTestId('add-at-playhead').click()
    await expect(page.getByTestId('lane-I2').getByTestId('clip')).toHaveCount(1)
    await page.getByTestId('target-track').selectOption({ label: 'Konu görseli (I1)' })
    await page.getByTestId('add-at-playhead').click()
    await expect(page.getByTestId('lane-I1').getByTestId('clip')).toHaveCount(1)

    // oyun sesini A1'e sürükle-bırak
    const game = page.getByTestId('asset').nth(1)
    const lane = page.getByTestId('lane-A1')
    await game.dragTo(lane)
    await expect(page.getByTestId('lane-A1').getByTestId('clip')).toHaveCount(1)
    // görsel ses izine bırakılamaz: uyarı verir
    await page.getByTestId('asset').nth(3).dragTo(page.getByTestId('lane-A2'))
    await expect(page.getByTestId('toast').filter({ hasText: 'Görsel katmanına yalnızca' }).or(page.getByTestId('toast').filter({ hasText: 'ses akışı yok' }))).toBeVisible()
    await expect(page.getByTestId('lane-A2').getByTestId('clip')).toHaveCount(0)

    // konuşma dosyası: rol + bağlı kaynaklar
    await page.getByTestId('asset').nth(2).click()
    await page.getByTestId('role-select').selectOption('voice')
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
    await expect(page.getByTestId('lane-V1').getByTestId('clip')).toHaveCount(1)
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
    const v1 = page.getByTestId('lane-V1').getByTestId('clip')
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

  test('video katmanına eklenen videonun sesi de ses izine eklenir (sessiz kalmaz)', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => (window as unknown as { __cfApi: NonNullable<Window['clipforge']> }).__cfApi.invoke('media:import', ['/kayit/paylasilan video.mp4']))
    await expect(page.getByTestId('asset')).toHaveCount(1)
    await page.getByTestId('asset').click()
    await page.getByTestId('target-track').selectOption({ label: 'Yüz (webcam) (V2)' })
    await expect(page.getByTestId('with-audio')).toBeChecked()
    await page.getByTestId('add-at-playhead').click()
    await expect(page.getByTestId('lane-V2').getByTestId('clip')).toHaveCount(1)
    await expect(page.getByTestId('lane-A1').getByTestId('clip')).toHaveCount(1) // sesi A1'e geldi
    await expect(page.getByTestId('toast').filter({ hasText: 'sesiyle birlikte' })).toBeVisible()
    // sesi istemeyen: işareti kaldır
    await page.getByTestId('with-audio').uncheck()
    await page.getByTestId('add-at-end').click()
    await expect(page.getByTestId('lane-V2').getByTestId('clip')).toHaveCount(2)
    await expect(page.getByTestId('lane-A1').getByTestId('clip')).toHaveCount(1)
  })
})
