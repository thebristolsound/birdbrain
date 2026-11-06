import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { tmpdir } from 'os'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { getCapture, listCaptures } from '@main/services/db/captureRepo'
import { initManifest, readEntries } from '@main/services/manifest'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import {
  createCaptureLifecycle,
  type LaunchedAdmissionRequest
} from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import { ManifestEntrySchema } from '@shared/schemas'
import { safeRegexOutcome } from '@main/services/safeRegex'
import { MANIFEST_FILENAME, MANUAL_DEDUPE_WINDOW_MS } from '@shared/constants'
import type { CaptureEvent } from '@shared/types'
import type { BoundTls, ScrollToLoadRecord } from '@shared/schemas'
import { ENGINE_BOUND_TLS, ENGINE_SCROLL_TO_LOAD } from '../../helpers/captureEnginePackage'

// A 1 ms budget for every pattern in this file, so a pattern that backtracks runs out of it on any
// machine, as tests/shared/urlPatterns.test.ts injects its budget. Production keeps 200 ms.
vi.mock('@main/services/safeRegex', async (importOriginal) => {
  const real = await importOriginal<typeof import('@main/services/safeRegex')>()
  return {
    ...real,
    safeRegexTest: (pattern: string, flags: string, text: string) =>
      real.safeRegexTest(pattern, flags, text, 1)
  }
})

// The Capture Lifecycle's launched route (#1832): a clicked Capture in the browser Birdbrain
// launched, admitted with `method: 'launched'` and the browser that took it.

const BROWSER = {
  product: 'Chrome',
  version: '149.0.7827.55',
  family: 'chrome-for-testing' as const
}

function launchedRequest(
  caseId: string,
  overrides: Partial<LaunchedAdmissionRequest> = {}
): LaunchedAdmissionRequest {
  return {
    route: 'launched',
    caseId,
    url: 'https://example.com/launched',
    title: 'Launched page',
    timestamp: '2026-11-05T12:00:00.000Z',
    captureId: crypto.randomUUID(),
    mhtml: Buffer.from('MIME-Version: 1.0\r\n\r\nlaunched page'),
    screenshot: Buffer.from('png bytes'),
    textContent: 'launched text',
    httpStatus: 200,
    userAgent: 'Mozilla/5.0 launched',
    browser: BROWSER,
    inventory: {
      mhtml: { present: true, pinnedImages: 0, pinnedImagesNotLoaded: 0 },
      transactionRecord: { present: false, reason: 'page-not-recorded' },
      screenshot: {
        present: true,
        scaled: false,
        truncated: false,
        trimmed: false,
        contentWidth: 1,
        contentHeight: 1,
        width: 1,
        height: 1
      },
      pdf: { present: false, reason: 'failed' }
    },
    boundTlsAbsent: 'not-recorded',
    ...overrides
  }
}

describe('Capture Lifecycle: the launched route', () => {
  let tempDir: string
  let caseId: string
  let events: CaptureEvent[]

  function buildLifecycle() {
    return createCaptureLifecycle({
      selectorLifecycle: { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle,
      emitCaptureEvent: (event) => events.push(event),
      fetchTlsCertChain: async () => null,
      egressIsDirect: () => true
    })
  }

  function caseDir(): string {
    return join(tempDir, 'captures', caseId)
  }

  function entries(): Record<string, unknown>[] {
    return readEntries(readFileSync(join(caseDir(), MANIFEST_FILENAME), 'utf8'))
  }

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-launched-admit-'))
    initStorage(join(tempDir, 'captures'))
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator', ignoredUrlPatterns: [] })
    resetInstallationId()
    initInstallationId(tempDir)
    await initDatabase(':memory:')
    caseId = createCase({ name: 'Launched' }).id
    ensureCaseDir(caseId)
    initManifest(caseDir())
    events = []
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('signs method launched and the browser product, version and family, and the row keeps the version', async () => {
    const outcome = await buildLifecycle().admit(launchedRequest(caseId))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const row = getCapture(outcome.capture.id)
    expect(row?.method).toBe('launched')
    expect(row?.browserVersion).toBe(BROWSER.version)
    const entry = entries().find((e) => e.type === 'capture')
    expect(entry).toMatchObject({
      method: 'launched',
      browserProduct: 'Chrome',
      browserVersion: '149.0.7827.55',
      browserFamily: 'chrome-for-testing',
      schemaVersion: 7
    })
    expect(entry).not.toHaveProperty('egressKind')
    expect(ManifestEntrySchema.safeParse(entry).success).toBe(true)
    expect(events.map(({ type, source }) => `${type}:${source}`)).toEqual([
      'received:launched',
      'stored:launched'
    ])
  })

  it('stores the page archive the browser returned, and signs its hash', async () => {
    const request = launchedRequest(caseId)
    const outcome = await buildLifecycle().admit(request)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const { mhtmlPath } = getCapture(outcome.capture.id) ?? {}
    expect(mhtmlPath).toBeDefined()
    const stored = readFileSync(join(tempDir, 'captures', mhtmlPath!))
    expect(stored.equals(request.mhtml)).toBe(true)
    const sha256 = createHash('sha256').update(request.mhtml).digest('hex')
    expect(outcome.contentHash).toBe(sha256)
    expect(entries().find((e) => e.type === 'capture')).toMatchObject({ contentHash: sha256 })
  })

  it('signs the Bound TLS Details, the Scroll-to-load record and the page text it was given', async () => {
    const request = launchedRequest(caseId, {
      boundTls: ENGINE_BOUND_TLS as BoundTls,
      boundTlsAbsent: undefined,
      scrollToLoad: ENGINE_SCROLL_TO_LOAD as ScrollToLoadRecord
    })
    expect((await buildLifecycle().admit(request)).ok).toBe(true)
    const entry = entries().find((e) => e.type === 'capture')
    expect(entry?.boundTls).toEqual(ENGINE_BOUND_TLS)
    expect(entry).not.toHaveProperty('boundTlsAbsent')
    expect(entry?.scrollToLoad).toEqual(ENGINE_SCROLL_TO_LOAD)
    expect(entry?.textHash).toBe(
      createHash('sha256').update(Buffer.from('launched text', 'utf-8')).digest('hex')
    )
  })

  it('signs why the entry carries no Bound TLS Details', async () => {
    expect((await buildLifecycle().admit(launchedRequest(caseId))).ok).toBe(true)
    const entry = entries().find((e) => e.type === 'capture')
    expect(entry?.boundTlsAbsent).toBe('not-recorded')
    expect(entry).not.toHaveProperty('boundTls')
  })

  it('signs the Egress fields while the Egress is not Direct and skips the TLS re-fetch', async () => {
    const outcome = await buildLifecycle().admit(
      launchedRequest(caseId, { egress: { kind: 'proxy', label: 'SOCKS5 fixture' } })
    )
    expect(outcome.ok).toBe(true)
    expect(entries().find((e) => e.type === 'capture')).toMatchObject({
      egressKind: 'proxy',
      egressLabel: 'SOCKS5 fixture',
      userAgent: 'Mozilla/5.0 launched',
      tlsSkipped: 'egress-not-direct'
    })
  })

  // Open question Q1, answered for the maintainer to confirm: the manual dedup window does not
  // apply to the launched route.
  it(`admits two Captures of one tab's page within MANUAL_DEDUPE_WINDOW_MS (${MANUAL_DEDUPE_WINDOW_MS} ms)`, async () => {
    const lifecycle = buildLifecycle()
    const first = await lifecycle.admit(launchedRequest(caseId))
    const second = await lifecycle.admit(launchedRequest(caseId))
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(listCaptures(caseId)).toHaveLength(2)
    expect(events.filter(({ type }) => type === 'skipped')).toEqual([])
  })

  it('refuses a committed URL the exclusion policy matches with a skipped event, and writes nothing', async () => {
    updateSettings({ ignoredUrlPatterns: ['example.com/launched'] })
    const lifecycle = buildLifecycle()
    expect(lifecycle.screenLaunched(caseId, 'https://example.com/launched')).toEqual({
      kind: 'excluded',
      pattern: 'example.com/launched'
    })
    const outcome = await lifecycle.admit(launchedRequest(caseId))
    expect(outcome).toEqual({
      ok: false,
      refusal: { kind: 'excluded', pattern: 'example.com/launched' }
    })
    expect(events.map(({ type, source }) => `${type}:${source}`)).toEqual([
      'skipped:launched',
      'skipped:launched'
    ])
    expect(listCaptures(caseId)).toEqual([])
    expect(entries().filter((e) => e.type === 'capture')).toEqual([])
    expect(readdirSync(caseDir()).sort()).toEqual([MANIFEST_FILENAME].sort())
  })

  it('refuses a page loaded from an excluded address after a same-document navigation moved it', async () => {
    updateSettings({ ignoredUrlPatterns: ['example.com/inbox'] })
    const lifecycle = buildLifecycle()
    const committedUrl = 'https://example.com/inbox'
    const url = 'https://example.com/settings'
    const refusal = { kind: 'excluded', pattern: 'example.com/inbox' }
    expect(lifecycle.screenLaunched(caseId, url)).toBeNull()
    expect(lifecycle.screenLaunched(caseId, url, committedUrl)).toEqual(refusal)
    const outcome = await lifecycle.admit(launchedRequest(caseId, { url, committedUrl }))
    expect(outcome).toEqual({ ok: false, refusal })
    expect(events.map(({ type, url: address }) => `${type}:${address}`)).toEqual([
      `skipped:${committedUrl}`,
      `skipped:${committedUrl}`
    ])
    expect(listCaptures(caseId)).toEqual([])
  })

  // Ruling 49 (D13): a clicked Capture whose exclusion pattern times out is admitted, as today.
  it('admits a clicked Capture whose exclusion pattern runs out of its budget', async () => {
    const url = `https://example.com/${'a'.repeat(23)}/x/aaab`
    // The pattern matches the URL when the evaluation may finish, and runs out of this file's
    // budget.
    expect(safeRegexOutcome('(a+)+b', '', url, 30_000)).toBe('match')
    expect(safeRegexOutcome('(a+)+b', '', url, 1)).toBe('timeout')
    updateSettings({ ignoredUrlPatterns: ['/(a+)+b/'] })
    const lifecycle = buildLifecycle()
    expect(lifecycle.screenLaunched(caseId, url)).toBeNull()
    const outcome = await lifecycle.admit(launchedRequest(caseId, { url }))
    expect(outcome.ok).toBe(true)
  })

  it('refuses as failed, with a failed event, an entry the strict schema would refuse', async () => {
    const lifecycle = buildLifecycle()
    const outcome = await lifecycle.admit(
      launchedRequest(caseId, { transactionRecord: Buffer.from('a record the inventory omits') })
    )
    expect(outcome).toMatchObject({ ok: false, refusal: { kind: 'failed' } })
    expect(events.at(-1)).toMatchObject({ type: 'failed', source: 'launched' })
    expect(listCaptures(caseId)).toEqual([])
  })

  it('reports an abandoned Capture on the activity feed and stores nothing', () => {
    buildLifecycle().abandonedLaunched('https://example.com/launched')
    expect(events).toEqual([
      expect.objectContaining({
        type: 'failed',
        source: 'launched',
        url: 'https://example.com/launched',
        error: expect.stringMatching(/^Capture abandoned/)
      })
    ])
    expect(listCaptures(caseId)).toEqual([])
  })
})
