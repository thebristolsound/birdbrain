import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, initDatabase } from '@main/services/db/core'
import { createCase, updateCase } from '@main/services/db/caseRepo'
import { insertCapture, toggleFavorite } from '@main/services/db/captureRepo'
import { createNote } from '@main/services/db/noteRepo'
import { addTagToCapture, createTag } from '@main/services/db/tagRepo'
import { appendManifestEntry, initManifest } from '@main/services/manifest'
import { readCaseRevision } from '@main/services/caseRevision'

// The revision read (ADR-0042; engine plan E6): the generation and counter from
// the database, and the head of the Case's manifest.jsonl read from the file
// each time.
describe('readCaseRevision', () => {
  let root: string
  let caseId: string
  const store = { caseDir: (id: string) => join(root, id) }

  function stamp(n: number) {
    return appendManifestEntry(store.caseDir(caseId), {
      type: 'timestamp',
      caseId,
      captureContentHash: 'a'.repeat(64),
      timestamp: `2026-10-16T00:00:0${n}.000Z`,
      operatorId: 'op-1',
      operatorName: 'Operator',
      toolVersion: '0.1.0'
    })
  }

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-case-revision-'))
    await initDatabase(':memory:')
    caseId = createCase({ name: 'Revision' }).id
    mkdirSync(store.caseDir(caseId), { recursive: true })
  })

  afterEach(() => {
    closeDatabase()
    rmSync(root, { recursive: true, force: true })
  })

  it('reads no head while the Manifest is absent or empty', () => {
    const revision = readCaseRevision(caseId, store)
    expect(revision).toEqual({
      caseId,
      generation: expect.stringMatching(/^[0-9a-f]{32}$/),
      counter: 0,
      manifestHead: null
    })
    initManifest(store.caseDir(caseId))
    expect(readCaseRevision(caseId, store)?.manifestHead).toBeNull()
  })

  it("reads the last Manifest entry's index and hash, and follows each append", () => {
    initManifest(store.caseDir(caseId))
    const first = stamp(1)
    expect(readCaseRevision(caseId, store)?.manifestHead).toEqual({
      index: first.index,
      entryHash: first.entryHash
    })
    const second = stamp(2)
    const after = readCaseRevision(caseId, store)
    expect(after?.manifestHead).toEqual({ index: first.index + 1, entryHash: second.entryHash })
    expect(second.entryHash).not.toBe(first.entryHash)
  })

  it('reads the counter the triggers keep', () => {
    createNote({ caseId, title: 'N', body: 'text' })
    expect(readCaseRevision(caseId, store)?.counter).toBe(2)
  })

  it('stays as it was across Tag, favourite and Case name edits', () => {
    initManifest(store.caseDir(caseId))
    stamp(1)
    const capture = insertCapture({
      caseId,
      url: 'https://harrow.example.net/',
      title: 'Harrow',
      hash: 'a'.repeat(64),
      timestamp: '2026-10-16T00:00:00.000Z'
    })
    const before = readCaseRevision(caseId, store)

    addTagToCapture({ captureId: capture.id, tagId: createTag({ name: 'Evidence' }).id })
    toggleFavorite(capture.id)
    updateCase({ id: caseId, name: 'Renamed' })

    expect(readCaseRevision(caseId, store)).toEqual(before)
  })

  it('returns null for an id that names no Case, without reading any file', () => {
    const caseDir = vi.fn(store.caseDir)
    expect(readCaseRevision('no-such-case', { caseDir })).toBeNull()
    expect(caseDir).not.toHaveBeenCalled()
  })

  // As strict as the append path: a damaged last line is never read as an
  // empty Manifest.
  it('throws on a damaged last Manifest line', () => {
    initManifest(store.caseDir(caseId))
    stamp(1)
    appendFileSync(join(store.caseDir(caseId), 'manifest.jsonl'), '{"index": "torn\n')
    expect(() => readCaseRevision(caseId, store)).toThrow()
  })
})
