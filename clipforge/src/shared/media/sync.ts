/**
 * İki kaydın (ekran / kamera) ses zarflarını çapraz ilişkiyle hizalayıp zaman ofsetini bulur.
 * `a` ve `b`: aynı örnekleme hızında (`rate` Hz) ses zarfı (ör. 100 Hz RMS) dizileri.
 * Dönen değer: b'nin zamanı = a'nın zamanı + offset (sn). Pozitif → b, a'dan sonra başlıyor / geriden geliyor.
 */
export function estimateOffsetSec(a: Float32Array | number[], b: Float32Array | number[], rate: number, maxOffsetSec = 10): { offsetSec: number; confidence: number } {
  const norm = (x: ArrayLike<number>) => {
    let m = 0
    for (let i = 0; i < x.length; i++) m += x[i]
    m /= x.length || 1
    const out = new Float32Array(x.length)
    let v = 0
    for (let i = 0; i < x.length; i++) {
      out[i] = x[i] - m
      v += out[i] * out[i]
    }
    const sd = Math.sqrt(v / (x.length || 1)) || 1
    for (let i = 0; i < out.length; i++) out[i] /= sd
    return out
  }
  const A = norm(a)
  const B = norm(b)
  const maxLag = Math.floor(maxOffsetSec * rate)
  let best = -Infinity
  let bestLag = 0
  let second = -Infinity
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    // b[i + lag] ↔ a[i]
    let s = 0
    let n = 0
    const i0 = Math.max(0, -lag)
    const i1 = Math.min(A.length, B.length - lag)
    for (let i = i0; i < i1; i++) {
      s += A[i] * B[i + lag]
      n++
    }
    if (n < rate) continue
    const c = s / n
    if (c > best) {
      second = Math.max(second, best)
      best = c
      bestLag = lag
    } else if (Math.abs(lag - bestLag) > 3) second = Math.max(second, c)
  }
  const confidence = Math.max(0, Math.min(1, best - Math.max(0, second) * 0.5))
  return { offsetSec: bestLag / rate, confidence }
}
