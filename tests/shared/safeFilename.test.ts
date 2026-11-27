import { describe, it, expect } from 'vitest'
import { safeFilename, MAX_FILENAME_STEM_LENGTH } from '@shared/safeFilename'

describe('safeFilename', () => {
  it('replaces every character Windows rejects in a path segment', () => {
    expect(safeFilename('Foo: bar | Site? <a> "b" c/d\\e*f')).toBe('Foo bar Site a b c d e f')
  })

  it('strips control characters', () => {
    expect(safeFilename('a b\tc\nde')).toBe('a b c d e')
  })

  it('collapses whitespace and trims trailing dots and spaces', () => {
    expect(safeFilename('  Report   v2. . ')).toBe('Report v2')
  })

  it('keeps unicode letters intact', () => {
    expect(safeFilename('Отчёт – 報告 — café')).toBe('Отчёт – 報告 — café')
  })

  it('falls back when nothing usable remains or the name is a reserved device', () => {
    expect(safeFilename('', 'capture')).toBe('capture')
    expect(safeFilename(null, 'capture')).toBe('capture')
    expect(safeFilename('???', 'capture')).toBe('capture')
    expect(safeFilename('CON', 'capture')).toBe('capture')
    expect(safeFilename('lpt3', 'capture')).toBe('capture')
    expect(safeFilename('Console', 'capture')).toBe('Console')
  })

  it('falls back for a reserved device name followed by an extension', () => {
    expect(safeFilename('CON.report', 'capture')).toBe('capture')
    expect(safeFilename('NUL.txt', 'capture')).toBe('capture')
    expect(safeFilename('com1.tar.gz', 'capture')).toBe('capture')
  })

  it('keeps names that only start with a device name', () => {
    expect(safeFilename('Console.txt', 'capture')).toBe('Console.txt')
    expect(safeFilename('COM10', 'capture')).toBe('COM10')
    expect(safeFilename('AUXiliary', 'capture')).toBe('AUXiliary')
    expect(safeFilename('report.CON', 'capture')).toBe('report.CON')
  })

  it('caps length at the stem limit', () => {
    const long = 'x'.repeat(500)
    expect(safeFilename(long).length).toBe(MAX_FILENAME_STEM_LENGTH)
    expect(safeFilename(long, 'f', 10)).toBe('xxxxxxxxxx')
  })

  it('drops a whole emoji when the length cap lands inside its surrogate pair', () => {
    // 9 units of x then a 2-unit emoji: a 10-unit cut falls between its halves.
    expect(safeFilename(`${'x'.repeat(9)}😀tail`, 'f', 10)).toBe('xxxxxxxxx')
    expect(safeFilename(`${'x'.repeat(8)}😀tail`, 'f', 10)).toBe('xxxxxxxx😀')
  })
})
