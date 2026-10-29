import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/settings'
import type { LayoutTemplate, Settings } from '../shared/types'

export class SettingsStore {
  private cur: Settings = { ...DEFAULT_SETTINGS }

  constructor(private readonly file: string) {}

  get value(): Settings {
    return this.cur
  }

  async load(): Promise<Settings> {
    try {
      this.cur = normalizeSettings(JSON.parse(await readFile(this.file, 'utf8')))
    } catch {
      this.cur = { ...DEFAULT_SETTINGS }
    }
    return this.cur
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    this.cur = normalizeSettings({ ...this.cur, ...patch })
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify(this.cur, null, 2), 'utf8')
    await rename(tmp, this.file)
    return this.cur
  }
}

/** Kullanıcının kaydettiği sahne/kare düzeni şablonları (yerleşik şablonlar kodda durur). */
export class TemplateStore {
  private items: LayoutTemplate[] = []

  constructor(private readonly file: string) {}

  get value(): LayoutTemplate[] {
    return this.items
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8'))
      this.items = Array.isArray(raw) ? raw.filter((t) => t && typeof t.id === 'string' && Array.isArray(t.layers)).map((t) => ({ ...t, builtin: false })) : []
    } catch {
      this.items = []
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify(this.items, null, 2), 'utf8')
    await rename(tmp, this.file)
  }

  async save(t: LayoutTemplate): Promise<LayoutTemplate[]> {
    this.items = [...this.items.filter((x) => x.id !== t.id), { ...t, builtin: false }]
    await this.persist()
    return this.items
  }

  async remove(id: string): Promise<LayoutTemplate[]> {
    this.items = this.items.filter((x) => x.id !== id)
    await this.persist()
    return this.items
  }
}
