import { copyFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { AppService } from '../main/app'
import type { Command } from '../shared/timeline/history'
import { PROJECT_VERSION, type MediaAsset, type Project, type Timeline, type Transcript } from '../shared/types'
import { createDefaultTimeline, newId } from '../shared/timeline/model'

/** Uygulamayla AYNI kullanıcı verisi klasörü: ayarlar (whisper yolu/model, sözlük) paylaşılır. */
export function defaultUserData(): string {
  if (process.env.CLIPFORGE_USER_DATA) return process.env.CLIPFORGE_USER_DATA
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'ClipForge')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'ClipForge')
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'ClipForge')
}

export async function makeService(): Promise<AppService> {
  const s = new AppService({
    userDataDir: defaultUserData(),
    resourcesDir: resolve(__dirname, '..', '..', 'resources'),
    version: 'cli',
    platform: process.platform,
    emit: () => undefined,
    headless: true
  })
  await s.init()
  return s
}

export const log = (msg: string) => process.stderr.write(`${msg}\n`)

/** Bir görevin bitmesini bekler; hata durumunda anlaşılır mesajla fırlatır. İlerlemeyi stderr'e yazar. */
export function waitTask(service: AppService, id: string, label: string): Promise<void> {
  return new Promise((ok, bad) => {
    let last = -1
    const check = (t: { id: string; status: string; progress: number; error?: string }) => {
      if (t.id !== id) return
      const pct = Math.floor(t.progress * 100)
      if (pct !== last && pct % 10 === 0) (last = pct, log(`${label}: %${pct}`))
      if (t.status === 'done') (off(), ok())
      else if (t.status === 'failed') (off(), bad(new Error(t.error ?? `${label} başarısız`)))
      else if (t.status === 'cancelled') (off(), bad(new Error(`${label} iptal edildi`)))
    }
    const off = service.queue.onUpdate(check)
    const cur = service.queue.get(id)
    if (cur) check(cur)
  })
}

/** Açık bir proje: bellek içi durum + diske kaydet. Her yazmadan önce `.bak` yedeği alınır. */
export class Session {
  constructor(
    readonly service: AppService,
    readonly path: string,
    public project: Project,
    public transcripts: Record<string, Transcript>
  ) {}

  get timeline(): Timeline {
    return this.project.timeline
  }

  static async open(path: string, service?: AppService): Promise<Session> {
    const svc = service ?? (await makeService())
    const abs = resolve(path)
    const { project } = await svc.openProject(abs)
    const transcripts: Record<string, Transcript> = {}
    for (const a of project.assets) {
      const t = await svc.transcriptGet(a.id)
      if (t) transcripts[a.id] = t
    }
    return new Session(svc, abs, project, transcripts)
  }

  static async create(path: string, name: string): Promise<Session> {
    const svc = await makeService()
    const abs = resolve(path)
    svc.newProject()
    const now = new Date().toISOString()
    const project: Project = { version: PROJECT_VERSION, id: newId('proj'), name, createdAt: now, updatedAt: now, assets: [], timeline: createDefaultTimeline(), chatLogs: [], candidates: [], markers: {}, searchHistory: [], transcriptRefs: {}, exportJobs: [] }
    await mkdir(dirname(abs), { recursive: true })
    const s = new Session(svc, abs, project, {})
    await s.save()
    return s
  }

  /** Komutları zaman çizelgesine uygular (geri alma yok: .bak yedeği vardır) */
  apply(...cmds: Command<Timeline>[]): void {
    this.project = { ...this.project, timeline: cmds.reduce((tl, c) => c.do(tl), this.project.timeline) }
  }

  asset(ref?: string): MediaAsset {
    const list = this.project.assets
    if (list.length === 0) throw new Error('Projede medya yok. Önce `import` ile video ekleyin.')
    if (!ref) {
      if (list.length > 1) throw new Error(`Birden çok medya var; --asset <id|ad> verin: ${list.map((a) => `${a.id} (${a.name})`).join(', ')}`)
      return list[0]
    }
    const a = list.find((x) => x.id === ref) ?? list.find((x) => x.name.toLowerCase().includes(ref.toLowerCase()))
    if (!a) throw new Error(`Medya bulunamadı: ${ref}`)
    return a
  }

  async save(): Promise<void> {
    try {
      await copyFile(this.path, `${this.path}.bak`)
    } catch {
      /* ilk kayıt: yedek yok */
    }
    await this.service.saveProject(this.project, this.path)
  }
}
