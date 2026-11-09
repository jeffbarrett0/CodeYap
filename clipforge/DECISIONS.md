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

## 19. Arayüz sadeleştirme: sol panel yalnızca kütüphane
**Karar:** İstek doğrultusunda sol panelde yalnızca içe aktarma alanı ve medya kütüphanesi var. Daha önce solda olan **Arama, Transkript, Öneriler** ve seçili dosyanın
ayrıntıları (**Kaynak**: transkripsiyon başlatma, rol, bağlı kaynaklar, ize ekleme) özellik kaybı olmasın diye **sağ panele ikinci bir sekme sırası olarak taşındı**
(sekmelerin test kimlikleri korundu). Kütüphane kartlarında "Transkript hazır" rozeti kalır; önizleme kopyası ilerleme çubuğu sol panelden kaldırıldı (alttaki
Görevler çubuğunda görünür). Bu bir yorumdur: istenirse sekmeler başka bir yere (alt panel, açılır pencere) taşınabilir.
**Oynatma:** Tarayıcılar kullanıcı etkileşimi olmadan sesli oynatmayı engeller; kütüphane tıklaması bir etkileşim olduğu için otomatik oynatma çalışır.
**Kırpma:** klibin kaynak karesine göre normalize dikdörtgendir (`Clip.crop`), katman yerleşiminden önce uygulanır; kırpma sırasında klibin tamamı gösterilir.
Kırpma klip bazındadır (aynı izdeki diğer klipleri etkilemez); kaynak görünümünde sağ tık yalnızca zaman çizelgesindeki klibe yönlendirir.
**Altyazı konumu** altyazı bazında (`Caption.pos`); stildeki genel konum varsayılan kalır. Kutu boyutu yaklaşık hesaplanır (karakter genişliği tahmini), libass ile birkaç piksel fark olabilir.

## 20. İstenmeyen bölümlerin kaldırılması (sadeleştirme turu 2)
**Kaldırıldı (arayüzden):** Kaynak sekmesindeki "Seçili kayıt" bloğu (OBS/codec rozetleri, algılama notu, **ses track tablosu**), "Bu dosyanın rolü", "Zaman çizelgesine ekle" paneli,
**Öneriler** sekmesi (ve içindeki sohbet günlüğü içe aktarma), Katmanlar'daki **hazır şablon listesi** ("YouTube Shorts · Yüz / Davet / Görsel" dahil).
**Korundu (istek gereği dokunulmadı):** en-boy oranı, seçili katman alanı (konum/boyut), sığdırma, saydamlık; katman listesi; "Düzeni kaydet" ve kullanıcının kayıtlı düzenleri.
**Sonuçlar / yorumlar (onay gerekebilir):**
* Track tablosu kalktığı için transkripsiyon her zaman **Track 1**'den yapılır ve oyun/konuşma track eşlemesi arayüzden değiştirilemez (çok track'li OBS kayıtlarında Track 1 = karışım varsayımı). Veri modeli (`transcriptionTrack`, `audioMap`) duruyor; gerekirse arayüze geri eklenir.
* Rol kaldırıldı: rolü olmayan, başka kaynağa bağlı bir **ses dosyası konuşma (A2)** sayılır; diğer sesler A1'e gider.
* Dosyayı ize ekleme yolu artık yalnızca **sürükle-bırak** (Alt = videonun sesi olmadan) ve arama/transkript akışları.
* "Hazır şablon listesi" kalktı; varsayılan 3 bölgeli düzen yeni projelerde hâlâ başlangıç düzenidir ama listeden yeniden uygulanamaz. Bu, "yazan kısmı kaldır" isteğinin yorumudur (yalnızca yazıyı gizlemek yerine hazır şablonları kaldırdım).
* Öneriler sekmesinin kaldırılması sohbet günlüğü içe aktarmayı da erişilemez yaptı (kod ve Ayarlar → Sohbet sütun eşlemesi duruyor).

## 21. Sessizlik / dolgu kesme
Kesim planı **transkript kelime zaman damgalarından** çıkar (`planSilenceCuts`): `minGap` (0.7 sn) üstü boşluklar iki yandan `keep` (0.15 sn) pay bırakılarak, dolgu sesleri kendi aralıklarıyla (komşu gerçek
kelimelere taşmadan), baş/son sessizlik kısaltılarak kesilir; hepsi tek komut = tek geri alma. Gerçek kelime yoksa hiçbir şey kesilmez.
**Sınırlar:** (a) Whisper dolgu seslerini çoğu zaman yazıya dökmez; `transcribeFillers` açıkken ipucuna ("Şey, ııı, eee, hımm, yani.") dolgu örneği eklenir (whisper.cpp `--prompt`). Bu bazen **sessiz bölümlerde ipucunu halüsinasyon olarak tekrarlatabilir**; sorun görülürse
Ayarlar'dan kapatılabilir. Gerçek kayıtla denenmedi. (b) Kesim zaman çizelgesindeki TÜM izleri etkiler: sessizlik sırasında oyun sesi/görüntü akıyorsa o da kesilir (konuşmasız oyun anları dahil) — bu istenen davranış olarak yorumlandı.
(c) Ses tabanlı sessizlik algılama (ffmpeg `silencedetect`) yok; konuşma dışı gürültü (nefes, tıkırtı) kelime olarak yazılmadığı sürece "sessizlik" sayılır.

## 22. Transkript doğruluğu
Yöntemler: (1) Whisper'a **ipucu** (özel sözlük) — `whisper.cpp --prompt`, faster-whisper `initial_prompt`, OpenAI `prompt`; ipucu değişince transkript yeniden üretilir (önbellek anahtarına dahil).
(2) **Bulanık sözlük düzeltmesi** (≥5 harfli sözlük kelimeleri, benzerlik ≥ 0.84, ≤5 harf ek; "kabuk" gibi gerçek sözcükler korunur). (3) **Güven işareti**: whisper.cpp `-ojf` belirteç olasılıklarının ortalaması < 0.5 ise "emin değil"
(faster-whisper `probability`; OpenAI API güven vermez → işaret yok). (4) **Elle düzeltme** + "tümünde düzelt + sözlüğe ekle" ile sistem öğrenir.
**%100 garanti yoktur**: özellikle yöresel kelimeler/özel isimler için `medium` model ve sözlük önerilir. Eşikler (0.5 / 0.84) gerçek Türkçe kayıtla ayarlanmadı; false positive riski düşük tutuldu (kısa kelime ve uzak benzerlik düzeltilmez).

## 23. Otomatik davranışların kaldırılması ve elle kontrol (tur 3)
* **Otomatik seçme/yükleme:** `asset:added` ve proje açılışı artık dosya seçmez; kaynak oynatıcı yalnızca kütüphane tıklamasıyla (ve onun otomatik oynatması) açılır.
* **Üst alan = normal video:** katman adı "Video", yerleşim *sığdır*. Kaynakta kamera köşesi kırpması (`webcamRegion`) yalnızca kullanıcı elle bölge girerse uygulanır; yüz algılama/odaklama hiç yoktur (zaten yoktu, "cover" kırpması kaldırıldı).
* **Oyun ekranı katmanı (`V1`) varsayılanda yok.** Üretilen "ekran" klipleri hedef iz yoksa **ilk video katmanına** (V2) yönlendirilir (`retargetItems`); yeni katman kendiliğinden oluşturulmaz. Aynı kaynakta hem ekran hem kamera klibi çıkıyorsa tek video katmanında çakışmamak için **yalnızca asıl görüntü** tutulur (kamera kırpması düşer). Elle "+ Oyun ekranı" eklenirse ikisi de kullanılır.
* **Delete** tek öğeyi siler (klip: bağlı klipler kalır — önceki davranış bağlı grubu siliyordu; Shift+Delete eski davranış). Tek-seçim kuralı: klip/altyazı seçimi birbirini temizler. Kütüphane silmesi **geri alınamaz** (zaman çizelgesinde kullanılıyorsa onay + geçmiş temizlenir; kullanılmıyorsa yalnızca listeden çıkar). Katman silme Delete ile yapılmaz (yanlışlıkla düzen kaybını önlemek için; "Katmanı sil" düğmesi var).
* **Eski projeler:** v1'den gelenlerde konumu olmayan görsel izler (V1) görünür bir varsayılan yer alır; v2 projelerinde kayıtlı katmanlar (V1 dahil) aynen kalır.

## 24. MP4 kalitesi
**Karar:** Tüm şablonlar **maksimum kalite**: libx264 **CRF 14** (görsel olarak kayıpsıza yakın), `-preset slow`, High profil, yuv420p, bitrate yalnızca **üst sınır** (150 Mbps; 4K 240 Mbps), kaynak kare hızı (24–60, otomatik), **AAC 320 kbps**, Lanczos ölçekleme, BT.709 etiketi, 1080p ve **4K** (2160×3840 / 3840×2160) şablonları. Dışa aktarma penceresinde CRF, kodlama hızı ve bitrate sınırı elle değiştirilebilir.
**Doğrulama:** gerçek ffmpeg testinde varsayılan çıktı, aynı boru hattının CRF 1 çıktısına SSIM > 0.99 benzerlikte; düşük kaliteli ayar belirgin biçimde altında.
**Sınırlar / maliyet:** (a) Dosyalar büyük, kodlama yavaştır ("slow" ≈ medium'dan 2–3 kat). (b) Kaynak çözünürlüğü seçilen çıkıştan düşükse (ör. 720p kayıt → 4K) yalnızca yeniden ölçeklenir, ayrıntı eklenmez; "kaynağa yakın" kalite kaynağın kendisinden daha iyi olamaz. (c) Kare hızı otomatiktir; 60 fps kaynak 60 fps çıkar (platformlar yeniden sıkıştırır). (d) Ses **−14 LUFS'a dengelenir** (açık): kalite kaybı değil ama seviyeleri değiştirir; kapatılabilir. (e) Kalite, zaman çizelgesindeki ara işlemlerden (katman ölçekleme, bindirme) sonra 8-bit 4:2:0'da kodlanır; 10-bit/HDR desteklenmez. (f) İçerik yeniden kodlandığı için "kayıpsız kopya" değildir.

## 25. Boş başlangıç düzeni, otomatik oran ve takılma düzeltmesi (tur 4)
* **Varsayılan düzen tek "Video" katmanı** (tam kare, sığdır). Orta alan (görsel) ve Konu görseli kaldırıldı; hiçbir hazır katman yok. Eski projelerdeki bu katmanlar aynen durur ve artık **silinebilir** (daha önce korumalıydı). Üst bölge artık tam kare olduğu için "üst %41" düzeni yeni projelerde kalktı; önceki 3 bölgeli düzen isteyen kullanıcı katmanları elle ekleyip "Düzeni kaydet" ile saklayabilir. Hazır şablonlar (oyun ortada + kamera vb.) kodda duruyor ama arayüzde listelenmez.
* **Otomatik oran** (`Timeline.aspectAuto`, yeni projelerde açık): ilk video eklenirken, zaman çizelgesinde henüz video/görsel klip yoksa oran videonun **gerçek genişlik/yüksekliğinden** en yakın desteklenen orana (9:16 · 1:1 · 16:9) çevrilir. Sınırlar: yalnızca bu üç oran desteklenir (4:3, 21:9, 4:5 en yakınına yuvarlanır; özel oran/çözünürlük yok); video dönüş (rotation) meta verisi okunmaz; görsel (resim) oranı belirlemez. Eski projeler "elle" sayılır (oran değişmez). Şablon uygulamak oranı şablondan alır ve otomatiği kapatır.
* **Takılma hatası:** Katman çerçevesi kare dışına büyütülebiliyordu (genişlik > %100); taşan çerçeve diğer panellerin üstüne binip tıklamaları yakalıyor, "basılı kalmış" gibi davranıyordu. Düzeltmeler: (1) katman konumu her zaman kare içinde tutulur (`clampRect`; sürükleme, tutamaç, sayısal giriş ve proje açılışı onarımı), (2) bindirme katmanları `clip-path` ile tuvale (+ tutamaç payı) kırpılır, (3) fare düğmesi bırakılmışsa ya da işaretçi yakalama kaybedilmişse sürükleme **biter** (katman/altyazı/kırpma). Kare dışına taşan "kasıtlı" yerleşim (kaydırarak kırpma etkisi) artık mümkün değil; bunun için *Crop / Kırp* kullanılır.

## 26. Büyük videolarda oynatma bozulması (ilk saniyeler normal, sonra takılma/cızırtı)

**Kök neden (ölçüldü):** `cf-media://` işleyicisi `net.fetch(file://)` kullanıyordu ve HTTP `Range` başlığını yok sayıp her istekte tüm dosyayı `200` olarak döndürüyordu (gerçek Electron testinde `206` yerine `200`). Küçük dosyada fark edilmez; 24 dk'lık 1080p60 VOD'da her arabellek/atlama GB'larca veri okutur, oynatma ilk saniyelerden sonra çöker ve ses cızırdar. Üstüne: (a) ses ayrı `<audio>`'dan geliyor ve her karede videoya göre yeniden aranıyordu, (b) saat 60 Hz store'a yazılıyordu, (c) önizleme kopyası (proxy) bitince adres oynatma sırasında değişip kaynağı yeniden yüklüyordu.

**Çözüm:**
- `src/main/media/serve.ts`: Range'i kendimiz karşılıyoruz (206 + `Content-Range`, 416, `Accept-Ranges`), `fs` akışıyla; birim testli.
- Kaynak: önizleme kopyası yokken orijinal MP4/MOV/WebM tek öğeden (sesli) çalınır; kopya varsa ses saattir, video ona yetişir ve en çok ~1,5 sn'de bir düzeltilir.
- Oynatma sırasında adres değişmez (duraklatınca geçer, kaldığı süreden devam eder); `sourceTime` ~15 Hz güncellenir.
- Zaman çizelgesi önizlemesi (`PreviewEngine`) aynı korumaları aldı: oynatmada kaynak değişmez, yeniden arama sıklığı sınırlı.
- Test: gerçek Electron + 40 sn 1080p60 yüksek bit hızlı MP4 → Range yanıtları ve ortaya atlayıp oynatma.

**Not:** VP9 1080p60 yazılımsal çözülürken zayıf bilgisayarlarda hâlâ ağır olabilir; önizleme kopyası (540p) hazır olunca (kütüphanedeki görev çubuğu) akıcılık belirgin artar. Dışa aktarma etkilenmez.

## 27. Sessizleri kes sonrası siyah ekran ve toplu silme

* **Siyah ekran:** Her kesimde klipler yeni kimlik alıyordu ve önizleme motoru klip başına yeni bir `<video>` oluşturup yüklüyordu; yüklenene kadar (~1 sn) kare çizilmiyordu. Artık video/ses öğeleri **katman+kaynak** başına tutulur ve kesimden sonraki klip aynı öğeyi yeniden kullanır (sadece atlama yapılır); atlama sürerken öğenin son karesi çizilmeye devam eder. Klip değişiminde hemen doğru noktaya atlanır. Not: dışa aktarma etkilenmez (kesimler zaten boşluksuz birleşir). Sınır: sert bir geri sarma/ilk açılışta, öğe henüz hiç kare üretmediyse yine kısa bir bekleme olabilir; ağır VP9'da önizleme kopyası hazır olunca tamamen akıcıdır.
* **Toplu silme (hepsi tek geri alma adımı):** Altyazı sekmesi (onay kutuları, Tümünü seç, Seçilenleri sil, Tüm altyazıları sil) · Zaman çizelgesi (Tümünü seç / Ctrl+A, Sil, Tümünü sil) · Klip sekmesi (çoklu seçimde "Seçilenleri sil", tümünü seç/sil) · Katmanlar (seçili katmanda "Klipleri temizle") · Ses sekmesi (izin tüm kliplerini sil) · Kütüphane (onay kutuları, Seçilenleri kaldır; diskteki dosyalara dokunulmaz) · Arama (Sonuçları temizle). Kilitli izler atlanır. Transkript silme için ana süreç tarafında kalıcı bir silme işlemi yok; eklenmedi.

## 28. Katman bazlı seç/sil ve aramadan bağımsız klip projesi

**Katman bazlı seç/sil.** Zaman çizelgesindeki her katman (V2, A1, A2…, Altyazı/CC) bir "klasör" gibi davranır: katman etiketine ya da şeride **sağ tık → "Bu katmandaki tümünü seç / hepsini sil"**; ya da katmana (etikete, boş şeride, bir klibine) tıklayıp **Ctrl+A → Delete** (etkin katman sol kenarda yeşil işaretlenir; etkin katman yoksa Ctrl+A tüm klipleri seçer). Silme tek `removeMany` komutudur: yalnızca o katman etkilenir (bağlı görüntü/ses klipleri başka katmanda kalır), **Ctrl+Z tek adımda geri alır**. Altyazı katmanı da aynı kuralı izler. Kilitli katmanlar atlanır (uyarı verilir).

**Aramadan bağımsız klip projesi.** Arama sonucunda süre seçilir (**18 / 20 / 25 sn ya da özel**) ve "Yeni projede klip (N sn)" ile (klip taslağında "Yeni projede aç") klip **ayrı bir proje dosyası** olarak üretilip açılır. Ana proje dosyası ve bellekteki hali değişmez; "← Ana projeye dön" ile dönülür.
* Yeni proje: `<ana proje>-klipler/<arama · süre>.clipforge` (+ `-data`). Yalnızca ilgili medya (ayrı kaynak track'leri/kamera dahil) aynı dosyalara işaret eder — **medya kopyalanmaz**; önizleme kopyası, küçük resim ve **transkript** sabit bağ/kopya ile taşınır, böylece klip bağımsız olarak kesilebilir, altyazılanabilir, sesi ayarlanabilir.
* Süre mantığı mevcut klip önerisidir: hedef süreye göre **cümle sınırlarına yapışır**, konuşma ortasında kesilmez.

**Varsayımlar (belirsiz noktalar):**
1. "Tam N sn" yerine "N sn hedefi": cümle sınırları nedeniyle gerçek süre N'den biraz farklı olabilir (konuşma azsa belirgin kısa; uyarı gösterilir). İsterseniz klibi sonradan kırpabilirsiniz.
2. Ana projede kaydedilmemiş değişiklik ya da hiç kayıt yoksa, çalışma alanı değişirken kaybolmasın diye **önce onayla kaydedilir**; reddedilirse klip projesi oluşturulmaz.
3. Etkin katman yokken Ctrl+A tüm klipleri seçer (eski davranış).
4. Aynı arama sonucundan tekrar klip üretilirse dosya adı `(2)`, `(3)`… ile ayrılır; mevcut klip projesinin üzerine yazılmaz.

## 29. Yeni varsayılan katmanlar, 0. saniyeden başlama, sürükle-kutu ile toplu seçim

* **Katmanlar (yeni projeler):** `Video 1 · Video 2 · Video 3 · Fotoğraf 1 · Fotoğraf 2 · Ses · Altyazı`. "Oyun sesi" → **Ses**; **Konuşma katmanı kaldırıldı**. Katmanlar boş başlar (hiçbir içerik kendiliğinden eklenmez), hepsi tam kare "sığdır"; konum/boyut Katmanlar panelinden ayarlanır. Kimlikler: V1–V3, I1–I2, A1. Eski projeler açılırken "Oyun sesi" adı "Ses" olur ve **boş** "Konuşma" izi kaldırılır; içinde klip olan eski Konuşma izi veri kaybı olmasın diye "Ses 2" adıyla korunur.
* **Sesler tek "Ses" izinde:** Bir videoyu bırakınca sesi Ses izine gelir. O aralıkta Ses izi doluysa (ör. Video 1'in sesi) ikinci videonun **sesi eklenmez** (görüntü eklenir, uyarı verilir) — aksi halde ses kayıp görüntüden kopardı. Dosyada ayrı oyun/konuşma ses akışı varsa yalnızca ilki (oyun) Ses izine girer; konuşma akışını ayrıca almak için ses dosyasını Ses izine bırakın. (Varsayım: tek "Ses" istendi, karışım tek izde.)
* **0. saniyeden başlama:** Bırakılan dosya şeridin başına yakınsa (≤ 2 sn) **tam 0. sn**'den başlar; bir klibin sonuna ≤ 1 sn yakınsa hemen sonrasına yapışır (`snapDropTime`). Görüntü ve sesi aynı noktadan başlar.
* **Sürükle-kutu (marquee):** Boş şeride sol tuşla basılı tutup sürükleyince kutuya değen klip/altyazılar seçilir (Shift: seçime ekle); Delete siler, Ctrl+Z geri alır. Tek tıklama seçimi bırakıp oynatma başlığını taşır. Kilitli katmanlar atlanır. Katman şeritleri artık görünür alanın sonuna kadar uzar, boş alandan başlamak kolaylaşır.
* **Düzeltme:** `retargetItems` aynı izdeki klipleri yalnızca **zamanda çakışıyorsa** eler (önceden toplu klip oluşturmada aynı izdeki 2. ve 3. klip sessizce düşüyordu).

## 30. Komut satırı (CLI) — yapay zekâ ile editleme

* **Neden:** CapCut gibi araçların otomasyon arayüzü yok; bizde tüm iş mantığı arayüzden bağımsız (`AppService` + saf `shared` kodu). CLI aynı kodu çağırır: `src/cli/` → `out/main/cli.js` (`npm run cli -- …`). Her komut JSON döndürür; ilerleme stderr'e gider.
* **Kapsam (v1):** `new, import --add, transcribe, transcript, search, add-clip, new-clip-project, silence, cut, captions, delete-lane, frame, show, export, presets, info`. Proje dosyası uygulamayla birebir uyumludur; her yazmadan önce `.bak` yedeği alınır. Ayarlar (whisper yolu/modeli, sözlük) uygulamayla **aynı kullanıcı verisi klasöründen** okunur (`CLIPFORGE_USER_DATA` ile değiştirilebilir).
* **Kararlar/varsayımlar:** (1) CLI'da önizleme kopyası (proxy) üretilmez (yalnızca arayüz önizlemesi içindir). (2) `frame` ile çizelgedeki bir kare JPG olarak alınır; asistan görsel kontrol yapabilir. (3) `new-clip-project` ana projeyi değiştirmez (testle doğrulanır). (4) Kurgu kararları kullanıcıdadır; `CLAUDE.md` kullanıcının kalıcı kurallarını (çağrı metni yok, tam transkript, önce sor) içerir. (5) Katman konum/boyutu, metin katmanı, kırpma ve elle altyazı düzeni CLI'da henüz yok (sonraki adım).

## 31. Altyazı stili: "Vurgulu kutulu" (referans videodan)

**Referans (kullanıcının kendi videosundan karelerle incelendi):** kalın, dar, **eğik**, BÜYÜK HARF yazı; beyaz dolgu + kalın siyah kontur + yumuşak gölge; metne oturan **koyu gri, yarı saydam kutu**; tek satır, **2-4 kelime**; satırın **son 1-2 kelimesi** satır satır dönen renklerle (sarı · kırmızı · mavi) vurgulu. (Videodaki üst/alt kullanıcı yazıları ve kanal logosu videonun kendisine ait; altyazı sistemine alınmadı, hiçbir yönlendirme metni üretilmez.)

**Uygulama:** `Altyazı` sekmesi → **Hazır stil**: *Klasik* / *Vurgulu kutulu (referans)*; ayrıca Eğik, Arka plan kutusu (renk, saydamlık), "Son kelimeleri renklendir" (3 renk), "Satır başına en fazla kelime". Dışa aktarma (ASS): kutu = `BorderStyle 3` katmanı (metne tam oturur, ölçüm tahmini yok), üstte konturlu/gölgeli metin, vurgu = kelime başına `\1c`. Önizleme tuvali aynı şekli çizer. CLI: `captions <proje> --style boxed-highlight`.
* **Vurgu kuralı (varsayım):** rastgele değil, deterministik — her satırda son kelime (3 kelimeye kadar) ya da son 2 kelime (4+), renk satır sırasına göre döner. Referanstaki vurgular elle seçilmiş görünüyor; birebir aynı kelimeler seçilmeyebilir. Vurgu aralığı `Caption.hl` alanında durur; metin sonradan düzenlenirse kelime sayısına kırpılır.
* **Yazı tipi:** referans fontu belirlenemedi; **Impact + eğik** en yakın, her Windows/macOS'ta bulunan seçenek (Linux'ta Impact yoksa yedek font kullanılır; Windows'ta referansa yakın görünür). Yazı tipi seçilebilir.
* Stil uygulanınca satırlar kısa parçalara yeniden üretilsin mi diye sorulur (elle düzenlemeler kaybolur, Ctrl+Z geri alır). Eski projeler ve "Klasik" stil aynı çıktıyı verir.

## 32. Vlog otomatik kurgu: b-roll yerleştirme ve hareketli grafikler (2D harita / 3D küre)

* **Akış:** sessizleri kes → (kurgu sonrası zamanlarla) b-roll ve grafik yerleştir → istenirse altyazı → dışa aktar. Komutlar: `script`, `overlay`, `broll-plan [--apply]`, `graphic`, `import --layer`. Ayrıntı: `CLAUDE.md`.
* **Grafikler:** ASS vektör çizimi + ffmpeg (ek bağımlılık yok, deterministik, Windows/macOS aynı). **3D küre** gerçek ortografik izdüşümle kare kare hesaplanır (dönüş, hedef ülke vurgusu, yükselen rota yayı, nabız atan işaret); **2D harita** dünya görünümünden hedefe yakınlaşır, rota çizgisi çizilir. Ayrıca animasyonlu başlık ve çubuk grafik. Çıktı tam kare, sesiz H.264 MP4: çizelgede **normal klip** olduğu için uygulamada elle taşınır/kesilir. Veri: Natural Earth 1:110m (kamu malı, `resources/world.json`, `scripts/make-world.mjs` ile yeniden üretilir; Türkçe ülke adları dahil) + ~50 ana şehir.
* **Katman sırası (önemli):** çizimde V1 en üstte, V3 en altta. Vlogda ana görüntü **V3**'e (`import --add --layer V3`), b-roll **V2**'ye, grafikler **V1**'e konur; Ses katmanı kesintisiz sürer, yani b-roll/grafik konuşmanın üstüne biner. Katman çakışırsa komut hata verir (üzerine yazmaz, kaydırmaz).
* **Öneri, uygulama değil:** `broll-plan` yalnızca dosya adındaki kelimeleri (`istanbul_bogaz.mp4` → "istanbul bogaz") konuşmada arar; `--apply` verilmedikçe projeyi değiştirmez. `script` cümlede geçen yerleri (`places`) listeler; hangi cümlede grafik çizileceğine kullanıcı karar verir.
* **Sınırlar (dürüstçe):** serbest 3D model/karakter ya da fotogerçekçi görüntü üretilmez; harita ayrıntısı 110m (küçük ülkeler/şehir sınırları yok); yer adı ülke/ana şehir ya da `boylam,enlem`; grafik süresi/zamanı elle verilir. Arayüzde grafik üretme düğmesi yok (üretilen klipler uygulamada normal medya olarak açılır); gerekirse eklenir.

## 33. Altyazıyı önizlemede doğrudan boyutlandırma

Seçili altyazının çevresinde 6 tutamaç çıkar (4 köşe + sol/sağ kenar); çekince **karşı kenar sabit kalarak** yazı büyür/küçülür (kutu yazıya gerçek ölçümle oturur: `preview/measure.ts`). Boyut **altyazı başına** `Caption.scale` çarpanıdır (0,25–5×); panelde Boyut kaydırıcısı, "Bu boyutu tüm altyazılara uygula" ve "Boyutu sıfırla" vardır. Dışa aktarmada ASS satırına `\fs` (ve kutu/kontur iç boşluğu) eklenir; önizleme ile çıktı aynı yerleşim hesabını kullanır. Ek düzeltme: "Varsayılan konuma dön" artık vurgu ve boyutu silmez. Kenarı yatay çekmek yazıyı **ölçekler** (satır kaydırmayı değiştirmez); satır başına kelime sayısı stil ayarındadır. Art arda hızlı çekmeler tek geri alma adımında birleşebilir.

## 34. Auto Kick (yayın kaydını otomatik işleme) — güncel: bkz. 35

**Akış:** üst çubukta **Auto Kick** → kayıt seç → *içe aktar → transkripsiyon → sessiz alanları (ve "ııı/eee"leri) kırp → tam videoyu kaydet (full video)* → *otomatik klipler (sonraki adım, henüz yok)*. CLI karşılığı: `auto-kick <video> [--out klasör] [--quality fast|high]`.
* **Çıktı:** `<kaydın klasörü>/AutoKick/<kayıt adı>/` altında `<ad> - full.mp4` ve `<ad>.clipforge` (uygulamada açılıp elle düzenlenebilir; "Projeyi uygulamada aç" düğmesi). Klipler için ileride `klipler/` klasörü. Orijinal kayda dokunulmaz.
* **Arka planda, izole:** iş kendi `AppService` örneğinde çalışır (arayüzde açık projeyi etkilemez); pencere kapatılabilir, ilerleme/iptal/hata Auto Kick penceresinde görünür; aynı anda tek iş çalışır (CPU). Uygulama kapanırsa iş durur.
* **Kesintiye dayanıklı:** her aşamadan sonra proje ve `autokick.json` kaydedilir; aynı kaydı yeniden başlatınca biten aşamalar atlanır, transkript önbellekten gelir.
* **Kalite/hız (varsayım):** 2 saatlik yayında "maksimum kalite" (x264 slow, CRF 14) saatler sürer; bu yüzden varsayılan **Hızlı** (veryfast, CRF 20, 40 Mbps üst sınır, AAC 192k, kaynak kare hızı); "Maksimum" seçilebilir. Çözünürlük kaynağa göre şablonla: 16:9 → 1080p (kaynak ≥3000 px ise 4K), 9:16, 1:1. Platform süre sınırı tam videoya uygulanmaz.
* **Sessizlik kuralı:** ayarlardaki değerler (≥0,7 sn sessizlik, 0,15 sn pay, dolgu sesleri) ya da pencerede verilenler; "Sessizleri kes" ile aynı algoritma.
* **Bilinen sınırlar:** 2 saatlik gerçek yayında süre Whisper modeline/CPU'ya bağlıdır (denenmedi; testler 10 dk'lık yapay kayıtla). Kurgu sonrası çok sayıda kesim (yüzlerce) dışa aktarmada uzun filtre grafiği üretir; 10 dk/26 kesim ile doğrulandı. Otomatik klip aşaması kullanıcının kurallarına göre eklenecek.

## 35. Auto Kick: dokunmadan, doğrulanmış tam video

Aşamalar: içe aktar → transkripsiyon → **sessizleri kes → boşlukları kapat** → tam video (otomatik klip satırı şimdilik kaldırıldı). Kullanıcı hiçbir şeye dokunmaz.
* **Ölçeklenen dışa aktarma (`autokick/fastcut.ts`):** yüzlerce kesimli uzun kayıt için kayıt TEK KEZ açılır; tutulan aralıklar `select`/`aselect` ile seçilir (genel dışa aktarıcı her klip için ayrı giriş + `amix` girişi açtığından binlerce klipte çalışmaz). Kesim sınırları kare ızgarasına oturtulur; ses çerçevesi kare süresine tam bölünecek boyuttadır (60 fps → 160 örnek) → ses/görüntü **kaymaz**. Kare hızı kesir olarak açıkça verilir (59,94 → 60000/1001); aksi halde seçimden sonra 25 fps'e düşüp kare atıyordu.
* **Doğrulama:** çıktı geçici dosyaya yazılır; görüntü ve ses süresi beklenenle (±0,5 sn) ve birbiriyle (±0,25 sn) eşleşmezse ya da ses yoksa dosya atılır ve hata verilir (sessizce "bitti" denmez). Çizelgede boşluk kalmadığı da denetlenir. Disk yeri yetersizse işe başlamadan uyarılır.
* **Ölçüm (yapay, 30 dk / 425 kesim, 640×360@60):** 17 dk'ya indi; görüntü 1039,95 sn = ses 1039,95 sn; kesim sonrası kare kaynakla birebir aynı; ~3 dk. Gerçek 2 saatlik yayın denenmedi; süre Whisper'a ve CPU'ya bağlı. Transkripsiyon 10 dk'lık parçalar hâlinde önbelleğe alınır, kesintide kaldığı yerden sürer.
* **Çıktı kalitesi:** tam video kaynak çözünürlüğünde kalır (yeniden ölçeklenmez); Hızlı = veryfast/CRF 20, Maksimum = slow/CRF 14; ses normalize edilmez (özgün seviye).

## 36. Auto Kick: konu klibi (altyapı)

**İstek:** "Osimhen'le ilgili klip çıkar" → sistem Auto Kick transkriptine bakıp konuyla ilgili klip çıkarsın. Bu adım yalnızca **altyapı**; klibin düzeni (yüz üstte, fotoğraf altta, sıralama) kullanıcı anlatınca eklenecek.
* **Bulma (`shared/topic.ts`):** sorgudan anahtar kelimeler ("ile ilgili" gibi kısa/ek sözcükler elenir); eşleşme Türkçe/aksan duyarsız, ek toleranslı ("Osimhen'in/-e/-le"), küçük Whisper yazım hatalı ("Osimen"). Yakın geçişler (≤25 sn) tek konuşma bloğu; blok cümle sınırlarına oturur, 1 yakın bağlam cümlesi eklenir; uzun blok en çok geçişi içeren pencerelere bölünür (varsayılan ≤60 sn); çok kısa blok yakın cümlelerle ≥8 sn'ye genişler. Uzak/alakasız içerik **katılmaz**. Skor: geçiş sayısı ve yoğunluğu.
* **Öneri, otomatik üretim değil:** adaylar listelenir, kullanıcı seçer (kurgu kararı kullanıcıda). Seçilen aday, **kesilmiş çizelgenin** [başlangıç, bitiş] aralığıdır (sessizsiz, boşluksuz); bağımsız proje olarak `<AutoKick projesi>-klipler/` altına yazılır, transkript ve önizleme taşınır → sonra altyazı/düzen eklenebilir. Auto Kick projesi değişmez (testle doğrulandı).
* **Arayüz/CLI:** Auto Kick penceresi → *Konu klibi* (proje seç, konu yaz, aday listesi, "klip projesi oluştur", "Uygulamada aç"); CLI `topic-clips`.
* **Sınırlar:** yalnızca kelime eşleşmesi (anlamsal/eş anlamlı arama yok: "forvet" yazınca "Osimhen" bulunmaz); adayın klip olarak ilginçliği (komik/heyecanlı) değerlendirilmez; çok kelimeli konuda herhangi bir anahtar kelime eşleşir.

## 37. Auto Kick: ön kontrol, otomatik model indirme, konuşma track'i seçimi, anlaşılır hata

**Sorun:** "Auto Kick'i başlat" deyince transkripsiyon aşamasında hata çıkıyordu; nedeni kullanıcıya görünmüyordu ve uzun bir işin sonunda ortaya çıkıyordu.
* **Sıra (istenen):** başlat → kayıt otomatik içe aktarılır (ilerleme yüzdesiyle) → transkripsiyon → sessizleri kes → boşlukları kapat → tam videoyu kaydet. Kullanıcı hiçbir adımda dokunmaz.
* **Ön kontrol (içe aktarmadan ÖNCE, saniyeler):** ffmpeg/ffprobe, whisper programı, API anahtarı. Eksikse işe başlanmaz ve ne yapılacağı yazılır ("whisper-cli.exe yolunu gösterin"). Pencere açılınca aynı denetim *Transkripsiyon hazır ✓ / ⚠ …* olarak görünür.
* **Model kendiliğinden iner:** whisper.cpp modeli kurulu değilse (ör. "small", ~470 MB) Auto Kick onu indirir (yalnızca ilk sefer; ilerleme gösterilir) ve devam eder.
* **Konuşma hangi ses track'inde:** çok track'li OBS kayıtlarında her track'ten ~60 sn'lik örnek (kaydın %30'u, gerekirse %60'ı) kısa transkribe edilir; en çok kelime çıkan track seçilir (`detectSpeechTrack`). Tek track'te soru yok; önceki çalıştırmada seçilen track tekrar kullanılır. (Eski davranış: dosyadaki varsayılan track; konuşma başka track'teyse "boş transkript" hatası verirdi.)
* **Hata görünürlüğü:** hata, aşama adıyla ve çözümüyle gösterilir ("Transkripsiyon aşamasında hata: …"); boş transkriptte track/dil/model yazılır. Başarısız/iptal işte **"Yeniden dene (kaldığı yerden)"**: biten aşamalar ve 10 dk'lık transkript parçaları atlanır.
* **Sınırlar:** whisper programının kendisi (whisper-cli) otomatik kurulmaz; yolu bir kez Ayarlar'da gösterilmelidir. Track denetimi her track için ~birkaç on sn ek süre ekler. Gerçek 2 saatlik yayın hâlâ denenmedi.

## 38. Öneriler: yayından ayrı video fikirleri + YouTube başlıkları

**İstek:** 2 saatlik bir yayının transkriptinden "şu 15 dakikalık bölümden ayrı bir video çıkarabilirsin, başlığı şu olabilir" önerileri. (Auto Kick bu işte kullanılmaz; normal akış.) Sağ panelde **Öneriler** sekmesi (eski sohbet/ses-enerjisi öneri sekmesi ile ilgisi yok).
* **Konu bölümleme (`shared/ideas.ts`, dil modeli gerektirmez):** transkript ~45 sn'lik birimlere bölünür; kelime dağarcığındaki değişimden (kök-eşlemeli tf-idf, TextTiling benzeri komşu pencere benzerliği) konu sınırları bulunur; en az ~4 dk / en çok 30 dk bölümler; çok kısa parçalar komşuya katılır, çok uzunlar en belirgin iç sınırdan bölünür. Skor: konu tutarlılığı, belirginlik (kayıt geneline göre özgünlük), süre uygunluğu (6–25 dk ideal), odak. Anahtar kelimeler (Türkçe ekler için kök eşleme, "yapay zeka" gibi ardışık ikililer birleşik) ve temsilci cümlelerden alıntı özet üretilir. Sentetik 4 konulu kayıtta sınırlar ±2 dk içinde bulundu.
* **Başlıklar:** (1) **Yapay zekâ kapalıyken** anahtar kelimelerden *taslak* başlıklar ("Yapay zeka hakkında konuştuklarım"); sınırlıdır. (2) **Ayarlar → Başlık önerileri:** Anthropic (varsayılan model claude-haiku-5-5) ya da OpenAI uyumlu (OpenAI/OpenRouter/yerel Ollama) seçilirse her bölüm için 1 ana + 2 alternatif başlık, açılış cümlesi fikri ve kısa açıklama yazılır. Bölümün metni (uzunsa 6 eşit parçadan örneklenmiş ≤6000 karakter) seçilen sağlayıcıya GÖNDERİLİR; anahtar yerel ayarlarda düz metin saklanır (diğer anahtarlar gibi). Hata olursa taslak başlıklar kalır ve nedeni gösterilir.
* **Kalıcı kural uygulaması:** istem "metinde olmayanı uydurma, tık tuzağı yok, çağrı/yönlendirme yazma" der ve model çıktısı ayrıca filtrelenir: "beğen/abone/takip/kanalıma/link/tamamı" geçen başlık, açılış ya da açıklama atılır.
* **Karar kullanıcıda:** öneriler listelenir; "Klip taslağı aç" ile mevcut taslak akışına (oradan "Yeni projede aç") girer. CLI: `ideas <proje> [--ai]` (Claude Code başlıkları metni okuyup kendisi yazabilir; bkz. `CLAUDE.md`).
* **Sınırlar:** yalnızca kelime dağarcığına bakar (üslup/duygu/izlenme potansiyeli değerlendirilmez); kayıt <2 dk ya da çok az cümle içeriyorsa öneri üretmez; tek konulu uzun yayın tek öneri verir; taslak başlıklar zayıftır. Gerçek 2 saatlik yayında denenmedi (testler yapay transkriptle).

## 39. Boşluğa tıklayınca seçim kalkar · bilgisayarı kilitlememe · Auto Kick otomatik başlangıç · Öneriler sadeleşti

* **Seçim:** önizleme arka planına, sol panelin boş yerine, üst çubuk boşluğuna tıklamak ya da **Esc** klip/altyazı seçimini (yeşil çerçeve) kaldırır. Zaman çizelgesi kendi boşluk tıklamasını/sürükle-kutusunu yönetir; düğmeler, sağ panel, kütüphane kartları ve tutamaçlar seçimi bozmaz.
* **Bilgisayar yavaşlıyor:** nedenleri ağır arka plan işleriydi (içe aktarma sonrası önizleme kopyası, transkripsiyon, kodlama: tüm çekirdekler, normal öncelik) ve durağan önizlemenin sürekli yeniden çizilmesi. Düzeltme: **Ayarlar → FFmpeg / Araçlar → Arka plan işleri: Dengeli (varsayılan) / Tam hız.** Dengeli: ffmpeg/whisper alt süreçleri **düşük öncelikle** (siz başka program açınca onlara öncelik verilir) ve çekirdeklerin **yarısıyla** çalışır; iş biraz uzar ama bilgisayar kullanılabilir kalır. Ek: duraklatılmış oynatıcıda kare döngüsü çalışmaz, durağan önizleme saniyede 1 kez çizilir, kaynak videolar `preload=metadata`.
* **Auto Kick:** kayıt seçilir seçilmez iş **kendiliğinden** başlar (içe aktarma → transkripsiyon → sessizleri kes → boşlukları kapat → tam video); "başlat" düğmesi kalktı; **genel ilerleme çubuğu** %100'e dolar (ağırlık: transkripsiyon %55, kodlama %33). Seçenekler "Gelişmiş ayarlar" altında.
* **Öneriler sadeleşti:** amaç YouTube'da klip yapılabilecek **2–30 dk** bölümleri bulmak. Her öneri tek satır: "**Batrakov hakkında konuşmuşsun** · 6 dk · 11 kez anıldı". İki kaynaktan: (1) **özel isim yoğunluğu** — büyük harfle yazılmış (cümle başı olmayan) bir ad ≤150 sn aralıkla ≥4 kez anılıyorsa o bölüm; "Victor Osimhen" gibi yan yana adlar birleşir; ay/gün adları ve genel sözcükler elenir; (2) kelime dağarcığı değişimiyle konu bölümleri (mastar "dinlemek", "kendine", "böyle" gibi sözcükler artık konu sayılmaz). Örtüşenler elenir. Anahtar kelime rozetleri, alternatif başlıklar ve uzun alıntı kaldırıldı ("Ne konuşulmuş?" açılır kısa özet). **YouTube başlığı yalnızca yapay zekâ ayarlıysa** tek satır gösterilir.
* **Sınırlar:** isim tespiti büyük harf yazımına dayanır (Whisper bazen küçük yazar); ilgi çekicilik değerlendirilmez; gerçek 2 saatlik yayında denenmedi.

## 40. whisper-cli "kullanım metni" hatası (Auto Kick, Türkçe/köşeli parantezli klasör adı)

**Belirti:** "Transkripsiyon aşamasında hata: whisper.cpp hatası: -vp N, --vad-speech-pad-ms … VAD samples overlap" — bu, whisper-cli'nin **kullanım (yardım) metninin son satırlarıdır**; program bir bağımsız değişkeni anlayamayıp yardımı basmıştır. Asıl "error:" satırı gösterilmiyordu.
* **Muhtemel neden:** Auto Kick proje klasörü kaydın adından türer ("HER GENCİN İZLEMESİ GEREKEN VİDEO [IMouIMdFvWs]…"). Windows'ta whisper-cli bağımsız değişkenleri ANSI kod sayfasıyla okur; `İ` gibi karakterler ve köşeli parantez yolu bozar. (Normal projeler ASCII oturum klasöründe olduğundan sorun görülmemişti.) Gerçek whisper'la doğrulayamadım; düzeltme bu varsayıma ve aşağıdaki sağlamlaştırmaya dayanır.
* **Düzeltme:** whisper artık **çalışma klasöründe (cwd)** ve yalnızca **ASCII göreli dosya adlarıyla** (`-f chunk_0.wav -of wcpp_600`) çalıştırılır; klasör yolu hiçbir bağımsız değişkende geçmez. Sürüm bir isteğe bağlı bayrağı (`-sow`, `-np`, `-t`, `--prompt`) tanımazsa o bayrak çıkarılıp yeniden denenir. Hâlâ hata olursa **asıl neden** gösterilir (ör. `"-ml" tanınmıyor`), kullanım metninin sonu değil.
* **Hâlâ olursa:** whisper-cli sürümünüz çok eski/farklı olabilir; güncel sürüm kullanın. Mesajda tanınmayan bayrak adı yazar.

## 41. Altyazı dili: İngilizce çeviri

**İstek:** Altyazı bölümünde İngilizce seçeneği; seçilince altyazılar İngilizceye çevrilsin.
* **Arayüz:** Altyazı sekmesi → **Altyazı dili**: *Özgün* / *English*. English seçilince satırlar çevrilir; önizleme, zaman çizelgesi şeridi, satır listesi ve **dışa aktarma** çeviriyi kullanır. Özgüne dönmek tek seçim; çeviriler saklanır (tekrar İngilizceye geçince yeniden çevrilmez). Ctrl+Z geri alır.
* **Zamanlama korunur:** çeviri satır satır yapılır (aynı sayı, aynı sıra); satırlar konuşma parçaları olduğundan model komşu satırları bağlam olarak görür ama her çıktıya yalnızca kendi karşılığını yazar. Sayı tutmazsa parti ikiye bölünüp yeniden denenir; olmazsa hata verilir (yarım çeviri uygulanmaz).
* **Motor:** Ayarlar → **Yapay zekâ** (Anthropic ya da OpenAI uyumlu) — başlık önerileriyle aynı anahtar. **Anahtar yoksa çeviri yapılamaz** ve nedeni söylenir; dil değişmez. Çevrilen satırların metni seçilen sağlayıcıya gönderilir. İstem "ekleme yok, çağrı metni yok" der.
* **Veri:** `Caption.tr[dil]` = çeviri metni + o metne göre vurgu (kelime sayısı dile göre değiştiğinden vurgu İngilizce metin üzerinden atanır; stil değişince yenilenir); `Timeline.captionLang`. `text` her zaman özgün konuşmadır.
* **Düzenleme:** İngilizce seçiliyken satır listesinde düzenlemek çeviriyi düzenler, özgün metin korunur. Özgün metin sonradan değiştirilirse çeviri otomatik yenilenmez (satır silinip dil yeniden seçilerek ya da altyazı yeniden üretilerek yenilenir). Yeni üretilen altyazılar, İngilizce seçiliyse kendiliğinden çevrilir.
* **CLI:** `captions <proje> --lang en`.
* **Sınırlar:** yalnızca İngilizce (dil listesi genişletilebilir); çeviri kalitesi modele bağlı; internet ve anahtar gerekir. Whisper'ın kendi çeviri kipi (`--translate`, çevrimdışı) kullanılmadı: kelime zamanlaması kaba ve her dil için ayrı transkripsiyon gerekirdi.

## 48. Whisper "failed to open wcpp_0.json for writing" (Windows)

Kullanıcı ortamında whisper-cli çalışma klasörünü (cwd) uygulamıyor ya da klasöre yazamıyordu: önce "input file not found chunk_0.wav", sonra çıktı için "failed to open … for writing". Çözüm: girdi (`-f`) ve çıktı (`-of`) yolları BİRLİKTE, sırayla denenir — göreli (cwd) → mutlak → Windows 8.3 kısa yol → ASCII geçici klasöre kopya (önce kullanıcının geçici klasörü, sonra sürücü kökü). Hata türüne göre ("input file not found / input file(s) failed / for writing") bir sonrakine geçilir; hepsi başarısızsa asıl whisper hatası gösterilir. Hâlâ yazılamıyorsa neden büyük olasılıkla antivirüs/Denetimli Klasör Erişimi: klasör istisnaya eklenmeli.

## 47. Yayın başı videosunu (telifli şarkı) otomatik kesme

**İstek:** yayın kayıtlarının başında 2 dk 44 sn'lik "Yayın başlıyor" videosu (telifli şarkılı) var; Auto Kick'te kesilsin.
* **Yöntem:** referans ekran görüntüsüyle görsel eşleşme (`shared/intro.ts`): ilk (süre+60) sn saniyede bir 64×36 gri kareye indirilir, Pearson korelasyonu ≥0,80 olan kareler sayılır (geri sayım rakamı değişse de yerleşim aynı). ≥8 eşleşme ve ilk eşleşme ≤ süre ise [0, max(süre, son eşleşme+1 sn)] kesilir. Eşleşme yok / az / videonun ortasında / tespit hatası → **hiçbir şey kesilmez** (yanlış kesim, doğru kesimden daha kötü). Auto Kick'te içe aktarma aşamasında, transkripsiyondan önce uygulanır (çizelgeden `cutRange`); yeniden çalıştırmada tekrar kesilmez (içe aktarma atlanır). Süre "kesin 164 sn" varsayımıdır: geri sayım ekranı tam bu süreyi doldurmuyorsa süre ayarı güncellenir.
* Varsayılan referans kullanıcının verdiği ekran görüntüsü (`resources/intro/yayin-basliyor.png`); Ayarlar'dan başka ekran seçilebilir. CLI: `cut-intro` (`--dry`).
* Sınır: gerçek bir yayın kaydıyla denenmedi (sentetik video + kullanıcının ekran görüntüsünün sabit hâliyle test edildi); geri sayım rakamlarının değişmesi korelasyon testinde simüle edildi.

## 46. Gözetimsiz zincir: Auto Kick → Auto Clips → MP4

**İstek:** 8 saat bilgisayar başında olunmayacak: video Auto Kick'e atılır, düzenlenir, dışa aktarılır, sonra Auto Clips klipleri üretir; Auto Clips penceresi de kendiliğinden açılmalı.
* Zincir **ana süreçte** (arayüzden bağımsız): `AutoKickManager` emit kancası → `chainAutoClips` (her Auto Kick işi için bir kez, yalnızca `done` + sonuç varsa, ayar açıksa) → `AutoClipsManager` (aşamalar: konuları bul → klip projelerini üret → MP4 dışa aktar; iptal edilebilir; tek klipte hata o klibe yazılır, diğerleri sürer). Ayarlar: `autoClipsAfterKick` (açık), `autoClipsExport` (açık), `autoClipsMax` (10). Arayüz: Auto Kick bitince Auto Clips penceresi otomatik açılır; ilerleme/sonuç (MP4'ü göster, projeyi aç) orada. CLI: `auto-kick --clips`, `auto-clips --export`.
* İki ağır iş (sonraki Auto Kick ile Auto Clips dışa aktarması) aynı anda çalışabilir; düşük öncelik politikası (dengeli CPU modu) geçerli.

## 45. Auto Clips, yüz videosu, uçak rotası, sözlük, zaman damgası/öneri düzeltmeleri

* **Auto Clips:** Auto Kick bitince tam video otomatik devredilir (store `autoClipsProject`, üst çubukta ●). Transkriptten kişi/takım adına göre klip adayları (`shared/autoclips.ts`: adlı bölümler öncelikli; klip konunun anıldığı cümlelerle sınırlanır; uzun konu parçalanır) → "zaman aralığı + ne konuşulmuş" (sayaç yok). Seçilenden bağımsız **9:16 klip projesi**: yüz üstte (aynı kaynağın yüz bölgesi kırpması, varsayılan sağ alt), konuşulan görüntü altta (kaynak karenin kendisi; fotoğraf üretilmez). Yerleşimin kesin ölçüleri kullanıcının örnek ekran görüntüsüyle kesinleşecek; şimdilik mevcut "oyun ortada · kamera üstte" şablonu.
* **Yüz videosu + Anlatım → Görsel:** video anlatımda sahne varken yüz köşede (V1), sahneler V2 tam kare, yüz V3 tam kare (sahne yokken). `place` sahnesinde from+to → uçak silüeti rota üzerinde ilerler.
* **Transkript doğruluğu:** yerleşik futbol sözlüğü (temkinli eşik 0,82; yalnızca büyük harfle başlayan/emin olunamayan kelime; ≥6 harfli terim) + bölünmüş terim birleştirme (Galata saray → Galatasaray) + bir harf eksik yazım (Osimen → Osimhen). Kullanıcı sözlüğü öncelikli ve eski davranış aynı.
* **Whisper "chunk_0.wav bulunamadı" (Windows):** dosya adı yazımları sırayla denenir (göreli → mutlak → 8.3 kısa yol → ASCII geçici klasöre kopya); dosya yoksa/silinmişse anlaşılır mesaj.
* **Zaman damgası:** ana konu başlıklarda tekrarlanmaz; `chapters --titles` ile Claude Code'un yazdığı başlıklar. **Öneriler paneli:** sayaç yok; zaman aralığı + ne konuşulmuş.
* **Dosya penceresi:** Ses / Video / Tümü + "Tüm dosyalar".

## 44. Anlatım → Görsel (anlatılanı hareketli sahnelerle görselleştirme)

**İstek:** içerik üreticisi bir konuyu (ör. Stuttgart'ın hikâyesi) anlatırken Claude Code'un arkadan anlatılana göre animasyonlu sahneler (rakam kartları, isim bandı, sezon çizelgesi) üretmesi; aynısı ClipForge'da, ayrı bir yerde, "sesi atarım, görselleştirsin".
* **Girdi:** ses ya da video anlatım. Çıktı: tek proje — anlatım sesi Ses katmanında, sahneler Video 1'de (normal klipler; sonradan elle düzenlenir). Kaynağa dokunulmaz.
* **Sahne dili (`shared/story`):** saf JSON (`StoryPlan`): `stats`, `timeline`, `list`, `person`, `quote`, `title`, `place`. Her sahnenin anlatım zamanı ve (kart/madde için) sahne içi `at` zamanı var; öğe konuşulduğu an belirir. Çizim: ASS vektör animasyonu + ffmpeg (ek bağımlılık yok, deterministik). Ortak zemin (ızgara/parıltı/marka) bir kez PNG'ye çizilip her sahnede arka plan olur → ~7 kat hızlı. Harita sahnesi mevcut harita çiziciyi kullanır.
* **Planlama (3 yol):** (1) kurallı taslak (`planStory`): rakam+birim → rakam kartları, `22/23` sezonları → çizelge (yan cümleler madde, ton anahtar sözcüklerden), "teknik direktör Ad Soyad" → isim bandı, bilinen yer → harita, bölüm başlıkları → başlık; (2) yapay zekâ (ayarlıysa; çıktısı `sanitizeContent` ile süzülür, çağrı metni atılır); (3) Claude Code `story-plan.json`'u kendisi yazar. Kullanıcı arayüzde her sahneyi kapatır/siler/ekler/düzenler; kurguyu o belirler.
* **Güncelleme (kullanıcı isteği):** asıl yol **Claude Code**: `story plan --blank` → transkripti oku → `story schema` ile planı kendisi yaz → kullanıcıya onaylat → `story preview` (PNG kareler, medya/ses gerekmez) → `story build`. Tema varsayılanı siyah + sarı. Gerçekçi sahne ve 2D/3D karakter için `media` sahnesi (hazır görsel/video/şeffaf PNG karakter; üretimi Claude Code'un görsel üretim aracıyla yapar, kullanıcı onayıyla): ClipForge'a üretim modeli gömülmedi.
* **Futbol sahnesi:** anlatılan pozisyonun 3B perspektifli canlandırması (`football`): saf simülasyon (`shared/story/football.ts`: oyuncu/top/kamera/etiket/bölge/iz; kimlik, top zinciri, çakışan hareket denetimi) + çizim (`footballAss.ts`). Çizim **yazılım rasterleştiricide** (`raster.ts`: sıfırdan farklı sarımlı çokgen dolgu, 3 alt tarama) yapılıp ffmpeg'e ham RGB verilir; yalnızca yazılar ASS ile biner — ilk denemede her şeyi libass çokgeniyle çizmek 54 bin olayla bellek tükettirip ffmpeg'i öldürdü. Hız ≈ gerçek zamanın 2 katı (1080p). Önizleme tek kareyi çizer (`story preview`). Oyuncular sade figür; gerçek yüz/forma yok.
* **Takım kimliği ve araştırma (kullanıcı isteği):** anlatıdaki takıma göre forma/renk (`shared/story/teams.ts`: ~60 kulüp/milli takım, ev + yedek forma, şort/çorap/desen; Türkçe-İngilizce takma adlarla bulunur). Web'den doğrulandı: Bayern 2025/26 iç saha = kırmızı forma + kırmızı şort/çorap (adidas/FC Bayern lansmanı); Galatasaray 2025/26 = "parçalı" sarı-kırmızı (Puma); Kane 2025/26 Bundesliga'yı 36 golle gol kralı bitirdi (Bundesliga.com/FC Bayern). Formalar sezonluk değiştiği için veri "genel renk"tir; Claude Code anlatılan sezonu web'den doğrulayıp `color/color2/shorts/socks/pattern/alt` ile ezer. Renk çakışmasında rakip yedek forma giyer; kaleci rengi iki takımdan da uzak seçilir; tribün ev sahibinin renginde. Diğer sahneler `team` ile vurgu rengini takımdan alır; `source` alanı ekrana KAYNAK yazısı koyar; `plan.research` doğrulanan bilgiler + kaynaklar için. Arma/logo yok. ClipForge'un kendisi web'e gitmez; araştırmayı Claude Code yapar (CLAUDE.md'de zorunlu adım).
* **Bilgi paketi ve veriye dayalı grafikler (kullanıcı isteği: "anlattığım videoyu zenginleştir, gol krallığında 2-5. kim?"):** `shared/story/data.ts` + `resources/knowledge/datasets.json` (+ kullanıcı `knowledge/`): kaynaklı, tarihli, doğruluk durumlu veri kümeleri. Tohum veri bu oturumda web aramasıyla toplandı; **arama özetleri tutarsız çıktı** (Kane için bir sayfa 33, resmi kaynaklar 36; birçok liste yalnızca ilk 2-5 sırayı veriyor; Premier Lig 3-5. sıra çelişkili) ve bu oturumda ham tablo çekme (Wikipedia) ağ izni/denetim nedeniyle yapılamadı. Bu yüzden model **eksiği uydurmaz**: `complete:false`, `value:null`, `status:snapshot`, bayatlık uyarısı (güncel sezonda 14 gün+); sahne yalnızca bilineni gösterir. Yeni sahneler: `leaderboard` (çubuklu sıralama, vurgulu satır, takım renkli çubuk, sondan başa belirme), `compare`, `teamcard` (forma deseni + otomatik künyeler). Kurallı planlayıcı artık bilgi paketiyle çalışır: takım adı → takım kartı, "gol krallığı/puan durumu" + lig/oyuncu → sıralama (vurgu: adı geçen oyuncu), veri yoksa uyarı. Asıl veri toplama Claude Code'un işi (WebFetch ile ana kaynak sayfaları → `story data add`); CLAUDE.md'de akış yazılı.
* **Güncel veri kuralı + marka koruması (kullanıcı kuralı):** rakamlar hafızadan değil o gün web'den alınır (anlatımda "Haaland gol kralı" denirken Haaland 5 gol daha atmış olabilir). Kod tarafı: sezonu süren veri kümesi `asOf` 1 günden eskiyse `story build`/arayüz çizimi reddedilir (`staleDatasets`; `--allow-stale`/"Eski veriyle de çiz" = bilinçli onay); `story preview` `freshness` raporlar; ekrandaki KAYNAK satırı verinin tarihini yazar; kurallı planlayıcı bayat veriyi uyarır. ClipForge'un kendisi internete gidip veri çekmez (anahtar/kaynak yok, tutarsızlık riski): çekme işi Claude Code'un zorunlu adımı (CLAUDE.md). Marka: `theme.brand` varsayılan boş; referans videodaki başka kanalın adı (Akıl Oyunu) kodda engelli (`cleanBrand`), asla yazılmaz.
* **Sınırlar:** kurallı planlayıcı basit (yan cümle → madde); isim bandı şeffaf değil (koyu zeminde); büyük harf dönüşümü Türkçe (yabancı adlarda `i` → `İ`); gerçek bir anlatımla gözle denenmedi (yapay transkript ve kare kontrolüyle doğrulandı).

## 43. Premium altın altyazı stili ve altyazı başına satır genişliği

**İstek:** beyaz/siyah yerine altın-sarı, ince siyah konturlu "premium" altyazı; 8 kelimelik altyazı üst üste (çok satıra) yığılıyorsa sağa çekerek düzenleyebilmek.
* **Stil:** `premium-gold` hazır stili — Arial Black, altın (#F2B705), 3 px siyah kontur, hafif gölge, kutusuz, satır başına ≤4 kelime, son kelimeler açık sarı. Altyazı panelindeki "Altyazı stili" listesinde; CLI `captions --style premium-gold`.
* **Satır genişliği:** `Caption.maxChars` (altyazıya özel, yoksa stildeki). Seçili altyazının sağında ↔ tutamacı: sağa çek → kelimeler daha az satıra yayılır, yazı boyutu değişmez; sol kenar sabit kalır. Panelde aynı ayar kaydırıcı + "tüm altyazılara uygula" + sıfırla. Önizleme ve dışa aktarma aynı `captionLayout`'u kullanır.

## 42. YouTube zaman damgaları (bölüm listesi)

**İstek:** 2 saatlik yayını düzenleyip kaydettikten sonra YouTube açıklaması için "şu dakika arası şunu konuştum" listesi.
* **Neye göre:** DÜZENLENMİŞ videonun zaman çizelgesi (sessiz kesimleri ve boşluk kapatma sonrası) — dışa aktarılan videoyla **aynı zamanlar**. Bu yüzden düzenleme bittikten sonra çalıştırılır; düzenleme değişirse yeniden oluşturulmalıdır.
* **Yöntem (`shared/chapters.ts`) — kullanıcının örneğine göre (düzeltme):** başlıklar **kişi/takım adlarıdır** ("Papa Gueye", "Rafael Leao", "Ederson"; birden çok ad konuşulduysa virgülle: "Chevalier, Salah, Guirassy"). Çizelge transkripti 30 sn'lik birimlere bölünür; her birimde büyük harfle yazılmış özel adlar sayılır, baskın ad komşularla yumuşatılarak bölüm aralıkları çıkar; çok kısa aralıklar birleştirilir, çok uzunlar en derin konu sınırından bölünür. Ad yoksa anahtar kelimeler, o da yoksa "Sohbet"; ilk bölüm "Giriş". **Sıklık** seçilebilir: Az (≈7 dk), Orta (varsayılan ≈3,5 dk), Çok (≈2 dk). İsteğe bağlı yapay zekâ da aynı üslupta çok kısa ad başlığı yazar; çağrı/yönlendirme içerenler atılır.
* **Çıktı:** Kullanıcının örneğindeki gibi: `Saniyeler:` başlığı, boş satır, sonra `00:00:00 - Giriş` / `00:12:42 - Ederson` (her zaman SS:DD:SS). Kurallar denetlenir ve uyarı verilir (ilk bölüm 0:00, en az 3 bölüm, en az 10 sn). Sağ panel → **Zaman damgası**: metin düzenlenebilir, **Kopyala** ve **Dosyaya kaydet (.txt)**. Dışa aktar penceresinde "YouTube zaman damgalarını da yaz" (10 dk'dan uzun videoda varsayılan açık, yalnızca "tüm çizelge" kapsamı) → videonun yanına `<ad> - zaman damgaları.txt`. Auto Kick tam videonun yanına aynı dosyayı otomatik yazar. CLI: `chapters`.
* **Sınırlar:** yalnızca kelime dağarcığı değişimine bakar (bölüm sınırları ±1-2 dk kayabilir; kullanıcı metni düzeltebilir); başlıklar yapay zekâsız basit; ≥3 bölüm çıkmayan kısa/tek konulu videoda uyarı verilir ve dosya yazılmaz. Gerçek 2 saatlik yayında denenmedi (yapay transkriptle sınırlar ±2 dk içinde bulundu).

## 49. Auto Clips: süre 20–178 sn ve sosyal medya şeridi
- Klip süresi 20 sn ile 2 dk 58 sn arasında; konu bölümü 178 sn'yi aşmadıkça bölünmez.
- Kullanıcının sosyal medya şeridi (şeffaf PNG) her klibe I1 katmanında, yüz/görüntü kesişim çizgisine ortalı eklenir (genişlik %86; kullanıcı "çok az küçült" dedi). Kapatma/değiştirme: `autoClipsOverlay`, `autoClipsOverlayPath`, CLI `--no-overlay/--overlay`.

## 50. Toplam süre göstergesi
Auto Kick ve Auto Clips işleri bittiğinde ("Tamamlandı") kartta "⏱ Toplam süre: 1 sa 12 dk" yazar (`finishedAt − startedAt`, `fmtElapsed`). Auto Clips süresi klip üretme + MP4 dışa aktarmayı kapsar.

## 51. Sessizlik eşiği, klip sınırları, yatay klipler
- Sessizlik kesme eşiği 0,7 → 0,55 sn (kullanıcı: "bazı yerleri atlamışsın, çok hafif düşür"). Ayar dosyasında eski varsayılan (0,7) kayıtlıysa yüklenirken 0,55'e alınır.
- Klip başı/sonu: `refineClipBounds` — bağlaçlı/çok kısa baş cümle atılır, yarım son cümle atılır/tamamlanır, söz payı (0,3 sn önce, 0,5 sn sonra). Süre sınırları bozulmaz.
- Yatay mod (`horizontal`): 2:58 sınırı yok (45 sn–20 dk; tavan 1 sa), yüz/şerit yok, 16:9 `youtube` ön ayarı; zincirde dikeyden sonra çalışır. `topic-video` konu geçişlerini tek yatay videoda toplar.

## 52. Uzun yolda "whisper.cpp bulunamadı" (Windows)
Uzun video adı (Auto Kick klasörü + proje klasörü + uzun anahtar) çalışma klasörü yolunu 260 karakterin üstüne çıkarınca Windows süreci başlatamıyor (ENOENT) ve hata yanıltıcı biçimde "whisper.cpp bulunamadı" görünüyordu. `shortWorkDir`: yol 120 karakterden uzunsa ya da ASCII değilse geçici ses parçaları `<temp>/clipforge-tr/<kısa ad>` altında tutulur.

## 53. Yatay klip kuralları
Yatay klipler en az 1 dk, en çok 20 dk (kullanıcı: "kısa tutmaya çalışma"), çıkarabildiği kadar (en çok 30). Aynı konunun ardışık bölümleri tek klip; farklı konular birleştirilmez ("bütün konuştuklarımızı bir klipte toplama"). Adsız konular (ör. "webinar") yatayda da alınır.

## 54. Konu yarıda kesilmesin; yatay klipler 3–25 dk
- Dikey/yatay: aynı konunun ardışık bölümleri (ortak ad/anahtar kelime, aralık ≤60 sn dikey / ≤120 sn yatay) tek klipte birleşir; son anılıştan sonra +3 cümle. Kullanıcı: "Orkun 50 sn konuşuldu, klip 30 sn'de yarım kaldı".
- Yatay: en az 3, en çok 25 dk, tercih ~6,5 dk, en çok 15 klip (kullanıcı: "çok fazla küçük klip istemiyorum").

## 55. Kısa video altyazısı (`shorts`)
Referans kısa videodaki gibi: iri beyaz kalın yazı + siyah kontur, kutusuz/vurgusuz, satırda 2–4 kelime (`minWords:2` ile tek kelime komşuya katılır), yüz alanının altında, şeridin hemen üstünde. `autoClipsCaptions` ayarı (varsayılan kapalı; önceki "altyazı istenmedikçe ekleme" kuralı) ve `--captions` ile dikey Auto Clips kliplerine otomatik eklenir. Yatay kliplerde yok.

## 56. "Claude ile edit yap" düğmesi (vlog)
Zaman çizelgesi araç çubuğuna (Sessizleri kes / Boşlukları kapat yanına) ✨ düğmesi: projeyi kaydedip vlog komutunu panoya kopyalar. Editi uygulama değil Claude Code yapar (uygulama Claude'u çağıramaz). Komut: transkript → sessiz kesme + boşluk kapatma → yolculuk cümlelerine 2B/3B rota grafiği (doğrudan) → diğer fırsatlar öneri → frame ile kontrol → liste.

## 57. Vlog zenginleştirme: zoom, ses giriş/çıkışı, ses efekti
Kullanıcı: Paris yalnızca örnekti; 10–30 dk vlogda daha çok görsel (2B/3B), ses giriş/çıkışları, zoom vb. İstenen: `Clip.fx` (zoom from/to/odak, fadeIn/fadeOut) → dışa aktarmada `zoompan` (2× büyütülüp, titremesiz) + `fade`/`afade`; CLI `zoom`, `fade`, `sfx` (ffmpeg lavfi ile üretilen telifsiz whoosh/swish/pop/ding/riser; üst üste binenler SFX2… katmanlarına). Önizleme (arayüz) bu efektleri henüz göstermez; dışa aktarma gösterir. "Claude ile edit yap" komutu bunları kullanır.

## 58. "Claude ile editle" = tam yaratıcı özgürlük
Kullanıcı: ek görsel fırsatları önerme, kendiliğinden ekle; "sahne senin", "şov yap"; beğenmezse söyler. Komut buna göre yeniden yazıldı (öneri/onay yok; disiplin korunur: uydurma yok, çağrı metni yok, güncel veri, konuşma net). `graphic --scene` ile tüm hikâye sahneleri (rakam kartı, liste, zaman çizelgesi…) vlog çizelgesine konabilir.

## 59. Araç çantası genişledi + çağrı butonları
Kullanıcı: çantayı mümkün olduğunca genişlet; abone ol/beğen çağrı butonlarını 2–3 dakikada bir koyabilirsin, kendi özel butonlarını 2 gün içinde verecek. Eklenenler: `text` (animasyonlu ekran yazısı), `grade` (renk havası: fx.grade → ffmpeg), `cta` (kullanıcının buton dosyalarını `resources/cta/` ya da `--file` ile aralıklı gösterir; dosya yoksa hiçbir şey eklemez), yeni sfx türleri (boom, shutter, click, notify). Kural değişti: çağrı yalnızca KULLANICININ butonlarıyla; kendi icat ettiğimiz "abone ol" yazısı/butonu yok; başka kanal adı/logosu yasak.

## 60. Arka plan sesini kes (denoise)
Kullanıcı: yola yakın çekimde araba sesleri gelirse tek düğmeyle azaltılsın, ses odaklansın. `Clip.fx.denoise` (hafif/orta/güçlü) → dışa aktarmada highpass + RNNoise sinir ağı (`arnndn`, model `resources/models/rnnoise-voice.rnnn` "leavened-quisling", telifsiz) + afftdn (+agate). Model yolu çalışma klasöründe göreli `rnnoise.rnnn` (Windows güvenli); model yoksa adım atlanır ve uyarı verilir. Sentetik testte yalnızca gürültü olan aralık −26,6 → −80,8 dB düştü, konuşma aralığı aynı kaldı. Sınır: aynı anda konuşma + gürültü varken gürültü tamamen silinmez, yalnızca bastırılır; önizlemede duyulmaz; Auto Kick full.mp4 (hızlı kesim) henüz kapsam dışı.

## 61. Arka sesi kes: önizlemede de duyulsun; Auto Kick'e uygulanmasın
Kullanıcı: önizlemede de duyulsun, Auto Kick'e uygulama. Çözüm: `AppService.denoisePreview` dışa aktarmadakiyle AYNI filtre zincirini (`denoiseChain`) ses akışına uygulayıp `<veri>/denoised/<varlık>_a<i>_<seviye>.m4a` olarak önbelleğe yazar; `cf-media://…/audio/<i>/<seviye>` ile servis edilir; önizleme motoru (denoiseReady) hazır olunca o kopyayı çalar. Hazırlık arka planda (uzun kayıtta dakikalar sürebilir), bildirimle haber verilir. Auto Kick full.mp4'e bağlanmadı.

## 62. Klip bazında sesi kapatma
Kullanıcı: ikinci video eklenince birinin (ya da diğerinin) sesini kesebilmek (ev edit sırasında can sıkıyordu). Video + bağlı ses klibi grup olduğundan, video klibi seçilince grubun ses klibi `muted` olur (`ops.setClipsMuted`); sesi olmayan klipte değişmez ve bilgi verilir. Arayüz: araç çubuğu düğmesi, M tuşu, denetçi kutusu, klipte 🔇. Önizleme ses seviyesini 0'lar, dışa aktarma kapalı klibin sesini filtre grafiğine koymaz. CLI `mute`.

## 63. Fragman (trailer) özelliği
Kullanıcı: 30 dk'lık YouTube vlogundan 10–60 sn'lik parçalar verecek; "Fragman"a basınca "videodan belirli yerleri seç" denmeli; güzel bir fragman çıkmalı. Ayrı pencere (üst çubuk → Fragman). Parçalar zaman çizelgesi aralığı ya da kütüphane videosu; en güçlü anlar puanlanıp kısa planlara kesilir, kanca başa, zoom/whoosh/boom/giriş geçişi/kapanış kartı; sonuç AYRI proje (`-fragman/`). `createTrailerProject` kaynağın tüm medyasını (aynı dosyalar) taşır. Ses efektleri `main/sfx.ts`ye ortaklaştırıldı. Sınır: puanlama sezgiseldir (transkript kalitesine bağlı); müzik yok; kapanış kartı yalnızca başlık+alt başlık metni.

## 64. Fragman: yön + üç yol
Kullanıcı: Fragman'a basınca yatay/dikey seçeneği; otomatik fragman için üçüncü buton; "klip seç" butonuyla (1:10–1:20 gibi) seçilenlerin güzelce birleştirilmesi. Eklenenler: yön (16:9 / 9:16; dikeyde ana görüntü ortadan 9:16 kırpılır, tüm video katmanları tam kare cover), `mode` exact/moments/auto (`planShots` exact'te aralıkları olduğu gibi döndürür; `autoSegments` vlogu eşit bölgelere ayırır), dk:sn girişi (`parseClock`), CLI `--clips/--auto/--vertical`. Sınır: dikey kırpma ortadan yapılır (konuşmacı kenardaysa kadraj kaçabilir; yüz takibi yok).

## 65. Fragman: fareyle aralık seçimi
Kullanıcı: 20 dakikalık videoyu göster, saniye yazmak yerine fareyle seçeyim. `RangePicker`: üstte tüm vlog şeridi (tıkla/sürükle pencereyi götürür), altta ayrıntı şeridi (sürükle = aralık; 30 sn–5 dk pencere), mevcut seçimler renkli blok, oynatma başlığı çizgisi, üzerine gelince transkriptten o anın cümlesi, ±0,5 sn ince ayar. Seçim dk:sn alanlarına yazılır (elle düzenlenebilir). Sınır: videonun karesi/dalga formu gösterilmez; konum konuşma metni ve zaman cetveline bakılarak bulunur.

## 66. "Claude ile edit yap" düğmeleri kaldırıldı
Kullanıcı isteği: araç çubuğundaki ✨ ve Auto Kick sonucundaki "Claude ile edit yap" düğmeleri kaldırıldı (`claudeVlogPrompt` silindi). Düzenleme akışı değişmedi: kullanıcı Claude Code'a doğrudan yazar; Story/Fragman pencerelerindeki "komutu kopyala" düğmeleri durur.

## 67. Hız: sözlük önbelleği, hızlı whisper, eşzamanlı parça, önizleme kopyası
Kullanıcı: kayıt içe aktarma ve transkript aşamaları çok uzun sürüyor. Bulgu: (1) `applyVocabulary` her kelime/çift için tüm terimlerle benzerlik hesaplıyordu (30 bin kelime × 1500 terim: >200 sn, şimdi ~0,5 sn); (2) whisper-cli varsayılanı ışın araması (beam 5) → `-bs 1 -bo 1` (ayar `whisperFast`); (3) tek whisper süreci çok çekirdekte işlemciyi tam kullanamaz → 8+ çekirdekte 2 parça eşzamanlı; (4) Auto Kick gözetimsiz → `autoKickFullSpeed` ile tam çekirdek; (5) editördeki önizleme kopyası 30 fps + ultrafast. Ölçülemeyenler: gerçek whisper hızlanması (burada whisper yok; kullanıcının makinesinde denenecek).

## 68. Hız: her yolda aynı (Auto Kick + sistem geneli)
Kullanıcı: hızlandırmayı hem Auto Kick'te hem sistemin genelinde uygula. Gerçek transkripsiyonlar zaten `transcriptStart`'tan geçiyordu (hızlı whisper, eşzamanlı parça, sözlük önbelleği hepsinde). Eksikler kapatıldı: whisper iş parçacığı tüm çekirdek; CLI oturumları `autoKickFullSpeed` ile tam hız (`enableCliFullSpeed`; Electron içindeki Auto Kick kendi ayarını ayrıca uygular, mod geri yüklenir); `detectSpeechTrack` en küçük model + 30 sn örnek + eşzamanlı track'ler; eşzamanlı whisper çağrılarında çıktı adı çakışması giderildi.

## 69. Çağrı butonları araç çantasında (4 hazır buton)
Kullanıcı 4 video verdi (YouTube giriş/çıkış 4K60, TikTok/Twitter/Instagram takip): hepsi 5 sn, sesli, #00FD00 YEŞİL PERDELİ; buton karenin altından yükselip tıklanıyor ("TAKİP ET"→"TAKİP EDİLİYOR"; YouTube'da abone ol+beğen+zil) ve iniyor (ölçüm: hareket alanı x 0,19–0,81, y 0,46–1,0). `resources/cta/` altına kopyalandı + `cta.json`. Yeni: `Clip.fx.chroma` (dışa aktarma `chromakey`+`despill`, önizleme canvas keying), `shared/cta.ts` (manifest, `ctaRect` alt kenara yapışık yerleşim, rotasyon), `cta` komutu cta.json kipi (sıra YouTube–TikTok–YouTube–X–YouTube–Instagram; sesleri `CTAS` izinde), araç çubuğu "＋ Çağrı butonu" ve `cta:list` IPC. Kural: çağrı yalnızca bu butonlarla.

## 70. CapCut benzeri zaman çizelgesi (ses dalgası klibin üstünde)
- Ses katmanları (A1/A2) varsayılan GİZLİ: yalnızca bir video klibine bağlı sesler gizlenir; ses dalgası video klibinin alt yarısında çizilir (`ClipWave`, `media:waveform` IPC, önbellek `<veri>/waveforms/`). "♪ Ses katmanları" düğmesi (`localStorage cf-audio-lanes`) eski görünümü açar.
- Hacim çizgisi klibin üstünde sürüklenir (dB gösterir; çift tık = 0 dB); en altta ses kapanır. Klip başlığında ad + süre, şeritler 58 px.
- Sağ tık menüsü: sesi kapat, **sesi görüntüden ayır** (`detachAudio`), **sesi sil, görüntü kalır** (`removeAudioOf`), klibi sil.
- Önizleme: "⛶ Tam ekran" düğmesi / **F** tuşu (1080p tuval).

## 71. Maç sonu edit (referans video analizi)
Kullanıcı "Fenerbahçe nasıl kollandı" tarzı videolar paylaşıyor. Referans: üst yüz + alt konu görseli (mevcut Auto Clips düzeni), kutulu vurgulu altyazı (mevcut `boxed-highlight`), YENİ: maç görüntüsü tam kare araya girer (bulanık dolgu). Eklenen: `Clip.fx.blurFill` (export plan + önizleme), `match-edit` komutu (`VC` katmanı, `--clips`/`--auto`). Görüntüleri kullanıcı sağlar (telif); referanstaki daire vurgusu ve zoom sonradan eklenebilir.
