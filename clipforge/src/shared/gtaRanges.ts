/** "28-45", "0:28 - 0:45", "1:02:03-1:03:10 Başlık", "28 45" satırlarından aralıklar; bozuk/ters satırlar uyarı olarak döner */
export function parseGtaRanges(text: string): { ranges: { start: number; end: number; title: string }[]; warnings: string[] } {
  const ranges: { start: number; end: number; title: string }[] = []
  const warnings: string[] = []
  const t = (x: string): number | null => {
    const p = x.trim().replace(',', '.').split(':')
    if (p.length > 3 || p.some((q) => !/^\d+(\.\d+)?$/.test(q))) return null
    return p.reduce((a, q) => a * 60 + Number(q), 0)
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const m = /^(\d+(?::\d+){0,2}(?:[.,]\d+)?)\s*(?:-|–|—|\s|ile|→|>)\s*(\d+(?::\d+){0,2}(?:[.,]\d+)?)\s*(.*)$/i.exec(line)
    const a = m ? t(m[1]) : null
    const b = m ? t(m[2]) : null
    if (!m || a === null || b === null) {
      warnings.push(`Okunamadı: "${line}" (örnek: 0:28 - 0:45)`)
      continue
    }
    if (!(b - a >= 3)) {
      warnings.push(`"${line}": bitiş başlangıçtan en az 3 sn sonra olmalı`)
      continue
    }
    ranges.push({ start: a, end: b, title: m[3].trim() || `GTA 6 klip ${ranges.length + 1}` })
  }
  return { ranges, warnings }
}

