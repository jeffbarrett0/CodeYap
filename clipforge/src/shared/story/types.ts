/**
 * Anlatım → Görsel: kullanıcının anlattığı sesi (ya da videoyu) alır, konuşmaya göre hareketli sahneler
 * (rakam kartları, sezon çizelgesi, isim bandı, liste, alıntı, başlık, harita) üretip anlatımla eşzamanlı bir videoya dizer.
 * Sahneler saf JSON'dur: planı insan, yapay zekâ ya da Claude Code yazabilir.
 */
export type StoryTone = 'good' | 'warn' | 'bad' | 'neutral'

export interface StoryTheme {
  bg: string
  accent: string
  good: string
  warn: string
  bad: string
  text: string
  muted: string
  card: string
  fontHead: string
  fontBody: string
  /** Sağ üst köşedeki marka yazısı (boş: yok) */
  brand: string
}

/** Siyah zemin, sarı vurgu (olumlu/olumsuz/uyarı için anlamlı renkler korunur) */
export const DEFAULT_STORY_THEME: StoryTheme = {
  bg: '#0A0A0A',
  accent: '#FFD21F',
  good: '#6EE7A0',
  warn: '#FF9F1C',
  bad: '#FF4D4D',
  text: '#FFFFFF',
  muted: '#A8A28A',
  card: '#16140C',
  fontHead: 'Arial Black',
  fontBody: 'Arial',
  brand: ''
}

export interface StatCard {
  label?: string
  value: string
  unit?: string
  sub?: string
  tone?: StoryTone
  /** Sahne başından itibaren saniye: kart ne zaman belirsin (yoksa sırayla) */
  at?: number
}
export interface StoryItem {
  text: string
  tone?: StoryTone
  at?: number
}
export interface TimelinePeriod {
  label: string
  items: StoryItem[]
  at?: number
}

/** Saha noktası: [x, y] metre (x: 0..105 uzunluk, hücum yönü +x; y: 0..68, 0 = yakın taç çizgisi) ya da adlı nokta ('ceza-yayi', 'sag-kanat'…) */
export type FbSpot = string | [number, number]
export interface FbPlayer {
  id: string
  name?: string
  num?: number
  team: 'home' | 'away'
  at: FbSpot
  keeper?: boolean
}
export type FbCameraMode = 'broadcast' | 'follow' | 'top' | 'behind' | 'goal'
export type FbAction =
  | { do: 'pass'; at: number; from: string; to: string; dur?: number; lob?: boolean }
  | { do: 'shoot'; at: number; from: string; to: string | [number, number] | [number, number, number]; dur?: number; result?: 'goal' | 'save' | 'miss' }
  | { do: 'run'; at: number; player: string; to: FbSpot; dur?: number }
  | { do: 'dribble'; at: number; player: string; to: FbSpot; dur?: number }
  | { do: 'label'; at: number; player: string; text: string; dur?: number }
  | { do: 'zone'; at: number; center: FbSpot; rx?: number; ry?: number; dur?: number; text?: string }
  | { do: 'line'; at: number; from: FbSpot | string; to: FbSpot | string; dur?: number }
  | { do: 'camera'; at: number; mode: FbCameraMode }
export interface FbTeam {
  name?: string
  color?: string
  /** '4-3-3' gibi: adı verilmeyen diğer oyuncular otomatik dizilir (arka plan oyuncuları) */
  formation?: string
}
export interface FootballContent {
  type: 'football'
  home?: FbTeam
  away?: FbTeam
  players: FbPlayer[]
  ball?: { holder?: string; at?: FbSpot }
  actions: FbAction[]
  /** right (varsayılan): ev sahibi sağdaki kaleye saldırır; left: sahne 180° döner */
  attack?: 'right' | 'left'
  camera?: FbCameraMode
  title?: string
}

export type StoryContent =
  | FootballContent
  | { type: 'stats'; kicker?: string; title?: string; cards: StatCard[] }
  | { type: 'timeline'; kicker?: string; title?: string; periods: TimelinePeriod[] }
  | { type: 'list'; kicker?: string; title?: string; items: StoryItem[] }
  | { type: 'person'; role?: string; name: string; sub?: string }
  | { type: 'quote'; text: string; by?: string }
  | { type: 'title'; text: string; sub?: string }
  | { type: 'place'; to: string; from?: string; label?: string; sub?: string }
  /** Hazır görsel/video (gerçekçi sahne, 2D/3D karakter render'ı…): tam kare ya da şeffaf PNG karakter; altta isteğe bağlı yazı */
  | { type: 'media'; file: string; fit?: 'cover' | 'contain'; align?: 'left' | 'center' | 'right'; zoom?: 'in' | 'out' | 'none'; title?: string; caption?: string }

export type StoryType = StoryContent['type']
export const STORY_TYPES: { id: StoryType; label: string; hint: string }[] = [
  { id: 'stats', label: 'Rakam kartları', hint: '1-4 büyük rakam (ör. 7 PUAN, 15. SIRA)' },
  { id: 'timeline', label: 'Sezon / yıl çizelgesi', hint: 'Dönemler ve her dönemde sırayla beliren olay kartları' },
  { id: 'list', label: 'Liste', hint: 'Sırayla beliren maddeler' },
  { id: 'person', label: 'İsim bandı', hint: 'Kişi adı + unvanı' },
  { id: 'quote', label: 'Alıntı', hint: 'Büyük alıntı yazısı' },
  { id: 'title', label: 'Başlık', hint: 'Konu başlığı' },
  { id: 'place', label: 'Harita', hint: 'Anlatılan yeri haritada göster' },
  { id: 'football', label: 'Futbol sahası canlandırması', hint: '3B saha: oyuncular, top, pas/şut, bölgeler, kamera' },
  { id: 'media', label: 'Görsel / video / karakter', hint: 'Hazır fotoğraf, video ya da şeffaf PNG karakter; altına yazı' }
]

export interface StoryScene {
  id: string
  /** Anlatım zamanı (saniye): sahne ne zaman başlar */
  start: number
  /** Sahnenin bittiği an; sonraki sahneye kadar uzatılır */
  end: number
  enabled: boolean
  content: StoryContent
  /** Bu sahne neden önerildi (anlatımdan alıntı) */
  reason?: string
  source: 'auto' | 'ai' | 'manual'
}

export interface StoryPlan {
  totalSec: number
  theme: StoryTheme
  scenes: StoryScene[]
  /** Planı nasıl çıkardığımız: bilgi amaçlı */
  planner: 'auto' | 'ai'
  warnings: string[]
}

/** Metni sahnede güvenle gösterilecek hale getirir: çağrı/yönlendirme metni yok, uzunluk sınırlı */
export const CTA_RE = /(beğen|abone|takip et|kanal(ım|ımıza|a)|bildirim|videonun tamamı|link(e|i)? tıkla|yorum yap)/i

/** İş isteği (arayüz / CLI ortak) */
export interface StoryRequest {
  /** Anlatım dosyası: ses (MP3/WAV/M4A…) ya da video */
  mediaPath: string
  /** Çıkış klasörü; boşsa dosyanın yanında `Anlatım/<ad>/` */
  outDir?: string
  /** plan: içe aktar + transkript + sahne planı (düzenlenebilir); build: planı videoya çevir */
  action: 'plan' | 'build'
  /** build için düzenlenmiş plan; yoksa kayıtlı `story-plan.json` kullanılır */
  plan?: StoryPlan
  /** Yapay zekâ ayarlıysa sahneleri o planlasın */
  useAi?: boolean
  /** plan: otomatik sahne bulma; boş plan yazılır (sahneleri Claude Code/kullanıcı yazar) */
  blank?: boolean
  aspect?: '16:9' | '9:16' | '1:1'
  language?: string
  theme?: Partial<StoryTheme>
}

export type StoryStage = 'import' | 'transcribe' | 'plan' | 'render' | 'project'
export const STORY_STAGES: { id: StoryStage; label: string }[] = [
  { id: 'import', label: 'Anlatımı içe aktar' },
  { id: 'transcribe', label: 'Transkripsiyon' },
  { id: 'plan', label: 'Sahneleri planla' },
  { id: 'render', label: 'Sahneleri çiz' },
  { id: 'project', label: 'Projeyi kur' }
]

export interface StoryStageState {
  id: StoryStage
  label: string
  status: 'pending' | 'running' | 'done' | 'skipped' | 'failed'
  progress: number
  detail?: string
}

export interface StoryResult {
  outDir: string
  projectPath: string
  planPath: string
  plan: StoryPlan
  /** build sonrası: çizilen sahne sayısı ve toplam süre */
  rendered?: { scenes: number; totalSec: number }
}

export interface StoryStatus {
  id: string
  request: StoryRequest
  name: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  stages: StoryStageState[]
  error?: string
  result?: StoryResult
  startedAt: number
  finishedAt?: number
}

export const initialStoryStages = (): StoryStageState[] => STORY_STAGES.map((s) => ({ ...s, status: 'pending', progress: 0 }))
