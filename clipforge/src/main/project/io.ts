import { access, copyFile, cp, link, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { PROJECT_VERSION, type Project } from '../../shared/types'
import { applyTemplate, DEFAULT_TEMPLATE, normalizeTracks } from '../../shared/timeline/templates'
import { sanitizePlacements } from '../../shared/timeline/ops'

/** Proje dosyasının türetilmiş verileri (proxy, küçük resim, transkript) için yan klasör */
export function dataDirFor(projectPath: string): string {
  return `${projectPath}-data`
}

const toPosix = (p: string) => p.split(sep).join('/')

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** Kayıt biçimine çevirir: medya yolları proje dosyasına göre GÖRELİ saklanır (mutlak yol yedek olarak kalır). */
export function serializeProject(project: Project, projectPath: string, transcriptIds: string[] = []): Project {
  const dir = dirname(projectPath)
  return {
    ...project,
    version: PROJECT_VERSION,
    updatedAt: new Date().toISOString(),
    transcriptRefs: Object.fromEntries(transcriptIds.map((id) => [id, `transcripts/${id}.json`])),
    assets: project.assets.map((a) => {
      const { missing: _missing, ...rest } = a
      void _missing
      return { ...rest, relativePath: toPosix(relative(dir, a.path)) }
    })
  }
}

export async function saveProject(project: Project, projectPath: string, transcriptIds: string[] = []): Promise<void> {
  const data = serializeProject(project, projectPath, transcriptIds)
  await mkdir(dirname(projectPath), { recursive: true })
  const tmp = `${projectPath}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, projectPath)
}

export class ProjectFileError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage)
  }
}

/**
 * Projeyi açar. Medya yolları önce göreli (proje klasörüne göre), bulunamazsa mutlak yoldan çözülür;
 * ikisi de yoksa varlık `missing` olarak işaretlenir (proje yine açılır, dışa aktarma uyarı verir).
 */
export async function openProject(projectPath: string): Promise<Project> {
  let raw: string
  try {
    raw = await readFile(projectPath, 'utf8')
  } catch {
    throw new ProjectFileError('Proje dosyası okunamadı.')
  }
  let p: Project
  try {
    p = JSON.parse(raw) as Project
  } catch {
    throw new ProjectFileError('Proje dosyası bozuk (geçerli JSON değil).')
  }
  if (typeof p.version !== 'number' || !Array.isArray(p.assets) || !p.timeline) throw new ProjectFileError('Bu dosya bir ClipForge projesi değil.')
  if (p.version > PROJECT_VERSION) throw new ProjectFileError('Proje, uygulamanın daha yeni bir sürümüyle kaydedilmiş. Lütfen ClipForge\'u güncelleyin.')

  const dir = dirname(projectPath)
  for (const a of p.assets) {
    const byRel = a.relativePath ? resolve(dir, a.relativePath.split('/').join(sep)) : ''
    if (byRel && (await exists(byRel))) {
      a.path = byRel
      a.missing = undefined
    } else if (a.path && isAbsolute(a.path) && (await exists(a.path))) a.missing = undefined
    else a.missing = true
  }
  // v1 projelerinde katman konumu yoktur: varsayılan şablon uygulanır (klipler ve iz kimlikleri korunur)
  if (!p.timeline.tracks.some((t) => t.placement)) p.timeline = applyTemplate(p.timeline, { ...DEFAULT_TEMPLATE, aspect: p.timeline.aspect })
  // Kare dışına taşmış katman konumlarını onar (arayüzü kapatıp tıklamaları yakalıyordu)
  p.timeline = normalizeTracks(sanitizePlacements(p.timeline))
  p.chatLogs ??= []
  p.candidates ??= []
  p.markers ??= {}
  p.searchHistory ??= []
  p.exportJobs ??= []
  p.transcriptRefs ??= {}
  return p
}

/** "Farklı kaydet": türetilmiş veriler yeni konuma kopyalanır */
export async function copyDataDir(from: string, to: string): Promise<void> {
  if (resolve(from) === resolve(to) || !(await exists(from))) return
  await cp(from, to, { recursive: true, force: false, errorOnExist: false })
}

export function defaultProjectName(path: string): string {
  return basename(path).replace(/\.clipforge$/i, '')
}

/** Aynı birimdeyse sabit bağ (anında, ek disk yok), olmazsa kopya */
async function linkOrCopy(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true })
  if (await exists(to)) return
  try {
    await link(from, to)
  } catch {
    await copyFile(from, to)
  }
}

/** Yeni (bağımsız) projenin veri klasörüne yalnızca ilgili türetilmiş dosyaları taşır; kaynak klasöre dokunmaz */
export async function seedDataDir(fromDir: string, toDir: string, relPaths: string[]): Promise<void> {
  for (const rel of relPaths) {
    const src = join(fromDir, rel)
    if (await exists(src)) await linkOrCopy(src, join(toDir, rel))
  }
}
