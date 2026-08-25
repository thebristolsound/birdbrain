import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { createHash } from 'crypto'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { getCapture, insertCapture, listCaptures } from '@main/services/db/captureRepo'
import { initManifest, verifyManifestChain } from '@main/services/manifest'
import { createCaptureStore } from '@main/services/captureStore'
import type { CaptureStore } from '@main/services/captureStore'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import type { CaptureLifecycle } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import { ManifestEntrySchema } from '@shared/schemas'
import type { Capture } from '@shared/types'

// Duplication is a same-bytes operation, so the corroboration-only TLS re-fetch
// (#123) that ingest performs would otherwise open a real socket while building
// the fixture capture.
vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

const MHTML_BODY = 'From: <Saved by Chrome>\nContent-Type: multipart/related\n\nduplicate me'
const SCREENSHOT = Buffer.from('PNG-screenshot-bytes')
const TEXT = 'a phrase only this page carries'

describe('createCaptureLifecycle.duplicate (#827)', () => {
  let tempDir: string
  let caseDir: string
  let caseId: string
  let lifecycle: CaptureLifecycle
  let source: Capture

  function manifestLines(): Record<string, unknown>[] {
    return readFileSync(join(caseDir, 'manifest.jsonl'), 'utf-8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-duplicate-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator' })
    resetInstallationId()
    initInstallationId(tempDir)
    caseId = createCase({ name: 'Duplicate' }).id
    ensureCaseDir(caseId)
    caseDir = join(tempDir, 'captures', caseId)
    initManifest(caseDir)
    lifecycle = createCaptureLifecycle({
      selectorLifecycle: { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle
    })
    const ingested = await lifecycle.ingest({
      caseId,
      url: 'https://example.com/evidence',
      title: 'Evidence',
      timestamp: '2026-04-05T12:00:00.000Z',
      stream: Readable.from([Buffer.from(MHTML_BODY)]) as unknown as ReadableStream<Uint8Array>,
      textContent: TEXT,
      headers: { server: 'nginx' },
      browserVersion: 'Chrome/120',
      userAgent: 'Mozilla/5.0',
      httpStatus: 200,
      extensionVersion: '0.1.0',
      operatorId: 'op-source',
      operatorName: 'Original Operator',
      toolVersion: '0.1.0',
      screenshot: SCREENSHOT
    })
    source = ingested.capture
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('writes its own artifacts, its own signed entry, and leaves the chain valid', async () => {
    const result = await lifecycle.duplicate(source.id)

    expect(result.status).toBe('duplicated')
    if (result.status !== 'duplicated') return
    const { capture } = result

    // A second ROW, never a second reference to one file: the paths differ and
    // both exist, so deleting either capture cannot take the other's bytes.
    expect(capture.id).not.toBe(source.id)
    expect(capture.mhtmlPath).not.toBe(source.mhtmlPath)
    expect(existsSync(join(tempDir, 'captures', capture.mhtmlPath!))).toBe(true)
    expect(existsSync(join(tempDir, 'captures', source.mhtmlPath!))).toBe(true)
    expect(readFileSync(join(tempDir, 'captures', capture.mhtmlPath!), 'utf-8')).toBe(MHTML_BODY)

    // Same bytes, so the same SHA-256 — which is what lets the copy verify
    // against its own entry.
    expect(capture.hash).toBe(source.hash)
    expect(capture.screenshotHash).toBe(createHash('sha256').update(SCREENSHOT).digest('hex'))
    expect(capture.textHash).toBe(
      createHash('sha256').update(Buffer.from(TEXT, 'utf-8')).digest('hex')
    )

    const entries = manifestLines()
    expect(entries).toHaveLength(2)
    expect(entries[1].captureId).toBe(capture.id)
    expect(capture.manifestIndex).toBe(1)
    expect(verifyManifestChain(caseDir).valid).toBe(true)
    // The duplicate verifies on its own entry, not on the source's.
    await expect(lifecycle.verify(capture.id)).resolves.toMatchObject({ status: 'verified' })
    await expect(lifecycle.verify(source.id)).resolves.toMatchObject({ status: 'verified' })
  })

  it('states on the chain that it is a copy, of what, when, and by whom', async () => {
    const result = await lifecycle.duplicate(source.id)
    if (result.status !== 'duplicated') throw new Error('expected a duplicate')

    const entry = manifestLines()[1]
    // Without these three the entry is indistinguishable from a second capture
    // of the page — the one thing a duplicate must never look like.
    expect(entry.method).toBe('duplicate')
    expect(entry.duplicateOfCaptureId).toBe(source.id)
    expect(typeof entry.duplicatedAt).toBe('string')
    expect(Date.parse(entry.duplicatedAt as string)).not.toBeNaN()

    // The act is attributed to whoever asked for the copy, not to the operator
    // who captured the page.
    expect(entry.operatorName).toBe('Test Operator')
    expect(manifestLines()[0].operatorName).toBe('Original Operator')

    // The observation is still dated to when the page was seen. Dating it to
    // the copy would claim the site was visited again.
    expect(entry.timestamp).toBe('2026-04-05T12:00:00.000Z')
    expect(entry.url).toBe('https://example.com/evidence')
    expect(entry.duplicatedAt).not.toBe(entry.timestamp)

    expect(ManifestEntrySchema.safeParse(entry).success).toBe(true)
    expect(result.capture.method).toBe('duplicate')
    expect(result.capture.duplicateOfCaptureId).toBe(source.id)
  })

  it('re-anchors from the signed entry, so an edited captures row cannot reach the chain', async () => {
    // Settings → Database can hand-edit any row. The mirror is not the record.
    const { getDb } = await import('@main/services/db/core')
    getDb()
      .prepare('UPDATE captures SET url = ?, timestamp = ?, headers = ? WHERE id = ?')
      .run(
        'https://attacker.example/',
        '2020-01-01T00:00:00.000Z',
        '{"server":"forged"}',
        source.id
      )

    const result = await lifecycle.duplicate(source.id)
    if (result.status !== 'duplicated') throw new Error('expected a duplicate')

    const entry = manifestLines()[1]
    expect(entry.url).toBe('https://example.com/evidence')
    expect(entry.timestamp).toBe('2026-04-05T12:00:00.000Z')
    expect(entry.headers).toEqual({ server: 'nginx' })
    expect(result.capture.url).toBe('https://example.com/evidence')
    expect(verifyManifestChain(caseDir).valid).toBe(true)
  })

  it('copies no tags, notes or extracted data — only the bytes and their provenance', async () => {
    const { getDb } = await import('@main/services/db/core')
    const db = getDb()
    db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').run(
      'tag-1',
      'Relevant',
      '#fff'
    )
    db.prepare('INSERT INTO capture_tags (capture_id, tag_id) VALUES (?, ?)').run(
      source.id,
      'tag-1'
    )

    const result = await lifecycle.duplicate(source.id)
    if (result.status !== 'duplicated') throw new Error('expected a duplicate')

    const tagRows = db
      .prepare('SELECT capture_id FROM capture_tags WHERE tag_id = ?')
      .all('tag-1') as Array<{ capture_id: string }>
    // An operator's judgement about the original is not a fact about the copy.
    expect(tagRows.map((r) => r.capture_id)).toEqual([source.id])
  })

  it('refuses a tampered source, writing neither an entry nor a row', async () => {
    writeFileSync(join(tempDir, 'captures', source.mhtmlPath!), 'tampered bytes')
    const before = manifestLines().length

    const result = await lifecycle.duplicate(source.id)

    expect(result).toEqual({ status: 'rejected', reason: 'not_verified', detail: 'tampered' })
    expect(manifestLines()).toHaveLength(before)
    expect(listCaptures(caseId)).toHaveLength(1)
  })

  it('refuses an MHTML capture that verifies but is anchored by no entry', async () => {
    // A pre-chain MHTML row: `computeVerification` grandfathers a capture with
    // no manifestIndex past the anchoring check, so it reports 'verified' on
    // the file hash alone. Duplicating it would write the first chain entry
    // those bytes ever had, dated and signed now — a stronger record for the
    // copy than the original it came from.
    const orphanId = 'orphan-capture'
    const bytes = 'unanchored bytes'
    writeFileSync(join(tempDir, 'captures', caseId, `${orphanId}.mhtml`), bytes)
    const orphan = insertCapture({
      id: orphanId,
      caseId,
      url: 'https://unanchored.example.com',
      title: 'Unanchored',
      hash: createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
      timestamp: '2026-04-05T12:00:00.000Z',
      format: 'mhtml',
      mhtmlPath: join(caseId, `${orphanId}.mhtml`)
    })
    const before = manifestLines().length

    const result = await lifecycle.duplicate(orphan.id)

    expect(result).toEqual({
      status: 'rejected',
      reason: 'not_verified',
      detail: 'entry-unreadable'
    })
    expect(manifestLines()).toHaveLength(before)
    expect(existsSync(join(tempDir, 'captures', caseId, `${orphanId}.mhtml`))).toBe(true)
  })

  it('refuses, and cleans up, when the copy on disk does not hash to the anchored content', async () => {
    // The window between the verify above and the copy: the source file
    // changing mid-copy must not produce a duplicate that verifies against an
    // entry describing bytes it does not have.
    const realStore = createCaptureStore({ getRoot: () => join(tempDir, 'captures') })
    const shortCopyStore: CaptureStore = {
      ...realStore,
      copyArtifacts: async (cid, sourceId, targetId) => {
        const copied = await realStore.copyArtifacts(cid, sourceId, targetId)
        const { abs, rel } = realStore.artifactPaths(cid, targetId, 'mhtml')
        writeFileSync(abs, 'truncated')
        return {
          ...copied,
          artifacts: {
            ...copied.artifacts,
            mhtml: {
              rel,
              hash: createHash('sha256').update(Buffer.from('truncated')).digest('hex'),
              sizeBytes: 'truncated'.length
            }
          }
        }
      }
    }
    const lifecycleWithShortCopy = createCaptureLifecycle({
      selectorLifecycle: { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle,
      store: shortCopyStore
    })
    const before = manifestLines().length

    const result = await lifecycleWithShortCopy.duplicate(source.id)

    expect(result).toEqual({ status: 'rejected', reason: 'copy_mismatch' })
    expect(manifestLines()).toHaveLength(before)
    expect(listCaptures(caseId)).toHaveLength(1)
    // The half-written copy is removed, so no unreferenced bytes are left in
    // the case directory for an orphan scan to find later.
    const { readdirSync } = await import('fs')
    const strays = readdirSync(join(tempDir, 'captures', caseId)).filter(
      (f) => !f.startsWith(source.id) && f !== 'manifest.jsonl'
    )
    expect(strays).toEqual([])
  })

  it.each(['png', 'txt'] as const)(
    'refuses, and cleans up, when the copied %s sidecar does not hash to its anchored value',
    async (type) => {
      // The same window, for each sidecar: the source's entry anchors its hash,
      // so a copy that lands different bytes must not be signed over — the
      // entry would describe a file the duplicate does not have.
      const realStore = createCaptureStore({ getRoot: () => join(tempDir, 'captures') })
      const corruptStore: CaptureStore = {
        ...realStore,
        copyArtifacts: async (cid, sourceId, targetId) => {
          const copied = await realStore.copyArtifacts(cid, sourceId, targetId)
          const { abs, rel } = realStore.artifactPaths(cid, targetId, type)
          writeFileSync(abs, 'corrupted-sidecar')
          return {
            ...copied,
            artifacts: {
              ...copied.artifacts,
              [type]: {
                rel,
                hash: createHash('sha256').update(Buffer.from('corrupted-sidecar')).digest('hex'),
                sizeBytes: 'corrupted-sidecar'.length
              }
            }
          }
        }
      }
      const lifecycleWithCorruptSidecar = createCaptureLifecycle({
        selectorLifecycle: {
          runActiveSelectorsForCapture: vi.fn()
        } as unknown as SelectorLifecycle,
        store: corruptStore
      })
      const before = manifestLines().length

      const result = await lifecycleWithCorruptSidecar.duplicate(source.id)

      expect(result).toEqual({ status: 'rejected', reason: 'copy_mismatch' })
      expect(manifestLines()).toHaveLength(before)
      expect(listCaptures(caseId)).toHaveLength(1)
      const { readdirSync } = await import('fs')
      const strays = readdirSync(join(tempDir, 'captures', caseId)).filter(
        (f) => !f.startsWith(source.id) && f !== 'manifest.jsonl'
      )
      expect(strays).toEqual([])
    }
  )

  it('anchors for the copy only what the source entry anchors — unanchored sidecars gain none', async () => {
    // A chain-era capture from before sidecar anchoring (#118): its signed
    // entry records no screenshotHash/textHash, so verify skips its sidecar
    // files entirely — including a tampered one. Anchoring a freshly computed
    // hash over the copy would hand those unchecked bytes the first chain
    // anchor they ever had; the copy must stay exactly as unanchored as its
    // source.
    const preId = 'pre-sidecar-capture'
    const bytes = 'pre-sidecar-anchoring capture'
    const contentHash = createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    writeFileSync(join(caseDir, `${preId}.mhtml`), bytes)
    writeFileSync(join(caseDir, `${preId}.png`), 'screenshot nobody ever anchored')
    const { withCaptureEntry } = await import('@main/services/manifest')
    const pre = await withCaptureEntry(
      caseDir,
      {
        captureId: preId,
        caseId,
        url: 'https://example.com/pre-118',
        timestamp: '2026-01-01T00:00:00.000Z',
        contentHash,
        sizeBytes: bytes.length,
        operatorId: 'op-old',
        operatorName: 'Old Operator',
        toolVersion: '0.0.9'
      },
      (m) =>
        insertCapture({
          id: preId,
          caseId,
          url: 'https://example.com/pre-118',
          title: 'Pre-sidecar-anchoring',
          hash: contentHash,
          timestamp: '2026-01-01T00:00:00.000Z',
          format: 'mhtml',
          mhtmlPath: join(caseId, `${preId}.mhtml`),
          screenshotPath: join(caseId, `${preId}.png`),
          manifestIndex: m.index,
          prevHash: m.prevHash,
          entryHash: m.entryHash
        })
    )

    const result = await lifecycle.duplicate(pre.id)

    expect(result.status).toBe('duplicated')
    if (result.status !== 'duplicated') return
    const entry = manifestLines().at(-1)!
    // OMITTED, not re-computed: the screenshot file is copied so the duplicate
    // stays usable, but its bytes are anchored by nothing, same as the source.
    expect('screenshotHash' in entry).toBe(false)
    expect('textHash' in entry).toBe(false)
    expect(result.capture.screenshotHash).toBeUndefined()
    expect(result.capture.textHash).toBeUndefined()
    expect(existsSync(join(tempDir, 'captures', result.capture.screenshotPath!))).toBe(true)
    expect(verifyManifestChain(caseDir).valid).toBe(true)
    await expect(lifecycle.verify(result.capture.id)).resolves.toMatchObject({
      status: 'verified'
    })
  })

  it('rolls back the entry and removes the copy when the row insert fails', async () => {
    const captureRepo = await import('@main/services/db/captureRepo')
    const boom = new Error('insert failed')
    vi.spyOn(captureRepo, 'insertCapture').mockImplementation(() => {
      throw boom
    })
    const before = manifestLines().length

    await expect(lifecycle.duplicate(source.id)).rejects.toThrow(boom)

    // The write-ahead seam truncates its own entry; the copied artifacts are
    // namespaced by the new id, so cleaning them up cannot touch the source.
    expect(manifestLines()).toHaveLength(before)
    const { readdirSync } = await import('fs')
    const strays = readdirSync(join(tempDir, 'captures', caseId)).filter(
      (f) => !f.startsWith(source.id) && f !== 'manifest.jsonl'
    )
    expect(strays).toEqual([])
  })

  it('refuses a legacy html capture, which has no entry to copy provenance from', async () => {
    const legacy = insertCapture({
      caseId,
      url: 'https://legacy.example.com',
      title: 'Legacy',
      hash: 'x'.repeat(64),
      timestamp: '2026-04-05T12:00:00.000Z'
    })
    const before = manifestLines().length

    const result = await lifecycle.duplicate(legacy.id)

    expect(result).toEqual({ status: 'rejected', reason: 'not_verified', detail: 'legacy' })
    expect(manifestLines()).toHaveLength(before)
  })

  it('refuses when no operator name is set, the gate ingest applies', async () => {
    updateSettings({ operatorName: '' })
    const before = manifestLines().length

    const result = await lifecycle.duplicate(source.id)

    expect(result).toEqual({ status: 'rejected', reason: 'operator_name_required' })
    expect(manifestLines()).toHaveLength(before)
    expect(listCaptures(caseId)).toHaveLength(1)
  })

  it('reports not_found for an unknown id and touches nothing', async () => {
    const before = manifestLines().length
    const result = await lifecycle.duplicate('no-such-capture')
    expect(result).toEqual({ status: 'rejected', reason: 'not_found' })
    expect(manifestLines()).toHaveLength(before)
  })

  it('duplicates a duplicate, linking to the row it was actually copied from', async () => {
    const first = await lifecycle.duplicate(source.id)
    if (first.status !== 'duplicated') throw new Error('expected a duplicate')
    const second = await lifecycle.duplicate(first.capture.id)
    if (second.status !== 'duplicated') throw new Error('expected a duplicate')

    // Not source.id: the chain records the copy that was made, not the ultimate
    // origin, and following the links one hop at a time is what reconstructs it.
    expect(second.capture.duplicateOfCaptureId).toBe(first.capture.id)
    expect(manifestLines()).toHaveLength(3)
    expect(verifyManifestChain(caseDir).valid).toBe(true)
  })

  it('remaps the duplication link on archive import, like supersedes', async () => {
    // The manifest keeps the ids the source installation used — the chain is
    // immutable — so this column is the only link that survives a case moving
    // between installations. Left unremapped it would point at an id that does
    // not exist here, and the copy would read as having no source at all.
    const { collectCapturesForCase, importCaptureRows } =
      await import('@main/services/db/captureRepo')
    const result = await lifecycle.duplicate(source.id)
    if (result.status !== 'duplicated') throw new Error('expected a duplicate')

    const rows = collectCapturesForCase(caseId)
    const newCaseId = createCase({ name: 'Imported' }).id
    const mapId = (id: string) => `imported-${id}`
    importCaptureRows(rows, {
      newCaseId,
      mapId,
      mapTag: (id: string) => id,
      getText: () => ''
    })

    const imported = collectCapturesForCase(newCaseId).find(
      (r) => r.id === mapId(result.capture.id)
    ) as Record<string, unknown>
    expect(imported.duplicate_of_capture_id).toBe(mapId(source.id))
    expect(imported.method).toBe('duplicate')
  })

  it('resolves the trusted-time mirror from the manifest, by content hash', async () => {
    const { listPendingTimestampCaptures } = await import('@main/services/db/captureRepo')
    const result = await lifecycle.duplicate(source.id)
    if (result.status !== 'duplicated') throw new Error('expected a duplicate')

    // The source is a v2 capture with no token yet, and the duplicate carries
    // its content hash, so both resolve to the same axis value. No separate
    // hand-off to the timestamp worker is made for the copy; the mirror is
    // reconciled from the manifest, which is what puts it in the retry queue.
    expect(getCapture(result.capture.id)!.trustedTimeStatus).toBe('pending')
    expect(getCapture(source.id)!.trustedTimeStatus).toBe('pending')
    const queued = listPendingTimestampCaptures().map((c) => c.id)
    expect(queued).toContain(result.capture.id)
    // Whichever row the worker stamps, the token anchors the shared content
    // hash — so it dates the original observation for both rows, and neither
    // gains a claim the other lacks.
    expect(result.capture.hash).toBe(source.hash)
  })

  it('leaves the source untouched, including its manifest entry', async () => {
    const entryBefore = manifestLines()[0]
    // The verification cache and the trusted-time mirror are rebuildable
    // columns that the gate's verify refreshes, exactly as pressing Verify
    // would. Everything a reader relies on is compared.
    const REBUILDABLE = [
      'lastVerifiedAt',
      'lastVerifiedHash',
      'lastVerifiedStatus',
      'trustedTimeStatus'
    ]
    const evidential = (id: string) =>
      Object.fromEntries(
        Object.entries(getCapture(id)!).filter(([key]) => !REBUILDABLE.includes(key))
      )
    const rowBefore = evidential(source.id)

    await lifecycle.duplicate(source.id)

    expect(manifestLines()[0]).toEqual(entryBefore)
    expect(evidential(source.id)).toEqual(rowBefore)
  })
})
