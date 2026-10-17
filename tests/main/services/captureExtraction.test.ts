import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { getCapture } from '@main/services/db/captureRepo'
import { initManifest, verifyManifestChain } from '@main/services/manifest'
import { createCaptureLifecycle, type CaptureLifecycle } from '@main/services/captureLifecycle'
import type { CaptureLifecycleDeps } from '@main/services/captureLifecycle'
import { createCaptureStore } from '@main/services/captureStore'
import { getStorageRoot } from '@main/services/storage'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import * as dataExtractor from '@main/services/dataExtractor'
import * as mhtmlDecoder from '@main/services/mhtmlDecoder'
import { diagnosticsService } from '@main/services/diagnostics'
import {
  createExtractionProcess,
  type ExtractionClient,
  type ExtractionOutcome
} from '@main/services/extraction/processClient'
import type { ExtractionRequest } from '@main/services/extraction/processHandler'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import { disposeLogger, initLogger, readRecentEntries } from '@main/services/logger'
import { fakeFork, inProcessExtraction } from '../../helpers/inProcessExtraction'
import { FIXTURE_DIR, FIXTURE_KNOWN_ANSWERS, rowKeys } from '../../helpers/extractionKnownAnswers'

// Extraction after ingest and on reprocess, with decoding and extraction in the
// utility process (#598). The unit runner has no utilityProcess, so the process
// is the real client over a stand-in child (tests/helpers/inProcessExtraction.ts)
// or a recording client.

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

const POPE = 'cnn-pope-synthetic.mhtml'
const IRAN = 'cnn-iran-synthetic.mhtml'

const CANNED_ROWS = [
  { category: 'Infrastructure', subcategory: 'Email Address', value: 'wren@desk.example.net' }
]

// A client that records each request and answers when the test settles it.
function recordingClient() {
  const requests: { request: ExtractionRequest; settle: (o: ExtractionOutcome) => void }[] = []
  const client: ExtractionClient = {
    extract: (request) => new Promise((settle) => requests.push({ request, settle })),
    dispose: () => {}
  }
  return { client, requests }
}

function storedRows(captureId: string): string[] {
  return rowKeys(
    getDb()
      .prepare('SELECT category, subcategory, value FROM extracted_data WHERE capture_id = ?')
      .all(captureId) as { category: string; subcategory: string; value: string }[]
  )
}

function extractionFailures(): number {
  return readRecentEntries(50).filter((e) => e.code === 'capture.extraction_failed').length
}

describe('capture extraction through the utility process', () => {
  let tempDir: string
  let caseId: string
  const selectorLifecycle = {
    runActiveSelectorsForCapture: vi.fn()
  } as unknown as SelectorLifecycle

  function lifecycleWith(extraction?: ExtractionClient): CaptureLifecycle {
    const deps: CaptureLifecycleDeps = { selectorLifecycle }
    return createCaptureLifecycle(extraction ? { ...deps, extraction } : deps)
  }

  function ingestFixture(lifecycle: CaptureLifecycle, fixture: string, url: string) {
    return lifecycle.ingest({
      caseId,
      url,
      title: fixture,
      timestamp: '2026-10-17T12:00:00.000Z',
      stream: Readable.from([
        readFileSync(join(FIXTURE_DIR, fixture))
      ]) as unknown as ReadableStream<Uint8Array>,
      textContent: 'page text',
      headers: {},
      browserVersion: 'Chrome/120',
      userAgent: 'Mozilla/5.0',
      httpStatus: 200,
      operatorId: 'op-1',
      operatorName: 'Smith',
      toolVersion: '0.1.0'
    })
  }

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-capture-extraction-'))
    initStorage(join(tempDir, 'captures'))
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator' })
    resetInstallationId()
    initInstallationId(tempDir)
    await initDatabase(':memory:')
    caseId = createCase({ name: 'Extraction' }).id
    ensureCaseDir(caseId)
    initManifest(join(tempDir, 'captures', caseId))
    initLogger(tempDir, 'capture-extraction-test-session')
  })

  afterEach(() => {
    disposeLogger()
    closeDatabase()
    resetInstallationId()
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('ingest sends the stored files to the process client and never decodes or extracts here', async () => {
    const extract = vi.spyOn(dataExtractor, 'extractData')
    const decode = vi.spyOn(mhtmlDecoder, 'extractHtmlFromMhtml')
    const { client, requests } = recordingClient()
    const { capture } = await ingestFixture(lifecycleWith(client), POPE, 'https://a.example.org/1')

    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const store = createCaptureStore({ getRoot: getStorageRoot })
    expect(requests[0].request).toEqual({
      mhtmlPath: store.artifactPaths(caseId, capture.id, 'mhtml').abs,
      htmlPath: store.artifactPaths(caseId, capture.id, 'html').abs
    })
    requests[0].settle({ ok: true, rows: CANNED_ROWS, durationMs: 5 })

    await vi.waitFor(() => expect(storedRows(capture.id)).toEqual(rowKeys(CANNED_ROWS)))
    expect(extract).not.toHaveBeenCalled()
    expect(decode).not.toHaveBeenCalled()
  })

  it('reprocess sends each Capture to the process client and never extracts here', async () => {
    const extract = vi.spyOn(dataExtractor, 'extractData')
    const decode = vi.spyOn(mhtmlDecoder, 'extractHtmlFromMhtml')
    const { client, requests } = recordingClient()
    const lifecycle = lifecycleWith(client)
    const { capture: first } = await ingestFixture(lifecycle, POPE, 'https://a.example.org/1')
    const { capture: second } = await ingestFixture(lifecycle, IRAN, 'https://a.example.org/2')
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    for (const { settle } of requests.splice(0)) settle({ ok: true, rows: [], durationMs: 1 })

    const reprocess = lifecycle.reprocessCase(caseId)
    for (const capture of [first, second]) {
      await vi.waitFor(() => expect(requests).toHaveLength(1))
      const [{ request, settle }] = requests.splice(0)
      expect(request.mhtmlPath).toContain(capture.id)
      settle({ ok: true, rows: CANNED_ROWS, durationMs: 1 })
    }
    expect(await reprocess).toEqual({ processed: 2 })
    expect(storedRows(first.id)).toEqual(rowKeys(CANNED_ROWS))
    expect(storedRows(second.id)).toEqual(rowKeys(CANNED_ROWS))
    expect(extract).not.toHaveBeenCalled()
    expect(decode).not.toHaveBeenCalled()
  })

  for (const [fixture, expected] of Object.entries(FIXTURE_KNOWN_ANSWERS)) {
    it(`writes the known rows for ${fixture} after ingest and again after reprocess`, async () => {
      const lifecycle = lifecycleWith(inProcessExtraction())
      const { capture } = await ingestFixture(lifecycle, fixture, 'https://a.example.org/kat')
      await vi.waitFor(() => expect(storedRows(capture.id)).toEqual(expected))

      await lifecycle.reprocessCase(caseId)
      expect(storedRows(capture.id)).toEqual(expected)
    })
  }

  it('writes no rows for a Capture deleted while its extraction ran', async () => {
    const { client, requests } = recordingClient()
    const lifecycle = lifecycleWith(client)
    const { capture } = await ingestFixture(lifecycle, POPE, 'https://a.example.org/deleted')
    await vi.waitFor(() => expect(requests).toHaveLength(1))

    expect(await lifecycle.delete(capture.id)).toBe(true)
    requests[0].settle({ ok: true, rows: CANNED_ROWS, durationMs: 5 })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(getCapture(capture.id)).toBeUndefined()
    expect(storedRows(capture.id)).toEqual([])
    expect(extractionFailures()).toBe(0)
  })

  for (const behaviour of ['exit', 'hang'] as const) {
    it(`keeps the Capture when the process ${behaviour === 'exit' ? 'exits' : 'times out'}, and the next extraction runs in a new process`, async () => {
      const { fork, children } = fakeFork([behaviour])
      const lifecycle = lifecycleWith(
        createExtractionProcess({ entryPath: 'x', fork, timeoutMs: 30 })
      )

      const { capture: failed } = await ingestFixture(lifecycle, POPE, 'https://a.example.org/f')
      await vi.waitFor(() => expect(extractionFailures()).toBe(1))
      expect(storedRows(failed.id)).toEqual([])
      expect(getCapture(failed.id)?.id).toBe(failed.id)
      expect((await lifecycle.verify(failed.id)).status).toBe('verified')
      expect(verifyManifestChain(join(tempDir, 'captures', caseId)).valid).toBe(true)

      const { capture: next } = await ingestFixture(lifecycle, IRAN, 'https://a.example.org/n')
      await vi.waitFor(() => expect(storedRows(next.id)).toEqual(FIXTURE_KNOWN_ANSWERS[IRAN]))
      expect(children).toHaveLength(2)
      expect(extractionFailures()).toBe(1)
    })
  }

  it('records the duration the process measured as a data-extraction slow operation', async () => {
    const record = vi.spyOn(diagnosticsService, 'recordSlowOp')
    const { client, requests } = recordingClient()
    const lifecycle = lifecycleWith(client)
    await ingestFixture(lifecycle, POPE, 'https://a.example.org/ok')
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    requests[0].settle({ ok: true, rows: [], durationMs: 42.5 })
    await vi.waitFor(() =>
      expect(record).toHaveBeenCalledWith('data-extraction', 'https://a.example.org/ok', 42.5)
    )

    await ingestFixture(lifecycle, POPE, 'https://a.example.org/failed')
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    requests[1].settle({ ok: false, error: new Error('exited'), durationMs: 17 })
    await vi.waitFor(() =>
      expect(record).toHaveBeenCalledWith('data-extraction', 'https://a.example.org/failed', 17)
    )
  })

  it('a lifecycle built without a process client extracts nothing', async () => {
    const extract = vi.spyOn(dataExtractor, 'extractData')
    const record = vi.spyOn(diagnosticsService, 'recordSlowOp')
    const lifecycle = lifecycleWith()
    const { capture } = await ingestFixture(lifecycle, POPE, 'https://a.example.org/none')
    await lifecycle.reprocessCase(caseId)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(storedRows(capture.id)).toEqual([])
    expect(extract).not.toHaveBeenCalled()
    expect(record.mock.calls.filter(([kind]) => kind === 'data-extraction')).toEqual([])
  })
})
