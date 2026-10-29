# ClipForge — Mimari

Bir Kick yayıncısının OBS kaydından (ör. 60 dk MKV) **konuşmada arama yaparak** klip çıkardığı, klibi CapCut benzeri bir
zaman çizelgesinde düzenleyip 9:16 olarak dışa aktardığı masaüstü uygulaması.

## 1. Teknoloji seçimi ve gerekçe

| Katman | Seçim | Neden |
|---|---|---|
| Kabuk | **Electron** (Tauri değil) | Önizleme için Chromium'un `<video>`/Canvas/WebAudio yığınına ve **H.264/AAC çözücülerine** ihtiyaç var. Tauri macOS'ta WKWebView, Windows'ta WebView2, Linux'ta WebKitGTK kullanır: codec ve `canvas`+`<video>` davranışı üç platformda farklıdır ve MKV/FLV proxy'leri dahil medya oynatma tutarsızlığı en büyük risk. Electron tek, sabit bir Chromium sürümü demektir. Ana süreç Node.js olduğu için ffmpeg/whisper alt süreçlerini yönetmek, iptal etmek ve `ffmpeg-static` gibi hazır ikilileri paketlemek de basittir. Maliyet: ~100 MB kurulum boyutu. |
| Arayüz | React 19 + TypeScript (strict) | Bileşen modeli zaman çizelgesi/inspector gibi yoğun durumlu arayüze uygun. |
| Durum | **Zustand** (tek store) | Redux Toolkit'e göre çok daha az şablon kod; proje durumu tek store'da, zaman çizelgesi düz JSON. |
| Derleme | electron-vite (Vite 8) | main / preload / renderer için tek yapılandırma, HMR. |
| Video | **FFmpeg** (`ffmpeg-static` ya da kullanıcının kendi ikilisi) | İçe aktarma, proxy, ses çıkarma, analiz ve dışa aktarmanın tamamı. |
| Transkripsiyon | **whisper.cpp** (varsayılan), faster-whisper, OpenAI Whisper API | Yerel ve gizlilik dostu varsayılan; bulut isteğe bağlı. Bkz. `DECISIONS.md`. |
| Arama indeksi | Bellekte ters indeks + sözlük (SQLite FTS değil) | 1 saatlik kayıt ≈ 7–15 bin kelime: kurulum ms, sorgu ms. Bulanık eşleşme sözlük üzerinde yürür; FTS bulanık/yakınlık aramasını zaten karşılamazdı. |
| Test | Vitest (birim + ffmpeg entegrasyon), Playwright (arayüz + gerçek Electron) | |
| Paketleme | electron-builder (dmg/zip, nsis) | |

## 2. Süreç modeli

```
┌──────────────────────────── Renderer (React, sandbox, contextIsolation) ─────────────────────────┐
│  Zustand store ── Arayüz bileşenleri ── PreviewEngine (canvas + gizli <video>/<audio>)            │
│        │ window.clipforge  (ClipforgeApi)                                                         │
└────────┼──────────────────────────────────────────────────────────────────────────────────────────┘
         │ preload (contextBridge): invoke<C>(kanal, ...args), on<E>(olay), mediaUrl(), pathForFile()
┌────────▼─────────────────────────────── Main (Node) ─────────────────────────────────────────────┐
│  ipc.ts  (tipli kanallar, hata → anlaşılır mesaj)        cf-media:// (Range destekli dosya sunumu) │
│  AppService ── TaskQueue (iptal edilebilir, ilerleme)    SettingsStore, proje G/Ç                  │
│      │                                                                                            │
│      ├─ ffmpeg / ffprobe  ── alt süreçler (içe aktarma, proxy, ses analizi, dışa aktarma)          │
│      ├─ whisper-cli / python(faster-whisper) / HTTPS (OpenAI) ── transkripsiyon parçaları          │
│      └─ SearchService (bellekte indeks)                                                           │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
                   src/shared/** : saf TypeScript çekirdek (node/electron/DOM import etmez)
```

* **Arayüz hiç kilitlenmez:** ağır işlerin hepsi alt süreçtir (ffmpeg, whisper). Arama/indeksleme milisaniyeler sürdüğü
  için main'de çalışır; gerekirse `utilityProcess`'e taşınabilir (`SearchService` saf TS).
* **Güvenlik:** `contextIsolation`, `sandbox`, `nodeIntegration: false`; renderer'a yalnızca tipli dar bir API verilir.
  `cf-media://` yalnızca kayıtlı varlıkların proxy/küçük resim/ses dosyalarını sunar (yol enjeksiyonu yok: kimlik → yol
  eşlemesi). Üretimde CSP meta etiketi uygulanır.
* **Tarayıcı modu:** `window.clipforge` yoksa `api/mock.ts` devreye girer. Mock, **gerçek** `SearchService`, `TaskQueue`,
  sohbet ayrıştırıcı ve skorlama kodunu kullanır; yalnızca ffmpeg/whisper/dosya sistemi taklit edilir. `npm run dev:web`
  ve Playwright arayüz testleri bunu kullanır.

## 3. Klasör yapısı

```
clipforge/
├─ src/
│  ├─ shared/                 # Saf çekirdek — hem main hem renderer kullanır, birim testlerle doğrulanır
│  │  ├─ types.ts             # Veri modelleri (Project, MediaAsset, Transcript, …)
│  │  ├─ ipc.ts               # Tipli IPC sözleşmesi (kanallar, olaylar, ClipforgeApi)
│  │  ├─ text.ts              # Türkçe katlama, tokenizer, Damerau-Levenshtein, fonetik indirgeme
│  │  ├─ search/              # engine (tam/bulanık/pencere), semantic, service
│  │  ├─ transcript/          # sentences (cümle bölütleme), chunking (örtüşen pencereler + birleştirme)
│  │  ├─ clip/boundaries.ts   # Pre/post-roll, hedef süre, cümleye yapışma, uyarılar
│  │  ├─ timeline/            # model, ops (katman/kesme/birleştirme), history+commands, captions, create, templates, transcript
│  │  ├─ export/              # presets, layout (9:16 düzenleri), ass (altyazı), plan (ffmpeg filtre grafiği)
│  │  ├─ chat/parse.ts        # CSV/TSV/JSON/metin sohbet günlüğü + mesaj hızı serisi
│  │  ├─ suggest/score.ts     # Ses, sohbet, anahtar kelime, sahne, işaretçi → aday skoru + gerekçe
│  │  └─ media/               # probe (ffprobe + OBS algılama), markers, sync (ses ofseti)
│  ├─ main/                   # Electron ana süreç
│  │  ├─ index.ts, ipc.ts     # Pencere, menü, cf-media://, tipli IPC bağlama
│  │  ├─ app.ts               # AppService: tüm iş mantığı (Electron'a bağımlı değil → test edilebilir)
│  │  ├─ tasks.ts             # TaskQueue
│  │  ├─ ffmpeg.ts            # Alt süreç çalıştırma, ilerleme, iptal, anlaşılır hata mesajları
│  │  ├─ media/               # import, proxy, audio (PCM/RMS, sahne)
│  │  ├─ transcribe/          # providers (whisper.cpp, faster-whisper, OpenAI, mock), pipeline, models
│  │  ├─ export.ts            # Dışa aktarma çalıştırıcı (.part → yeniden adlandırma)
│  │  └─ project/io.ts        # Proje kaydet/aç (göreli yollar)
│  ├─ preload/index.ts        # contextBridge
│  └─ renderer/               # React arayüzü (store.ts, components/, preview/engine.ts, api/{index,mock}.ts)
├─ tests/
│  ├─ unit/                   # Vitest: çekirdek + gerçek ffmpeg entegrasyonu
│  ├─ e2e/                    # Playwright: tarayıcı modu (app.spec) ve gerçek Electron (electron.spec)
│  └─ perf/hour.test.ts       # 60 dk'lık gerçek MKV ile kabul denemesi
├─ resources/faster_whisper_cli.py
├─ scripts/make-fixtures.mjs
├─ electron-builder.yml, electron.vite.config.ts, vite.web.config.mts, vitest*.mts, playwright*.ts
└─ docs/ARCHITECTURE.md, DECISIONS.md, README.md
```

## 4. Veri modelleri (`src/shared/types.ts`)

Tüm zamanlar **saniye**; hepsi düz JSON (class/Map/Date yok).

| Model | Önemli alanlar |
|---|---|
| `Project` | `assets`, `timeline`, `chatLogs`, `candidates`, `markers`, `searchHistory` (≤10), `transcriptRefs`, `exportJobs`, `version` |
| `MediaAsset` | `path`/`relativePath`, `container`, `durationSec`, `width/height/fps`, `videoCodec`, `audioStreams[]` (Track 1…N), `obs` {isObs, version, encoder, evidence}, `chapters`, `proxyPath`, `thumbnailPath`, `transcriptionTrack`, `audioMap` {mix, game, voice}, `webcamRegion`/`webcamAssetId`/`syncOffsetSec` |
| `Transcript` | `words[]` (`TranscriptWord`: text/start/end/confidence), `segments[]` (`Segment`: cümle, kelime aralığı), `language`, `model`, `provider`, `audioTrack` |
| `SearchResult` | `start/end`, `sentence`, `before[]/after[]`, `score`, `kind` (exact/fuzzy/window/semantic), `matchCount`, `matchedWords[]`, `missingTerms?` |
| `Timeline` | `aspect`, `background`, `tracks[]`, `captions[]`, `captionStyle` (`layout`/`webcamOverlay` yalnızca eski projeler için yedek) |
| `Track` | `kind` (video/audio/image/text), `role`, `clips[]`, `muted/locked/volume`, **`placement`** (katmanın kare içindeki rect/fit/visible/opacity), `textDefault` |
| `LayoutTemplate` | kaydedilebilir düzen: aspect, arka plan, katman listesi (konum + metin biçimi) |
| `Clip` | `text?` (metin klibi), `start`, `srcIn/srcOut`, `assetId`, `audioStream?`, `groupId?`, `origin` (**kaynak zaman damgası meta verisi**: sorgu, eşleşme anı), `overlay?`, `crop?` |
| `Caption` / `CaptionStyle` | zamanlı metin / yazı tipi, renk, kontur, konum, büyük harf |
| `ChatLog` / `ChatMessage` | `t` (kayıt başından sn), `user`, `text` |
| `ClipCandidate` | `start/end/peak`, `score`, `reasons[]` (signal, strength, label), `status` |
| `ExportJob` / `ExportOptions` | şablon, çözünürlük, fps, bitrate/CRF, ses dengeleme, azami süre |

## 5. Ana akışlar

**İçe aktarma** — `media:import` → görev(import): ffprobe → OBS algılama (etiket, dosya adı, ilk 1 MB'ta x264 SEI imzası) →
2 sn test çözümü (bozuk dosya/eksik codec burada anlaşılır mesajla yakalanır) → küçük resim → `asset:added`. Ardından görev(proxy):
tek ffmpeg geçişinde `proxy.mp4` (540p, kısa GOP, sessiz) + her ses track'i için mono AAC (`audio_N.m4a`).

**Transkripsiyon** — `transcribeAsset`: aynı (track, dil, model, sağlayıcı) için kayıtlı transkript varsa **yeniden kullanır**.
Aksi halde kaydı 10 dk + 15 sn **örtüşen** pencerelere böler; her pencere 16 kHz mono WAV'a çıkarılıp sağlayıcıya verilir,
sonucu diske önbelleklenir (iptal/çökme sonrası kaldığı yerden sürer). `mergeChunkResults` her sınırda iki pencerenin de
sessiz olduğu (yoksa örtüşmenin orta) noktada keser → kelime kaybı/tekrarı yok. Sonra `buildSegments` cümleleri çıkarır.

**Arama** — `SearchService` → `searchTranscript`: sorgu → içerik terimleri (dolgu sözcükler atılır: "…ile ilgili konuştuğum yer")
→ her terim sözlükte **tam** (ı/i, ş/s … katlanmış), **ek almış** ("Nelson'dan"), **bulanık** (Damerau-Levenshtein + fonetik
indirgeme; eşik ayarlı) eşlenir → terimlerin `windowSec` içinde birlikte geçtiği pencereler aday olur → çakışanlar elenir →
aynı konuşma bölümündekiler **tek sonuçta birleşir** → bağlam cümleleri eklenir. Hiçbir yerde tüm terimler bir arada yoksa
düşük skorlu *kısmi* sonuçlar (işaretli) döner.

**Klip** — `suggestClip`: pre/post-roll (varsayılan 5/10 sn) **cümle sınırına yuvarlanır**; ya da hedef süre (15/30/60) için
sonuç cümlelerinin etrafına hedefi aşmayacak biçimde cümle eklenir. Başlangıç/bitiş hiçbir cümlenin içine düşmez. Uyarılar:
platform sınırı aşımı, eşleşme hedeften uzun, hedeften kısa. Klip → `clipItemsForSource`: V1 (ekran) + A1/A2 (oyun/konuşma
ayrı track'lerdeyse ayrı, değilse karışım) + V2 (kamera) — hepsi `groupId` ile bağlı, `origin` ile kaynağa bağlı.

**Zaman çizelgesi** — Saf, değişmez işlemler (`ops.ts`) + komut deseni (`commands.ts`, `history.ts`): her komut uygulandığı
andaki durumu anı olarak saklar; sürükleme komutları tek geri alma adımında birleşir.

**Dışa aktarma** — `buildExportPlan` zaman çizelgesini **tek** ffmpeg komutuna çevirir: her klip `-ss/-t -i` girişi (yalnızca
gereken kısım çözülür), siyah taban + bulanık dolgulu ekran + kamera kırpması/yerleşimi + ASS altyazı, `amix` ile iz seviyeli ses,
isteğe bağlı loudnorm. Çıktı `.part` olarak yazılıp bitince yeniden adlandırılır; iptalde yarım dosya kalmaz.

## 6. Tipli IPC

`src/shared/ipc.ts` içindeki `IpcInvoke` (kanal → [argümanlar, sonuç]) ve `IpcEvents` tabloları hem `ipcMain.handle`
tarafında (`Handlers` eşlemi derleme zamanında tüm kanalları zorunlu kılar) hem preload'da hem renderer'da kullanılır.
Hatalar main'de `IpcResult` olarak sarılır; renderer'a **anlaşılır Türkçe mesaj** olarak ulaşır (`userMessage`).

| Kanal | İş |
|---|---|
| `app:info`, `settings:get/set` | Araç durumu (ffmpeg/whisper/modeller), ayarlar |
| `dialog:*`, `project:*` | Dosya diyalogları, proje kaydet/aç/yeni |
| `media:import/markers/syncOffset` | İçe aktarma, OBS işaretçileri, kamera senkronu |
| `transcript:start/get`, `search:run` | Transkripsiyon, arama |
| `chat:import`, `suggest:start` | Sohbet günlüğü, otomatik öneri |
| `export:start`, `export:dialogOutput` | Dışa aktarma |
| `task:cancel/list`, `model:download`, `shell:reveal` | Görevler, model indirme |

Olaylar: `task:update`, `asset:added/updated`, `transcript:ready`, `suggest:ready`, `export:done`, `menu:command`.

## 7. Görev kuyruğu

`TaskQueue` (`src/main/tasks.ts`): türe göre eşzamanlılık sınırı (import 2; proxy/transkripsiyon/analiz/dışa aktarma 1),
`AbortSignal` ile iptal (alt süreç öldürülür, yarım çıktılar silinir), 0..1 ilerleme + mesaj, hata → `failed` + anlaşılır mesaj.
Arayüz durum çubuğundan görev panelini açar; her görevin ilerleme çubuğu ve **İptal** düğmesi vardır.

## 8. Dayanıklılık

* Alt süreç hataları `friendlyFfmpegMessage` ile Türkçe, çözüm önerili mesajlara çevrilir (bozuk dosya → "OBS'te Remux", eksik
  codec, disk dolu, izin, bellek, eksik filtre…). Ana süreçte `uncaughtException`/`unhandledRejection` günlüğe yazılır, çökmez.
* Büyük dosya: yalnızca 1 MB başlık okunur; ses analizi PCM'i akış olarak işler; önizleme proxy'dir; dışa aktarma yalnızca kullanılan
  aralıkları çözer.
* Yollar her yerde argv olarak geçer (kabuk yok) → boşluk/Türkçe karakter sorunsuz; ffmpeg filtreleri için dosyalar çalışma
  klasörüne **göreli adla** yazılır (Windows `C:\` kaçışı sorunu yok).
