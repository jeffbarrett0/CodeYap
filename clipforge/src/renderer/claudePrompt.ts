/**
 * Claude Code'a yapıştırılacak hazır komut: internetten güncel veri araştırması gerektiren zenginleştirme (harita/uçak, rakam,
 * gol krallığı…) uygulamanın içinden yapılamaz; Claude Code bu klasörde `story` komutlarıyla yapar.
 */
export function claudeEditPrompt(videoPath: string, projectDir?: string): string {
  return [
    `clipforge klasöründe çalış. Şu videoyu zenginleştir: ${videoPath}`,
    projectDir ? `(Proje klasörü: ${projectDir})` : '',
    '',
    '- Önce transkripsiyonu yap ve konuşmamı baştan sona oku (story plan --blank).',
    '- Konuştuğum yerlere göre arkaya hareketli sahneler çiz: yer geçerse harita/3D küre (A\'dan B\'ye gidiyorsam uçak rotası), takım/oyuncu geçerse takım kartı ya da sıralama, rakam geçerse rakam kartı, pozisyon anlatırsam futbol sahası canlandırması.',
    '- İstatistik/sıralama/künye gibi veriyi hafızandan değil, internetten GÜNCEL olarak al; kaynağını yaz.',
    '- Yüzüm sahne varken köşede küçük, sahne yokken tam kare görünsün.',
    '- Önce planı bana göster, onayımdan sonra çiz.'
  ]
    .filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== ''))
    .join('\n')
}

/**
 * Vlog projesi için Claude Code komutu ("Claude ile edit yap"): vlogu (10–30 dk) temizler ve ZENGİNLEŞTİRİR — sessizlik/dolgu kesimi,
 * konuşulan yerlere 2B/3B harita-küre rotaları, başlık/grafik kartları, zoom'lar, ses giriş/çıkışı ve ses efektleri. Claude Code bu klasörde
 * `clipforge` komutlarıyla yapar (uygulama Claude'u çağıramaz; komut panoya kopyalanır).
 */
export function claudeVlogPrompt(projectPath: string): string {
  return [
    `clipforge klasöründe çalış. Şu vlogu (10–30 dk olabilir) edit et: ${projectPath}`,
    '',
    'SAHNE SENİN: tüm yaratıcılık sende. Bana öneri sunma, onay isteme, "şunu da ekleyebilirim" deme; neyi nasıl yapacağına KENDİN karar ver ve hepsini kendiliğinden uygula. Videoyu olabildiğince zengin, akıcı ve etkileyici yap — şov yap. Beğenmediğimi sonra söylerim, sen düzeltirsin.',
    '',
    '1. Transkript yoksa çıkar (transcribe), konuşmamı baştan sona OKU (transcript): akış, bölümler, vurgulu/heyecanlı anlar, yerler, sayılar, hikâyenin temposu.',
    '2. Temizle: silence (sessizlik + ııı/eee), show ile boşluk kalmadığını doğrula. Kesimden sonra zamanlar kayar: sonraki adımlarda script ile KURGU SONRASI zamanları kullan.',
    '3. Zenginleştir — araç çantan (hepsini, uygun gördüğün sıklıkta ve kombinasyonda kullan):',
    '   • graphic --type globe|map (3B küre / 2B harita + rota, --from/--to), --type title (bölüm/gün/konu başlığı), --type chart; ayrıca graphic --scene \'{...}\' ile her hikâye sahnesi: stats (rakam kartı), list, timeline, quote, person (isim bandı), place, teamcard, leaderboard, compare (biçimler: story schema). Bir b-roll klasörü varsa broll-plan/overlay.',
    '   • zoom --at sn --dur 2-4 --to 1.1-1.2 [--focus x,y] (yavaş yakınlaşma; vurgu, itiraf, espri, yeni konu girişi), fade --in 0.6 --out 1.5 (başta giriş, sonda çıkış), sfx --type whoosh|swish|pop|ding|riser --at sn --vol 0.5 (grafik girişleri, vurgular, geçişler).',
    '   • captions (gerekli görürsen), ritim: sıkıcı yeri hareketlendir, güçlü anı vurgula, nefes aldır.',
    '4. Kendi disiplinin: yalnızca KONUŞULAN yer/rakam/olayı görselleştir, bilgi UYDURMA (güncel istatistik gerekiyorsa web\'den doğrula); konuşma her zaman net duyulsun; çağrı/yönlendirme (abone ol, beğen…) metni ASLA ekleme; kaynak videoya dokunma (yedek .bak).',
    '5. Grafik/kart anlarının karesine frame ile bak, taşma/çakışma varsa düzelt. Zoom ve ses efektleri dışa aktarmada duyulup görülür.',
    '6. Bitince ne yaptığını zamanlarıyla kısaca listele (öneri değil, rapor). Dışa aktarmayı ben isteyince yap.'
  ].join('\n')
}
