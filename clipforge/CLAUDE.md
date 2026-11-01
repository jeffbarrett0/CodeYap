# ClipForge — yapay zekâ ile video editleme (Claude Code için)

Bu klasörde Claude Code çalıştırıldığında videolar **komut satırı** (`npm run cli -- …`) ile editlenir. Uygulamanın arayüzüyle aynı proje dosyasını (`.clipforge`) kullanır; sonra uygulamada açılıp elle devam edilebilir.

## Hazırlık (bir kez)
`npm install` → `npm run build` (CLI `out/main/cli.js` olarak derlenir; kod değişirse yeniden derleyin). Whisper yolu/modeli uygulamanın Ayarlar'ındakiyle **aynıdır** (aynı kullanıcı verisi klasörü); uygulamada bir kez transkripsiyon çalışıyorsa CLI'da da çalışır.

## Komutlar (hepsi JSON döndürür; `npm run cli -- help`)
`new` · `import --add` · `transcribe` · `transcript` · `search` · `add-clip` · `new-clip-project` · `silence` · `cut` · `captions` · `delete-lane` · `frame` · `show` · `export` · `presets`

Tipik akış: `new p.clipforge` → `import p.clipforge video.mp4 --add` → `transcribe p.clipforge` → `transcript p.clipforge` (içeriği OKU) → `silence` → `captions` → `frame` (bir kareye bakıp doğrula) → `export p.clipforge --out cikti.mp4 --preset shorts`.
Aramadan klip: `search p.clipforge "söz"` → `new-clip-project p.clipforge --query "söz" --pick 1 --sec 25 --out klip.clipforge` (ana proje değişmez).

## Çalışma kuralları (kullanıcının kalıcı kuralları)
- **Çağrı/yönlendirme metni üretme ya da ekleme:** "videoyu beğenip takip etmeyi unutmayın", "videonun tamamı … kanalında" gibi hiçbir yazı, altyazı ya da katman olmayacak.
- **Transkript eksiksiz ve okunur** olmalı; belirsiz kelimeleri uydurma, işaretle/sor.
- **Kurguyu kullanıcı belirler.** Ne kesileceği, üst/alt yerleşimler, kapanış yazıları kullanıcının kararıdır; istenmedikçe yalnızca öneri sun. Emin olmadığında önce sor.
- Yıkıcı işlemden önce yedek vardır (`<proje>.bak`); yine de kaynak videoyu asla değiştirme/silme. Dışa aktarmada telif hatırlatmasını anımsat.
- Her yeni video için aynı kurallar geçerlidir; belirli kişi/konu adı varsayma.

## Sınırlar
Arayüzdeki görsel ince ayarlar (katman konum/boyutu, metin katmanı, kırpma) CLI'da henüz yok; proje JSON'u elle düzenlenebilir ama önce `.bak` alın. Ayrı oyun/konuşma ses akışı olan videolarda Ses katmanına yalnızca ilk akış girer.
