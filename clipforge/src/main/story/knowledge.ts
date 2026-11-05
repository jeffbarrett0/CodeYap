import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateDataset, type Dataset } from '../../shared/story/data'

/**
 * Bilgi paketi yükleyici: uygulamayla gelen tohum veri (resources/knowledge) + kullanıcının eklediği/güncellediği veri
 * (kullanıcı veri klasörü/knowledge). Aynı id varsa kullanıcınınki öncelikli. Bozuk dosya atlanır, uyarı döner.
 */
export interface Knowledge {
  datasets: Dataset[]
  warnings: string[]
  userDir: string
}

async function readDir(dir: string, into: Map<string, Dataset>, warnings: string[]): Promise<void> {
  let files: string[] = []
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  } catch {
    return
  }
  for (const f of files) {
    try {
      const raw = JSON.parse(await readFile(join(dir, f), 'utf8')) as unknown
      for (const d of Array.isArray(raw) ? raw : [raw]) {
        const v = validateDataset(d)
        into.set(v.id, v)
      }
    } catch (e) {
      warnings.push(`${f}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

export async function loadKnowledge(env: { userDataDir: string; resourcesDir: string }): Promise<Knowledge> {
  const map = new Map<string, Dataset>()
  const warnings: string[] = []
  const userDir = join(env.userDataDir, 'knowledge')
  await readDir(join(env.resourcesDir, 'knowledge'), map, warnings)
  await readDir(userDir, map, warnings)
  return { datasets: [...map.values()], warnings, userDir }
}

/** Kullanıcı bilgi paketine veri kümesi yazar (aynı id'yi günceller) */
export async function saveDataset(env: { userDataDir: string }, d: unknown): Promise<Dataset> {
  const v = validateDataset(d)
  const dir = join(env.userDataDir, 'knowledge')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${v.id}.json`), JSON.stringify(v, null, 2), 'utf8')
  return v
}
