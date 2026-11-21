import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TEAMS } from '../../shared/story/teams'
import { parseAliases } from '../../shared/transcript/vocabulary'
import { loadKnowledge } from '../story/knowledge'

/**
 * Yerleşik futbol sözlüğü (konuşma tanıma düzeltmesi): resources/knowledge/glossary.txt (oyuncu/teknik direktör/takım adları)
 * + takım veritabanı adları + bilgi paketindeki oyuncu/takım adları. Yalnızca YAZIMI düzeltir; temkinli eşikle uygulanır.
 */
/** Yerleşik düzeltme listesi: resources/knowledge/aliases.txt ("yanlış => doğru") */
export async function builtinAliases(env: { resourcesDir: string }): Promise<{ from: string; to: string }[]> {
  try {
    return parseAliases(await readFile(join(env.resourcesDir, 'knowledge', 'aliases.txt'), 'utf8'))
  } catch {
    return []
  }
}

export async function builtinGlossary(env: { resourcesDir: string; userDataDir: string }): Promise<string[]> {
  const terms = new Set<string>()
  try {
    const txt = await readFile(join(env.resourcesDir, 'knowledge', 'glossary.txt'), 'utf8')
    for (const l of txt.split(/\r?\n/)) if (l.trim() && !l.startsWith('#')) terms.add(l.trim())
  } catch {
    /* sözlük dosyası yoksa yalnızca veritabanı */
  }
  for (const t of TEAMS) terms.add(t.name)
  try {
    const kn = await loadKnowledge(env)
    for (const d of kn.datasets) for (const r of d.rows) {
      terms.add(r.name)
      if (r.team) terms.add(r.team)
    }
  } catch {
    /* bilgi paketi okunamazsa yok say */
  }
  return [...terms]
}
