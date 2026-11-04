# ClipForge — yapay zekâ ile video editleme (Claude Code için)

Bu klasörde Claude Code çalıştırıldığında videolar **komut satırı** (`npm run cli -- …`) ile editlenir. Uygulamanın arayüzüyle aynı proje dosyasını (`.clipforge`) kullanır; sonra uygulamada açılıp elle devam edilebilir.

## Hazırlık (bir kez)
`npm install` → `npm run build` (CLI `out/main/cli.js` olarak derlenir; kod değişirse yeniden derleyin). Whisper yolu/modeli uygulamanın Ayarlar'ındakiyle **aynıdır** (aynı kullanıcı verisi klasörü); uygulamada bir kez transkripsiyon çalışıyorsa CLI'da da çalışır.

## Komutlar (hepsi JSON döndürür; `npm run cli -- help`)
`new` · `import --add` · `transcribe` · `transcript` · `script` · `search` · `add-clip` · `new-clip-project` · `silence` · `cut` · `overlay` · `broll-plan` · `graphic` · `captions` · `delete-lane` · `frame` · `show` · `export` · `presets`

Tipik akış: `new p.clipforge` → `import p.clipforge video.mp4 --add` → `transcribe p.clipforge` → `transcript p.clipforge` (içeriği OKU) → `silence` → `captions` → `frame` (bir kareye bakıp doğrula) → `export p.clipforge --out cikti.mp4 --preset shorts`.
Aramadan klip: `search p.clipforge "söz"` → `new-clip-project p.clipforge --query "söz" --pick 1 --sec 25 --out klip.clipforge` (ana proje değişmez).

## Auto Kick (yayın kaydı → tam video)
Arayüzde **kayıt seçilir seçilmez** başlar (başlat düğmesi yok; genel ilerleme çubuğu %100'e dolar). CLI: `auto-kick "<yayın.mkv>" [--out klasör] [--quality fast|high]`: içe aktar → transkripsiyon → sessizleri kırp → `<ad> - full.mp4` + `<ad>.clipforge` (`AutoKick/<ad>/`). Uzun sürer (2 saatlik yayın = saatler); bitmeden terminali kapatma, yeniden çalıştırırsan kalan aşamalardan sürer. Klip aşaması henüz yok; kullanıcı kurallarını verince eklenecek. Arayüzde: üst çubuk → **Auto Kick**.

### Konu klibi ("Osimhen'le ilgili klip çıkar")
`topic-clips <AutoKick klasörü|proje> --topic "Osimhen" [--max-sec 60] [--min-sec 8] [--gap 25]` → transkriptte konunun geçtiği yerleri bulur (Türkçe ek ve küçük yazım hatalarına dayanıklı), yakın geçişleri tek blokta toplar, cümle sınırlarına oturtup **aday önerir** (zaman, süre, geçiş sayısı, metin). Kullanıcı seçince `--pick 1,3` (ya da `--all`) ile her aday için **bağımsız klip projesi** üretilir (`<AutoKick projesi>-klipler/`); Auto Kick projesine dokunulmaz. Adayları kullanıcıya göster, seçtirmeden üretme. **Klibin düzeni** (kullanıcının yüzü üstte, fotoğraf altta, sıralama…) kullanıcı anlatınca eklenecek; şimdilik klip yalnızca kesilmiş, sessizsiz çizelge aralığıdır. Arayüzde: Auto Kick penceresi → **Konu klibi**.

## YouTube zaman damgaları (bölüm listesi)
Kullanıcı "videonun altına timestamp/bölüm zamanları" isterse: düzenleme **bittikten sonra** (sessizler kesilmiş, boşluklar kapanmış) `chapters <proje> [--out zaman-damgalari.txt] [--ai] [--density low|medium|high]`. Zamanlar projenin zaman çizelgesine göredir = dışa aktarılan videoyla aynı. Çıktı kullanıcının istediği biçimdedir: `Saniyeler:`, boş satır, `00:00:00 - Giriş`, `00:12:42 - Ederson` (başlıklar konuşulan kişi/takım adları, birden çoksa virgülle; yaklaşık her 2–7 dk bir bölüm, `--density`). YouTube kuralları: 0'dan başlar, ≥3 bölüm, her bölüm ≥10 sn. Listeyi kullanıcıya göster, başlıkları istenirse düzelt; konuşulmayanı uydurma, çağrı/yönlendirme metni yazma. Önce transkript olmalı. Arayüzde: sağ panel → **Zaman damgası**; Dışa aktar penceresinde "YouTube zaman damgalarını da yaz" kutusu; Auto Kick tam videonun yanına `… - zaman damgaları.txt` yazar.

## Video önerileri (yayından klip olarak paylaşılabilecek bölümler)
Kullanıcı "bu yayından hangi bölümleri klip yapabilirim" derse: kayıt içe aktarılıp transkribe edilmiş olmalı, sonra `ideas <proje> [--max 10]` çalıştır. Çıktı **2–30 dakikalık** bölümlerdir: `headline` ("Batrakov hakkında konuşmuşsun"), süre, kaç kez anıldığı, zaman aralığı. Özel isimler (büyük harfle yazılmış, bir bölümde yoğun anılan adlar) öncelikli, sonra konu değişimine göre bölümler. Kısa, düz sun: "Şu isim hakkında konuşmuşsun · 6 dk · 1:12:00–1:18:00". Kullanıcı isterse bölümün metnini `transcript <proje> --from --to` ile okuyup YouTube başlığı öner (≤70 karakter, abartısız; yalnızca konuşulanlara dayan; çağrı/yönlendirme metni yazma). Onayladığı bölümden `add-clip --start --end` ya da `new-clip-project` ile klip/proje çıkar. Arayüzde: sağ panel → **Öneriler** ("Klip yap" düğmesi; Ayarlar → Başlık önerileri'nden anahtar girilirse YouTube başlığı da yazılır).

## Vlog akışı (otomatik kurgu)
Sıra önemlidir: **önce kesim, sonra yerleştirme** (kesimden sonra zamanlar kayar).
1. `new` → `import <proje> vlog.mp4 --add --layer V3` — ana görüntü EN ALT katmana (V3). **Katman sırası: V1 en üstte çizilir**, V3 en altta; b-roll V2'ye, grafikler V1'e gider (üstteki alttakini kapatır; konuşma sesi Ses katmanında kesintisiz sürer).
2. `transcribe` → `silence` (sessizlik + ııı/eee kesimi).
3. `script` — kurgu SONRASI zamanlarla cümleler ve cümlede geçen yerler (`places`). Buradan b-roll ve grafik fırsatlarını **öner** (kullanıcı onaylamadan uygulama).
4. B-roll: kullanıcı klasör verirse `broll-plan --folder K` (dosya adındaki kelimeleri konuşmada arar; yazmaz) → onaydan sonra `--apply` ya da `overlay --file F --at sn --dur 3.5`.
5. Grafik (konuşulan yeri çizerek anlat): `graphic --type globe --to "Türkiye" --from "Londra" --at 12.5 --dur 4 --layer V1` (3D dönen küre + rota), `--type map` (2D harita, yakınlaşma + rota), `--type title --text "3. GÜN"`, `--type chart --data "A:10,B:20"`. Çıktı tam kare bir videodur, çizelgede normal klip gibi düzenlenir. Yer adı ülke/ana şehir ya da `boylam,enlem`.
6. İstenirse `captions --style boxed-highlight`.
7. `frame --at sn --out k.jpg` ile bak (ör. grafik anında), sonra `export`.

## Çalışma kuralları (kullanıcının kalıcı kuralları)
- **Çağrı/yönlendirme metni üretme ya da ekleme:** "videoyu beğenip takip etmeyi unutmayın", "videonun tamamı … kanalında" gibi hiçbir yazı, altyazı ya da katman olmayacak.
- **Transkript eksiksiz ve okunur** olmalı; belirsiz kelimeleri uydurma, işaretle/sor.
- **Kurguyu kullanıcı belirler.** Ne kesileceği, üst/alt yerleşimler, kapanış yazıları kullanıcının kararıdır; istenmedikçe yalnızca öneri sun. Emin olmadığında önce sor.
- Yıkıcı işlemden önce yedek vardır (`<proje>.bak`); yine de kaynak videoyu asla değiştirme/silme. Dışa aktarmada telif hatırlatmasını anımsat.
- Her yeni video için aynı kurallar geçerlidir; belirli kişi/konu adı varsayma.

## Sınırlar
- **Grafikler:** 2D/3D "çizim" sahneleri (harita, dönen küre, başlık, grafik) hazır şablonlardır; serbest 3D model/karakter ya da fotogerçekçi sahne üretilemez. Harita verisi 1:110m (küçük adalar/şehir sınırları yok); şehirler için ~50 ana şehir tanımlı, diğerleri `boylam,enlem` ile verilir. Yazı tipi Impact (Windows/macOS'ta var).
Arayüzdeki görsel ince ayarlar (katman konum/boyutu, metin katmanı, kırpma) CLI'da henüz yok; proje JSON'u elle düzenlenebilir ama önce `.bak` alın. Ayrı oyun/konuşma ses akışı olan videolarda Ses katmanına yalnızca ilk akış girer.
