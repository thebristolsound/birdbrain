import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'crypto'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { MANIFEST_FILENAME } from '@shared/constants'
import { initStorage, ensureCaseDir, getStorageRoot } from '@main/services/storage'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase, setAutoCapturePolicy, updateCase } from '@main/services/db/caseRepo'
import {
  getInstallationId,
  initInstallationId,
  resetInstallationId
} from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import {
  createRecaptureService,
  type RecaptureService,
  type RenderedPage,
  type RenderPage
} from '@main/services/recapture'
import { canonicalStringify } from '@shared/verify'
import type { Capture, CaptureEvent } from '@shared/types'

// What a Background Job tells the activity feed, how its job row ends, and the entry and row a
// stored one writes, for each way a job can be admitted or refused. The answers in the fixture
// file are what recapture.ts produced on main at 9871449a, the commit this pin was added on
// top of, before the Case check, the exclusion policy and the stored report moved into Capture
// Lifecycle admission.
// Two answers are newer, re-recorded with that move: the two archived-Case scenarios, which
// main stored as Captures and admission now refuses.
// The feed takes the lifecycle's events and the queue's on one channel, as main wires them, so
// the recorded order holds whichever of the two emits an event. Content is invented.
//
// Values that differ on every run are replaced by a name before the comparison: the Case's id,
// the installation's id, every other UUID in order of first appearance, each entry hash and
// each signature. Every entry hash is first recomputed from the entry's own canonical body.

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

// A stored job's entry signs the running build's version, which moves at every release.
vi.mock('@main/services/toolVersion', () => ({ resolveToolVersion: () => TOOL_VERSION }))

const TOOL_VERSION = vi.hoisted(() => '1.0.1-beta.25')
const FIXTURE = join(__dirname, '../../fixtures/backgroundJob/known-answers.json')
const NOW = '2026-11-16T10:00:00.000Z'
const PAGE = 'https://example.com/page'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

function fakeRender(overrides: Partial<RenderedPage> = {}): RenderPage {
  return async (url) => ({
    mhtmlStream: (async function* () {
      yield Buffer.from(`mhtml-of-${url}`)
    })(),
    screenshot: Buffer.from('png-bytes'),
    screenshotRecord: {
      scaled: false,
      truncated: false,
      trimmed: false,
      contentWidth: 1280,
      contentHeight: 900,
      width: 1280,
      height: 900
    },
    scrollToLoad: {
      requested: true,
      ran: true,
      outcome: 'stopped-growing',
      endHeight: 900,
      scrollLockLifted: true
    },
    imageSourcePinning: { present: true, pinnedImages: 0, pinnedImagesNotLoaded: 0 },
    text: 'page text',
    title: 'Page Title',
    finalUrl: url,
    httpStatus: 200,
    userAgent: 'HiddenWindow UA',
    browserVersion: 'Chrome/130',
    transactionRecord: { present: false, reason: 'failed', error: new Error('not recorded') },
    pdf: { present: false, reason: 'failed', error: new Error('not printed') },
    cleanup: async () => {},
    ...overrides
  })
}

// A render that waits for `release`, so a test can change settings while the job is running.
function heldRender(overrides: Partial<RenderedPage> = {}): {
  render: RenderPage
  started: Promise<void>
  release: () => void
} {
  let release: () => void = () => {}
  let begun: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    begun = resolve
  })
  return {
    started,
    release,
    render: async (url, opts) => {
      begun()
      await gate
      return fakeRender(overrides)(url, opts)
    }
  }
}

describe('what a Background Job reports and stores', () => {
  let tempDir: string
  let caseId: string
  let events: CaptureEvent[]
  let newCaptures: Capture[]
  let results: unknown[]

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) })
    tempDir = mkdtempSync(join(tmpdir(), 'bb-background-job-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    initSettings(tempDir)
    resetInstallationId()
    initInstallationId(tempDir)
    updateSettings({ operatorName: 'Op' })
    caseId = createCase({ name: 'Background jobs' }).id
    ensureCaseDir(caseId)
    events = []
    newCaptures = []
    results = []
  })

  afterEach(() => {
    vi.useRealTimers()
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // Both emitters write to one list, as both reach the renderer on one channel.
  function makeService(renderPage: RenderPage): RecaptureService {
    const emitEvent = (event: CaptureEvent): void => {
      events.push(event)
    }
    const emitNewCapture = (capture: Capture): void => {
      newCaptures.push(capture)
    }
    const captureLifecycle = createCaptureLifecycle({
      selectorLifecycle: { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle,
      egressIsDirect: () => true,
      emitCaptureEvent: emitEvent,
      emitNewCapture
    })
    // Passed as a value, so this file compiles on both sides of the change: the queue takes
    // `emitNewCapture` only while it broadcasts a stored Capture itself.
    const deps = { renderPage, captureLifecycle, emitEvent, emitNewCapture }
    return createRecaptureService(deps)
  }

  async function settle(svc: RecaptureService): Promise<void> {
    await svc.idle()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }

  // Everything the scenario left behind, with the values that differ on every run named.
  function answers(svc: RecaptureService): unknown {
    const manifest = join(getStorageRoot(), caseId, MANIFEST_FILENAME)
    let lines: string[] = []
    try {
      lines = readFileSync(manifest, 'utf-8')
        .split('\n')
        .filter((line) => line.length > 0)
    } catch {
      // A scenario that stores nothing leaves no manifest.
    }
    const named = new Map<string, string>([
      [caseId, '<case>'],
      [getInstallationId(), '<installation>']
    ])
    for (const line of lines) {
      const { entryHash, signature, ...body } = JSON.parse(line) as Record<string, unknown>
      expect(sha(canonicalStringify(body))).toBe(entryHash)
      named.set(String(entryHash), `<hash of entry ${String(body.index)}>`)
      named.set(String(signature), `<signature of entry ${String(body.index)}>`)
    }
    const db = getDb()
    let text = JSON.stringify({
      results,
      events,
      newCaptures: newCaptures.map(({ id, url, method }) => ({ id, url, method })),
      jobs: svc.listJobs({ caseId }),
      entries: lines,
      rows: db.prepare('SELECT * FROM captures ORDER BY manifest_index').all()
    })
    for (const [value, name] of named) text = text.replaceAll(value, name)
    const uuids = new Map<string, string>()
    text = text.replace(UUID, (id) => {
      if (!uuids.has(id)) uuids.set(id, `<uuid ${uuids.size + 1}>`)
      return uuids.get(id) ?? id
    })
    return JSON.parse(text)
  }

  const SCENARIOS: Record<string, () => Promise<RecaptureService>> = {
    'a job that is stored': async () => {
      const svc = makeService(fakeRender())
      results.push(svc.enqueue([{ url: PAGE, caseId }]))
      await settle(svc)
      return svc
    },
    'a job whose render lands on another address of the same site': async () => {
      const svc = makeService(fakeRender({ finalUrl: 'https://example.com/landed' }))
      results.push(svc.enqueue([{ url: PAGE, caseId }]))
      await settle(svc)
      return svc
    },
    'a job whose page looks like a login wall': async () => {
      const svc = makeService(
        fakeRender({ finalUrl: 'https://example.com/login', title: 'Sign in' })
      )
      results.push(svc.enqueue([{ url: PAGE, caseId }]))
      await settle(svc)
      return svc
    },
    'a Recapture that supersedes the first Capture': async () => {
      const svc = makeService(fakeRender())
      results.push(svc.enqueue([{ url: PAGE, caseId }]))
      await settle(svc)
      const supersedesCaptureId = newCaptures[0].id
      results.push(svc.enqueue([{ url: PAGE, caseId, supersedesCaptureId }]))
      await settle(svc)
      return svc
    },
    'a Capture link job': async () => {
      const svc = makeService(fakeRender())
      results.push(svc.enqueue([{ url: PAGE, caseId }]))
      await settle(svc)
      const linkHref = 'https://example.com/linked'
      results.push(
        svc.enqueueLink({
          urls: [linkHref],
          caseId,
          linkedFrom: { captureId: newCaptures[0].id, linkHref }
        })
      )
      await settle(svc)
      return svc
    },
    'a Capture link job whose render lands on an excluded address': async () => {
      const svc = makeService(async (url, opts) =>
        fakeRender(
          url === 'https://example.com/linked' ? { finalUrl: 'https://blocked.example/x' } : {}
        )(url, opts)
      )
      results.push(svc.enqueue([{ url: PAGE, caseId }]))
      await settle(svc)
      setAutoCapturePolicy(caseId, { exclusions: ['blocked.example'], mode: 'stack' })
      const linkHref = 'https://example.com/linked'
      results.push(
        svc.enqueueLink({
          urls: [linkHref],
          caseId,
          linkedFrom: { captureId: newCaptures[0].id, linkHref }
        })
      )
      await settle(svc)
      return svc
    },
    'two jobs queued together, one of them for an excluded address': async () => {
      setAutoCapturePolicy(caseId, { exclusions: ['secret.example.com'], mode: 'stack' })
      const svc = makeService(fakeRender())
      results.push(
        svc.enqueue([
          { url: 'https://secret.example.com/a', caseId },
          { url: PAGE, caseId }
        ])
      )
      await settle(svc)
      return svc
    },
    'a job whose address is excluded after it is queued and before it starts': async () => {
      const first = heldRender()
      const svc = makeService(async (url, opts) =>
        url === PAGE ? first.render(url, opts) : fakeRender()(url, opts)
      )
      results.push(
        svc.enqueue([
          { url: PAGE, caseId },
          { url: 'https://later.example/b', caseId }
        ])
      )
      await first.started
      setAutoCapturePolicy(caseId, { exclusions: ['later.example'], mode: 'stack' })
      first.release()
      await settle(svc)
      return svc
    },
    'a job whose render lands on an excluded address': async () => {
      setAutoCapturePolicy(caseId, { exclusions: ['blocked.example'], mode: 'stack' })
      const svc = makeService(fakeRender({ finalUrl: 'https://blocked.example/landing' }))
      results.push(svc.enqueue([{ url: PAGE, caseId }]))
      await settle(svc)
      return svc
    },
    'a job whose operator name is cleared while it renders': async () => {
      const held = heldRender()
      const svc = makeService(held.render)
      results.push(svc.enqueue([{ url: PAGE, caseId }]))
      await held.started
      updateSettings({ operatorName: '' })
      held.release()
      await settle(svc)
      return svc
    },
    'a job whose operator name is cleared and whose render lands on an excluded address':
      async () => {
        setAutoCapturePolicy(caseId, { exclusions: ['blocked.example'], mode: 'stack' })
        const held = heldRender({ finalUrl: 'https://blocked.example/landing' })
        const svc = makeService(held.render)
        results.push(svc.enqueue([{ url: PAGE, caseId }]))
        await held.started
        updateSettings({ operatorName: '' })
        held.release()
        await settle(svc)
        return svc
      },
    'jobs queued, resumed and retried with no operator name': async () => {
      const svc = makeService(fakeRender())
      updateSettings({ operatorName: '' })
      results.push(
        svc.enqueue([
          { url: PAGE, caseId },
          { url: 'not a url', caseId }
        ])
      )
      results.push(svc.resume('0196f7a2-aaaa-bbbb-cccc-00000000b001'))
      results.push(svc.retry({ batchId: '0196f7a2-aaaa-bbbb-cccc-00000000b001' }))
      await settle(svc)
      return svc
    },
    'a job for a Case that does not exist, and one for an address that is not a URL': async () => {
      const svc = makeService(fakeRender())
      results.push(
        svc.enqueue([
          { url: PAGE, caseId: '0196f7a2-aaaa-bbbb-cccc-00000000c404' },
          { url: 'not a url', caseId: '0196f7a2-aaaa-bbbb-cccc-00000000c404' },
          { url: 'not a url', caseId }
        ])
      )
      await settle(svc)
      return svc
    },
    'a job queued into an archived Case': async () => {
      expect(updateCase({ id: caseId, archived: true })?.archived).toBe(true)
      const svc = makeService(fakeRender())
      results.push(svc.enqueue([{ url: PAGE, caseId }]))
      await settle(svc)
      return svc
    },
    'a job whose Case is archived while it renders': async () => {
      const held = heldRender()
      const svc = makeService(held.render)
      results.push(svc.enqueue([{ url: PAGE, caseId }]))
      await held.started
      expect(updateCase({ id: caseId, archived: true })?.archived).toBe(true)
      held.release()
      await settle(svc)
      return svc
    }
  }

  it.each(Object.keys(SCENARIOS))('%s', async (name) => {
    const svc = await SCENARIOS[name]()
    // Read and compared, never recorded: a missing or stale fixture fails on every machine.
    const recorded = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as Record<string, unknown>
    expect(recorded).toHaveProperty([name])
    expect(answers(svc)).toEqual(recorded[name])
  })
})
