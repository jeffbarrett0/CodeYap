/** Basit coğrafya: Natural Earth 1:110m ülke sınırları (resources/world.json) + ana şehirler, yer çözümleme, izdüşümler. */

export interface Country {
  iso: string
  tr: string
  en: string
  lon: number
  lat: number
  polys: [number, number][][]
}
export interface World {
  source?: string
  countries: Country[]
}
export interface Place {
  name: string
  lon: number
  lat: number
  /** Vurgulanacak ülke (ISO3) */
  iso?: string
}

const CITIES: [string, number, number, string][] = [
  ['İstanbul', 28.98, 41.01, 'TUR'], ['Ankara', 32.85, 39.93, 'TUR'], ['İzmir', 27.14, 38.42, 'TUR'], ['Antalya', 30.71, 36.9, 'TUR'], ['Trabzon', 39.72, 41.0, 'TUR'],
  ['Londra', -0.13, 51.51, 'GBR'], ['Manchester', -2.24, 53.48, 'GBR'], ['Liverpool', -2.98, 53.41, 'GBR'], ['Paris', 2.35, 48.86, 'FRA'], ['Berlin', 13.4, 52.52, 'DEU'], ['Münih', 11.58, 48.14, 'DEU'], ['Dortmund', 7.47, 51.51, 'DEU'],
  ['Madrid', -3.7, 40.42, 'ESP'], ['Barselona', 2.17, 41.39, 'ESP'], ['Lizbon', -9.14, 38.72, 'PRT'], ['Roma', 12.5, 41.9, 'ITA'], ['Milano', 9.19, 45.46, 'ITA'], ['Torino', 7.69, 45.07, 'ITA'],
  ['Amsterdam', 4.9, 52.37, 'NLD'], ['Brüksel', 4.35, 50.85, 'BEL'], ['Viyana', 16.37, 48.21, 'AUT'], ['Zürih', 8.54, 47.38, 'CHE'], ['Cenevre', 6.14, 46.2, 'CHE'], ['Atina', 23.73, 37.98, 'GRC'],
  ['Moskova', 37.62, 55.75, 'RUS'], ['Prag', 14.42, 50.09, 'CZE'], ['Budapeşte', 19.04, 47.5, 'HUN'], ['Varşova', 21.01, 52.23, 'POL'], ['Stockholm', 18.07, 59.33, 'SWE'], ['Oslo', 10.75, 59.91, 'NOR'], ['Kopenhag', 12.57, 55.68, 'DNK'], ['Helsinki', 24.94, 60.17, 'FIN'],
  ['Dubai', 55.27, 25.2, 'ARE'], ['Doha', 51.53, 25.29, 'QAT'], ['Cidde', 39.17, 21.54, 'SAU'], ['Kahire', 31.24, 30.04, 'EGY'], ['Bakü', 49.87, 40.41, 'AZE'], ['Tiflis', 44.8, 41.72, 'GEO'],
  ['New York', -74.0, 40.71, 'USA'], ['Los Angeles', -118.24, 34.05, 'USA'], ['Miami', -80.19, 25.76, 'USA'], ['Washington', -77.04, 38.91, 'USA'], ['Toronto', -79.38, 43.65, 'CAN'], ['Mexico City', -99.13, 19.43, 'MEX'],
  ['Rio de Janeiro', -43.17, -22.91, 'BRA'], ['São Paulo', -46.63, -23.55, 'BRA'], ['Buenos Aires', -58.38, -34.6, 'ARG'],
  ['Tokyo', 139.69, 35.69, 'JPN'], ['Seul', 126.98, 37.57, 'KOR'], ['Pekin', 116.4, 39.9, 'CHN'], ['Şanghay', 121.47, 31.23, 'CHN'], ['Delhi', 77.1, 28.7, 'IND'], ['Bangkok', 100.5, 13.76, 'THA'], ['Singapur', 103.82, 1.35, 'SGP'], ['Sidney', 151.21, -33.87, 'AUS']
]

/** Küçük harf + Türkçe/aksan duyarsız karşılaştırma anahtarı */
export function key(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

const ALIASES: Record<string, string> = { turkiye: 'TUR', turkey: 'TUR', abd: 'USA', amerika: 'USA', 'amerika birlesik devletleri': 'USA', ingiltere: 'GBR', 'birlesik krallik': 'GBR', almanya: 'DEU', 'guney kore': 'KOR', rusya: 'RUS', cin: 'CHN', yunanistan: 'GRC', 'birlesik arap emirlikleri': 'ARE' }

/** "Türkiye", "İstanbul", "28.9,41.0" → Place. Bulunamazsa null. */
export function findPlace(world: World, query: string): Place | null {
  const q = key(query)
  if (!q) return null
  const ll = /^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/.exec(query.trim())
  if (ll) return { name: query.trim(), lon: Number(ll[1]), lat: Number(ll[2]) }
  const city = CITIES.find((c) => key(c[0]) === q)
  if (city) return { name: city[0], lon: city[1], lat: city[2], iso: city[3] }
  const iso = ALIASES[q]
  const country = world.countries.find((c) => (iso && c.iso === iso) || key(c.tr) === q || key(c.en) === q)
  if (country) return { name: country.tr, lon: country.lon, lat: country.lat, iso: country.iso }
  return null
}

/** Metinde geçen bilinen yerler (ülke/şehir) — otomatik grafik önerisi için; yazılış sırasına göre */
export function placesInText(world: World, text: string): Place[] {
  const t = ` ${key(text)} `
  const out: Place[] = []
  const seen = new Set<string>()
  const add = (p: Place | null) => {
    if (p && !seen.has(p.name)) (seen.add(p.name), out.push(p))
  }
  const names: string[] = [...CITIES.map((c) => c[0]), ...world.countries.map((c) => c.tr), ...Object.keys(ALIASES)]
  const hits: { at: number; name: string }[] = []
  for (const n of names) {
    const k = key(n)
    if (k.length < 3) continue
    // Türkçe ekleri (Türkiye'ye, İstanbul'a, Almanya'da) yakalamak için kelime başı eşleşmesi
    const idx = t.indexOf(` ${k}`)
    if (idx >= 0) hits.push({ at: idx, name: n })
  }
  for (const h of hits.sort((a, b) => a.at - b.at)) add(findPlace(world, h.name))
  return out
}

const rad = (d: number) => (d * Math.PI) / 180

/** Birim küre üzerindeki yön vektörü */
export function toVec(lon: number, lat: number): [number, number, number] {
  const a = rad(lon)
  const p = rad(lat)
  return [Math.cos(p) * Math.sin(a), Math.sin(p), Math.cos(p) * Math.cos(a)]
}

/** Büyük daire üzerinde s∈[0,1] noktası (yön vektörü) */
export function slerp(a: [number, number, number], b: [number, number, number], s: number): [number, number, number] {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
  const w = Math.acos(dot)
  if (w < 1e-6) return a
  const k1 = Math.sin((1 - s) * w) / Math.sin(w)
  const k2 = Math.sin(s * w) / Math.sin(w)
  return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2]
}

export const fromVec = (v: [number, number, number]): { lon: number; lat: number } => ({ lon: (Math.atan2(v[0], v[2]) * 180) / Math.PI, lat: (Math.asin(Math.max(-1, Math.min(1, v[1]))) * 180) / Math.PI })

/**
 * Ortografik (küre) izdüşümü. Merkez (lon0, lat0). Dönüş: ekran birimleri (−1..1) ve görünürlük (cosc>0 ön yüz).
 * `lift`: yüzeyden yükseklik katsayısı (1 = yüzey).
 */
export function orthographic(lon: number, lat: number, lon0: number, lat0: number, lift = 1): { x: number; y: number; cosc: number } {
  const l = rad(lon - lon0)
  const p = rad(lat)
  const p0 = rad(lat0)
  const x = Math.cos(p) * Math.sin(l)
  const y = Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l)
  const cosc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l)
  return { x: x * lift, y: y * lift, cosc }
}

export const ease = {
  outCubic: (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3,
  inOut: (t: number) => {
    const x = Math.min(1, Math.max(0, t))
    return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
  }
}
