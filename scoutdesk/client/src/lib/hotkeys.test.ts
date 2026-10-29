import { describe, expect, it } from 'vitest'
import { comboFromEvent, formatHotkey, normalizeCombo } from './hotkeys'

const ev = (o: Partial<KeyboardEvent>) => ({ key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o }) as KeyboardEvent

describe('comboFromEvent', () => {
  it('lowercases letters and names special keys', () => {
    expect(comboFromEvent(ev({ key: 'S' }))).toBe('s')
    expect(comboFromEvent(ev({ key: ' ' }))).toBe('space')
    expect(comboFromEvent(ev({ key: 'ArrowLeft' }))).toBe('left')
  })
  it('orders modifiers mod → alt → shift', () => {
    expect(comboFromEvent(ev({ key: 'z', ctrlKey: true, shiftKey: true }))).toBe('mod+shift+z')
    expect(comboFromEvent(ev({ key: 'z', metaKey: true }))).toBe('mod+z')
    expect(comboFromEvent(ev({ key: 'ArrowRight', shiftKey: true }))).toBe('shift+right')
  })
  it('keeps shift for letters but not for symbols like "?"', () => {
    expect(comboFromEvent(ev({ key: 'X', shiftKey: true }))).toBe('shift+x')
    expect(comboFromEvent(ev({ key: '?', shiftKey: true }))).toBe('?')
  })
  it('uses the physical key under Alt (macOS rewrites e.key)', () => {
    expect(comboFromEvent(ev({ key: '¡', code: 'Digit1', altKey: true }))).toBe('alt+1')
    expect(comboFromEvent(ev({ key: '†', code: 'KeyT', altKey: true }))).toBe('alt+t')
  })
})

describe('normalizeCombo / formatHotkey', () => {
  it('normalises aliases and ordering', () => {
    expect(normalizeCombo('Shift+Ctrl+Z')).toBe('mod+shift+z')
    expect(normalizeCombo('esc')).toBe('escape')
  })
  it('renders readable labels', () => {
    expect(formatHotkey('space')).toBe('Space')
    expect(formatHotkey('left')).toBe('←')
    expect(formatHotkey('shift+x')).toContain('X')
  })
})
