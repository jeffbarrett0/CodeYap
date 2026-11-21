import { describe, expect, it } from 'vitest'
import { parseChapterList } from '../../src/shared/chapters'
import { safeFileTitle, ytCutFileName, ytCutRanges } from '../../src/shared/ytcut'

describe('YouTube yatay video: aralıklar ve dosya adları', () => {
  it('bitişli satır tam aralığı, tek zamanlı satır sonraki satırın başını, son satır kayıt sonunu kullanır; süre dışı atlanır', () => {
    const list = parseChapterList('00:03:00 - 00:09:00 Noah Lang\n00:34:00 - Leo\n00:41:00 - Deniz Gül\n09:59:00 - Süre dışı')
    const { items, warnings } = ytCutRanges(list, 3 * 3600)
    expect(items.map((i) => [i.title, i.start, i.end])).toEqual([['Noah Lang', 180, 540], ['Leo', 2040, 2460], ['Deniz Gül', 2460, 10800]])
    expect(items.map((i) => i.index)).toEqual([1, 2, 3])
    expect(warnings.join(' ')).toMatch(/Süre dışı/)
  })
  it('bitişi video süresini aşan kırpılır; 2 sn\'den kısa atlanır', () => {
    const { items, warnings } = ytCutRanges(parseChapterList('00:00:10 - 00:09:00 Uzun\n00:00:20 - 00:00:21 Kısa'), 100)
    expect(items).toHaveLength(1)
    expect(items[0].end).toBe(100)
    expect(warnings.length).toBe(2)
  })
  it('Windows\'ta yasak karakterler temizlenir; sıra numarası sıralamayı korur', () => {
    expect(safeFileTitle('Leo: "Beşiktaş" / Ne? <şimdi>.')).toBe('Leo Beşiktaş Ne şimdi')
    expect(safeFileTitle('???')).toBe('Bolum')
    expect(ytCutFileName(3, 'Deniz Gül', 12)).toBe('03 - Deniz Gül.mp4')
    expect(ytCutFileName(3, 'X', 120)).toBe('003 - X.mp4')
  })
})
