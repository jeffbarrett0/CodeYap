# ClipForge — yapay zekâ ile video editleme (Claude Code için)

Bu klasörde Claude Code çalıştırıldığında videolar **komut satırı** (`npm run cli -- …`) ile editlenir. Uygulamanın arayüzüyle aynı proje dosyasını (`.clipforge`) kullanır; sonra uygulamada açılıp elle devam edilebilir.

## Hazırlık (bir kez)
`npm install` → `npm run build` (CLI `out/main/cli.js` olarak derlenir; kod değişirse yeniden derleyin). Whisper yolu/modeli uygulamanın Ayarlar'ındakiyle **aynıdır** (aynı kullanıcı verisi klasörü); uygulamada bir kez transkripsiyon çalışıyorsa CLI'da da çalışır.

## Komutlar (hepsi JSON döndürür; `npm run cli -- help`)
`new` · `import --add` · `transcribe` · `transcript` · `script` · `search` · `add-clip` · `new-clip-project` · `silence` · `cut` · `overlay` · `broll-plan` · `graphic` · `captions` · `delete-lane` · `frame` · `show` · `export` · `presets`

Tipik akış: `new p.clipforge` → `import p.clipforge video.mp4 --add` → `transcribe p.clipforge` → `transcript p.clipforge` (içeriği OKU) → `silence` → `captions` → `frame` (bir kareye bakıp doğrula) → `export p.clipforge --out cikti.mp4 --preset shorts`.
Aramadan klip: `search p.clipforge "söz"` → `new-clip-project p.clipforge --query "söz" --pick 1 --sec 25 --out klip.clipforge` (ana proje değişmez).

## Auto Kick (yayın kaydı → tam video)
`auto-kick "<yayın.mkv>" [--out klasör] [--quality fast|high]`: içe aktar → transkripsiyon → sessizleri kırp → `<ad> - full.mp4` + `<ad>.clipforge` (`AutoKick/<ad>/`). Uzun sürer (2 saatlik yayın = saatler); bitmeden terminali kapatma, yeniden çalıştırırsan kalan aşamalardan sürer. Klip aşaması henüz yok; kullanıcı kurallarını verince eklenecek. Arayüzde: üst çubuk → **Auto Kick**.

### Konu klibi ("Osimhen'le ilgili klip çıkar")
`topic-clips <AutoKick klasörü|proje> --topic "Osimhen" [--max-sec 60] [--min-sec 8] [--gap 25]` → transkriptte konunun geçtiği yerleri bulur (Türkçe ek ve küçük yazım hatalarına dayanıklı), yakın geçişleri tek blokta toplar, cümle sınırlarına oturtup **aday önerir** (zaman, süre, geçiş sayısı, metin). Kullanıcı seçince `--pick 1,3` (ya da `--all`) ile her aday için **bağımsız klip projesi** üretilir (`<AutoKick projesi>-klipler/`); Auto Kick projesine dokunulmaz. Adayları kullanıcıya göster, seçtirmeden üretme. **Klibin düzeni** (kullanıcının yüzü üstte, fotoğraf altta, sıralama…) kullanıcı anlatınca eklenecek; şimdilik klip yalnızca kesilmiş, sessizsiz çizelge aralığıdır. Arayüzde: Auto Kick penceresi → **Konu klibi**.

## Video önerileri (uzun yayından ayrı video fikirleri)
Kullanıcı "bu yayından hangi videoları çıkarabilirim / başlık öner" derse: kayıt içe aktarılıp transkribe edilmiş olmalı, sonra `ideas <proje> [--max 8]` çalıştır. Çıktı: konuya göre ayrılmış bölümler (zaman, süre, anahtar kelimeler, taslak başlık, özet alıntı). Sonra her önerinin metnini `transcript <proje> --from <baş> --to <bit>` ile **OKU** ve YouTube başlıklarını (1 ana + 2 alternatif, ≤70 karakter, abartısız) **sen yaz**; yalnızca konuşulanlara dayan, çağrı/yönlendirme metni ("beğenin", "abone olun", "kanalıma gelin") yazma. Önerileri kullanıcıya sun; onayladığı bölümden `add-clip --start --end` ya da `new-clip-project` ile klip/proje çıkar. Arayüzde: sağ panel → **Öneriler** (Ayarlar → Başlık önerileri'nden Anthropic/OpenAI anahtarı girilirse başlıkları uygulama kendisi yazar; kapalıyken taslak başlıklar anahtar kelimelerden üretilir).

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
