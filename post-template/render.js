// Sablonu 1080x1920 render eder; video ve buton yuvasinin konumunu layout.json'a, maskeyi .build/mask.png'ye yazar.
// Kullanim: node render.js   (playwright gerekir)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const dir = __dirname, out = path.join(dir, '.build');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  await p.goto('file://' + dir + '/index.html?scale=1&render=1');
  await p.waitForTimeout(600);
  const L = await p.evaluate(() => {
    const r = id => { const e = document.getElementById(id).getBoundingClientRect(); return { x: e.x, y: e.y, w: e.width, h: e.height }; };
    const c = getComputedStyle(document.querySelector('.canvas'));
    return { video: r('video'), btn: r('btn-slot'), radius: parseFloat(getComputedStyle(document.getElementById('video')).borderRadius),
             safeTop: parseFloat(c.paddingTop), safeBottom: parseFloat(c.paddingBottom) };
  });
  const even = n => Math.round(n / 2) * 2;
  L.video = { x: Math.round(L.video.x), y: Math.round(L.video.y), w: even(L.video.w), h: even(L.video.h) };
  L.btn = { x: Math.round(L.btn.x), y: Math.round(L.btn.y), w: Math.round(L.btn.w), h: Math.round(L.btn.h) };
  // icerik guvenli alana sigiyor mu?
  L.contentTop = await p.evaluate(() => document.querySelector('.profile').getBoundingClientRect().top);
  fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify(L, null, 2));
  await p.screenshot({ path: path.join(out, 'base.png') });
  const m = await b.newPage({ viewport: { width: L.video.w, height: L.video.h } });
  await m.setContent(`<body style="margin:0;background:#000"><div style="width:${L.video.w}px;height:${L.video.h}px;background:#fff;border-radius:${L.radius}px"></div></body>`);
  await m.screenshot({ path: path.join(out, 'mask.png') });
  await b.close();
  const bottom = Math.max(L.btn.y + L.btn.h, L.video.y + L.video.h);
  console.log(JSON.stringify({ icerik_ust: Math.round(L.contentTop), buton_alt: bottom, guvenli_ust: L.safeTop, guvenli_alt: 1920 - L.safeBottom }));
})();
