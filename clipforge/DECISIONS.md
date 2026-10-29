# Kararlar ve açık sorular

Her madde: **Karar** (şimdi ne yapıldı) · **Gerekçe** · **Açık / riskli** (sahibinin onayı ya da gerçek veriyle doğrulama gerekenler).
Beş madde brief'te açıkça istenenlerdir (1–5); gerisi uygularken verilen kararlardır.

---

## 1. Whisper modeli ve çalıştırma yöntemi

**Karar:** Varsayılan sağlayıcı **whisper.cpp** (`whisper-cli`), varsayılan model **`small`**, varsayılan dil **Türkçe (`tr`)**.
Seçilebilir: `tiny / base / small / medium`; sağlayıcı alternatifleri **faster-whisper** (Python köprüsü) ve **OpenAI Whisper API**
(`whisper-1`, kelime zaman damgalı `verbose_json`). Modeller uygulama içinden indirilir (Hugging Face `ggerganov/whisper.cpp`).

**Gerekçe:** `tiny/base` Türkçede özel isimleri sık bozar (zaten bulanık aramayla telafi ediliyor ama kalite düşer); `medium` ≈ 1.5 GB ve
CPU'da gerçek zamandan yavaştır; `small` (≈ 466 MB) Türkçe için kalite/hız dengesidir. whisper.cpp tek ikilidir (Metal/CUDA/Vulkan
derlemeleri var), Python kurulumu gerektirmez. Kayıt 10 dk'lık parçalara bölündüğü için bellek sabittir ve iptal/devam mümkündür.

**Açık / riskli:**
* whisper.cpp'de kelime zaman damgası `-ml 1 -sow` ile alınıyor (token zaman damgaları); doğruluğu ±0.1–0.3 sn olabilir. faster-whisper'ın
  `word_timestamps` çıktısı (DTW) genelde daha isabetli. **Gerçek bir Türkçe yayın kaydıyla iki sağlayıcı kıyaslanmalı** — klip
  sınırları cümle başına/sonuna ±0.12/0.3 sn payla yapıştığı için küçük kaymalar kabul edilebilir, ama doğrulanmadı.
* Whisper sessizlik/müzikte "halüsinasyon" üretebilir. faster-whisper köprüsü `vad_filter` kullanır; whisper.cpp tarafına VAD
  eklenmedi (sürüme bağlı bayraklar). Gerekirse `ffmpeg silenceremove` ön işlemi eklenebilir.
* Bu ortamda gerçek model çalıştırılmadı (Whisper ikilisi/model yok): sağlayıcı katmanı, whisper.cpp'nin JSON biçimini üreten
  **sahte bir `whisper-cli`** ile gerçek Electron süreci içinde test edildi; gerçek model doğruluğu ve hızı ölçülmedi.
* `auto` dil algılama seçilebilir ama parça başına ayrı algılanır (karışık dilli yayınlarda tutarsız olabilir).

## 2. Lisans

**Karar (öneri, sahibi onaylamalı):** Uygulama kodu **MIT** (`package.json`).

**Bileşenler:**

| Bileşen | Lisans | Not |
|---|---|---|
| Electron, React, Zustand, Vite, Vitest, Playwright | MIT / Apache-2.0 | |
| **FFmpeg** (`ffmpeg-static`) | **GPL-3.0** derlemeler (libx264 içerir) | Ayrı süreç olarak çalıştırılır (bağlanmaz), ama **dağıtımda GPL metni ve kaynak kodu teklifi** gerekir. `@ffprobe-installer/ffprobe` de statik bir ffprobe getirir (paketin lisans bilgisi ayrıca incelenmeli). |
| whisper.cpp, OpenAI Whisper ağırlıkları, faster-whisper | MIT | |

**Açık / riskli:** Ticari dağıtım düşünülüyorsa GPL FFmpeg yerine **LGPL derlemesi** (x264 yok → macOS VideoToolbox/Windows
NVENC/AMF/QSV ile kodlama) ya da kullanıcıya "kendi FFmpeg'ini seç" modeli (uygulama bunu zaten destekliyor: Ayarlar → FFmpeg yolu)
tercih edilebilir. Hukuki inceleme yapılmadı. Ayrıca **oyun/müzik telifi**: dışa aktarma öncesi hatırlatma var, hukuki tavsiye
değildir.

## 3. Anlamsal arama sağlayıcısı

**Karar:** İsteğe bağlı, **varsayılan kapalı**. Sağlayıcı: herhangi bir **OpenAI uyumlu `/embeddings` uç noktası**
(OpenAI `text-embedding-3-small`, ya da yerelde Ollama / LM Studio / vLLM). Transkript 3 cümlelik kayan pencerelere bölünür,
vektörler bellekte tutulur, sorgu vektörüyle kosinüs benzerliği; çakışan pencereler elenir; sözcük sonuçlarıyla birleştirilir.

**Gerekçe:** Uygulamaya model gömmek (ONNX/transformers.js) kurulum boyutunu ve karmaşıklığı büyütür; uç nokta soyutlaması hem bulutu
hem tam yerel çalışmayı (metin cihazdan çıkmaz) destekler.

**Açık / riskli:** Türkçe için çok dilli bir model gerekir (ör. `bge-m3`, `multilingual-e5`); OpenAI küçük modeli idare eder ama
sınanmadı. **Gömme vektörleri diske kaydedilmiyor** (oturum başına yeniden hesaplanır; 1 saat ≈ 600 pencere ≈ 10 istek). Sonuç
eşikleri (`minSimilarity 0.25`, göreli kesme 0.8) gerçek verilerle ayarlanmadı. Bulut kullanılırsa transkript metni dışarı gider —
arayüzde uyarı var.

## 4. Kick sohbet günlüğü biçimi

**Karar:** Tek bir "resmi biçim" varsayılmadı; **esnek ayrıştırıcı**: CSV/TSV (başlık otomatik tanınır, `;`/`,`/tab/`|`), JSON
(dizi ya da `{messages|comments|chat|data: [...]}`; iç içe alanlar `sender.username`, `commenter.display_name`, `message.body` …), düz metin
(`[SS:DD:SS] kullanıcı: mesaj`). Zaman: saniye, `SS:DD:SS(.ms)`, `DD:SS`, ISO-8601, epoch. Mutlak zaman damgası varsa **yayın
başlangıcı** (Ayarlar → Sohbet) ile göreli saniyeye çevrilir; verilmezse ilk mesaj 0 sayılır ve uyarı gösterilir. Tanınmazsa
**açık hata + beklenen şema** gösterilir; sütun eşlemesi ayarlardan yapılır.

**Açık / riskli:** Kick'in kayıttan sonra indirilebilen *resmi* bir sohbet dökümü sunduğunu doğrulayamadım; üçüncü taraf araçlar
farklı şemalar üretir. Kick API mesaj nesnesinin alan adları (`content`, `created_at`, `sender.username`) bilgiye dayalı bir
varsayımdır. **Gerçek örnek dosyalarla doğrulanmalı.** Ayrıca yayın başlangıcı ile **OBS kaydının başlangıcı** farklıysa sohbet
zamanları kayar — ofset girişi (`offsetSec`) modelde var ama arayüzde ayrı bir "kayma" alanı yok (yayın başlangıcı alanıyla
dolaylı çözülür).

## 5. OBS işaretçi (marker) yöntemi

**Karar:** İki kaynak desteklenir, **hiçbiri yoksa özellik sessizce devre dışı** kalır (hata yok):
1. **OBS 31+ "Chapter Marker"** → MKV/MP4 *bölümleri*; `ffprobe -show_chapters` ile okunur.
2. **obs-websocket ile kayıt sırasında zaman damgası loglayan yan araç** → kaydın yanında `<kayıt adı>.markers.json|csv|txt`
   (ör. `2024-05-12 21-30-45.markers.txt` içinde `00:12:31 komik an`). JSON, CSV ve düz metin tanınır.

İşaretçiler otomatik öneride **en güçlü sinyaldir** (ses/sohbet olmasa bile aday üretir) ve kaynak oynatıcının kaydırma çubuğunda
görünür.

**Açık / riskli:** Uygulama kendisi obs-websocket'e **bağlanmaz** (kapsam dışı bırakıldı; yan araç gerekir). OBS'in chapter
marker'ı hangi kapsayıcılarda yazdığı ve zaman tabanı gerçek bir OBS 31 kaydıyla doğrulanmadı (testler ffprobe çıktısını
simüle eder). Hotkey ile marker koymak yayıncının OBS ayarına bağlıdır.

---

## 6. Elektron (Tauri değil)
Bkz. `docs/ARCHITECTURE.md §1`: Chromium'un sabit codec/`canvas` davranışı, Node ile alt süreç yönetimi, hazır ffmpeg ikilileri.

## 7. Arama indeksi bellekte, SQLite FTS değil
1 saatlik kayıt ≈ 7–15 bin kelime → kurulum ms, sorgu ms. FTS bulanık/yakınlık aramasına zaten yetmezdi; sözlük üstünde
Damerau-Levenshtein ve fonetik indirgeme gerekir. Transkript JSON olarak diske yazılır, açılışta indekse yüklenir. 100+ saatlik bir
arşivde arama (çoklu kayıt) istenirse SQLite'a geçmek makul.

## 8. Bulanık eşleşme tasarımı
Eşik (varsayılan 0.80, ayarlı), ≥4 harfli sözcüklerde; Türkçe ekler (`Nelson'dan`, `Nelsonun` ≤5 harf sonek) ayrı kural; "Victor/Viktor/Wiktor"
için fonetik indirgeme (c→k, w→v, çift harf). **Bilinen sınır:** çok farklı yazımlar (ör. "Vektör Nelsın") eşik altında kalabilir; çok
kelimeli sorguda tek terim bulunursa düşük skorlu "kısmi" sonuç döner (işaretli).

## 9. Dolgu sözcük listesi (sorgu temizleme)
"… ile ilgili konuştuğum yer" gibi serbest cümleler için küçük, **konu içermeyen** bir Türkçe/İngilizce durak sözcük listesi
(`src/shared/text.ts`). İsim/kelime/konu sabit kodlanmamıştır; "Victor Nelson" yalnızca testlerde örnektir.

## 10. Proxy ve önizleme
Önizleme 540p, kısa GOP'lu sessiz H.264 + **her ses track'i için ayrı mono AAC**. Böylece önizlemede oyun/konuşma seviyeleri
ayrı oynar. Maliyet: içe aktarmadan sonra bir kerelik kodlama (60 dk için 4 çekirdekli CPU'da ≈ 7.4 dk; bkz. README ölçümleri). Önizleme kopyası hazır olmadan transkripsiyon/arama çalışır; yalnızca oynatma bekler. Hızlandırma seçenekleri: daha düşük `proxyHeight`, donanım kodlayıcı (yapılmadı).
Tarayıcı `<audio>` ile **%100 üstü ses** çalamaz: önizleme 0–%100 ile sınırlı, **dışa aktarma 0–%150** destekler.

## 11. OBS kodlayıcı (NVENC/x264/AMF) algılaması kesin değildir
x264 kayıtlarında akış başındaki SEI imzası okunur (güvenilir). NVENC/AMF/QSV kayıtları standart H.264/HEVC/AV1 bit akışıdır; bazı
kapsayıcı etiketleri (`ENCODER`) kodlayıcı adını içerir ama OBS yazımı genelde içermez → "kodlayıcı ?" gösterilir. **Çözülebilirlik
etkilenmez:** üç kodlayıcının çıktısı da standart bit akışıdır, ffmpeg yazılımla çözer; içe aktarmada 2 sn'lik test çözümü yapılır.
NVENC/AMF donanımı olmayan bu ortamda yalnızca x264 ile gerçek kayıt üretilip denendi.

## 12. Tek ffmpeg komutu ile dışa aktarma
Zaman çizelgesi bir `filter_complex` betiğine çevrilir (ara dosya yok). Avantaj: tek geçiş, kalite kaybı yok, iptal kolay. Sınır:
çok sayıda küçük klip içeren çok uzun projelerde filtre grafiği büyür (her klip bir giriş) — "her klip ayrı dosya" modu bunu aşar.
**Geçişler/efektler/renk düzeltme kapsam dışı** (brief).

## 13. Altyazı: ASS + libass
Altyazı `ass` filtresiyle yakılır. Bazı FFmpeg derlemelerinde libass yoktur → otomatik olarak **altyazısız** dışa aktarılır ve kullanıcı
uyarılır. Yazı tipi sistemde yüklü olmalıdır (Arial/Impact vb.); eksikse libass yedek yazı tipi kullanır. Kelime-kelime vurgulama
(karaoke tarzı) yapılmadı.

## 14. Kamera senkronu
Ayrı dosya: ilk 120 sn'nin **ses zarflarının çapraz ilişkisinden** ofset bulunur (±15 sn; güven düşükse hata verir, elle girilir).
Tek dosya (OBS birleşik kayıt): kamera bölgesi normalize dikdörtgen olarak girilir (görsel seçici yok — sayısal alan). Brief'teki
"ilk karedeki ses/görüntü ofseti" yaklaşımı ses-tabanlı yapıldı; görüntü tabanlı (ör. alkış/flaş) hizalama yok.

## 15. Kapsam dışı bırakılanlar / ertelenenler
* **HUD bölgesi (ROI) tespiti** ve oyun-içi olay modeli (brief'te "isteğe bağlı"): yapılmadı. Sahne değişimi yoğunluğu var (isteğe bağlı).
* GPU kodlama (NVENC/VideoToolbox) yok; `libx264` kullanılır.
* Otomatik güncelleme, kod imzalama/noter onayı, telemetri yok.
* **macOS ve Windows'ta çalıştırılmadı.** Kod yol/kabuk açısından platform bağımsız yazıldı (argv ile alt süreç, `path` modülü), testler
  Linux'ta koştu. Kurulum dosyaları ilgili işletim sisteminde derlenmelidir (`ffmpeg-static` derlemeyi yapan platformun ikilisini indirir).
* Çoklu proje/çoklu kayıt arama (yalnızca seçili kayıt aranır), sohbet kelime-bulutu, çevrimiçi VOD içe aktarma (kapsam dışı).

## 16. Katman modeli ve şablonlar (v2)
**Karar:** Düzen artık sabit bir "düzen ön ayarı" değil, **iz başına konum** (`Track.placement`: rect, fit, visible, opacity). Şablon = katman konumlarının
ve metin biçimlerinin bir anlık görüntüsü (`LayoutTemplate`); yerleşik şablonlar kodda, kullanıcı şablonları `templates.json`'da. Eski (v1) projeler açılışta
varsayılan şablona geçirilir (iz kimlikleri ve klipler korunur; eski "oyun ortada" ön ayarı ayrıca yerleşik şablon olarak duruyor).
**Hazır yazı yok:** Varsayılan şablonda davet/çağrı/kanal yönlendirmesi gibi hiçbir hazır metin bulunmaz; orta bölgede yalnızca boş bir görsel yeri vardır. Metin katmanı (*+ Metin*) boş başlar. (Kullanıcı kuralı: bu yazıları kullanıcı kendisi ekler.)
**Metin/animasyon:** Metin katmanları dışa aktarmada **ASS** ile yakılır (altyazıyla aynı yol; `fade`, `pulse`, `slide-up`), video/GIF animasyonu yok.
**Önizleme farkları:** Canvas önizleme ASS animasyonlarını taklit eder; yazı tipi yerleşimi libass'tan birkaç piksel farklı olabilir. Yazı tipi sistemde yüklü olmalı
(Impact Windows/macOS'ta var; Linux'ta yedek yazı tipi kullanılır). Eski sürümde oluşturulmuş projelerdeki `T1`/`T2` metin katmanları (hazır yazılı) otomatik silinmez; elle silinebilir.
**Ses:** Video katmanı kendi sesini çalmaz/dışa aktarmaz; ses her zaman bir ses izindeki klipten gelir. Bu yüzden video bir video katmanına eklenirken sesi bağlı klip olarak otomatik eklenir. Önizleme kopyası hazır olmadan, tarayıcının çalabildiği dosyalarda (MP4/MOV/WEBM/MP3/WAV…) ilk ses akışı özgün dosyadan çalınır; MKV'de proxy bitene kadar kaynak oynatıcıda "Ses önizlemesi hazırlanıyor…" uyarısı görünür.
**Oyun ekranı** varsayılan kapalı katmandır; kamera/yüz kaynağı olmayan bir klip eklenirken otomatik açılır (aksi halde görüntü hiç görünmezdi).
**Açık:** (a) "Kısa animasyon" olarak yalnızca metin animasyonu var; hareketli görsel (GIF/WebM kanalı daveti) için video katmanı kullanılabilir ama
alfa kanallı videolar denenmedi. (b) Katman başına gölge/köşe yuvarlama/kenarlık yok. (c) Şablon uygulamak mevcut metin klibinin içeriğini değiştirmez
(yalnızca konum ve boş izlerin varsayılan metni). (d) Katman konumu klip bazında değil iz bazındadır (aynı izdeki tüm klipler aynı yerdedir).

## 17. Bağlı kaynaklar ve senkron
Ayrı ekran/oyun sesi/konuşma/kamera dosyaları `MediaAsset.sources` ile bağlanır; ofset **bağlı dosyada** (`syncOffsetSec`: bağlı dosya zamanı = birincil dosya zamanı + ofset)
tutulur. Ofset ses zarfı çapraz ilişkisiyle (ilk 120 sn) önerilir; güven düşükse elle girilir. Birden çok kamera/oturum ya da dosya başına farklı
zaman tabanı (hız sapması) desteklenmez.

## 18. Transkriptten kesme
Kesim, seçili kelimelerin çevresindeki sessizliği ikiye bölerek (yarısı komşu kelimeye) yapılır; **tüm kilitsiz izlerden** aynı anda ripple. Zaman çizelgesi
transkripti, kliplerin kaynaklarının transkriptlerinden türetilir (yalnızca kullanılan aralık). Kelime düzeyindeki zaman damgası hataları (bkz. §1)
kesimde duyulabilir bir kayma yaratabilir; gerçek kayıtla denenmedi.
