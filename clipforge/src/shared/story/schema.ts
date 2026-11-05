/**
 * `story schema` çıktısı: Claude Code'un (ya da bir insanın) sahne planını elle yazabilmesi için sahne türleri, alanlar ve örnek plan.
 */
import { GOAL_TARGETS, SPOTS } from './football'

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
    football: '{ "type":"football", "home"?:{ "name", "color"?, "formation"?:"4-3-3" }, "away"?:{…}, "players":[{ "id":"osimhen", "name"?:"Osimhen", "num"?, "team":"home|away", "at":"ceza-yayi"|[x,y], "keeper"? }], "ball"?:{ "holder":"osimhen" }, "actions":[…], "attack"?:"right|left", "camera"?:"broadcast|follow|top|behind|goal", "title"? }  // anlatılan pozisyonu 3B sahada oynatır (aşağıdaki "football" bölümüne bak)',
    media: '{ "type":"media", "file":"gorsel.png|klip.mp4", "fit"?:"cover|contain", "align"?:"left|center|right", "zoom"?:"in|out|none", "title"?, "caption"?  }  // gerçekçi sahne, 2D/3D karakter render\'ı, fotoğraf, video. cover: tam kare (resim yavaşça yakınlaşır); contain: şeffaf PNG karakteri siyah zeminde yana yerleştirir'
  },
  football: {
    pitch: 'Metre: x 0..105 (hücum yönü +x), y 0..68 (0 = yakın taç çizgisi; hücum yönüne bakınca SAĞ taraf düşük y, SOL taraf yüksek y). attack:"left" tüm sahneyi 180° çevirir.',
    spots: Object.fromEntries(Object.entries(SPOTS).map(([k, v]) => [k, v])),
    goalTargets: Object.fromEntries(Object.entries(GOAL_TARGETS).map(([k, v]) => [k, v])),
    actions: {
      pass: '{ "do":"pass", "at":sn, "from":id, "to":id, "dur"?, "lob"?:true }  // top from oyuncusundadır; to oyuncusuna gider ve ondadır',
      shoot: '{ "do":"shoot", "at":sn, "from":id, "to":"kale-sag"|"kale-sol-ust"|…|[x,y,z?], "dur"?, "result"?:"goal|save|miss" }',
      run: '{ "do":"run", "at":sn, "player":id, "to":spot, "dur"? }   // topsuz koşu',
      dribble: '{ "do":"dribble", "at":sn, "player":id, "to":spot, "dur"? }   // top ayağında',
      label: '{ "do":"label", "at":sn, "player":id, "text":"PRES", "dur"? }   // oyuncunun üstünde sarı etiket',
      zone: '{ "do":"zone", "at":sn, "center":spot, "rx"?, "ry"?, "dur"?, "text"? }   // vurgulu bölge (boş alan, baskı alanı)',
      line: '{ "do":"line", "at":sn, "from":id|spot, "to":id|spot, "dur"? }   // topsuz çizgi (koşu yolu, pas seçeneği)',
      camera: '{ "do":"camera", "at":sn, "mode":"broadcast|follow|top|behind|goal" }   // geçiş 1.2 sn'
    },
    rules: [
      'at = SAHNE başından saniye; anlatımda o fiil söylendiği an (transkript zamanı − sahne start).',
      'Top hareketleri (pass/shoot) üst üste binemez; her pas/şut topu elinde tutan oyuncudan başlar (zincir: A→B pası, sonra B→C ya da B şutu).',
      'Adı verilmeyen diğer oyuncular için home/away.formation ver ("4-3-3"): arka plan oyuncuları otomatik dizilir (id: h1..h11, a1..a11; h1/a1 kaleci).',
      'İsim etiketi yalnızca name verilen oyunculara çıkar. Anlatılan ana göre kamera: genel=broadcast, hareketi izle=follow, taktik görünüm=top, şut anı=behind/goal.'
    ]
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
      { id: 'fb', start: 30, end: 44, enabled: true, source: 'manual', content: { type: 'football', home: { name: 'Sarı', formation: '4-3-3' }, away: { name: 'Beyaz', formation: '4-4-2' }, players: [{ id: 'osimhen', name: 'Osimhen', team: 'home', at: 'orta-saha-sag' }, { id: 'baris', name: 'Barış', team: 'home', at: 'ceza-yayi' }], ball: { holder: 'osimhen' }, actions: [{ do: 'dribble', at: 0.5, player: 'osimhen', to: [68, 24], dur: 2 }, { do: 'pass', at: 3, from: 'osimhen', to: 'baris' }, { do: 'camera', at: 4, mode: 'behind' }, { do: 'shoot', at: 5, from: 'baris', to: 'kale-sol-ust', result: 'goal' }] } },
      { id: 's3', start: 44, end: 52, enabled: true, source: 'manual', content: { type: 'media', file: 'hoeness.png', fit: 'contain', align: 'right', title: 'Teknik direktör', caption: 'Sebastian Hoeness' } }
    ]
  }
}
