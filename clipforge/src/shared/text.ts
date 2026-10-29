/**
 * Türkçe farkındalıklı metin normalizasyonu ve benzerlik ölçütleri.
 * Arama motoru, sohbet analizi ve altyazı üretimi bunları paylaşır.
 */

const TR_MAP: Record<string, string> = {
  ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ç: 'c', Ç: 'c', ö: 'o', Ö: 'o', ü: 'u', Ü: 'u'
}

/**
 * Küçük harfe çevirir, Türkçe karakterleri (ı/i, ş/s, ğ/g, ç/c, ö/o, ü/u) ve
 * aksanları (â, î, û …) ASCII karşılıklarına indirger.
 * Önce Türkçe harfler eşlenir: aksi halde 'İ'.toLowerCase() "i̇" (birleşik nokta) üretir.
 */
export function foldTr(s: string): string {
  return s
    .replace(/[ıİşŞğĞçÇöÖüÜ]/g, (c) => TR_MAP[c])
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
}

/** Harf/rakam dizilerine böler (kesme işareti ve noktalama ayraçtır: "Victor'dan" → victor, dan). */
export function tokenize(s: string): string[] {
  return foldTr(s).match(/[\p{L}\p{N}]+/gu) ?? []
}

/**
 * Whisper'ın duyduğu gibi yazdığı yabancı isimler için kaba fonetik indirgeme:
 * Victor/Viktor, Wiktor, Nelson/Nelsen gibi farkları küçültür.
 */
export function phoneticFold(folded: string): string {
  return folded
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/[cq]/g, 'k')
    .replace(/w/g, 'v')
    .replace(/x/g, 'ks')
    .replace(/(.)\1+/g, '$1')
}

/** Damerau-Levenshtein (optimal string alignment) mesafesi; `max` aşılırsa max+1 döner. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > max) return max + 1
  if (la === 0) return lb
  if (lb === 0) return la
  let prev2: number[] = new Array(lb + 1).fill(0)
  let prev: number[] = Array.from({ length: lb + 1 }, (_, j) => j)
  let cur: number[] = new Array(lb + 1).fill(0)
  for (let i = 1; i <= la; i++) {
    cur[0] = i
    let rowMin = cur[0]
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    ;[prev2, prev, cur] = [prev, cur, prev2]
  }
  return prev[lb]
}

/** 0..1 benzerlik (1 = aynı). Hem düz hem fonetik indirgenmiş biçimler denenir, büyüğü alınır. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1
  const plain = 1 - editDistance(a, b) / Math.max(a.length, b.length)
  const pa = phoneticFold(a)
  const pb = phoneticFold(b)
  if (pa === pb) return 0.97
  const phon = 1 - editDistance(pa, pb) / Math.max(pa.length, pb.length)
  return Math.max(plain, phon * 0.98)
}

/** Sorgudan atılan, içeriği taşımayan sözcükler (katlanmış biçimde). Konu / isim içermez. */
const STOP_RAW = `
ve ile veya ya ama fakat ki de da mi mu bir bu su o bunu sunu onu bunlar sunlar onlar icin gibi daha cok en pek hic
ben sen biz siz beni seni bana sana bize size benim senin bizim sizin
ilgili hakkinda hakkindaki dair uzerine uzerinde konusunda konusan konustugum konustuk konusmustum konusurken konustugumuz
bahsettigim bahsettim bahsetmistim bahsederken anlattigim anlattim soyledigim soyledim gectigi gecen gecti gectigim
yer yerde yeri kisim kismi bolum bolumu an ani anda zaman zamanda sirada sirasinda nerede nerde ne nasil kim kime hangi
bul bulur musun goster ara arama olan oldugu olarak var yok
the a an of about on in to where when i me my we talked talking spoke mentioned mention part section moment find show
`
export const STOPWORDS: ReadonlySet<string> = new Set(STOP_RAW.split(/\s+/).filter(Boolean))

export function isStopword(folded: string): boolean {
  return STOPWORDS.has(folded)
}

export function formatTime(sec: number, withMs = false): string {
  const s = Math.max(0, sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const body = withMs
    ? `${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}`
    : `${String(m).padStart(2, '0')}:${String(Math.floor(r)).padStart(2, '0')}`
  return h > 0 ? `${h}:${body}` : body
}

/** "754", "754.5", "12:34", "1:02:03(.5)" → saniye; tanınmazsa null */
export function parseTimecode(input: string): number | null {
  const s = input.trim().replace(',', '.')
  if (!s) return null
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s)
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s)
  if (!m) return null
  const [, h, mi, sec] = m
  if (Number(mi) > 59 || Number(sec) >= 60) return null
  return Number(h ?? 0) * 3600 + Number(mi) * 60 + Number(sec)
}
