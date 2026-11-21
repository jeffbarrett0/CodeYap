import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Çalıştırma günlüğü: Auto Kick / Auto Clips zincirinde ne olduğu çıktı klasöründe `Auto Kick günlüğü.txt` dosyasına yazılır (sorun olursa nedeni görülebilsin). Hata asla işi bozmaz. */
export async function appendRunLog(dir: string, text: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true })
    const t = new Date()
    const stamp = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} ${t.toTimeString().slice(0, 8)}`
    await appendFile(join(dir, 'Auto Kick günlüğü.txt'), `[${stamp}] ${text}\n`, 'utf8')
  } catch {
    /* günlük yazılamadı: önemli değil */
  }
}
