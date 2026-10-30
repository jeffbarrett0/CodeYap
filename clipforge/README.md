# ClipForge

Kick yayıncıları için masaüstü **klip çıkarma + video düzenleme** uygulaması.
Bir yayın kaydını (OBS MKV/MP4/MOV/FLV) yükle → konuşmada **“Victor Nelson ile ilgili konuştuğum yer”** gibi ara →
bulunan anlardan klip oluştur → CapCut benzeri zaman çizelgesinde düzenle → **9:16** olarak dışa aktar.

> Hiçbir isim/kelime/konu sabit kodlanmamıştır; “Victor Nelson” yalnızca testlerde örnektir.

**Teknoloji:** Electron + React + TypeScript · Zustand · FFmpeg · whisper.cpp (yerel) / faster-whisper / OpenAI Whisper API ·
Vitest + Playwright · electron-builder. Neden Electron (Tauri değil): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#1-teknoloji-seçimi-ve-gerekçe).
Belirsiz kalan kararlar: [`DECISIONS.md`](DECISIONS.md).

## Özellikler

| | |
|---|---|
| **İçe aktarma** | Sürükle-bırak / dosya seçici; MP4·MOV·MKV·FLV. OBS sürümü, codec (x264/NVENC/AMF), container ve **ses track sayısı** algılanır. Her ses track'i ayrı okunur; transkripsiyon varsayılan **Track 1** (oyun+mikrofon karışımı), değiştirilebilir. Arka planda işleme, ilerleme çubuğu, iptal. Proje kaydet/aç (JSON, **göreli medya yolları**). Küçük resim, süre, çözünürlük. |
| **Transkripsiyon** | Kelime düzeyinde zaman damgası; kayıt 10 dk + 15 sn **örtüşen** parçalarla işlenir (sınırda kelime kaybı yok); sonuç projeye kaydedilir ve **yeniden kullanılır**; dil varsayılanı Türkçe. |
| **Transkriptten düzenleme** | Transkript sekmesi: kelimeye tıkla → atla; aralık seçip **kes** (ripple), zaman damgasına git, seçimden klip; **tek tıkla sessizlik / ııı-eee kesme**; kelime düzeltme, özel sözlük, güvensiz kelime işareti. |
| **Konuşmada arama** | Tek kelime / isim / serbest cümle. **Tam** (ı/i, ş/s, ğ/g, ç/c, ö/o, ü/u duyarsız) · **bulanık** (“Viktor Nelsen” → “Victor Nelson”, eşik ayarlı) · **yakınlık penceresi** (“Victor” ve “Nelson” 10 sn içinde) · isteğe bağlı **anlamsal** arama. Sonuç: zaman, cümle, önceki/sonraki bağlam, skor; zamana göre sıralı; aynı konuşmadaki tekrarlar tek sonuç; tıklayınca oynatıcı o ana gider; son 10 sorgu. |
| **Klip oluşturma** | Başlangıç/bitiş **cümle sınırına** yapışır; pre-roll (5 sn) / post-roll (10 sn) ayarlı; hedef 15/30/60 sn; sınır aşımı uyarısı; oynatıcıdan ince ayar; kaynak zaman damgası klipte saklanır; tek tek ya da toplu. |
| **Otomatik öneri** | *Arayüzden kaldırıldı* (Öneriler sekmesi); altyapı kodda duruyor. |
| **Katmanlar & şablonlar** | Yüz / davet metni / görsel / oyun ekranı **ayrı katmanlar**: önizlemede sürükle-bırak + sayısal konum/boyut/görünürlük; metin animasyonları; düzenleri **şablon olarak kaydet**; ekran, oyun sesi, konuşma, kamera ve görsel ayrı dosyalarla çalışma. |
| **Zaman çizelgesi** | Çoklu video/ses izi, yakınlaştırma, taşı / kenardan kırp / böl / sil, bağlı (grup) klipler, kare kare oynatma başlığı, **geri al/yinele** (komut deseni), otomatik altyazı (yazı tipi/renk/konum), yüz kamerası overlay'i (ayrı dosya + senkron ya da tek dosyada bölge). |
| **Önizleme & dışa aktarma** | Gerçek zamanlı canvas önizleme (katman konumları dışa aktarmayla aynı); 9:16 · 1:1 · 16:9; hazır şablonlar (3 bölgeli, oyun ortada + kamera alt/üstte, tam kare + köşe kamera); oyun/konuşma **ayrı ses seviyesi**; **H.264 maksimum kalite** (CRF 14 · slow · 320 kbps ses · kaynak kare hızı · 1080p ve 4K şablonlar); kuyruk, ilerleme, iptal; TikTok/Reels/Shorts (9:16, 60 sn) ve YouTube şablonları; **telif hatırlatması**. |

### Klavye kısayolları
`Space` oynat/durdur · `S` böl · `Delete` sil · `J/K/L` geri/dur/ileri (tekrar basınca hızlanır) · `←/→` kare (Shift: 1 sn) ·
`Ctrl/Cmd+Z` geri al · `Ctrl/Cmd+Shift+Z` yinele · `Ctrl/Cmd+S` kaydet · `Ctrl/Cmd+E` dışa aktar · `Ctrl + tekerlek` yakınlaştır.

## Her şey senin kontrolünde (otomatik davranış yok)
* **Otomatik yükleme yok:** içe aktarılan ya da projeden açılan dosya kendiliğinden seçilmez/oynatılmaz; orta alan sen kütüphanede bir dosyaya tıklayana kadar boştur. Yeni projede tek boş Video katmanı vardır; orta/alt görsel alanı gibi hiçbir şey hazır gelmez.
* **Otomatik odaklama/kırpma yok:** üst alan normal bir video alanıdır; video kırpılmadan sığdırılır. (Kırpmayı yalnızca sen *Crop / Kırp* ile yaparsın.)
* **Otomatik ekleme yok:** oyun ekranı katmanı kendiliğinden gelmez, hiçbir katman kendiliğinden açılmaz. Aramadan klip çıkarınca video, oyun ekranı katmanı yoksa **Video** katmanına (`V2`) konur; sesler kendi izlerine.
* **Delete** yalnızca seçili **tek** öğeyi siler: zaman çizelgesindeki klip (bağlı klipler kalır; `Shift+Delete` bağlılarla birlikte), seçili altyazı, ya da kütüphanede odaktaki dosya. Kütüphaneden kaldırma diskteki dosyayı silmez; dosya zaman çizelgesinde kullanılıyorsa önce onay ister (o durumda klipler de kalkar ve geri alınamaz).

## Arayüz düzeni
* **Sol panel:** yalnızca **içe aktarma alanı** ve **Medya kütüphanesi**. Bir dosyaya tıklamak onu seçer ve kaynak oynatıcıda **baştan otomatik oynatır** (video, ses, görsel). Dosyayı zaman çizelgesindeki bir ize sürükleyebilirsin.
* **Orta:** önizleme. *Zaman çizelgesi* görünümünde **sağ tık → Crop / Kırp** (aşağıda); katmanları ve altyazıları doğrudan sürükleyebilirsin.
* **Sağ panel**, iki sıra sekme: **Düzenleme** — Klip · Katmanlar · Ses · Altyazı; **Bul / kaynak** — **Kaynak** (transkripsiyonu başlat, bağlı kaynaklar, kamera bölgesi) · **Arama** · **Transkript**.
* **Alt:** zaman çizelgesi.

**Kırpma (Crop):** Önizlemede sağ tık → *Crop / Kırp* (sağ tıkladığın noktadaki video/görsel katmanı kırpılır; yoksa seçili klip). Klibin tamamı gösterilir; yeşil kırpma dikdörtgeninin **alt kenarını yukarı** çekerek (ya da üst/sol/sağ kenar ve köşe tutamaçlarıyla) serbestçe kırp, ortadan sürükleyerek kaydır. *Alttan %* kutusundan sayısal gir; **Sıfırla** / **Bitti**; `Esc` çıkar. Kırpma klipte saklanır, geri alınabilir ve dışa aktarmaya aynen yansır. Klip sekmesinde de *Crop / Kırp* düğmesi ve sayısal değerler var.

**Altyazı konumu:** Altyazıya (önizlemede ya da zaman çizelgesindeki altyazı şeridinde) tıkla → seçilir (turuncu kutu). Önizlemede **sürükleyerek** istediğin yere taşı; Altyazı sekmesinde X/Y (%) sayısal girilir, *Varsayılan konuma dön*, *Bu konumu tüm altyazılara uygula*. Konum yalnızca seçili altyazıyı etkiler ve dışa aktarmada aynen uygulanır.

## Katmanlı düzen (YouTube Shorts) — kullanım notu

Kare **katmanlardan** oluşur. Her katman zaman çizelgesinde bir izdir ve kendi **konumu, boyutu, görünürlüğü, saydamlığı** vardır.

**Varsayılan düzen = yalnızca tek, tam kare "Video" katmanı** (kırpmadan, kaynağın oranında *sığdır*). **Hiçbir görsel/metin/oyun ekranı katmanı kendiliğinden gelmez**; gerekirse *Katmanlar* panelinden kendin eklersin (**+ Görsel**, **+ Metin**, **+ Video**, **+ Oyun ekranı**). Her katman (varsayılan olanlar dahil) **silinebilir** (*Katmanı sil*; içinde klip varsa onay ister, `Ctrl+Z` geri alır). Ses için **Oyun sesi** `A1` ve **Konuşma** `A2` izleri vardır (seviyeleri bağımsız).

**En-boy oranı otomatik** (varsayılan): başta hiçbir oran dayatılmaz; **ilk videoyu koyduğunda oran videonun gerçek boyutuna göre ayarlanır** (1920×1080 → 16:9, 1080×1920 → 9:16, kareye yakınsa 1:1; arada kalanlar en yakın orana). Zaman çizelgesinde zaten görüntü varsa sonraki videolar oranı değiştirmez. Oranı **elle seçersen** (9:16 · 1:1 · 16:9) otomatik kapanır; **Otomatik** düğmesi, mevcut ilk videonun boyutuna göre yeniden ayarlar. Dışa aktarma penceresi, zaman çizelgesinin oranına uyan şablonla açılır.

**Bir katmanı ayarlamak**
1. Sağ panel → **Katmanlar** sekmesi. Katmanı listeden ya da **önizlemeden** seç.
2. **Taşı:** önizlemede katmanı sürükle (kare kenarlarına, ortaya ve diğer katmanlara yapışır). **Boyutlandır:** 8 yeşil tutamaçtan çek.
3. **Sayısal:** seçili katmanın **X / Y / Genişlik / Yükseklik (%)**, *Sığdırma* (doldur ↔ sığdır), *Saydamlık*; “Tam kare / Üst yarı / Alt yarı / Ortala” kısayolları.
4. **Göster / gizle:** listedeki 👁 (ya da zaman çizelgesinde iz başlığındaki **G**). **Sıra:** ↑ ↓ (üstteki en önde).
5. **Metin katmanı** (*+ Metin*, boş başlar): metin, yazı tipi, boyut, renk, kontur, **animasyon** (yok / belirme / nabız / aşağıdan kayma); “Süreyi sona kadar uzat”.
6. **Katman ekle:** *+ Görsel*, *+ Metin*, *+ Video* (isteğe bağlı logo, ikinci görsel vb.).
7. **Kayıtlı düzenlerim:** *Düzeni kaydet* ile mevcut düzeni (konumlar, görünürlük, metin biçimi) adlandırıp kaydet; kayıtlı düzenler listesinden **Uygula**. Klipler değişmez. Saklandığı yer: kullanıcı verisi klasöründeki `templates.json`. (Hazır şablon listesi kaldırıldı.)

**Kaynakları ayrı yönetmek** (Medya sekmesi)
* Ekran kaydı, oyun sesi, konuşma sesi, kamera ve görseller **ayrı dosyalar** olarak içe aktarılır (MP4/MKV…, MP3/WAV/M4A…, PNG/JPG/WEBP).
* Dosyayı kütüphaneden **zaman çizelgesindeki bir ize sürükleyip bırak** (bırakma yeri klibin başlangıcıdır). Bir **videoyu video katmanına** bıraktığında **sesi de** otomatik olarak oyun sesi izine (`A1`) eklenir; sesi istemiyorsan bırakırken **Alt** tuşuna bas. Ses izine görsel gibi uyumsuz bırakmalar anlaşılır uyarı verir.
* **Bağlı kaynaklar:** Kaynak sekmesinde, konuşma kaydını (transkript onda; tek başına bir ses dosyası, başka kaynağa bağlanınca *konuşma* sayılır ve `A2`'ye gider) seçip ekran / oyun sesi / kamera dosyalarını bağla (gerekirse *Sesten bul* ile senkron ofseti). Konuşmadan klip çıkarınca hepsi **aynı aralıkta**, kendi izlerine gelir.

**Tek tıkla temizlik:** Transkript sekmesindeki (ve zaman çizelgesi araç çubuğundaki) **✂ Sessizlikleri ve ııı/eee'leri kes** düğmesi, konuşma olmayan sessiz aralıkları ve *ı, ııı, eee, hımm* gibi dolgu seslerini tek adımda keser (sonrası kayar, görüntü/ses/altyazı birlikte; `Ctrl+Z` hepsini geri alır). *Kesme ayarları*: şundan uzun sessizlik kesilsin (varsayılan 0.7 sn), kesimden sonra kalan nefes payı (0.15 sn), dolgu seslerini de kes. Kesim, kelime zaman damgalarına dayanır; bu yüzden transkript gerekir.

**Transkript doğruluğu:** (1) **Özel sözlük** (Ayarlar → Transkripsiyon): isimler, yöresel kelimeler, terimler. Whisper'a ipucu olarak verilir ve çıkan yazıya bulanık düzeltme uygulanır ("kabukçu" → "Kavukçu"; ekler korunur, "kabuk" gibi gerçek sözcüklere dokunulmaz). (2) **Emin olunamayan kelimeler** transkriptte dalgalı turuncu çizgiyle işaretlenir ("N kelimeden emin olunamadı" · *Sonraki şüpheli*). (3) Bir kelimeyi seç → **Düzelt** ya da **Tümünde düzelt + sözlüğe ekle** (sonraki transkripsiyonlarda da doğru yazılır). Düzeltilen kelimeler yeşil noktalı çizgiyle gösterilir, özgün yazım korunur. En iyi sonuç için özel isimlerde **medium** model önerilir.

**Kendin kesip birleştirmek**
* **Transkript** sekmesi: kelimeye tıkla → oraya atla; sürükle / Shift+tıkla → aralık seç; **✂ Seçimi kes** o aralığı tüm izlerden siler (sonrası kayar, bağlı ses/görüntü/altyazı birlikte; `Ctrl+Z` geri alır). *Sil, boşluk kalsın* seçeneği de var. **Zamana git:** `23:14`, `1:02:03`, `754`.
* Kaynak modunda aralık seçip **Seçimden klip oluştur**.
* Zaman çizelgesi: **S** böl · **⇄ Birleştir** (klip + hemen sonraki, kaynakta kesintisiz parça) · **Boşlukları kapat** · sürükleyerek taşı · kenardan kırp.

## Kurulum ve çalıştırma

Gereksinimler: **Node.js ≥ 20** (22 ile test edildi) ve npm.

```bash
cd clipforge
npm install          # electron, ffmpeg-static, @ffprobe-installer/ffprobe dahil (ağ erişimi gerekir)
npm run dev          # geliştirme modunda Electron
```

* **FFmpeg:** `ffmpeg-static` ile gelir; kendi ikilini kullanmak için *Ayarlar → FFmpeg yolu* veya `CLIPFORGE_FFMPEG` / `CLIPFORGE_FFPROBE`.
  Altyazı için **libass** (`ass` filtresi) gerekir; yoksa klip altyazısız dışa aktarılır ve uyarı verilir.
* **Whisper (yerel transkripsiyon):** *whisper.cpp* gerekir.
  1. `whisper-cli` ikilisini edin: macOS'ta Homebrew'daki `whisper-cpp` paketi; Windows'ta whisper.cpp GitHub sürümlerindeki hazır
     ZIP; Linux'ta kaynaktan derleme (`cmake -B build && cmake --build build -j`). `PATH`'te olması ya da *Ayarlar →
     Transkripsiyon → whisper-cli yolu* yeterli.
  2. *Ayarlar → Transkripsiyon → Kurulu modeller*'den modeli **indir** (`small` ≈ 466 MB, Türkçe için önerilir).
  - Alternatifler: **faster-whisper** (`pip install faster-whisper`, sağlayıcıyı değiştir) ya da **OpenAI Whisper API** (API anahtarı;
    ses parçaları buluta yüklenir).
* **Anlamsal arama (isteğe bağlı):** *Ayarlar → Arama → Anlamsal arama*; OpenAI uyumlu bir `/embeddings` uç noktası
  (yerel Ollama/LM Studio olabilir).

### Tarayıcı modu (Electron'suz arayüz geliştirme)
```bash
npm run dev:web      # http://localhost:5199 — sahte ana süreç + demo medya (ffmpeg ile üretilir)
```

### Hızlı kullanım
1. Soldaki **Kayıt içe aktar** (ya da dosyayı pencereye bırak). Önizleme kopyası arka planda hazırlanır; dosyaya tıklayınca oynar.
2. Sağ panel **Kaynak** sekmesi → **Transkripsiyonu başlat** (Track 1 varsayılan). İlerleme alttaki *Görevler* çubuğunda; iptal edilebilir.
3. **Arama** sekmesi: `Victor Nelson` (ya da `Victor Nelson ile ilgili konuştuğum yer`, `Viktor Nelsen`) → sonuçlar zaman damgasıyla listelenir.
4. **Klip oluştur** → sağ panelde pre/post-roll ya da hedef süre (30 sn), oynatıcıda `[ Baş` / `Son ]` ile ince ayar → **Zaman çizelgesine ekle**.
5. **Katmanlar** sekmesi: oranı kontrol et (otomatik), gerekirse katman ekle/konumlandır. **Altyazı** sekmesi: *Transkriptten altyazı üret*.
6. **Dışa aktar** → şablon (oranına uyan açılır; ör. TikTok/Reels/Shorts) → telif hatırlatmasını onayla → kuyruğa eklenir.

## Test

```bash
npm run typecheck            # tsc (strict)
npm test                     # Vitest: çekirdek + gerçek ffmpeg entegrasyonu (~1 dk)
npm run test:e2e             # Playwright: arayüz (tarayıcı modu, sahte ana süreç)
npm run test:e2e:electron    # Playwright: GERÇEK Electron (ekran yoksa xvfb-run kullanır); önce `npm run build`
npm run test:perf            # 60 dk'lık gerçek MKV ile kabul denemesi (yavaş, ~1.4 GB geçici dosya)
```

Playwright, önceden kurulu bir Chromium varsa (`/opt/pw-browsers/chromium`) onu, yoksa `npx playwright install chromium` ile indirileni kullanır.

Kapsam: Türkçe katlama/bulanık eşleşme/pencere/birleştirme ve “Victor Nelson” + yazım hatalı varyantlar; klip sınırının cümleye yapışması;
parça birleştirme (kelime kaybı yok); sohbet biçimleri ve hata mesajı; öneri skorlaması; zaman çizelgesi işlemleri ve geri al/yinele;
ffmpeg ile içe aktarma, proxy, iptal, transkripsiyon hattı (önbellek/devam), **9:16 dışa aktarma (kare içeriği doğrulanır)**, proje göreli yolları;
arayüzde uçtan uca akış; gerçek Electron'da içe aktarma → sahte whisper-cli → arama → klip → altyazı → 1080×1920 dışa aktarma.

## Ölçümler (60 dakikalık kayıt)

`npm run test:perf` — 60 dk, 1280×720@30, **3 ses track'li** OBS tarzı MKV (178 MB), Türkçe + boşluklu yol. Ölçüm ortamı: 4 çekirdekli
Linux konteyneri, GPU yok. **Transkripsiyon, gerçek Whisper yerine sahte sağlayıcıyla** koştu (parçalama/birleştirme/önbellek hattı gerçek, model süresi
ölçülmedi — gerçek süre modele ve donanıma bağlıdır; `small` modeli CPU'da kayıt süresinden uzun sürebilir).

| Adım | Süre |
|---|---|
| İçe aktarma (ffprobe + OBS algılama + test çözümü + küçük resim) | **0.4 sn** |
| Önizleme kopyası (540p + 3 ses track'i; arka planda, iptal edilebilir) | 7.4 dk |
| Transkripsiyon hattı: 7 örtüşen parça çıkarma + birleştirme (sahte model) | 5 sn |
| **Arama** “Victor Nelson” (~7 bin kelime) | **5 ms** |
| Ses analizi (otomatik öneri için, 60 dk) | 4.7 sn |

Doğrulananlar: Track 1 transkript için kullanılır; “Victor Nelson” 23:14 / 41:02 / 55:40 geçişlerini bulur; “Viktor Nelsen” aynı sonuçları verir;
30 sn'lik klip hedefi aşmaz ve başlangıcı cümle başındadır; parça sınırlarında kelime kaybı/tekrarı yoktur.
Önizleme kopyası en pahalı adımdır; *Ayarlar → Klip → Önizleme kopyası yüksekliği* ile düşürülebilir. Transkripsiyon/arama kopya
hazır olmadan da kullanılabilir (yalnızca oynatma kopyayı bekler).

## Paketleme

```bash
npm run dist:mac     # macOS'ta: dmg + zip (arm64, x64)
npm run dist:win     # Windows'ta: NSIS kurulum dosyası (x64)
```

Her platform **kendi işletim sisteminde** derlenmelidir (`ffmpeg-static` derleme platformunun ikilisini indirir). Yapılandırma:
[`electron-builder.yml`](electron-builder.yml). Kod imzalama/noter onayı yapılandırılmadı (bkz. DECISIONS §15). macOS/Windows
derlemeleri **bu geliştirme ortamında (Linux) denenmedi**.

## Veri ve gizlilik
Her şey yerelde: transkript, proxy, küçük resimler `<proje>.clipforge-data/` klasöründe (kaydedilmemiş projeler uygulama veri klasöründe).
Yalnızca *OpenAI Whisper API* ya da *bulut embedding* seçersen ses/metin dışarı gider (arayüz uyarır). Telemetri yok.

## Bilinen sınırlar
Bkz. [`DECISIONS.md`](DECISIONS.md#15-kapsam-dışı-bırakılanlar--ertelenenler): gerçek Whisper modeliyle doğruluk ölçülmedi, macOS/Windows'ta çalıştırılmadı,
HUD tespiti yok, GPU kodlama yok, geçiş/efekt/renk düzeltme kapsam dışı.
