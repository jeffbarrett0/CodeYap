import { describe, expect, it } from 'vitest'
import { editDistance, foldTr, phoneticFold, similarity, tokenize } from '@shared/text'
import { parseQuery } from '@shared/search/engine'

describe('foldTr', () => {
  it('Türkçe karakterleri ve büyük/küçük harfi eşitler', () => {
    expect(foldTr('ISIĞI ŞÖYLE ÇÜŞ')).toBe('isigi soyle cus')
    expect(foldTr('İstanbul ıspanak')).toBe('istanbul ispanak')
    expect(foldTr('Âlim Kâğıt')).toBe('alim kagit')
  })
  it('tokenize kesme işaretinde böler', () => {
    expect(tokenize("Victor'dan Nelson'ın")).toEqual(['victor', 'dan', 'nelson', 'in'])
  })
})

describe('benzerlik', () => {
  it('Damerau-Levenshtein yer değiştirmeyi 1 sayar', () => {
    expect(editDistance('nelson', 'nelsno')).toBe(1)
    expect(editDistance('kitten', 'sitting')).toBe(3)
    expect(editDistance('abc', 'abcdefgh', 2)).toBeGreaterThan(2)
  })
  it('fonetik indirgeme Victor/Viktor/Wiktor eşler', () => {
    expect(phoneticFold('victor')).toBe(phoneticFold('viktor'))
    expect(phoneticFold('victor')).toBe(phoneticFold('wiktor'))
  })
  it('benzerlik değerleri mantıklı', () => {
    expect(similarity('victor', 'viktor')).toBeGreaterThanOrEqual(0.95)
    expect(similarity('nelson', 'nelsen')).toBeGreaterThanOrEqual(0.8)
    expect(similarity('nelson', 'banana')).toBeLessThan(0.4)
  })
})

describe('parseQuery', () => {
  it('dolgu sözcükleri atar, içerik terimlerini tutar', () => {
    expect(parseQuery('Victor Nelson ile ilgili konuştuğum yer').map((t) => t.norm)).toEqual(['victor', 'nelson'])
    expect(parseQuery('Ayşe Hanım').map((t) => t.norm)).toEqual(['ayse', 'hanim'])
  })
  it('yalnızca dolgu varsa hepsini korur', () => {
    expect(parseQuery('bir yer').length).toBe(2)
  })
})
