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
})
