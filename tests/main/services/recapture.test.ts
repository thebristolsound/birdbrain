import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { once } from 'events'
import { MANIFEST_FILENAME } from '@shared/constants'
import { initStorage, ensureCaseDir, getStorageRoot } from '@main/services/storage'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase, setAutoCapturePolicy } from '@main/services/db/caseRepo'
import { getCapture, insertCapture, listCaptures } from '@main/services/db/captureRepo'
import { exportCaseArchive, importCaseArchive } from '@main/services/caseArchive'
import { defaultCaptureStore } from '@main/services/captureStore'
import { appendManifestEntry, initManifest } from '@main/services/manifest'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import { createCaptureLifecycle, verifyCapture } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import {
  createRecaptureService,
  looksLikeLoginWall,
  redirectedFinalUrl,
  type RenderedPage,
  type RenderPage
} from '@main/services/recapture'
import { RefusedAddressError } from '@main/services/localAddressPolicy'
import { getExhibit } from '@main/services/db/exhibitRepo'
import { resetSigningKey } from '@main/services/signingKey'
import { resetSyncStateMemory } from '@main/services/sharing/syncState'
import type { CaptureEvent, Capture } from '@shared/types'
import {
  activate,
  addCapture,
  appendOwnChainLine,
  createPeer,
  memberAddBody,
  pull,
  recordSource,
  seedSharedCase,
  type Peer
} from '../../helpers/syncPeers'

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

  it('signs the Egress the render went through, its label and the user agent (ADR-0032)', async () => {
    const svc = makeService(fakeRender({ egress: { kind: 'tor', label: 'Tor Browser' } }))
    svc.enqueue([{ url: 'https://example.com/page', caseId }])
    await svc.idle()
    expect(newCaptures).toHaveLength(1)
    const lines = readFileSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME), 'utf-8')
      .trim()
      .split('\n')
    const entry = JSON.parse(lines[lines.length - 1])
    expect(entry).toMatchObject({
      egressKind: 'tor',
      egressLabel: 'Tor Browser',
      userAgent: 'HiddenWindow UA',
      tlsSkipped: 'egress-not-direct'
    })
    expect((await verifyCapture(newCaptures[0].id)).status).toBe('verified')
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

  it('omits the final URL when only canonicalization differs (#797)', async () => {
    // The real renderer returns `wc.getURL()`, which is always canonical; the
    // operator's pasted URL is not. The fake above echoes its input, so it
    // cannot reach this case — pin the canonical form explicitly.
    const svc = makeService(fakeRender({ finalUrl: 'https://example.com/' }))
    svc.enqueue([{ url: 'https://example.com', caseId }])
    await svc.idle()
    const manifest = readFileSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME), 'utf-8')
    expect(manifest).not.toContain('finalUrl')
    const verification = await verifyCapture(newCaptures[0].id)
    expect(verification.status).toBe('verified')
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

  // Unit tests run with no Electron app, as a packaged build reads it: the e2e loopback
  // switch is off, so 127.0.0.1 is refused here as it is in production (#1726).
  it('refuses a link to a loopback or private address at enqueue, naming the class', async () => {
    let rendered = 0
    const svc = makeService(async (url, opts) => {
      rendered++
      return fakeRender()(url, opts)
    })
    const res = svc.enqueue([
      { url: 'http://127.0.0.1:8080/', caseId },
      { url: 'http://localhost/admin', caseId },
      { url: 'http://192.168.1.1/', caseId },
      { url: 'http://[::ffff:10.0.0.1]/', caseId },
      { url: 'http://wiki/', caseId }
    ])
    await svc.idle()

    expect(res.accepted).toBe(0)
    expect(res.rejected.map((r) => r.reason)).toEqual([
      'Points at a loopback address',
      'Points at this computer',
      'Points at a private address',
      'Points at a private address',
      'Points at a private network'
    ])
    expect(rendered).toBe(0)
    expect(newCaptures).toHaveLength(0)
  })

  function caseDirFiles(): string[] {
    return readdirSync(join(getStorageRoot(), caseId), { recursive: true }) as string[]
  }

  it.each([
    ['a loopback address', 'Redirects to a loopback address'],
    ['a private address', 'Redirects to a private address']
  ])('ends a job the renderer refused at a hop to %s, writing nothing', async (cls, reason) => {
    const before = caseDirFiles()
    const render: RenderPage = async () => {
      throw new RefusedAddressError(cls)
    }
    const svc = makeService(render)
    expect(svc.enqueue([{ url: 'https://public.example/r', caseId }]).accepted).toBe(1)
    await svc.idle()

    expect(events.filter((e) => e.type !== 'received')).toEqual([
      expect.objectContaining({
        type: 'skipped',
        source: 'recapture',
        url: 'https://public.example/r',
        skipReason: reason
      })
    ])
    expect(newCaptures).toHaveLength(0)
    expect(existsSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME))).toBe(false)
    expect(caseDirFiles()).toEqual(before)
  })

  it('refuses a render whose final URL is a private address, before it is ingested', async () => {
    const before = caseDirFiles()
    const tmpFile = join(tempDir, 'rendered.mhtml')
    writeFileSync(tmpFile, 'mhtml-bytes')
    const mhtmlStream = createReadStream(tmpFile)
    await once(mhtmlStream, 'ready')
    const svc = makeService(fakeRender({ finalUrl: 'http://192.168.0.10/router', mhtmlStream }))
    svc.enqueue([{ url: 'https://public.example/r', caseId }])
    await svc.idle()

    expect(newCaptures).toHaveLength(0)
    const skipped = events.find((e) => e.type === 'skipped')
    expect(skipped?.url).toBe('https://public.example/r')
    expect(skipped?.skipReason).toBe('Redirects to a private address')
    expect(events.find((e) => e.type === 'stored' || e.type === 'failed')).toBeUndefined()
    expect(existsSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME))).toBe(false)
    expect(caseDirFiles()).toEqual(before)
    expect(mhtmlStream.destroyed).toBe(true)
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

describe('redirectedFinalUrl (#797)', () => {
  // Every pair here is the same destination spelled two ways. Reporting any of
  // them as a redirect would put a false provenance claim in a signed entry.
  it.each([
    ['https://example.com', 'https://example.com/'],
    ['https://Example.COM/Path', 'https://example.com/Path'],
    ['https://example.com:443/a', 'https://example.com/a'],
    ['http://example.com:80/a', 'http://example.com/a'],
    ['https://example.com/página', 'https://example.com/p%C3%A1gina']
  ])('treats %s and %s as the same destination', (requested, final) => {
    expect(redirectedFinalUrl(requested, final)).toBeUndefined()
  })

  it('reports a genuine redirect, verbatim as the renderer resolved it', () => {
    expect(redirectedFinalUrl('https://example.com/a', 'https://example.com/b')).toBe(
      'https://example.com/b'
    )
    expect(redirectedFinalUrl('https://example.com', 'https://elsewhere.test/')).toBe(
      'https://elsewhere.test/'
    )
  })

  it('compares unparseable input as text rather than throwing', () => {
    expect(redirectedFinalUrl('not a url', 'not a url')).toBeUndefined()
    expect(redirectedFinalUrl('not a url', 'https://example.com/')).toBe('https://example.com/')
  })
})

// Capture link (ADR-0040): the job names the Capture whose stored page held the link and the
// link's address; the queue checks both and signs the source's Content Hash from its entry.
describe('Capture link jobs (ADR-0040)', () => {
  const LINK = 'http://example.com/linked'
  const LANDED = 'https://example.com/linked'
  let tempDir: string
  let caseId: string
  let events: CaptureEvent[]
  let newCaptures: Capture[]
  let captureLifecycle: ReturnType<typeof createCaptureLifecycle>
  let svc: ReturnType<typeof createRecaptureService>

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-link-capture-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    initSettings(tempDir)
    resetInstallationId()
    initInstallationId(tempDir)
    updateSettings({ operatorName: 'Op' })
    caseId = createCase({ name: 'Link source' }).id
    ensureCaseDir(caseId)
    events = []
    newCaptures = []
    captureLifecycle = createCaptureLifecycle({
      selectorLifecycle: { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle
    })
    // The link redirects from http to https, the case where `url` alone loses the address.
    svc = createRecaptureService({
      renderPage: (url, opts) => fakeRender(url === LINK ? { finalUrl: LANDED } : {})(url, opts),
      captureLifecycle,
      emitEvent: (e) => events.push(e),
      emitNewCapture: (c) => newCaptures.push(c),
      timeoutMs: 45_000
    })
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  const entries = (): Array<Record<string, unknown>> =>
    readFileSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME), 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  const entryOf = (id: string) => entries().find((e) => e.captureId === id)!

  async function sourceCapture(url = 'https://example.com/source'): Promise<Capture> {
    svc.enqueue([{ url, caseId }])
    await svc.idle()
    return getCapture(newCaptures[newCaptures.length - 1].id)!
  }

  function linkPayload(captureId: string, urls: string[] = [LINK]) {
    return { urls, caseId, linkedFrom: { captureId, linkHref: LINK } }
  }

  // A refused job writes nothing: no Capture, no manifest line.
  async function expectNothingWritten(before: number, captures: number): Promise<void> {
    await svc.idle()
    expect(newCaptures).toHaveLength(captures)
    expect(entries()).toHaveLength(before)
  }

  it('signs the source, its Content Hash from the entry, and the link address', async () => {
    const source = await sourceCapture()
    expect(svc.enqueueLink(linkPayload(source.id))).toEqual({ accepted: 1, rejected: [] })
    await svc.idle()

    const linked = getCapture(newCaptures[1].id)!
    expect(linked.url).toBe(LANDED)
    const provenance = {
      linkedFromCaptureId: source.id,
      linkedFromContentHash: entryOf(source.id).contentHash,
      linkHref: LINK
    }
    expect(provenance.linkedFromContentHash).toBe(source.hash)
    expect(linked).toMatchObject({ method: 'background', ...provenance })
    expect(entryOf(linked.id)).toMatchObject({ ...provenance, schemaVersion: 6 })
    expect((await verifyCapture(linked.id)).status).toBe('verified')
  })

  it('writes none of the fields on an ordinary job, or on a Recapture of a link Capture', async () => {
    const source = await sourceCapture()
    svc.enqueueLink(linkPayload(source.id))
    await svc.idle()
    const linkedId = newCaptures[1].id
    svc.enqueue([{ url: LINK, caseId, supersedesCaptureId: linkedId }])
    await svc.idle()
    const recaptureId = newCaptures[2].id

    for (const id of [source.id, recaptureId]) {
      const { linkedFromCaptureId, linkedFromContentHash, linkHref } = getCapture(id)!
      expect([linkedFromCaptureId, linkedFromContentHash, linkHref]).toEqual([
        undefined,
        undefined,
        undefined
      ])
      const entry = entryOf(id)
      const fields = ['linkedFromCaptureId', 'linkedFromContentHash', 'linkHref']
      expect(fields.filter((field) => field in entry)).toEqual([])
    }
    expect(getCapture(recaptureId)!.supersedesCaptureId).toBe(linkedId)
  })

  // `linkHref` is the address before canonicalization, so the check is exact: a spelling
  // that canonicalizes to the same address is still another string than the one signed.
  it.each([
    ['no address', []],
    ['two addresses', [LINK, 'http://example.com/other']],
    ['another address', ['http://example.com/other']],
    ['a canonical spelling of the address', ['http://example.com/linked/']]
  ])('refuses a payload whose urls hold %s', async (_label, urls) => {
    const source = await sourceCapture()
    const before = entries().length
    expect(svc.enqueueLink(linkPayload(source.id, urls))).toEqual({
      accepted: 0,
      rejected: [{ url: LINK, reason: 'Capture link takes exactly the link address' }]
    })
    await expectNothingWritten(before, 1)
  })

  it('refuses a payload with no source id, or one that also supersedes a Capture', async () => {
    const source = await sourceCapture()
    const before = entries().length
    expect(
      svc.enqueueLink({ urls: [LINK], caseId, linkedFrom: { captureId: '', linkHref: LINK } })
    ).toEqual({ accepted: 0, rejected: [{ url: LINK, reason: 'Invalid link source' }] })
    expect(svc.enqueueLink({ urls: [LINK], caseId })).toEqual({
      accepted: 0,
      rejected: [{ url: '', reason: 'Invalid link source' }]
    })
    expect(svc.enqueueLink({ ...linkPayload(source.id), supersedesCaptureId: source.id })).toEqual({
      accepted: 0,
      rejected: [{ url: LINK, reason: 'A link capture supersedes nothing' }]
    })
    await expectNothingWritten(before, 1)
  })

  it('refuses a source in another Case, or one deleted', async () => {
    const source = await sourceCapture()
    const otherCase = createCase({ name: 'Other' }).id
    ensureCaseDir(otherCase)
    expect(svc.enqueueLink({ ...linkPayload(source.id), caseId: otherCase }).rejected).toEqual([
      { url: LINK, reason: 'Link source is in another case' }
    ])
    expect(await captureLifecycle.delete(source.id)).toBe(true)
    const before = entries().length
    expect(svc.enqueueLink(linkPayload(source.id)).rejected).toEqual([
      { url: LINK, reason: 'Link source not found' }
    ])
    await expectNothingWritten(before, 1)
  })

  // The payload checks run again when the job does, for a job that reached the queue by
  // another route or whose source went away after it was queued.
  it.each([
    ['a different address', 'other', 'Link address differs from the queued address'],
    ['a deleted source', 'deleted', 'Link source not found'],
    ['a source in another Case', 'elsewhere', 'Link source is in another case']
  ])('skips a queued job naming %s, before it renders', async (_label, kind, reason) => {
    const source = await sourceCapture()
    let job = { url: LINK, caseId, linkedFrom: { captureId: source.id, linkHref: LINK } }
    if (kind === 'other') job = { ...job, url: 'http://example.com/other' }
    if (kind === 'deleted') await captureLifecycle.delete(source.id)
    if (kind === 'elsewhere') {
      job = { ...job, caseId: createCase({ name: 'Other' }).id }
      ensureCaseDir(job.caseId)
    }
    const before = entries().length
    expect(svc.enqueue([job]).accepted).toBe(1)
    await expectNothingWritten(before, 1)
    expect(events.at(-1)).toMatchObject({ type: 'skipped', url: job.url, skipReason: reason })
  })

  // The exclusion skip names the final address, so only `linkedFrom` ties it to the job.
  it('names the job on each of its events, and on no other job', async () => {
    const source = await sourceCapture()
    expect(events.some((e) => 'linkedFrom' in e)).toBe(false)
    setAutoCapturePolicy(caseId, {
      exclusions: ['/^https:\\/\\/example\\.com\\/linked$/'],
      mode: 'stack'
    })
    const [before, written] = [events.length, entries().length]
    expect(svc.enqueueLink(linkPayload(source.id)).accepted).toBe(1)
    await expectNothingWritten(written, 1)

    const linkedFrom = { captureId: source.id, linkHref: LINK }
    expect(events.slice(before)).toMatchObject([
      { type: 'received', url: LINK, linkedFrom },
      { type: 'skipped', url: LANDED, linkedFrom }
    ])
  })

  it('skips a source whose stored page no longer verifies', async () => {
    const source = await sourceCapture()
    writeFileSync(defaultCaptureStore.resolveAbsolute(source.mhtmlPath!), 'altered bytes')
    const before = entries().length
    expect(svc.enqueueLink(linkPayload(source.id)).accepted).toBe(1)
    await expectNothingWritten(before, 1)
    expect(events.at(-1)).toMatchObject({
      type: 'skipped',
      skipReason: 'Link source does not verify (tampered)'
    })
  })

  // The page still matches its entry, so only the verdict refuses it: a check that compared
  // the hash alone would sign a source whose screenshot no longer verifies.
  it('skips a source whose screenshot no longer verifies, though its page does', async () => {
    const source = await sourceCapture()
    writeFileSync(defaultCaptureStore.resolveAbsolute(source.screenshotPath!), 'altered png')
    const before = entries().length
    expect(svc.enqueueLink(linkPayload(source.id)).accepted).toBe(1)
    await expectNothingWritten(before, 1)
    expect(events.at(-1)).toMatchObject({
      type: 'skipped',
      skipReason: 'Link source does not verify (tampered)'
    })
  })

  // Maintainer ruling, 2026-10-26: the entry names the source by the id the source's own
  // entry signs, as a deletion entry does (#1815). An import into the installation that
  // already holds the row renames it, and the row keeps that new id for the viewer.
  it('names a source an archive import renamed by the id its own entry signs', async () => {
    const source = await sourceCapture()
    const archivePath = join(tempDir, 'source.bbcase')
    await exportCaseArchive(caseId, archivePath)
    const { newCaseId } = await importCaseArchive(archivePath)
    const [renamed] = listCaptures(newCaseId)
    expect(renamed.id).not.toBe(source.id)

    const payload = {
      urls: [LINK],
      caseId: newCaseId,
      linkedFrom: { captureId: renamed.id, linkHref: LINK }
    }
    expect(svc.enqueueLink(payload)).toEqual({ accepted: 1, rejected: [] })
    await svc.idle()

    const linked = getCapture(newCaptures[1].id)!
    expect(linked.linkedFromCaptureId).toBe(renamed.id)
    const entry = readFileSync(join(getStorageRoot(), newCaseId, MANIFEST_FILENAME), 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((e) => e.captureId === linked.id)
    expect(entry).toMatchObject({
      linkedFromCaptureId: source.id,
      linkedFromContentHash: source.hash,
      linkHref: LINK
    })
    expect((await verifyCapture(linked.id)).status).toBe('verified')
  })

  it('skips a source whose row points at another Capture’s entry', async () => {
    const source = await sourceCapture()
    const other = await sourceCapture('https://example.com/other-source')
    getDb()
      .prepare('UPDATE captures SET manifest_index = ? WHERE id = ?')
      .run(other.manifestIndex, source.id)
    const before = entries().length
    expect(svc.enqueueLink(linkPayload(source.id)).accepted).toBe(1)
    await expectNothingWritten(before, 2)
    expect(events.at(-1)).toMatchObject({
      type: 'skipped',
      skipReason: 'Link source has no verified manifest entry'
    })
  })

  it('skips a source with no manifest entry', async () => {
    const legacy = insertCapture({
      caseId,
      url: 'https://example.com/legacy',
      title: 'Legacy',
      hash: 'a'.repeat(64),
      timestamp: '2026-01-01T00:00:00.000Z'
    })
    expect(svc.enqueueLink(linkPayload(legacy.id)).accepted).toBe(1)
    await svc.idle()
    expect(newCaptures).toHaveLength(0)
    expect(events.at(-1)).toMatchObject({
      type: 'skipped',
      skipReason: 'Link source has no manifest entry'
    })
  })

  // The manifest writer runs no schema check, and the strict schema refuses a
  // `linkedFromContentHash` that is not lower-case SHA-256 hex. A signed capture entry's own
  // `contentHash` can be any string, so the queue refuses such a source rather than sign it.
  it('skips a source whose signed Content Hash is not lower-case SHA-256 hex', async () => {
    const contentHash = 'A'.repeat(64)
    const caseDir = join(getStorageRoot(), caseId)
    initManifest(caseDir)
    const id = 'upper-case-source'
    const { index } = appendManifestEntry(caseDir, {
      type: 'capture',
      captureId: id,
      caseId,
      url: 'https://example.com/upper',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentHash,
      sizeBytes: 1,
      operatorId: 'op',
      operatorName: 'Op',
      toolVersion: '0.4.0'
    })
    insertCapture({
      id,
      caseId,
      url: 'https://example.com/upper',
      title: 'Upper',
      hash: contentHash,
      timestamp: '2026-01-01T00:00:00.000Z',
      format: 'mhtml',
      manifestIndex: index
    })
    const before = entries().length
    expect(svc.enqueueLink(linkPayload(id)).accepted).toBe(1)
    await expectNothingWritten(before, 0)
    expect(events.at(-1)).toMatchObject({
      type: 'skipped',
      skipReason: 'Link source Content Hash is not lower-case SHA-256 hex'
    })
  })
})

// A Shared Case member can link from a teammate's received Capture: its signed entry is on
// the author's chain, not the receiver's, and the writer reads it from there (ADR-0040).
describe("Capture link from a teammate's Capture (ADR-0040)", () => {
  const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000001995'
  const LINK = 'http://example.com/alice/linked'
  let root: string
  let A: Peer
  let B: Peer

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'birdbrain-link-teammate-'))
    A = await createPeer(root, 'alice', 'Alice Owner', 'AL')
    B = await createPeer(root, 'bob', 'Bob Member', 'BO')
    for (const peer of [A, B]) {
      await activate(peer)
      seedSharedCase(CASE_ID, A, [B])
    }
    await activate(A)
    appendOwnChainLine(CASE_ID, memberAddBody(CASE_ID, A, 'owner', A))
    appendOwnChainLine(CASE_ID, memberAddBody(CASE_ID, B, 'member', A))
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    resetSigningKey()
    resetSyncStateMemory()
    rmSync(root, { recursive: true, force: true })
  })

  it("signs the author's entry for the source, and the Capture verifies", async () => {
    const source = await addCapture(CASE_ID, A, 1)
    const recorded = recordSource(CASE_ID, A)
    await activate(B)
    const result = await pull(CASE_ID, recorded)
    expect(result.errors).toEqual([])
    expect(getExhibit(source.captureId)?.authorInstallationId).toBe(A.installationId)

    const newCaptures: Capture[] = []
    const events: CaptureEvent[] = []
    const svc = createRecaptureService({
      renderPage: fakeRender(),
      captureLifecycle: createCaptureLifecycle({
        selectorLifecycle: { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle
      }),
      emitEvent: (e) => events.push(e),
      emitNewCapture: (c) => newCaptures.push(c),
      timeoutMs: 45_000
    })
    const linkedFrom = { captureId: source.captureId, linkHref: LINK }
    expect(svc.enqueueLink({ urls: [LINK], caseId: CASE_ID, linkedFrom })).toEqual({
      accepted: 1,
      rejected: []
    })
    await svc.idle()

    expect(events.filter(({ type }) => type === 'skipped')).toEqual([])
    expect(newCaptures).toHaveLength(1)
    const provenance = {
      linkedFromCaptureId: source.captureId,
      linkedFromContentHash: source.contentHash,
      linkHref: LINK
    }
    const linked = getCapture(newCaptures[0].id)!
    expect(linked).toMatchObject(provenance)
    const entry = readFileSync(join(getStorageRoot(), CASE_ID, MANIFEST_FILENAME), 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((e) => e.captureId === linked.id)
    expect(entry).toMatchObject({ ...provenance, schemaVersion: 6 })
    expect((await verifyCapture(linked.id)).status).toBe('verified')
  })
})
