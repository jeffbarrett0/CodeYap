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
 * Vlog projesi için Claude Code komutu ("Claude ile edit yap"): sessizlikleri/ııı'ları keser, boşlukları kapatır, konuşmayı okuyup
 * yolculuk/yer geçen yerlere (Belçika'dan Paris'e…) 2B/3B rota grafiği koyar. Claude Code bu klasörde `clipforge` komutlarıyla yapar.
 */
export function claudeVlogPrompt(projectPath: string): string {
  return [
    `clipforge klasöründe çalış. Şu vlog projesini edit et: ${projectPath}`,
    '',
    '1. Transkript yoksa çıkar (transcribe), sonra konuşmamı baştan sona oku (transcript).',
    '2. Sessizlikleri ve ııı/eee gibi dolgu seslerini kes (silence); boşluk kalmadığını show ile doğrula (boşlukları kapat).',
    '3. script ile konuştuğum yerleri bul. "Belçika\'dan Paris\'e gidiyorum" gibi yolculuk cümlelerinde, o cümlenin söylendiği ana rota grafiği koy: graphic --type globe (3B dönen küre + rota) ya da --type map (2B harita + rota), --from/--to ile, yaklaşık 4 sn. Tek yer anılırsa o yere yakınlaşan harita. Konuşulmayan yeri/rotayı uydurma.',
    '4. Konuşmadan çıkan başka görselleştirme fırsatları (başlık, rakam) olursa önce bana öner, kendiliğinden ekleme.',
    '5. Grafiklerin olduğu anların karesine frame ile bak, taşma/çakışma var mı kontrol et.',
    '6. Bitince yaptıklarını listele (zaman + ne eklendi/kesildi). Yedek (.bak) alınır; kaynak videoyu değiştirme. Çağrı/yönlendirme metni ekleme. Dışa aktarmayı ben isteyince yap.'
  ].join('\n')
}
