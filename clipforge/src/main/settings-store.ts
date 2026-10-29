import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/settings'
import type { Settings } from '../shared/types'

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
