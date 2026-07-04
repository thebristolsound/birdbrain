import { describe, it, expect } from 'vitest'
import { createStoredZip } from '../../../src/main/services/zip'
import { readStoredZip } from '../../../src/main/services/zipRead'

describe('readStoredZip', () => {
  it('round-trips createStoredZip output', () => {
    const zip = createStoredZip([
      { name: 'a.txt', data: 'hello' },
      { name: 'dir/b.bin', data: Buffer.from([0, 1, 2, 255]) },
      { name: 'empty.txt', data: '' }
    ])
    const entries = readStoredZip(zip)
    expect([...entries.keys()]).toEqual(['a.txt', 'dir/b.bin', 'empty.txt'])
    expect(entries.get('a.txt')!.toString('utf-8')).toBe('hello')
    expect(entries.get('dir/b.bin')).toEqual(Buffer.from([0, 1, 2, 255]))
    expect(entries.get('empty.txt')!.length).toBe(0)
  })

  it('rejects garbage and truncated buffers', () => {
    expect(() => readStoredZip(Buffer.from('not a zip'))).toThrow(/not a valid/i)
    const zip = createStoredZip([{ name: 'a.txt', data: 'hello' }])
    expect(() => readStoredZip(zip.subarray(0, zip.length - 4))).toThrow(/not a valid/i)
  })
})
