import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase, setAutoCapturePolicy } from '@main/services/db/caseRepo'
import { initStorage } from '@main/services/storage'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { startCaptureServer, stopCaptureServer } from '@main/services/captureServer'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import { createSessionService, type SessionService } from '@main/services/session'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { listCaptures } from '@main/services/db/captureRepo'
import { MANIFEST_FILENAME } from '@shared/constants'
import type { CaptureEvent } from '@shared/types'

// Per-case auto-capture exclusions, enforced server-side (#400).
//
// This file is the acceptance matrix for the enforcement half: what the server
// refuses, for which source, under which mode, and what the operator is told.
// It lives apart from captureServer.test.ts so the evidence review has one
// artifact to read rather than a 400-line block inside a 1900-line file. The
// existing global-list block at tests/main/services/captureServer.test.ts:497
// is the shape it follows.
//
// Every case here posts with a real, non-archived case, because the check now
// runs after case resolution. The reorder itself is pinned in
// captureServer.test.ts alongside the tests whose ordering it changed.

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

// The renderer CaptureEvent a block emits is the ONLY record it leaves — no
// manifest entry is written (ruled 2026-08-21, design question in #694). The
// events are collected here so both halves of that can be asserted.
const captureEvents: CaptureEvent[] = []

let nextPort = 19960
const TEST_TOKEN = 'test-server-token'
const SOURCES = ['auto', 'manual', 'selector'] as const

describe('per-case auto-capture exclusions (#400)', () => {
  let tempDir: string
  let baseUrl: string
  let sessionService: SessionService

  beforeEach(async () => {
    const port = nextPort++
    captureEvents.length = 0
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-exclusions-test-'))
    await initDatabase(':memory:')
    initStorage(join(tempDir, 'captures'))
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator' })
    resetInstallationId()
    initInstallationId(tempDir)
    sessionService = createSessionService()
    baseUrl = `http://127.0.0.1:${port}`
    const selectorLifecycle = createSelectorLifecycle({ emitRematched: () => {} })
    // The lifecycle admits the request, so it is where the skip event is
    // emitted from and where 'auto' reads the Active Case.
    const captureLifecycle = createCaptureLifecycle({
      selectorLifecycle,
      sessionService,
      emitCaptureEvent: (event) => captureEvents.push(event)
    })
    await startCaptureServer(
      { selectorLifecycle, captureLifecycle, token: TEST_TOKEN, sessionService },
      port
    )
  })

  afterEach(async () => {
    await stopCaptureServer()
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped HTTP payloads read by key
  type JsonBody = Record<string, any>
  const readJson = async (res: Response): Promise<JsonBody> => (await res.json()) as JsonBody

  function postCapture(fields: Record<string, string>): Promise<Response> {
    const form = new FormData()
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    form.append('mhtml', new Blob(['<html>x</html>'], { type: 'multipart/related' }), 'c.mhtml')
    return fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      body: form,
      headers: { 'X-Birdbrain-Token': TEST_TOKEN }
    })
  }

  // One seeded case, activated and with a live session, so all three sources
  // can post into it: 'auto' takes the active case, the other two name it.
  async function seedCase(name: string): Promise<string> {
    const created = createCase({ name })
    await fetch(`${baseUrl}/api/cases/${created.id}/activate`, {
      method: 'POST',
      headers: { 'X-Birdbrain-Token': TEST_TOKEN }
    })
    await fetch(`${baseUrl}/api/session/start`, {
      method: 'POST',
      headers: { 'X-Birdbrain-Token': TEST_TOKEN }
    })
    return created.id
  }

  // 'auto' takes the active case from the session and rejects a caseId field;
  // the other two name the case explicitly.
  function fieldsFor(
    source: (typeof SOURCES)[number],
    caseId: string,
    url: string
  ): Record<string, string> {
    const base: Record<string, string> = { source, url, title: 'T' }
    if (source !== 'auto') base.caseId = caseId
    return base
  }

  describe.each(SOURCES)('source=%s', (source) => {
    it('stack mode blocks a URL matching only the global list, naming the global rule', async () => {
      const caseId = await seedCase(`Stack Global ${source}`)
      updateSettings({ ignoredUrlPatterns: ['globalonly.com'] })
      setAutoCapturePolicy(caseId, { exclusions: ['caseonly.com'], mode: 'stack' })

      const res = await postCapture(fieldsFor(source, caseId, 'https://globalonly.com/page'))

      expect(res.status).toBe(403)
      expect((await readJson(res)).pattern).toBe('globalonly.com')
    })

    it('stack mode blocks a URL matching only the case list, naming the case rule', async () => {
      const caseId = await seedCase(`Stack Case ${source}`)
      updateSettings({ ignoredUrlPatterns: ['globalonly.com'] })
      setAutoCapturePolicy(caseId, { exclusions: ['caseonly.com'], mode: 'stack' })

      const res = await postCapture(fieldsFor(source, caseId, 'https://caseonly.com/page'))

      expect(res.status).toBe(403)
      expect((await readJson(res)).pattern).toBe('caseonly.com')
    })

    it('override mode ALLOWS a URL matching only the global list, and stores it', async () => {
      const caseId = await seedCase(`Override Global ${source}`)
      updateSettings({ ignoredUrlPatterns: ['globalonly.com'] })
      setAutoCapturePolicy(caseId, { exclusions: ['caseonly.com'], mode: 'override' })

      const res = await postCapture(fieldsFor(source, caseId, 'https://globalonly.com/page'))

      expect(res.status).toBe(200)
      expect((await readJson(res)).status).toBe('ok')
      expect(listCaptures(caseId)).toHaveLength(1)
    })

    it('override mode still blocks a URL matching the case list', async () => {
      const caseId = await seedCase(`Override Case ${source}`)
      updateSettings({ ignoredUrlPatterns: [] })
      setAutoCapturePolicy(caseId, { exclusions: ['caseonly.com'], mode: 'override' })

      const res = await postCapture(fieldsFor(source, caseId, 'https://caseonly.com/page'))

      expect(res.status).toBe(403)
      expect((await readJson(res)).pattern).toBe('caseonly.com')
    })
  })

  it.each([
    ['substring', 'blocked-site.com', 'https://blocked-site.com/page'],
    ['glob', '*.bank.com*', 'https://secure.bank.com/login'],
    ['regex literal', '/\\.gov(\\.|\\/|$)/i', 'https://example.gov/records']
  ])('the case list evaluates the %s pattern form', async (_name, pattern, url) => {
    const caseId = await seedCase(`Form ${pattern}`)
    setAutoCapturePolicy(caseId, { exclusions: [pattern], mode: 'stack' })

    const res = await postCapture({ source: 'manual', caseId, url, title: 'T' })

    expect(res.status).toBe(403)
    expect((await readJson(res)).pattern).toBe(pattern)
  })

  it('a URL on neither list is captured', async () => {
    const caseId = await seedCase('Allowed')
    updateSettings({ ignoredUrlPatterns: ['globalonly.com'] })
    setAutoCapturePolicy(caseId, { exclusions: ['caseonly.com'], mode: 'stack' })

    const res = await postCapture({
      source: 'manual',
      caseId,
      url: 'https://example.com/ok',
      title: 'T'
    })

    expect(res.status).toBe(200)
    expect(listCaptures(caseId)).toHaveLength(1)
  })

  it('one case is not excluded by another case list', async () => {
    const excluded = await seedCase('Has Exclusion')
    setAutoCapturePolicy(excluded, { exclusions: ['shared.example'], mode: 'stack' })
    const other = createCase({ name: 'No Exclusion' })

    const blockedRes = await postCapture({
      source: 'manual',
      caseId: excluded,
      url: 'https://shared.example/x',
      title: 'T'
    })
    const allowedRes = await postCapture({
      source: 'manual',
      caseId: other.id,
      url: 'https://shared.example/x',
      title: 'T'
    })

    expect(blockedRes.status).toBe(403)
    expect(allowedRes.status).toBe(200)
  })

  // A catastrophic per-case pattern exhausts the server's 200 ms vm budget and
  // yields NO match, so the capture is ACCEPTED. That is the pinned semantics of
  // safeRegexTest (tests/shared/urlPatterns.test.ts) and this change does not
  // alter it — it only widens the list the budget runs against. Asserted here
  // so the widened exposure is visible in the acceptance matrix rather than
  // only in the pull request body.
  it('a case pattern that exhausts the regex budget fails OPEN', async () => {
    const caseId = await seedCase('Pathological')
    setAutoCapturePolicy(caseId, {
      exclusions: ['/(a+)+(a+)+(a+)+(a+)+(a+)+(a+)+(a+)+(a+)+$/'],
      mode: 'stack'
    })

    const res = await postCapture({
      source: 'manual',
      caseId,
      url: 'https://example.com/' + 'a'.repeat(60) + 'b',
      title: 'T'
    })

    expect(res.status).toBe(200)
    expect(listCaptures(caseId)).toHaveLength(1)
  }, 30_000)

  it('emits a skipped CaptureEvent naming the matched pattern', async () => {
    const caseId = await seedCase('Event')
    setAutoCapturePolicy(caseId, { exclusions: ['caseonly.com'], mode: 'stack' })
    captureEvents.length = 0

    await postCapture({
      source: 'manual',
      caseId,
      url: 'https://caseonly.com/page',
      title: 'T'
    })

    const skipped = captureEvents.filter((e) => e.type === 'skipped')
    expect(skipped).toHaveLength(1)
    expect(skipped[0].skipReason).toBe('Blacklisted: caseonly.com')
    expect(skipped[0].source).toBe('manual')
  })

  // The #694 boundary, asserted rather than only described: a block leaves the
  // ephemeral renderer event above and nothing in the hash chain. An evidence
  // package can therefore be missing a page with no record of why — a
  // deliberate, recorded trade, and the thing a future manifest variant would
  // change.
  it('writes NO manifest entry for a blocked capture', async () => {
    const caseId = await seedCase('Manifest')
    setAutoCapturePolicy(caseId, { exclusions: ['caseonly.com'], mode: 'stack' })
    const manifestPath = join(tempDir, 'captures', caseId, MANIFEST_FILENAME)
    const linesBefore = existsSync(manifestPath)
      ? readFileSync(manifestPath, 'utf-8').split('\n').filter(Boolean).length
      : 0

    const res = await postCapture({
      source: 'manual',
      caseId,
      url: 'https://caseonly.com/page',
      title: 'T'
    })

    expect(res.status).toBe(403)
    const linesAfter = existsSync(manifestPath)
      ? readFileSync(manifestPath, 'utf-8').split('\n').filter(Boolean).length
      : 0
    expect(linesAfter).toBe(linesBefore)
  })

  describe('GET /api/status effective list', () => {
    it('is the global list when no case is active', async () => {
      updateSettings({ ignoredUrlPatterns: ['g1', 'g2'] })

      const data = await readJson(await fetch(`${baseUrl}/api/status`))

      expect(data.effectiveIgnoredUrlPatterns).toEqual(['g1', 'g2'])
      expect(data.ignoredUrlPatterns).toEqual(['g1', 'g2'])
    })

    it('is the global list when the active case has no exclusions', async () => {
      await seedCase('No Policy')
      updateSettings({ ignoredUrlPatterns: ['g1'] })

      const data = await readJson(await fetch(`${baseUrl}/api/status`))

      expect(data.effectiveIgnoredUrlPatterns).toEqual(['g1'])
    })

    it('merges global then case under stack, and leaves ignoredUrlPatterns global', async () => {
      const caseId = await seedCase('Stack Status')
      updateSettings({ ignoredUrlPatterns: ['g1'] })
      setAutoCapturePolicy(caseId, { exclusions: ['c1'], mode: 'stack' })

      const data = await readJson(await fetch(`${baseUrl}/api/status`))

      expect(data.effectiveIgnoredUrlPatterns).toEqual(['g1', 'c1'])
      expect(data.ignoredUrlPatterns).toEqual(['g1'])
    })

    it('publishes the case list alone under override', async () => {
      const caseId = await seedCase('Override Status')
      updateSettings({ ignoredUrlPatterns: ['g1'] })
      setAutoCapturePolicy(caseId, { exclusions: ['c1'], mode: 'override' })

      const data = await readJson(await fetch(`${baseUrl}/api/status`))

      expect(data.effectiveIgnoredUrlPatterns).toEqual(['c1'])
      expect(data.ignoredUrlPatterns).toEqual(['g1'])
    })
  })
})
