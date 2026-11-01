// Natural Earth 1:110m ülke sınırlarını (kamu malı, naturalearthdata.com) küçük bir JSON'a çevirir: resources/world.json
// Kullanım: node scripts/make-world.mjs [kaynak.geojson]   (kaynak verilmezse indirilir)
import { readFileSync, writeFileSync } from 'node:fs'

const SRC_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson'
const src = process.argv[2]
const geo = JSON.parse(src ? readFileSync(src, 'utf8') : await (await fetch(SRC_URL)).text())
const r = (n) => Math.round(n * 10) / 10
const countries = geo.features.map((f) => {
  const p = f.properties
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  return {
    iso: p.ISO_A3_EH && p.ISO_A3_EH !== '-99' ? p.ISO_A3_EH : p.ADM0_A3,
    tr: p.NAME_TR || p.NAME,
    en: p.NAME,
    lon: r(p.LABEL_X),
    lat: r(p.LABEL_Y),
    // yalnızca dış halka; 0.1° hassasiyet
    polys: polys.map((rings) => rings[0].map(([x, y]) => [r(x), r(y)]))
  }
})
writeFileSync(new URL('../resources/world.json', import.meta.url), JSON.stringify({ source: 'Natural Earth 1:110m (public domain)', countries }))
console.log(`${countries.length} ülke yazıldı`)
