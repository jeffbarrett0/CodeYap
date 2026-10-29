import { describe, expect, it } from 'vitest'
import { validateHotkey } from '../settings/TaxonomyEditor'
import { mentionSeconds } from './ClipComments'

describe('comment mentions', () => {
  it('parses m:ss and h:mm:ss', () => {
    expect(mentionSeconds('1:23')).toBe(83)
    expect(mentionSeconds('0:05')).toBe(5)
    expect(mentionSeconds('1:02:03')).toBe(3723)
  })
})

describe('tag hotkey validation', () => {
  it('accepts letters, digits and shift+letter', () => {
    for (const k of ['s', '4', 'shift+x']) expect(validateHotkey(k)).toBeNull()
  })
  it('rejects keys owned by the player / editor', () => {
    for (const k of ['space', 'f', 'm', 'd', 'i', 'o', 'left', '[', 'shift+f', 'enter']) expect(validateHotkey(k), k).toMatch(/reserved/)
  })
  it('rejects modifier combos and odd keys', () => {
    expect(validateHotkey('mod+s')).toMatch(/reserved/)
    expect(validateHotkey('alt+1')).toMatch(/reserved/)
    expect(validateHotkey('shift+1')).not.toBeNull()
    expect(validateHotkey(';')).not.toBeNull()
  })
})
