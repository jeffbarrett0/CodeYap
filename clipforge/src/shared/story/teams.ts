import { key } from '../graphics/geo'
import type { StoryTheme } from './types'

/**
 * Takım forma/renk veritabanı: anlatıda geçen takıma göre oyuncu formaları ve sahne vurgu rengi seçilir
 * (Bayern → kırmızı, Galatasaray → sarı-kırmızı "parçalı"…). Formalar SEZONLUK değişir: `note` hangi sezona göre olduğunu söyler;
 * emin değilsen web'den doğrula ve `home.color/color2/shorts/socks/pattern` ile ez. Armalar/logolar kullanılmaz (marka hakkı).
 */
export type KitPattern = 'solid' | 'halves' | 'stripes'
export interface Kit {
  /** gövde ana rengi */
  primary: string
  /** ikinci renk (halves/stripes için yarım/şerit; solid'de yok sayılır) */
  secondary: string
  shorts: string
  socks: string
  pattern: KitPattern
}
export interface TeamInfo {
  id: string
  name: string
  /** arama adları (Türkçe/İngilizce yazımlar); aksan ve büyük/küçük harf önemsiz */
  aliases: string[]
  home: Kit
  /** deplasman/yedek forma: rakiple renk çakışınca kullanılır */
  alt: Kit
  note?: string
}

const k = (primary: string, secondary: string, shorts: string, socks: string, pattern: KitPattern = 'solid'): Kit => ({ primary, secondary, shorts, socks, pattern })
const W = '#F4F4F4'
const BLK = '#151515'

const T = (id: string, name: string, aliases: string[], home: Kit, alt: Kit, note?: string): TeamInfo => ({ id, name, aliases: [name, ...aliases], home, alt, note })

export const TEAMS: TeamInfo[] = [
  // ── Almanya
  T('bayern', 'Bayern Münih', ['bayern', 'bayern munich', 'fc bayern', 'bayern munih', 'bayern münchen'], k('#DC052D', W, '#DC052D', '#DC052D'), k('#1B1B1B', '#DC052D', '#1B1B1B', '#1B1B1B'), '2025/26 iç saha: kırmızı forma, kırmızı şort ve çorap (adidas/FC Bayern lansmanı, Haziran 2025).'),
  T('dortmund', 'Borussia Dortmund', ['dortmund', 'bvb', 'borussia dortmund'], k('#FDE100', BLK, BLK, '#FDE100'), k(BLK, '#FDE100', BLK, BLK)),
  T('leverkusen', 'Bayer Leverkusen', ['leverkusen', 'bayer leverkusen'], k('#E32221', BLK, BLK, '#E32221'), k(W, '#E32221', W, W)),
  T('stuttgart', 'VfB Stuttgart', ['stuttgart', 'vfb stuttgart', 'vfb', 'stutgart'], k(W, '#E32219', W, W), k('#E32219', W, '#E32219', '#E32219')),
  T('leipzig', 'RB Leipzig', ['leipzig', 'rb leipzig'], k(W, '#DD0741', W, W), k('#DD0741', '#0B1F4D', '#DD0741', '#DD0741')),
  T('frankfurt', 'Eintracht Frankfurt', ['frankfurt', 'eintracht frankfurt', 'eintracht'], k(BLK, '#E1000F', BLK, BLK), k(W, '#E1000F', W, W)),
  // ── İspanya
  T('realmadrid', 'Real Madrid', ['real madrid', 'madrid', 'real'], k('#FFFFFF', '#FEBE10', W, W), k('#10224D', '#FEBE10', '#10224D', '#10224D')),
  T('barcelona', 'Barcelona', ['barcelona', 'barca', 'barça', 'fc barcelona'], k('#A50044', '#004D98', '#0B2F6B', '#A50044', 'stripes'), k('#F5C400', '#A50044', '#F5C400', '#F5C400')),
  T('atletico', 'Atlético Madrid', ['atletico', 'atletico madrid', 'atlético'], k('#CB3524', W, '#1B2B6B', '#1B2B6B', 'stripes'), k('#1B2B6B', '#CB3524', '#1B2B6B', '#1B2B6B')),
  T('sevilla', 'Sevilla', ['sevilla'], k(W, '#D4021D', W, W), k('#D4021D', W, '#D4021D', '#D4021D')),
  T('valencia', 'Valencia', ['valencia'], k(W, BLK, BLK, W), k(BLK, '#FF8C00', BLK, BLK)),
  T('villarreal', 'Villarreal', ['villarreal'], k('#FBE122', '#005187', '#005187', '#FBE122'), k('#005187', '#FBE122', '#005187', '#005187')),
  T('sociedad', 'Real Sociedad', ['real sociedad', 'sociedad'], k('#0067B1', W, W, '#0067B1', 'stripes'), k('#1B1B1B', '#0067B1', '#1B1B1B', '#1B1B1B')),
  T('athletic', 'Athletic Bilbao', ['athletic bilbao', 'athletic club', 'bilbao'], k('#EE2523', W, BLK, BLK, 'stripes'), k('#0B1F4D', '#EE2523', '#0B1F4D', '#0B1F4D')),
  // ── İngiltere
  T('mancity', 'Manchester City', ['manchester city', 'man city', 'city'], k('#6CABDD', W, W, '#6CABDD'), k('#1C2C5B', '#6CABDD', '#1C2C5B', '#1C2C5B')),
  T('manutd', 'Manchester United', ['manchester united', 'man united', 'man utd', 'united'], k('#DA291C', BLK, W, BLK), k(W, '#DA291C', BLK, W)),
  T('liverpool', 'Liverpool', ['liverpool', 'liverpul'], k('#C8102E', W, '#C8102E', '#C8102E'), k('#F4F4F4', '#C8102E', '#F4F4F4', '#F4F4F4')),
  T('arsenal', 'Arsenal', ['arsenal'], k('#EF0107', W, W, '#EF0107'), k('#F5C400', '#0B1F4D', '#0B1F4D', '#F5C400')),
  T('chelsea', 'Chelsea', ['chelsea', 'chelsi'], k('#034694', W, '#034694', W), k(W, '#034694', W, W)),
  T('tottenham', 'Tottenham', ['tottenham', 'spurs'], k(W, '#132257', '#132257', W), k('#132257', W, '#132257', '#132257')),
  T('newcastle', 'Newcastle United', ['newcastle', 'newcastle united'], k(BLK, W, BLK, BLK, 'stripes'), k('#0B7A9E', W, '#0B7A9E', '#0B7A9E')),
  T('astonvilla', 'Aston Villa', ['aston villa', 'villa'], k('#670E36', '#95BFE5', W, '#95BFE5'), k('#95BFE5', '#670E36', '#95BFE5', '#95BFE5')),
  // ── Fransa
  T('psg', 'Paris Saint-Germain', ['psg', 'paris saint-germain', 'paris saint germain', 'paris'], k('#004170', '#DA291C', '#004170', '#004170'), k(W, '#004170', W, W)),
  T('marseille', 'Marsilya', ['marsilya', 'marseille', 'olympique marseille', 'om'], k(W, '#2FAEE0', W, W), k('#2FAEE0', W, '#2FAEE0', '#2FAEE0')),
  T('lyon', 'Olympique Lyon', ['lyon', 'olympique lyon', 'olympique lyonnais'], k(W, '#DA291C', W, W), k('#1B2B6B', '#DA291C', '#1B2B6B', '#1B2B6B')),
  T('monaco', 'Monaco', ['monaco'], k('#E32219', W, W, '#E32219', 'halves'), k(BLK, '#E32219', BLK, BLK)),
  // ── İtalya
  T('juventus', 'Juventus', ['juventus', 'juve'], k(BLK, W, BLK, BLK, 'stripes'), k('#F4F4F4', BLK, '#F4F4F4', '#F4F4F4')),
  T('milan', 'Milan', ['milan', 'ac milan'], k('#FB090B', BLK, BLK, '#FB090B', 'stripes'), k(W, '#FB090B', W, W)),
  T('inter', 'Inter', ['inter', 'internazionale', 'inter milan'], k('#0068A8', BLK, BLK, '#0068A8', 'stripes'), k(W, '#0068A8', W, W)),
  T('napoli', 'Napoli', ['napoli'], k('#12A0D7', W, W, '#12A0D7'), k(W, '#12A0D7', W, W)),
  T('roma', 'Roma', ['roma', 'as roma'], k('#8E1F2F', '#F0BC42', W, '#8E1F2F'), k(W, '#8E1F2F', W, W)),
  T('lazio', 'Lazio', ['lazio'], k('#87D8F7', W, W, '#87D8F7'), k(W, '#87D8F7', W, W)),
  T('atalanta', 'Atalanta', ['atalanta'], k(BLK, '#1E71B8', BLK, BLK, 'stripes'), k('#F4F4F4', '#1E71B8', '#F4F4F4', '#F4F4F4')),
  T('fiorentina', 'Fiorentina', ['fiorentina'], k('#482E92', W, '#482E92', '#482E92'), k(W, '#482E92', W, W)),
  // ── diğer Avrupa
  T('ajax', 'Ajax', ['ajax'], k(W, '#D2122E', W, W), k('#1B2B6B', '#D2122E', '#1B2B6B', '#1B2B6B')),
  T('psv', 'PSV', ['psv', 'psv eindhoven'], k('#ED1C24', W, W, '#ED1C24', 'stripes'), k('#1B1B1B', '#ED1C24', '#1B1B1B', '#1B1B1B')),
  T('feyenoord', 'Feyenoord', ['feyenoord'], k('#E4002B', W, BLK, BLK, 'halves'), k(BLK, '#E4002B', BLK, BLK)),
  T('benfica', 'Benfica', ['benfica'], k('#E30613', W, W, '#E30613'), k(W, '#E30613', W, W)),
  T('porto', 'Porto', ['porto', 'fc porto'], k('#0B3A8F', W, '#0B3A8F', W, 'stripes'), k('#F5C400', '#0B3A8F', '#F5C400', '#F5C400')),
  T('sporting', 'Sporting Lizbon', ['sporting', 'sporting lizbon', 'sporting cp'], k('#008057', W, BLK, '#008057', 'stripes'), k(W, '#008057', W, W)),
  T('celtic', 'Celtic', ['celtic'], k('#16A34A', W, W, '#16A34A', 'stripes'), k('#1B1B1B', '#16A34A', '#1B1B1B', '#1B1B1B')),
  T('rangers', 'Rangers', ['rangers', 'glasgow rangers'], k('#1B458F', W, W, BLK), k(W, '#1B458F', W, W)),
  // ── Türkiye
  T('galatasaray', 'Galatasaray', ['galatasaray', 'gs', 'cim bom', 'cimbom', 'aslan'], k('#A90432', '#FDB913', '#A90432', '#A90432', 'halves'), k('#3A3A3D', '#FDB913', '#3A3A3D', '#3A3A3D'), '"Parçalı" sarı-kırmızı iç saha forması (Puma). 2026/27: koyu gri deplasman, beyaz alternatif (GZT/Habertürk). Sezona göre ton/şort değişebilir.'),
  T('fenerbahce', 'Fenerbahçe', ['fenerbahce', 'fenerbahçe', 'fb', 'fener', 'kanarya'], k('#FFED00', '#00205B', '#00205B', '#00205B', 'stripes'), k(W, '#00205B', W, W), 'Sarı-lacivert çubuklu; sezona göre şort/çorap değişebilir.'),
  T('besiktas', 'Beşiktaş', ['besiktas', 'beşiktaş', 'bjk', 'kartal', 'kartallar'], k(BLK, W, BLK, BLK, 'stripes'), k(W, BLK, W, W), 'Siyah-beyaz; sezona göre çubuklu/düz değişebilir.'),
  T('trabzonspor', 'Trabzonspor', ['trabzonspor', 'trabzon', 'ts'], k('#7B1530', '#3FA9F5', '#7B1530', '#3FA9F5', 'halves'), k(W, '#7B1530', W, W)),
  T('basaksehir', 'Başakşehir', ['basaksehir', 'başakşehir', 'istanbul basaksehir'], k('#F26A21', '#0B1F4D', '#0B1F4D', '#F26A21', 'halves'), k('#0B1F4D', '#F26A21', '#0B1F4D', '#0B1F4D')),
  // ── milli takımlar
  T('turkiye', 'Türkiye', ['turkiye', 'türkiye', 'turkey', 'a milli', 'milli takim', 'ay yildizlilar', 'ay yıldızlılar'], k('#E30A17', W, W, '#E30A17'), k(W, '#E30A17', W, W)),
  T('almanya', 'Almanya', ['almanya', 'germany', 'deutschland'], k(W, BLK, BLK, W), k('#1B1B1B', '#DD0000', '#1B1B1B', '#1B1B1B')),
  T('fransa', 'Fransa', ['fransa', 'france'], k('#0B3D91', W, W, '#E4002B'), k(W, '#0B3D91', W, W)),
  T('ispanya', 'İspanya', ['ispanya', 'spain', 'espana'], k('#C60B1E', '#F1BF00', '#0B1F4D', '#C60B1E'), k(W, '#C60B1E', W, W)),
  T('ingiltere', 'İngiltere', ['ingiltere', 'england'], k(W, '#C8102E', '#0B1F4D', W), k('#C8102E', W, '#C8102E', '#C8102E')),
  T('italya', 'İtalya', ['italya', 'italy'], k('#0066B3', W, W, '#0066B3'), k(W, '#0066B3', W, W)),
  T('portekiz', 'Portekiz', ['portekiz', 'portugal'], k('#C8102E', '#006600', '#006600', '#C8102E'), k(W, '#C8102E', W, W)),
  T('hollanda', 'Hollanda', ['hollanda', 'netherlands', 'holland'], k('#FF6F00', W, W, '#FF6F00'), k('#1B2B6B', '#FF6F00', '#1B2B6B', '#1B2B6B')),
  T('brezilya', 'Brezilya', ['brezilya', 'brazil'], k('#FFDF00', '#009C3B', '#0033A0', W), k('#0033A0', '#FFDF00', '#0033A0', '#0033A0')),
  T('arjantin', 'Arjantin', ['arjantin', 'argentina'], k('#75AADB', W, BLK, BLK, 'stripes'), k('#1B2B6B', '#75AADB', '#1B2B6B', '#1B2B6B')),
  T('hirvatistan', 'Hırvatistan', ['hirvatistan', 'hırvatistan', 'croatia'], k('#E4002B', W, W, '#E4002B', 'stripes'), k('#0B1F4D', '#E4002B', '#0B1F4D', '#0B1F4D')),
  T('belcika', 'Belçika', ['belcika', 'belçika', 'belgium'], k('#C8102E', '#F5C400', '#C8102E', '#C8102E'), k(W, '#C8102E', W, W))
]

const norm = (s: string) => key(s).replace(/\s+/g, ' ').trim()

/** Takımı ada göre bulur (Türkçe/İngilizce, aksan farkı, "FC"/"AS" gibi önekler önemsiz). Bulamazsa null. */
export function findTeam(query?: string): TeamInfo | null {
  if (!query) return null
  const q = norm(query.replace(/\b(fc|ac|as|ssc|sk|spor kulubu|futbol kulubu)\b/gi, ''))
  if (!q) return null
  let best: TeamInfo | null = null
  let bestScore = 0
  for (const t of TEAMS) {
    for (const a of t.aliases) {
      const n = norm(a)
      const score = n === q ? 100 : q.startsWith(n + ' ') || n.startsWith(q + ' ') ? 60 + Math.min(n.length, q.length) : n.length >= 4 && q.length >= 4 && (n.includes(q) || q.includes(n)) ? 30 + Math.min(n.length, q.length) : 0
      if (score > bestScore) (bestScore = score, (best = t))
    }
  }
  return bestScore >= 50 ? best : null
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
/** İki renk arasındaki algısal uzaklık (0..~440): küçükse sahada karışırlar */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)
  const rm = (r1 + r2) / 2
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2)
}
const luma = (hex: string): number => {
  const [r, g, b] = rgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export interface KitOverride {
  team?: string
  color?: string
  color2?: string
  shorts?: string
  socks?: string
  pattern?: KitPattern
  /** true: yedek (deplasman) formayı zorla */
  alt?: boolean
}
const HEX = /^#[0-9a-f]{6}$/i

function applyOverride(kit: Kit, o: KitOverride): Kit {
  return {
    primary: o.color && HEX.test(o.color) ? o.color : kit.primary,
    secondary: o.color2 && HEX.test(o.color2) ? o.color2 : kit.secondary,
    shorts: o.shorts && HEX.test(o.shorts) ? o.shorts : kit.shorts,
    socks: o.socks && HEX.test(o.socks) ? o.socks : kit.socks,
    pattern: o.pattern === 'halves' || o.pattern === 'stripes' || o.pattern === 'solid' ? o.pattern : kit.pattern
  }
}

export interface ResolvedKits {
  home: Kit
  away: Kit
  keeper: Kit
  homeName?: string
  awayName?: string
  /** tribün rengi (ev sahibinin ana rengi) */
  stand: string
  notes: string[]
}

export class TeamError extends Error {}

/**
 * İki takımın formasını belirler: adı verilen takım veritabanından gelir, alanlarla ezilir; rakiple renkler karışıyorsa
 * deplasman ekibi yedek forma giyer (rengi açıkça verilmediyse). Kaleci formaları iki takımdan da uzak bir renktir.
 */
export function resolveKits(homeIn?: KitOverride, awayIn?: KitOverride, defaults: { home: string; away: string } = { home: '#FFD21F', away: '#F2F2F2' }): ResolvedKits {
  const notes: string[] = []
  const lookup = (o: KitOverride | undefined, side: string): TeamInfo | null => {
    if (!o?.team) return null
    const t = findTeam(o.team)
    if (!t) throw new TeamError(`${side}: takım bulunamadı "${o.team}". Veritabanında yok; formayı elle verin ({ "name":"…", "color":"#RRGGBB", "color2":"#RRGGBB", "shorts":"#…", "socks":"#…", "pattern":"solid|halves|stripes" }) ya da \`story teams\` ile adı bulun.`)
    if (t.note) notes.push(`${t.name}: ${t.note}`)
    return t
  }
  const th = lookup(homeIn, 'home')
  const ta = lookup(awayIn, 'away')
  const plain = (c: string): Kit => k(c, W, c, c)
  let home = applyOverride(homeIn?.alt && th ? th.alt : th ? th.home : plain(homeIn?.color && HEX.test(homeIn.color) ? homeIn.color : defaults.home), homeIn ?? {})
  let away = applyOverride(awayIn?.alt && ta ? ta.alt : ta ? ta.home : plain(awayIn?.color && HEX.test(awayIn.color) ? awayIn.color : defaults.away), awayIn ?? {})
  if (ta && !awayIn?.alt && !awayIn?.color && colorDistance(home.primary, away.primary) < 110) {
    away = applyOverride(ta.alt, awayIn ?? {})
    notes.push(`${ta.name}: ${th?.name ?? 'rakip'} ile formalar karıştığı için yedek forma giydirildi.`)
  }
  if (colorDistance(home.primary, away.primary) < 90) notes.push('Uyarı: iki takımın forma renkleri birbirine çok yakın; away.color/alt ile ayırın.')
  const pool = ['#18C8FF', '#3DDC84', '#FF8A00', '#C77DFF', '#F5F500']
  const kc = pool.reduce((best, c) => (Math.min(colorDistance(c, home.primary), colorDistance(c, away.primary)) > Math.min(colorDistance(best, home.primary), colorDistance(best, away.primary)) ? c : best), pool[0])
  return { home, away, keeper: k(kc, kc, kc, kc), homeName: homeIn?.team ? (th?.name ?? homeIn.team) : undefined, awayName: awayIn?.team ? (ta?.name ?? awayIn.team) : undefined, stand: home.primary, notes }
}

/** Takıma özgü sahne teması: vurgu rengi takımın (koyu zeminde okunur) rengi olur */
export function themeForTeam(theme: StoryTheme, team?: string): StoryTheme {
  const t = findTeam(team)
  if (!t) return theme
  const cand = [t.home.primary, t.home.secondary, t.alt.primary].find((c) => luma(c) > 48 && colorDistance(c, theme.bg) > 120) ?? theme.accent
  return { ...theme, accent: cand, good: cand === theme.accent ? theme.good : theme.good }
}

/** Takımın koyu zeminde okunan rengi (çubuk/etiket için); takım bilinmiyorsa `fallback` */
export function readableTeamColor(team: string | undefined, theme: StoryTheme, fallback: string): string {
  const t = findTeam(team)
  if (!t) return fallback
  return [t.home.primary, t.home.secondary, t.alt.primary].find((c) => luma(c) > 48 && colorDistance(c, theme.bg) > 120) ?? fallback
}
