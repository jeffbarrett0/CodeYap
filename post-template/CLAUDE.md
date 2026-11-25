# Post sablonu: kalici kurallar

Kullanici (berkalog) Twitter'da paylastigi seyleri Instagram Reels, TikTok ve YouTube Shorts icin 9:16 videoya cevirir.
Her gonderi icin kullanici metin + video verir; sen sablonla birlestirip MP4 uretirsin.

## Akis
1. `index.html` icindeki `CONFIG` (text, video) guncellenir. Profil foto: `avatar.webp`, isim `berk`, kullanici adi `@berkalog`.
2. `./build.sh` hepsini yapar: `make-post.sh` (sablon render + klip -> `post.mp4`), `add-button.sh` (YouTube butonu -> `post-btn.mp4`), `add-outro.sh` (outro -> `post-final.mp4`).
   Konumlar `render.js` ile `layout.json`'a yazilir; buton ve video yeri elle hesaplanmaz.

## Degismez kurallar
- **Guvenli alan:** ust 230px, alt 430px, sag/sol 130px bos. Reels/TikTok/Shorts arayuzu bu bolgeleri kapatir. Icerik ortada, kucuk yazi (32px).
- **Outro:** `outro.mp4` HER gonderinin en sonuna eklenir (kullanici istedi).
- **YouTube butonu:** `youtube-button.mp4` (yesil perde, 4K) -> `prep-button.sh` ile yesili silinip `youtube-button.mov` (640px genislik) yapilir.
  Video basladiktan **1. saniyede** oynar, sonra **her 30 saniyede** bir (1, 31, 61...). 5 sn'lik animasyon sigmiyorsa eklenmez.
  Buton videonun **ustune degil ALTINA** gelir (`.btn-slot`), videoyu kapatmaz. Boyutu `--btn-w` ile ayarlanir (su an 640px).
  Butonun sesi videonun ortalama ses seviyesinden (LUFS) **6 dB KISIK** olacak sekilde otomatik ayarlanir (`QUIETER_DB`); sabit ses seviyesi KULLANMA.
  Buton outro'da calmaz (outro eklenmeden once uygulanir).
- Cikti dosyasi kullaniciya `SendUserFile` ile gonderilir, sonra commit + push edilir.
