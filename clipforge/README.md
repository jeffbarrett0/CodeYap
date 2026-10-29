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
| **Konuşmada arama** | Tek kelime / isim / serbest cümle. **Tam** (ı/i, ş/s, ğ/g, ç/c, ö/o, ü/u duyarsız) · **bulanık** (“Viktor Nelsen” → “Victor Nelson”, eşik ayarlı) · **yakınlık penceresi** (“Victor” ve “Nelson” 10 sn içinde) · isteğe bağlı **anlamsal** arama. Sonuç: zaman, cümle, önceki/sonraki bağlam, skor; zamana göre sıralı; aynı konuşmadaki tekrarlar tek sonuç; tıklayınca oynatıcı o ana gider; son 10 sorgu. |
| **Klip oluşturma** | Başlangıç/bitiş **cümle sınırına** yapışır; pre-roll (5 sn) / post-roll (10 sn) ayarlı; hedef 15/30/60 sn; sınır aşımı uyarısı; oynatıcıdan ince ayar; kaynak zaman damgası klipte saklanır; tek tek ya da toplu. |
| **Otomatik öneri** | Ses enerjisi sıçramaları, **sohbet hızı** (CSV/JSON/metin; sütun eşlemesi), tepki sözcükleri, isteğe bağlı sahne yoğunluğu, OBS işaretçileri → skor + **gerekçe**; kabul/red/süre ayarı. İşaretçi yoksa sessizce kapalı. |
| **Zaman çizelgesi** | Çoklu video/ses izi, yakınlaştırma, taşı / kenardan kırp / böl / sil, bağlı (grup) klipler, kare kare oynatma başlığı, **geri al/yinele** (komut deseni), otomatik altyazı (yazı tipi/renk/konum), yüz kamerası overlay'i (ayrı dosya + senkron ya da tek dosyada bölge). |
| **Önizleme & dışa aktarma** | Gerçek zamanlı canvas önizleme; 9:16 · 1:1 · 16:9; 9:16'da **oyun ortada, kamera alt/üstte** düzeni; oyun/konuşma **ayrı ses seviyesi**; H.264, çözünürlük/fps/bitrate/CRF; kuyruk, ilerleme, iptal; TikTok/Reels/Shorts (9:16, 60 sn) ve YouTube şablonları; **telif hatırlatması**. |

### Klavye kısayolları
`Space` oynat/durdur · `S` böl · `Delete` sil · `J/K/L` geri/dur/ileri (tekrar basınca hızlanır) · `←/→` kare (Shift: 1 sn) ·
`Ctrl/Cmd+Z` geri al · `Ctrl/Cmd+Shift+Z` yinele · `Ctrl/Cmd+S` kaydet · `Ctrl/Cmd+E` dışa aktar · `Ctrl + tekerlek` yakınlaştır.

## Kurulum ve çalıştırma

Gereksinimler: **Node.js ≥ 20** (22 ile test edildi) ve npm.

```bash
cd clipforge
npm install          # electron, ffmpeg-static, ffprobe-static dahil (ağ erişimi gerekir)
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
1. **Medya → Kayıt içe aktar** (ya da dosyayı pencereye bırak). Önizleme kopyası arka planda hazırlanır.
2. **Transkripsiyonu başlat** (Track 1 varsayılan). İlerleme alttaki *Görevler* çubuğunda; iptal edilebilir.
3. **Arama** sekmesi: `Victor Nelson` (ya da `Victor Nelson ile ilgili konuştuğum yer`, `Viktor Nelsen`) → sonuçlar zaman damgasıyla listelenir.
4. **Klip oluştur** → sağ panelde pre/post-roll ya da hedef süre (30 sn), oynatıcıda `[ Baş` / `Son ]` ile ince ayar → **Zaman çizelgesine ekle**.
5. **Düzen** sekmesi: 9:16 + “Oyun ortada · kamera altta”. **Altyazı** sekmesi: *Transkriptten altyazı üret*.
6. **Dışa aktar** → şablon (TikTok/Reels/Shorts) → telif hatırlatmasını onayla → kuyruğa eklenir.

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
