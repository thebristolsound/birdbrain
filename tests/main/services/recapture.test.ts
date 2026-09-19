import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { once } from 'events'
import { MANIFEST_FILENAME } from '@shared/constants'
import { initStorage, ensureCaseDir, getStorageRoot } from '@main/services/storage'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase, setAutoCapturePolicy } from '@main/services/db/caseRepo'
import { getCapture } from '@main/services/db/captureRepo'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import { createCaptureLifecycle, verifyCapture } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import {
  createRecaptureService,
  looksLikeLoginWall,
  type RenderedPage,
  type RenderPage
} from '@main/services/recapture'
import type { CaptureEvent, Capture } from '@shared/types'

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

function fakeRender(overrides: Partial<RenderedPage> = {}): RenderPage {
  return async (url) => ({
    mhtmlStream: (async function* () {
      yield Buffer.from(`mhtml-of-${url}`)
    })(),
    screenshot: Buffer.from('png-bytes'),
    text: 'page text',
    title: 'Page Title',
    finalUrl: url,
    httpStatus: 200,
    userAgent: 'HiddenWindow UA',
    browserVersion: 'Chrome/130',
    cleanup: async () => {},
    ...overrides
  })
}

describe('recapture service', () => {
  let tempDir: string
  let caseId: string
  let events: CaptureEvent[]
  let newCaptures: Capture[]
  const selectorLifecycle = {
    runActiveSelectorsForCapture: vi.fn()
  } as unknown as SelectorLifecycle

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-recapture-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    initSettings(tempDir)
    resetInstallationId()
    initInstallationId(tempDir)
    updateSettings({ operatorName: 'Op' })
    caseId = createCase({ name: 'Recapture' }).id
    ensureCaseDir(caseId)
    events = []
    newCaptures = []
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function makeService(renderPage: RenderPage, timeoutMs = 45_000) {
    const captureLifecycle = createCaptureLifecycle({ selectorLifecycle })
    return createRecaptureService({
      renderPage,
      captureLifecycle,
      emitEvent: (e) => events.push(e),
      emitNewCapture: (c) => newCaptures.push(c),
      timeoutMs
    })
  }

  it('captures a URL end-to-end with background provenance', async () => {
    const svc = makeService(fakeRender())
    const res = svc.enqueue([{ url: 'https://example.com/page', caseId }])
    expect(res.accepted).toBe(1)
    await svc.idle()
    expect(newCaptures).toHaveLength(1)
    const cap = getCapture(newCaptures[0].id)!
    expect(cap.method).toBe('background')
    expect(cap.userAgent).toBe('HiddenWindow UA')
    expect(cap.extensionVersion).toBeUndefined()
    const stored = events.find((e) => e.type === 'stored')
    expect(stored?.source).toBe('recapture')
  })

  it('records the supersedes link', async () => {
    const svc = makeService(fakeRender())
    svc.enqueue([{ url: 'https://example.com/a', caseId }])
    await svc.idle()
    const originalId = newCaptures[0].id
    svc.enqueue([{ url: 'https://example.com/a', caseId, supersedesCaptureId: originalId }])
    await svc.idle()
    expect(getCapture(newCaptures[1].id)!.supersedesCaptureId).toBe(originalId)
  })

  it('records consent-suppression provenance in the capture row and manifest entry', async () => {
    const svc = makeService(fakeRender({ consentSuppression: 'filter-list' }))
    svc.enqueue([{ url: 'https://example.com/page', caseId }])
    await svc.idle()
    expect(newCaptures).toHaveLength(1)
    expect(getCapture(newCaptures[0].id)!.consentSuppression).toBe('filter-list')
    const manifest = readFileSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME), 'utf-8')
    expect(manifest).toContain('"consentSuppression":"filter-list"')
    // The chain must still verify with the new field present — the verifier's
    // strict entry schema silently rejects unknown keys as chain-broken.
    const verification = await verifyCapture(newCaptures[0].id)
    expect(verification.status).toBe('verified')
  })

  it('omits consent-suppression provenance when the renderer did not suppress', async () => {
    const svc = makeService(fakeRender())
    svc.enqueue([{ url: 'https://example.com/page', caseId }])
    await svc.idle()
    expect(getCapture(newCaptures[0].id)!.consentSuppression).toBeUndefined()
    const manifest = readFileSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME), 'utf-8')
    expect(manifest).not.toContain('consentSuppression')
  })

  it('anchors the final post-redirect URL when the render redirected (#797)', async () => {
    const svc = makeService(fakeRender({ finalUrl: 'https://example.com/landing' }))
    svc.enqueue([{ url: 'https://example.com/page', caseId }])
    await svc.idle()

    // The capture is stored under the URL the bytes came from, as it always
    // has been. `finalUrl` is what lets a chain reader tell that the stored URL
    // is a redirect target and not where the operator aimed.
    expect(getCapture(newCaptures[0].id)!.url).toBe('https://example.com/landing')
    const manifest = readFileSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME), 'utf-8')
    expect(manifest).toContain('"finalUrl":"https://example.com/landing"')
    expect(manifest).toContain('"httpStatus":200')
    // The verifier's strict entry schema rejects unknown keys as chain-broken,
    // so this is also the check that the new fields are readable.
    const verification = await verifyCapture(newCaptures[0].id)
    expect(verification.status).toBe('verified')
  })

  it('omits the final URL when the requested URL is what was served (#797)', async () => {
    const svc = makeService(fakeRender())
    svc.enqueue([{ url: 'https://example.com/page', caseId }])
    await svc.idle()
    const manifest = readFileSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME), 'utf-8')
    // Writing the requested URL here would claim a redirect that never
    // happened, so nothing is written at all.
    expect(manifest).not.toContain('finalUrl')
  })

  it('runs jobs serially in FIFO order', async () => {
    const order: string[] = []
    const gate: Array<() => void> = []
    const render: RenderPage = async (url) => {
      order.push(`start:${url}`)
      await new Promise<void>((resolve) => gate.push(resolve))
      order.push(`end:${url}`)
      return fakeRender()(url, { timeoutMs: 0 })
    }
    const svc = makeService(render)
    svc.enqueue([
      { url: 'https://example.com/1', caseId },
      { url: 'https://example.com/2', caseId }
    ])
    // Only the first job may start until its render resolves.
    await vi.waitFor(() => expect(order).toContain('start:https://example.com/1'))
    expect(order).not.toContain('start:https://example.com/2')
    gate.shift()!()
    await vi.waitFor(() => expect(order).toContain('start:https://example.com/2'))
    gate.shift()!()
    await svc.idle()
    expect(newCaptures).toHaveLength(2)
  })

  it('rejects invalid URLs at enqueue with per-URL reasons', async () => {
    const svc = makeService(fakeRender())
    const res = svc.enqueue([
      { url: 'not-a-url', caseId },
      { url: 'ftp://example.com/x', caseId },
      { url: 'https://example.com/ok', caseId }
    ])
    expect(res.accepted).toBe(1)
    expect(res.rejected).toHaveLength(2)
    expect(res.rejected[0].url).toBe('not-a-url')
    // The one accepted URL still triggers a background job — drain it before the
    // test ends so it doesn't leak into the next test's shared db/storage fixtures.
    await svc.idle()
  })

  // #400: the per-case exclusion list blocks every capture route, manual
  // included. Recapture is a producer the capture server never sees, so it
  // enforces the list itself — at enqueue for the requested URL, and again
  // after the render for the URL that would actually be stored.
  it('refuses a recapture of an excluded URL at enqueue, naming the pattern', async () => {
    setAutoCapturePolicy(caseId, { exclusions: ['secret.example.com'], mode: 'stack' })
    const svc = makeService(fakeRender())
    const res = svc.enqueue([
      { url: 'https://secret.example.com/page', caseId },
      { url: 'https://example.com/ok', caseId }
    ])
    expect(res.accepted).toBe(1)
    expect(res.rejected).toEqual([
      { url: 'https://secret.example.com/page', reason: 'Blacklisted: secret.example.com' }
    ])
    const skipped = events.find((e) => e.type === 'skipped')
    expect(skipped?.source).toBe('recapture')
    expect(skipped?.url).toBe('https://secret.example.com/page')
    expect(skipped?.skipReason).toBe('Blacklisted: secret.example.com')
    await svc.idle()
    // Only the permitted URL was ever rendered and stored.
    expect(newCaptures).toHaveLength(1)
    expect(getCapture(newCaptures[0].id)!.url).toBe('https://example.com/ok')
  })

  it('refuses a recapture that redirects into an excluded URL, before it is ingested', async () => {
    setAutoCapturePolicy(caseId, { exclusions: ['/\\/login$/', 'blocked.example'], mode: 'stack' })
    const svc = makeService(fakeRender({ finalUrl: 'https://blocked.example/landing' }))
    const res = svc.enqueue([{ url: 'https://example.com/page', caseId }])
    // The requested URL is clean, so the job is accepted and rendered.
    expect(res.accepted).toBe(1)
    await svc.idle()
    expect(newCaptures).toHaveLength(0)
    const skipped = events.find((e) => e.type === 'skipped')
    expect(skipped?.url).toBe('https://blocked.example/landing')
    expect(skipped?.skipReason).toBe('Blacklisted: blocked.example')
    expect(events.find((e) => e.type === 'stored')).toBeUndefined()
    // Nothing written to the database, and nothing appended to the hash chain:
    // the case directory has no manifest at all, because no entry was ever made.
    expect(existsSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME))).toBe(false)
  })

  // A real ReadStream rather than a spy: what leaks is an open fd, and the
  // renderer's cleanup unlinks the temp file without closing it, so an
  // abandoned stream pins the deleted file's blocks (#766).
  it('releases the rendered stream when the redirect is blocked', async () => {
    setAutoCapturePolicy(caseId, { exclusions: ['blocked.example'], mode: 'stack' })
    const tmpFile = join(tempDir, 'rendered.mhtml')
    writeFileSync(tmpFile, 'mhtml-bytes')
    const mhtmlStream = createReadStream(tmpFile)
    // The fd is opened lazily, so wait for it: an assertion that a
    // never-opened stream is closed would pass without proving anything.
    await once(mhtmlStream, 'ready')
    const svc = makeService(
      fakeRender({ finalUrl: 'https://blocked.example/landing', mhtmlStream })
    )
    svc.enqueue([{ url: 'https://example.com/page', caseId }])
    await svc.idle()

    expect(newCaptures).toHaveLength(0)
    expect(mhtmlStream.destroyed).toBe(true)
    if (!mhtmlStream.closed) await once(mhtmlStream, 'close')
    expect(mhtmlStream.closed).toBe(true)
  })

  it('emits a failed event (and no capture) when rendering throws', async () => {
    const render: RenderPage = async () => {
      throw new Error('net::ERR_NAME_NOT_RESOLVED')
    }
    const svc = makeService(render)
    svc.enqueue([{ url: 'https://nope.invalid/', caseId }])
    await svc.idle()
    expect(newCaptures).toHaveLength(0)
    const failed = events.find((e) => e.type === 'failed')
    expect(failed?.error).toContain('ERR_NAME_NOT_RESOLVED')
    expect(failed?.source).toBe('recapture')
  })

  it('fails a job that exceeds the timeout', async () => {
    const render: RenderPage = (url, { timeoutMs }) =>
      new Promise(() => {
        // Contract: renderPage implementations honor timeoutMs themselves; the
        // service ALSO wraps with a race so a hung renderer cannot wedge the queue.
        void url
        void timeoutMs
      }) as Promise<RenderedPage>
    const svc = makeService(render, 50)
    svc.enqueue([{ url: 'https://slow.example.com/', caseId }])
    await svc.idle()
    const failed = events.find((e) => e.type === 'failed')
    expect(failed?.error).toMatch(/timed out/i)
  })

  it('stores login-wall pages but flags the stored event with a warning', async () => {
    const svc = makeService(
      fakeRender({ finalUrl: 'https://example.com/login?next=%2Fpage', title: 'Sign in' })
    )
    svc.enqueue([{ url: 'https://example.com/page', caseId }])
    await svc.idle()
    expect(newCaptures).toHaveLength(1)
    const stored = events.find((e) => e.type === 'stored')
    expect(stored?.warning).toMatch(/login/i)
  })
})

describe('looksLikeLoginWall', () => {
  it('flags login-ish titles', () => {
    expect(
      looksLikeLoginWall({
        requestedUrl: 'https://x.com/user',
        finalUrl: 'https://x.com/user',
        title: 'Log in to X'
      })
    ).toBe(true)
  })

  it('flags redirects to login paths', () => {
    expect(
      looksLikeLoginWall({
        requestedUrl: 'https://a.com/doc',
        finalUrl: 'https://a.com/accounts/signin?next=/doc',
        title: 'Welcome'
      })
    ).toBe(true)
  })

  it('flags off-hostname redirects', () => {
    expect(
      looksLikeLoginWall({
        requestedUrl: 'https://a.com/doc',
        finalUrl: 'https://sso.b.com/auth',
        title: 'Anything'
      })
    ).toBe(true)
  })

  it('passes normal pages', () => {
    expect(
      looksLikeLoginWall({
        requestedUrl: 'https://a.com/doc',
        finalUrl: 'https://a.com/doc',
        title: 'The Document'
      })
    ).toBe(false)
  })
})
