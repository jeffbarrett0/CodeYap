# Post sablonu: kalici kurallar

Kullanici (berkalog) Twitter'da paylastigi seyleri Instagram Reels, TikTok ve YouTube Shorts icin 9:16 videoya cevirir.
Her gonderi icin kullanici metin + video verir; sen sablonla birlestirip MP4 uretirsin.

## Akis
1. `index.html` icindeki `CONFIG` (text, video) guncellenir. Profil foto: `avatar.webp`, isim `berk`, kullanici adi `@berkalog`.
2. `?render=1` ile sablon ekran goruntusu alinip video alana ffmpeg ile yerlestirilir -> `post.mp4` (1080x1920, 30fps).
3. `./build.sh` calistirilir: `add-button.sh` (YouTube butonu) sonra `add-outro.sh` (outro) -> `post-final.mp4`.

## Degismez kurallar
- **Guvenli alan:** ust 230px, alt 430px, sag/sol 130px bos. Reels/TikTok/Shorts arayuzu bu bolgeleri kapatir. Icerik ortada, kucuk yazi (32px).
- **Outro:** `outro.mp4` HER gonderinin en sonuna eklenir (kullanici istedi).
- **YouTube butonu:** `youtube-button.mp4` (yesil perde, 4K) -> `prep-button.sh` ile yesili silinip `youtube-button.mov` yapilir.
  Video basladiktan **3. saniyede** oynar, sonra **her 30 saniyede** bir (3, 33, 63...). 5 sn'lik animasyon sigmiyorsa eklenmez.
  Butonun sesi videonun kendi ses seviyesine (LUFS) gore otomatik ayarlanir; sabit ses seviyesi KULLANMA.
  Buton outro'da calmaz (outro eklenmeden once uygulanir).
- Cikti dosyasi kullaniciya `SendUserFile` ile gonderilir, sonra commit + push edilir.
