import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { getTagsForCapture } from '@main/services/db/tagRepo'
import * as noteRepo from '@main/services/db/noteRepo'
import * as tagRepo from '@main/services/db/tagRepo'
import { initStorage } from '@main/services/storage'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import {
  startCaptureServer,
  stopCaptureServer,
  resetManualDedup,
  setMainWindow
} from '@main/services/captureServer'
import type { BrowserWindow } from 'electron'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import { createSessionService, type SessionService } from '@main/services/session'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'

// What the extension attach routes tell an open renderer (#852).
//
// The routes write Tags and Notes straight through the repos, so no renderer
// mutation runs and the caches showing that case would otherwise keep serving
// the pre-write answer. This file is the contract for the announcement: which
// writes emit, in what order relative to the capture event, and — the half that
// matters for an evidence display — which non-writes stay silent. A refused or
// failed attach that still emitted would have the renderer refetch on the claim
// that a row exists.
//
// Kept apart from captureServer.test.ts because it needs a main window
// installed and every send recorded, which that file's ~2000 lines of endpoint
// assertions neither set up nor want.

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

const sent: Array<{ channel: string; payload: unknown }> = []
vi.mock('@main/ipcWrap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/ipcWrap')>()
  return {
    ...actual,
    sendEvent: (_target: unknown, channel: string, payload: unknown) => {
      sent.push({ channel, payload })
    }
  }
})

const ATTACH = 'event:extensionAttach'
const NEW_CAPTURE = 'event:newCapture'

const attachEvents = (): unknown[] =>
  sent.filter((e) => e.channel === ATTACH).map((e) => e.payload)

// Only the two channels this file reasons about; capture-activity events are
// emitted throughout ingest and would drown the ordering assertion.
const captureAndAttachChannels = (): string[] =>
  sent.map((e) => e.channel).filter((c) => c === NEW_CAPTURE || c === ATTACH)

let nextPort = 19990
const TEST_TOKEN = 'test-server-token'
const PAGE_URL = 'https://example.com/page'

describe('extension attach cache events (#852)', () => {
  let tempDir: string
  let baseUrl: string
  let sessionService: SessionService

  beforeEach(async () => {
    const port = nextPort++
    sent.length = 0
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-attach-events-'))
    await initDatabase(':memory:')
    initStorage(join(tempDir, 'captures'))
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator' })
    resetInstallationId()
    initInstallationId(tempDir)
    sessionService = createSessionService()
    resetManualDedup()
    // Without a window the emitters are no-ops, so every assertion below would
    // pass on an absence rather than on the event.
    setMainWindow({
      isDestroyed: () => false,
      webContents: { send: () => {} }
    } as unknown as BrowserWindow)
    baseUrl = `http://127.0.0.1:${port}`
    const selectorLifecycle = createSelectorLifecycle({ emitRematched: () => {} })
    const captureLifecycle = createCaptureLifecycle({ selectorLifecycle })
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

  async function seedActiveCase(name: string): Promise<string> {
    const created = createCase({ name })
    await fetch(`${baseUrl}/api/cases/${created.id}/activate`, {
      method: 'POST',
      headers: { 'X-Birdbrain-Token': TEST_TOKEN }
    })
    return created.id
  }

  function postForm(
    path: string,
    fields: Record<string, string>,
    mhtmlContent?: string
  ): Promise<Response> {
    const form = new FormData()
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    if (mhtmlContent !== undefined) {
      form.append('mhtml', new Blob([mhtmlContent], { type: 'multipart/related' }), 'page.mhtml')
    }
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      body: form,
      headers: { 'X-Birdbrain-Token': TEST_TOKEN }
    })
  }

  // Seeds the capture the attach routes resolve against, then clears the
  // recording so each test reads only its own request's events.
  async function seedCapture(caseId: string): Promise<string> {
    const stored = await readJson(
      await postForm('/api/captures', { source: 'manual', caseId, url: PAGE_URL }, '<html>x</html>')
    )
    sent.length = 0
    return stored.captureId as string
  }

  it('announces a tag applied to a capture the case already held', async () => {
    const caseId = await seedActiveCase('Tag Case')
    const captureId = await seedCapture(caseId)

    const res = await postForm('/api/tags/apply', {
      caseId,
      url: `${PAGE_URL}#section`,
      tagName: 'Evidence'
    })

    expect(res.status).toBe(200)
    expect(attachEvents()).toEqual([{ kind: 'tag', caseId, captureId }])
    // The path #852 names as emitting nothing at all today: attaching to an
    // existing capture acquires no bytes, so NEW_CAPTURE never fires and this
    // event is the renderer's only notice.
    expect(captureAndAttachChannels()).toEqual([ATTACH])
    expect(getTagsForCapture(captureId).map((t) => t.name)).toEqual(['Evidence'])
  })

  it('announces a note created on a capture the case already held', async () => {
    const caseId = await seedActiveCase('Note Case')
    const captureId = await seedCapture(caseId)

    const res = await postForm('/api/notes', {
      caseId,
      url: PAGE_URL,
      noteTitle: 'Observed',
      noteText: 'The account posted again at 14:02.'
    })

    expect(res.status).toBe(200)
    expect(attachEvents()).toEqual([{ kind: 'note', caseId, captureId }])
    expect(captureAndAttachChannels()).toEqual([ATTACH])
    expect(noteRepo.listNotes(caseId)).toHaveLength(1)
  })

  it('announces the capture before the tag when the attach auto-captured', async () => {
    const caseId = await seedActiveCase('Auto Case')

    const res = await postForm(
      '/api/tags/apply',
      { caseId, url: PAGE_URL, tagName: 'Evidence' },
      '<html>fresh</html>'
    )

    const data = await readJson(res)
    expect(data.captured).toBe(true)
    // Order is the contract: the renderer folds the capture into its list
    // first, so the tag invalidation lands against a case that already shows
    // the capture it belongs to.
    expect(captureAndAttachChannels()).toEqual([NEW_CAPTURE, ATTACH])
    expect(attachEvents()).toEqual([{ kind: 'tag', caseId, captureId: data.captureId }])
  })

  it('announces the capture before the note when the attach auto-captured', async () => {
    const caseId = await seedActiveCase('Auto Note Case')

    const res = await postForm(
      '/api/notes',
      { caseId, url: PAGE_URL, noteText: 'first sighting' },
      '<html>fresh</html>'
    )

    const data = await readJson(res)
    expect(data.captured).toBe(true)
    expect(captureAndAttachChannels()).toEqual([NEW_CAPTURE, ATTACH])
    expect(attachEvents()).toEqual([{ kind: 'note', caseId, captureId: data.captureId }])
  })

  it('stays silent when the attach is refused before any write', async () => {
    const caseId = await seedActiveCase('Refused Case')

    // No capture of this URL and no payload to ingest one: 422, nothing written.
    const res = await postForm('/api/tags/apply', { caseId, url: PAGE_URL, tagName: 'Evidence' })

    expect(res.status).toBe(422)
    expect(attachEvents()).toEqual([])
  })

  it('stays silent when the tag write throws', async () => {
    const caseId = await seedActiveCase('Failing Tag Case')
    const captureId = await seedCapture(caseId)
    const spy = vi.spyOn(tagRepo, 'addTagToCapture').mockImplementation(() => {
      throw new Error('tag apply exploded')
    })

    try {
      const res = await postForm('/api/tags/apply', { caseId, url: PAGE_URL, tagName: 'Evidence' })
      expect(res.status).toBe(500)
      expect(attachEvents()).toEqual([])
      expect(getTagsForCapture(captureId)).toEqual([])
    } finally {
      spy.mockRestore()
    }
  })

  it('stays silent when the note write throws', async () => {
    const caseId = await seedActiveCase('Failing Note Case')
    await seedCapture(caseId)
    const spy = vi.spyOn(noteRepo, 'createNote').mockImplementation(() => {
      throw new Error('note create exploded')
    })

    try {
      const res = await postForm('/api/notes', { caseId, url: PAGE_URL, noteText: 'never lands' })
      expect(res.status).toBe(500)
      expect(attachEvents()).toEqual([])
      expect(noteRepo.listNotes(caseId)).toEqual([])
    } finally {
      spy.mockRestore()
    }
  })
})
