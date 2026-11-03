import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { MANIFEST_FILENAME } from '@shared/constants'
import { ManifestEntrySchema } from '@shared/schemas'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import {
  createCaptureLifecycle,
  ingestMhtmlCapture,
  type IngestParams,
  type IngestResult
} from '@main/services/captureLifecycle'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { getCapture } from '@main/services/db/captureRepo'
import { createPersona, updatePersona } from '@main/services/db/personaRepo'
import { initManifest, verifyManifestChain } from '@main/services/manifest'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

// No registry row has this id, so a label on the entry can only be the one the caller passed.
const PERSONA = { id: 'persona-row-id', label: 'Pseudonym A' }

const selectorLifecycle = { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle

// The lifecycle's ingest hands its params to ingestMhtmlCapture; both are run, so a Persona
// dropped on the way through fails here.
const INGESTS: Array<[string, (params: IngestParams) => Promise<IngestResult>]> = [
  ['ingestMhtmlCapture', (params) => ingestMhtmlCapture(params)],
  [
    'the lifecycle ingest',
    async (params) => {
      const lifecycle = createCaptureLifecycle({ selectorLifecycle, egressIsDirect: () => true })
      const result = await lifecycle.ingest(params)
      // The post-capture field build is queued on setImmediate; let it run before teardown.
      await new Promise<void>((resolve) => setImmediate(resolve))
      return result
    }
  ]
]

describe.each(INGESTS)('the Persona on a capture entry, through %s', (_name, ingest) => {
  let tempDir: string
  let caseId: string
  let caseDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-persona-ingest-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    caseId = createCase({ name: 'Persona ingest' }).id
    ensureCaseDir(caseId)
    caseDir = join(tempDir, 'captures', caseId)
    initManifest(caseDir)
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function params(extra: Partial<IngestParams> = {}): IngestParams {
    return {
      caseId,
      url: 'https://example.com/page',
      title: 'Landed',
      timestamp: '2026-11-03T12:00:00.000Z',
      stream: Readable.from([Buffer.from('mhtml bytes')]) as unknown as ReadableStream<Uint8Array>,
      textContent: '',
      headers: {},
      browserVersion: 'Chrome/130',
      userAgent: 'UA',
      httpStatus: 0,
      operatorId: 'op-1',
      operatorName: 'Casey Operator',
      toolVersion: '0.4.0',
      method: 'background',
      ...extra
    }
  }

  function manifestText(): string {
    const path = join(caseDir, MANIFEST_FILENAME)
    return existsSync(path) ? readFileSync(path, 'utf-8') : ''
  }

  function lastEntry(): Record<string, unknown> {
    const lines = manifestText().trim().split('\n')
    return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>
  }

  function personaColumns(captureId: string): unknown {
    return getDb()
      .prepare('SELECT persona_id, persona_label FROM captures WHERE id = ?')
      .get(captureId)
  }

  const body = (captureId: string, contentHash: string) => ({
    type: 'capture',
    captureId,
    caseId,
    url: 'https://example.com/page',
    timestamp: '2026-11-03T12:00:00.000Z',
    contentHash,
    method: 'background',
    exhibitNumber: 1,
    sizeBytes: 11,
    operatorId: 'op-1',
    operatorName: 'Casey Operator',
    toolVersion: '0.4.0',
    index: 0,
    prevHash: expect.any(String),
    entryHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    signature: expect.any(String)
  })

  it('signs no Persona key without one, keeps the stamp, and leaves the columns NULL', async () => {
    const { capture, contentHash } = await ingest(params())
    expect(lastEntry()).toEqual({ ...body(capture.id, contentHash), schemaVersion: 3 })
    expect(personaColumns(capture.id)).toEqual({ persona_id: null, persona_label: null })
    const row = getCapture(capture.id)
    expect([row?.personaId, row?.personaLabel]).toEqual([undefined, undefined])
  })

  it('signs the id and label as passed at schema 7, and the row mirrors them', async () => {
    const { capture, contentHash } = await ingest(params({ persona: PERSONA }))
    const entry = lastEntry()
    expect(entry).toEqual({
      ...body(capture.id, contentHash),
      personaId: PERSONA.id,
      personaLabel: PERSONA.label,
      schemaVersion: 7
    })
    expect(ManifestEntrySchema.safeParse(entry).success).toBe(true)
    expect(verifyManifestChain(caseDir).valid).toBe(true)
    expect(getCapture(capture.id)).toMatchObject({
      personaId: PERSONA.id,
      personaLabel: PERSONA.label
    })
  })

  it('signs the label passed at ingest over the one the registry holds', async () => {
    const { id } = createPersona({ label: 'Label in the registry' })
    const { capture } = await ingest(params({ persona: { id, label: 'Label passed at ingest' } }))
    expect(lastEntry()).toMatchObject({ personaId: id, personaLabel: 'Label passed at ingest' })
    expect(getCapture(capture.id)?.personaLabel).toBe('Label passed at ingest')
  })

  it('keeps the label on the entry and the row through a registry rename', async () => {
    const persona = createPersona({ label: 'Label at acquisition' })
    const { capture } = await ingest(params({ persona: { id: persona.id, label: persona.label } }))
    const signed = manifestText()

    updatePersona({ id: persona.id, label: 'Renamed in the registry' })
    expect(getCapture(capture.id)?.personaLabel).toBe('Label at acquisition')
    expect(manifestText()).toBe(signed)
    expect(lastEntry()).toMatchObject({
      personaId: persona.id,
      personaLabel: 'Label at acquisition'
    })
    expect(verifyManifestChain(caseDir).valid).toBe(true)
  })

  it.each([
    ['an empty id', { id: '', label: PERSONA.label }, 'personaId'],
    ['an empty label', { id: PERSONA.id, label: '' }, 'personaLabel']
  ])('refuses %s before signing, and writes nothing', async (_case, persona, field) => {
    const before = manifestText()
    await expect(
      ingest(
        params({
          persona,
          captureId: 'refused',
          screenshot: Buffer.from('PNG-screenshot-bytes'),
          textContent: 'extracted text'
        })
      )
    ).rejects.toThrow(new RegExp(`fails the strict schema, so it was not signed: ${field}`))
    expect(manifestText()).toBe(before)
    expect(getCapture('refused')).toBeUndefined()
    for (const type of ['mhtml', 'png', 'txt']) {
      expect(existsSync(join(caseDir, `refused.${type}`)), type).toBe(false)
    }
  })
})
