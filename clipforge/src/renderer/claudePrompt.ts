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
    `clipforge klasöründe çalış. Şu vlogu (10–30 dk olabilir) temizleyip ZENGİNLEŞTİREREK edit et: ${projectPath}`,
    '',
    '1. Transkript yoksa çıkar (transcribe), sonra konuşmamı baştan sona OKU (transcript): akışı, bölümleri, vurgulu/heyecanlı anları, anılan yerleri, sayıları anla.',
    '2. Temizle: sessizlikleri ve ııı/eee dolgularını kes (silence); boşluk kalmadığını show ile doğrula. Kesimden sonra zamanlar kayar: sonraki adımlarda script ile KURGU SONRASI zamanları kullan.',
    '3. Zenginleştir (editi sana bıraktım, doğrudan uygula; yedek .bak alınır, kaynak videoya dokunma):',
    '   • Görsel: konuşulan yer/yolculuk için graphic --type globe (3B dönen küre + rota) ya da map (2B harita + rota) (--from/--to; tek yer ise yakınlaşan harita); bölüm/gün/konu başlığı için --type title; konuştuğum sayı/karşılaştırma için --type chart (yalnızca KONUŞULAN değerlerle). İçerik el verdiği kadar sık koy (kabaca her 30–90 sn), her grafik 3–5 sn, üst üste bindirme. Konuşulmayan yer/rakam/rota UYDURMA.',
    '   • Zoom: vurgulu cümlelerde ve yeni konuya girişte zoom --at --dur 2-4 --to 1.1-1.2 (yavaş yakınlaşma); yaklaşık 20–45 sn arayla, art arda yığma, aralarda normal görüntü kalsın.',
    '   • Ses: fade --in 0.6 --out 1.5 (başta girişi, sonda çıkışı); grafik başlarken ona 0.1 sn kala sfx --type whoosh, vurgu anlarına pop/ding, büyük bölüm geçişine riser (--vol 0.4-0.6; konuşma net duyulmalı, abartma).',
    '   • Bir b-roll klasörü verdiysem broll-plan ile konuşmayla eşleştir.',
    '4. Grafiklerin olduğu anların karesine frame ile bak (taşma/çakışma var mı). Zoom ve ses efektleri dışa aktarmada duyulup görülür; arayüz önizlemesinde görünmeyebilir.',
    '5. Bitince yaptıklarını zamanlarıyla listele (ne eklendi/kesildi); beğenmediklerimi geri alabileyim. Çağrı/yönlendirme metni ekleme. Dışa aktarmayı ben isteyince yap.'
  ].join('\n')
}
