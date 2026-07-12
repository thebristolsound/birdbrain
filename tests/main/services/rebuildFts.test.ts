import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture, getCaptureTextContent, searchCaptures } from '@main/services/db/captureRepo'
import { rebuildFts } from '@main/services/db/dbAdmin'
import type { CaptureStore } from '@main/services/captureStore'

function makeCapture(caseId: string, text: string) {
  return insertCapture({
    caseId,
    url: 'https://x.example',
    title: 'T',
    hash: 'h',
    timestamp: '2026-01-01T00:00:00Z',
    textContent: text,
    format: 'mhtml'
  })
}

describe('rebuildFts heals capture_texts from sidecars', () => {
  beforeEach(() => initDatabase(':memory:'))
  afterEach(() => closeDatabase())

  it('re-reads .txt sidecars into capture_texts; index follows', () => {
    const c = createCase({ name: 'C', description: '', type: 'custom' })
    const cap = makeCapture(c.id, '')
    const fakeStore = {
      readArtifact: (_caseId: string, captureId: string, type: string) =>
        captureId === cap.id && type === 'txt' ? Buffer.from('healed sidecar text') : null
    } as unknown as CaptureStore
    const result = rebuildFts(fakeStore)
    expect(getCaptureTextContent(cap.id)).toBe('healed sidecar text')
    expect(searchCaptures('healed').map((x) => x.id)).toEqual([cap.id])
    expect(result.textsHealed).toBe(1)
    expect(result.rowsIndexed).toBeGreaterThanOrEqual(1)
  })

  it('leaves captures without a sidecar untouched (legacy HTML captures)', () => {
    const c = createCase({ name: 'C', description: '', type: 'custom' })
    const cap = makeCapture(c.id, 'original')
    const emptyStore = { readArtifact: () => null } as unknown as CaptureStore
    const result = rebuildFts(emptyStore)
    expect(getCaptureTextContent(cap.id)).toBe('original')
    expect(result.textsHealed).toBe(0)
  })
})
