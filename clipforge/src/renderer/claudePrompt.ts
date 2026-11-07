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
