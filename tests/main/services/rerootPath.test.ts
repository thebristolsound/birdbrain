import { describe, it, expect } from 'vitest'
import { rerootPath } from '@main/services/db/exhibitRepo'

describe('rerootPath', () => {
  it('moves a case-rooted path to the new case and id', () => {
    expect(rerootPath('oldCase/oldId.mhtml', 'newCase', 'oldId', 'newId')).toBe(
      'newCase/newId.mhtml'
    )
    expect(rerootPath('oldCase/attachments/oldId.zip', 'newCase', 'oldId', 'newId')).toBe(
      'newCase/attachments/newId.zip'
    )
  })

  it('keeps the file name of a filename-only legacy path', () => {
    expect(rerootPath('oldId.mhtml', 'newCase', 'oldId', 'newId')).toBe('newCase/newId.mhtml')
  })

  it('reads backslash separators from a Windows-exported archive', () => {
    expect(rerootPath('oldCase\\oldId.png', 'newCase', 'oldId', 'newId')).toBe(
      'newCase/newId.png'
    )
    expect(rerootPath('oldCase\\attachments\\oldId.zip', 'newCase', 'oldId', 'newId')).toBe(
      'newCase/attachments/newId.zip'
    )
  })
})
