/**
 * `story schema` çıktısı: Claude Code'un (ya da bir insanın) sahne planını elle yazabilmesi için sahne türleri, alanlar ve örnek plan.
 */
export const STORY_SCHEMA = {
  about: 'Anlatım sesi/videosu için hareketli sahne planı. Dosya: story-plan.json. Zamanlar anlatım saniyesidir; sahneler tam karedir ve Video 1\'e dizilir.',
  plan: {
    totalSec: 'anlatımın süresi (plan çıktısında hazır gelir)',
    planner: '"auto" | "ai" (bilgi amaçlı)',
    warnings: '[]',
    theme: { bg: '#0A0A0A', accent: '#FFD21F', good: '#6EE7A0', warn: '#FF9F1C', bad: '#FF4D4D', text: '#FFFFFF', muted: '#A8A28A', card: '#16140C', fontHead: 'Arial Black', fontBody: 'Arial', brand: 'kanal adı (sağ üstte; boş = yok)' },
    scenes: 'aşağıdaki sahnelerin dizisi'
  },
  scene: { id: '"s1"', start: 'sn (anlatımda ne zaman başlar)', end: 'sn (sonraki sahneye kadar uzar)', enabled: true, source: '"manual"', reason: 'isteğe bağlı: anlatımdan alıntı', content: '{ "type": ... } aşağıdaki türlerden biri' },
  types: {
    stats: '{ "type":"stats", "kicker"?, "title"?, "cards":[{ "label"?, "value":"7", "unit"?:"PUAN", "sub"?, "tone"?, "at"? }] }  // 1-4 rakam kartı',
    timeline: '{ "type":"timeline", "kicker"?, "title"?, "periods":[{ "label":"22/23", "at"?, "items":[{ "text":"Göreve geldi", "tone"?, "at"? }] }] }  // 2-5 dönem, dönem başına 3-4 madde',
    list: '{ "type":"list", "kicker"?, "title"?, "items":[{ "text", "tone"?, "at"? }] }',
    person: '{ "type":"person", "role"?:"TEKNİK DİREKTÖR", "name":"AD SOYAD", "sub"? }  // isim bandı',
    quote: '{ "type":"quote", "text", "by"? }',
    title: '{ "type":"title", "text", "sub"? }',
    place: '{ "type":"place", "to":"Almanya", "from"?:"Türkiye", "label"?, "sub"? }  // harita; ülke/ana şehir ya da "boylam,enlem"',
    media: '{ "type":"media", "file":"gorsel.png|klip.mp4", "fit"?:"cover|contain", "align"?:"left|center|right", "zoom"?:"in|out|none", "title"?, "caption"?  }  // gerçekçi sahne, 2D/3D karakter render\'ı, fotoğraf, video. cover: tam kare (resim yavaşça yakınlaşır); contain: şeffaf PNG karakteri siyah zeminde yana yerleştirir'
  },
  fields: {
    at: 'sahne BAŞINDAN saniye: kart/madde konuşulduğu an belirsin (transkript zamanından sahne start\'ını çıkar). Yoksa eşit aralıkla belirir.',
    tone: 'good (olumlu) | bad (olumsuz) | warn (uyarı/risk) | neutral'
  },
  rules: [
    'Yalnızca anlatımda GERÇEKTEN geçenleri yaz; rakam, ad, sezon uydurma.',
    'Çağrı/yönlendirme metni yok (beğen, abone ol, kanala gel…).',
    'Her sahne ortalama 5-30 sn; çakışma yok; start artan.',
    'Çizmeden önce `story preview plan.json` ile kareleri kontrol et.'
  ],
  example: {
    totalSec: 90,
    planner: 'ai',
    warnings: [],
    scenes: [
      { id: 's1', start: 3, end: 14, enabled: true, source: 'manual', content: { type: 'stats', kicker: 'RAKAMLARLA', cards: [{ label: 'Şampiyonlar Ligi', value: '7', unit: 'PUAN', sub: '3 maçta yenilgisiz', tone: 'good', at: 0.5 }, { label: 'Bundesliga', value: '15.', unit: 'SIRA', tone: 'bad', at: 4 }] } },
      { id: 's2', start: 14, end: 30, enabled: true, source: 'manual', content: { type: 'timeline', kicker: 'DÖNEMLER', title: 'Son sezonlar', periods: [{ label: '22/23', at: 0.5, items: [{ text: 'Göreve geldi', tone: 'good', at: 1 }, { text: 'Küme düşme hattı', tone: 'warn', at: 3 }] }, { label: '23/24', at: 6, items: [{ text: 'Bundesliga 2.', tone: 'good', at: 6.5 }] }] } },
      { id: 's3', start: 30, end: 40, enabled: true, source: 'manual', content: { type: 'media', file: 'hoeness.png', fit: 'contain', align: 'right', title: 'Teknik direktör', caption: 'Sebastian Hoeness' } }
    ]
  }
}
