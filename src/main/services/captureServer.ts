import { Hono } from 'hono'
import type { Context } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import type { Server } from 'http'
import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { sendEvent } from '@main/ipcWrap'
import * as caseRepo from '@main/services/db/caseRepo'
import * as captureRepo from '@main/services/db/captureRepo'
import * as noteRepo from '@main/services/db/noteRepo'
import * as selectorRepo from '@main/services/db/selectorRepo'
import * as tagRepo from '@main/services/db/tagRepo'
import { getSettings } from '@main/services/settings'
import { ingestMhtmlCapture } from '@main/services/captureLifecycle'
import type { AdmissionRefusal } from '@main/services/captureLifecycle'
import {
  createPipelineSelfTestSandbox,
  PIPELINE_SELF_TEST_URL,
  type PipelineSelfTestSandbox
} from '@main/services/pipelineSelfTest'
import { getInstallationId } from '@main/services/installationId'
import { getServerToken } from '@main/services/serverToken'
import { resolveToolVersion } from '@main/services/toolVersion'
import type { CaptureEvent } from '@shared/types'
import type { ExtensionAttachEvent } from '@shared/ipc'
import {
  CaptureUploadSchema,
  ExtensionNoteCreateSchema,
  ExtensionTagApplySchema,
  SelectorCreateSchema,
  UrlLookupSchema,
  formatCaptureUploadError,
  formatExtensionAttachError,
  formatSelectorCreateError,
  type ActiveSelectorsResult,
  type CaptureServerCase,
  type CaptureServerStatus,
  type CaptureUploadResult,
  type ExtensionAttachBase,
  type ExtensionNoteCreateResult,
  type ExtensionTagApplyResult,
  type ScreenshotStatus,
  type SelectorCreateResult,
  type UrlLookupResult
} from '@shared/schemas'
import { canonicalizeUrl, resolveCaptureForUrl } from '@shared/urlCanonicalize'
import { plainTextToNoteDoc } from '@shared/noteDoc'
import type { CaptureLifecycle } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import { createSessionService, type SessionService } from '@main/services/session'

import { CAPTURE_SERVER_PORT } from '@shared/constants'
import { effectiveIgnorePatternsForCase } from '@main/services/exclusionPolicy'
import { logger } from '@main/services/logger'
export { CAPTURE_SERVER_PORT }

export interface CaptureServerDeps {
  selectorLifecycle: SelectorLifecycle
  captureLifecycle: CaptureLifecycle
  token?: string
  // Owns the session state machine. Defaults to a module-level instance so
  // existing callers keep working; main supplies the real one.
  sessionService?: SessionService
}

const OPERATOR_NAME_REQUIRED_MSG =
  'Operator name required. Configure your name in Birdbrain settings before capturing.'

let server: Server | null = null
// The port this process is actually listening on, which is not always
// CAPTURE_SERVER_PORT: tests start the server on a port they own, and a
// listener elsewhere on the machine can hold the default. Null whenever the
// server is not running (#462).
let listeningPort: number | null = null
let mainWindow: BrowserWindow | null = null

// Fallback for callers that don't inject one (the test suite). It has no
// notification callbacks: broadcasting session events is the main-process
// wiring's job, so this module's window reference now serves capture events
// only.
let sessionService: SessionService = createSessionService()

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

function emitCaptureEvent(event: CaptureEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    sendEvent(mainWindow.webContents, IPC_CHANNELS.CAPTURE_ACTIVITY, event)
  }
}

// Announces a committed extension attach write (#852). Called after the repo
// write returns, never before: the renderer treats this as "the case on disk
// has changed, re-read it", so emitting it for a write that then threw would
// make it a claim about state that does not exist.
function emitExtensionAttach(event: ExtensionAttachEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    sendEvent(mainWindow.webContents, IPC_CHANNELS.EXTENSION_ATTACH, event)
  }
}

// The single source of truth for the pipeline self-test route.
const CAPTURE_TEST_ROUTE = '/api/captures/test'

// The one place an admission refusal becomes a status code. The messages are
// the wire contract the extension shows the operator, unchanged from when each
// check lived in the route; the policy itself is the Capture Lifecycle's.
function refusalResponse(c: Context, refusal: AdmissionRefusal): Response {
  switch (refusal.kind) {
    case 'operator_name_required':
      return c.json({ error: OPERATOR_NAME_REQUIRED_MSG }, 400)
    case 'no_active_session':
      return c.json({ error: 'No active session' }, 400)
    case 'no_active_case':
      return c.json({ error: 'No active case' }, 400)
    case 'missing_case_id':
      return c.json({ error: 'Missing required field: caseId' }, 400)
    case 'case_not_found':
      return c.json({ error: 'Case not found' }, 404)
    case 'case_archived':
      return c.json({ error: 'Case is archived' }, 400)
    case 'excluded':
      return c.json({ error: 'URL blocked by ignored pattern', pattern: refusal.pattern }, 403)
    case 'duplicate':
      return c.json({ error: 'Duplicate capture', status: 'skipped' }, 409)
    case 'failed':
      return c.json({ error: 'Failed to process capture' }, 500)
  }
}

// The multipart field is typed unknown by the schema; anything that is not a
// file is treated as no screenshot, as it always was.
function screenshotFileOf(field: unknown): Blob | undefined {
  return field instanceof File || field instanceof Blob ? field : undefined
}

function createApp(deps: CaptureServerDeps): Hono {
  const { selectorLifecycle, captureLifecycle, token } = deps
  const app = new Hono()
  const requiredToken = token ?? getServerToken()

  // DNS-rebinding guard (#D3): the server binds loopback, but a browser page on
  // a hostname the attacker has rebound to 127.0.0.1 still reaches us — carrying
  // that hostname in the Host header. Since a rebound page counts as same-origin
  // to itself, CORS never engages and it could otherwise read the token or drive
  // the pipeline. Reject anything whose Host is not a loopback literal, before
  // any body is read or CORS runs, so no forged origin can talk to us.
  app.use('*', async (c, next) => {
    const hostname = (c.req.header('Host') ?? '').replace(/:\d+$/, '').toLowerCase()
    const isLoopback =
      hostname === '127.0.0.1' ||
      hostname === 'localhost' ||
      hostname === '[::1]' ||
      hostname === '::1'
    if (!isLoopback) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    await next()
  })

  // Body size limit: 250 MB max to prevent memory exhaustion
  app.use('*', bodyLimit({ maxSize: 250 * 1024 * 1024 }))

  // Allow requests from Chrome extension
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (
          origin.startsWith('chrome-extension://') ||
          origin.startsWith('http://localhost:') ||
          origin.startsWith('http://127.0.0.1:')
        ) {
          return origin
        }
        return undefined as unknown as string
      },
      allowMethods: ['GET', 'POST'],
      allowHeaders: ['Content-Type', 'X-Birdbrain-Token']
    })
  )

  // Require auth token on all state-changing endpoints.
  app.use('*', async (c, next) => {
    if (c.req.method === 'POST') {
      const token = c.req.header('X-Birdbrain-Token')
      if (token !== requiredToken) {
        return c.json({ error: 'Unauthorized' }, 401)
      }
    }
    await next()
  })

  // Status endpoint — also tracks extension connection
  app.get('/api/status', (c) => {
    const origin = c.req.header('Origin') ?? ''
    const fromExtension = origin.startsWith('chrome-extension://')
    if (fromExtension) {
      sessionService.touchExtension()
    }
    const query = c.req.query()
    const includeCasesParam = query.includeCases
    let includeCases: boolean
    if (typeof includeCasesParam === 'undefined') {
      // Backwards-compatible default: include cases when no query param is provided
      includeCases = true
    } else if (typeof includeCasesParam === 'string') {
      const val = includeCasesParam.toLowerCase()
      // Explicitly disable only when clearly false/zero
      includeCases = !(val === '0' || val === 'false')
    } else {
      includeCases = true
    }
    const session = sessionService.snapshot()
    const activeCase = session.activeCaseId ? caseRepo.getCase(session.activeCaseId) : null
    const settings = getSettings()
    const allCases = includeCases ? caseRepo.listCases() : null
    // Token exposure is now extension-only (#228): the renderer talks to main
    // over IPC and never reads this. The two dev-server origins that used to be
    // granted (http://localhost:<port>, http://127.0.0.1:<port>) existed solely
    // to bootstrap the renderer's fetch wrapper, which no longer exists.
    //
    // The origin-less grant stays: Chrome normally sends an Origin on the
    // extension's status poll, but a fetch that omits it would otherwise lose
    // pairing. The DNS-rebinding guard above already rejects rebound hostnames
    // before this runs, and file:// is still not trusted — such a page receives
    // no CORS grant and so cannot read the body.
    const includeToken = !origin || origin.startsWith('chrome-extension://')
    const status: CaptureServerStatus = {
      running: true,
      ...(includeToken ? { serverToken: requiredToken } : {}),
      activeCase: activeCase ? { id: activeCase.id, name: activeCase.name } : null,
      sessionActive: session.sessionActive,
      captureCount: session.captureCount,
      autoCaptureMode: settings.autoCaptureMode,
      cases: includeCases && allCases ? allCases.map((cs) => ({ id: cs.id, name: cs.name })) : [],
      ignoredUrlPatterns: settings.ignoredUrlPatterns,
      // What the extension mirrors (#400): the global list combined with the
      // active case's exclusions, or that case's alone under 'override'. Sent
      // alongside `ignoredUrlPatterns` rather than overwriting it, so that
      // field keeps meaning "the operator's global list" for anything that
      // reads it. With no active case there is no case policy to apply, so this
      // is the global list — the extension only ever captures into the active
      // case, so its mirror and this list describe the same target.
      effectiveIgnoredUrlPatterns: effectiveIgnorePatternsForCase(activeCase?.id ?? null),
      captureScreenshots: settings.captureScreenshots,
      dedupeWindowSeconds: settings.dedupeWindowSeconds,
      theme: settings.theme
    }
    return c.json(status)
  })

  // List cases
  app.get('/api/cases', (c) => {
    const cases = caseRepo.listCases()
    return c.json(
      cases.map(
        (cs) =>
          ({
            id: cs.id,
            name: cs.name,
            captureCount: captureRepo.getCaptureCount(cs.id)
          }) satisfies CaptureServerCase
      )
    )
  })

  // Activate a case
  app.post('/api/cases/:id/activate', (c) => {
    const id = c.req.param('id')
    const caseData = caseRepo.getCase(id)
    if (!caseData) {
      return c.json({ error: 'Case not found' }, 404)
    }
    sessionService.activateCase(id)
    return c.json({ status: 'ok', case: { id: caseData.id, name: caseData.name } })
  })

  // Start session
  app.post('/api/session/start', (c) => {
    if (!sessionService.snapshot().activeCaseId) {
      return c.json({ error: 'No active case selected' }, 400)
    }
    sessionService.start()
    return c.json({ status: 'ok', sessionActive: true })
  })

  // Stop session
  app.post('/api/session/stop', (c) => {
    sessionService.stop()
    return c.json({ status: 'ok', sessionActive: false })
  })

  // Unified capture endpoint (multipart/form-data with MHTML file)
  app.post(
    '/api/captures',
    zValidator('form', CaptureUploadSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: formatCaptureUploadError(result.error) }, 400)
      }
      return undefined
    }),
    async (c) => {
      const input = c.req.valid('form')
      // The wire union, not the domain one: 'recapture' never arrives here.
      // Everything after parsing is the Capture Lifecycle's: the route hands
      // over the payload and maps the outcome.
      const outcome = await captureLifecycle.admit({
        route: input.source,
        caseId: input.caseId,
        url: input.url,
        title: input.title,
        timestamp: input.timestamp,
        stream: input.mhtml.stream(),
        textContent: input.textContent,
        headers: input.headers ?? {},
        browserVersion: input.browserVersion,
        userAgent: input.userAgent,
        httpStatus: input.httpStatus,
        extensionVersion: input.extensionVersion,
        screenshot: screenshotFileOf(input.screenshot)
      })
      if (!outcome.ok) return refusalResponse(c, outcome.refusal)
      return c.json({
        captureId: outcome.capture.id,
        hash: outcome.contentHash,
        manifestIndex: outcome.capture.manifestIndex,
        status: 'ok',
        source: input.source,
        screenshotStatus: outcome.screenshotStatus,
        screenshotWarning: outcome.screenshotWarning
      } satisfies CaptureUploadResult)
    }
  )

  // List active selectors for the active case only
  app.get('/api/selectors/active', (c) => {
    const { activeCaseId } = sessionService.snapshot()
    if (!activeCaseId) {
      return c.json([] satisfies ActiveSelectorsResult)
    }
    const activeSelectors: ActiveSelectorsResult = selectorRepo.listActiveSelectors(activeCaseId)
    return c.json(activeSelectors)
  })

  // Create a selector from the extension (highlighted text)
  app.post(
    '/api/selectors',
    zValidator('json', SelectorCreateSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: formatSelectorCreateError(result.error) }, 400)
      }
      return undefined
    }),
    async (c) => {
      try {
        const { caseId, pattern, label } = c.req.valid('json')

        if (!sessionService.snapshot().activeCaseId) {
          return c.json({ error: 'No active case selected' }, 400)
        }
        if (caseId !== sessionService.snapshot().activeCaseId) {
          return c.json({ error: 'caseId does not match active case' }, 400)
        }

        const caseData = caseRepo.getCase(caseId)
        if (!caseData) {
          return c.json({ error: 'Case not found' }, 404)
        }
        if (caseData.archived) {
          return c.json({ error: 'Case is archived' }, 400)
        }

        // Server-stamped, never read from the request body (#395).
        // SelectorCreateSchema has no origin field on purpose: anything that
        // reaches 127.0.0.1:19845 could otherwise assert a false claim about
        // how a selector entered the case.
        const selector = selectorLifecycle.createSelector({
          caseId,
          pattern,
          isRegex: false,
          label,
          origin: 'extension'
        })

        return c.json({ selector, status: 'ok' } satisfies SelectorCreateResult)
      } catch (err) {
        logger.error('captureServer', 'captureServer.selector_create_failed', undefined, err)
        return c.json({ error: 'Failed to create selector' }, 500)
      }
    }
  )

  // Auto-capture-then-attach (#392, R2): resolve the Capture a Tag or Note
  // binds to, ingesting the supplied payload first when the case holds no
  // capture of the canonicalized URL. The attach itself happens in the caller,
  // strictly after this returns ok — that ordering is what makes the
  // no-orphan criterion structural rather than defended: a failed ingest
  // returns a refusal here and no attach code ever runs.
  type AttachTarget =
    | {
        ok: true
        captureId: string
        captured: boolean
        screenshotStatus: ScreenshotStatus
        screenshotWarning?: string
      }
    | { ok: false; response: Response }

  // Concurrent attach requests for one case + canonical URL are chained, not
  // raced: the candidate lookup and the ingest below are separated by awaits,
  // so two simultaneous requests for the same uncaptured URL could each
  // observe "no capture" and acquire twice, splitting their annotations
  // across duplicate captures. The second request runs only after the first
  // settles, and its own lookup then finds that ingest's capture (PR #835
  // review). Different URLs never wait on each other.
  const attachChains = new Map<string, Promise<unknown>>()

  function resolveOrIngestCapture(c: Context, input: ExtensionAttachBase): Promise<AttachTarget> {
    const key = `${input.caseId}\n${canonicalizeUrl(input.url)}`
    const run = (attachChains.get(key) ?? Promise.resolve()).then(() =>
      resolveOrIngestCaptureNow(c, input)
    )
    const tail: Promise<unknown> = run
      .catch(() => undefined)
      .finally(() => {
        if (attachChains.get(key) === tail) attachChains.delete(key)
      })
    attachChains.set(key, tail)
    return run
  }

  async function resolveOrIngestCaptureNow(
    c: Context,
    input: ExtensionAttachBase
  ): Promise<AttachTarget> {
    const { caseId, url } = input
    const fail = (response: Response): AttachTarget => ({ ok: false, response })

    // Same active-case discipline as POST /api/selectors: these are
    // extension-only surfaces and the extension annotates the active case.
    const { activeCaseId } = sessionService.snapshot()
    if (!activeCaseId) return fail(c.json({ error: 'No active case selected' }, 400))
    if (caseId !== activeCaseId) {
      return fail(c.json({ error: 'caseId does not match active case' }, 400))
    }
    const caseData = caseRepo.getCase(caseId)
    if (!caseData) return fail(c.json({ error: 'Case not found' }, 404))
    if (caseData.archived) return fail(c.json({ error: 'Case is archived' }, 400))

    const existing = resolveCaptureForUrl(url, captureRepo.listCaptureUrlCandidates(caseId))
    if (existing) {
      // Nothing was acquired on this path, so no screenshot could be dropped.
      return { ok: true, captureId: existing.id, captured: false, screenshotStatus: 'none' }
    }

    const mhtmlField = input.mhtml
    if (!mhtmlField) {
      return fail(
        c.json({ error: 'No capture of this URL in the case; retry with an MHTML payload' }, 422)
      )
    }

    // The acquisition itself is the Capture Lifecycle's, gate, exclusion and
    // cap included: this branch is a real acquisition route and must refuse
    // what the case excludes (#400), where attaching to a capture the case
    // already holds, above, acquires nothing and is not checked.
    const outcome = await captureLifecycle.admit({
      route: 'attach',
      caseId,
      url,
      title: input.title,
      timestamp: input.timestamp,
      stream: mhtmlField.stream(),
      textContent: input.textContent,
      headers: input.headers ?? {},
      browserVersion: input.browserVersion,
      userAgent: input.userAgent,
      httpStatus: input.httpStatus,
      extensionVersion: input.extensionVersion,
      screenshot: screenshotFileOf(input.screenshot)
    })
    if (!outcome.ok) {
      // A failed ingest names what was NOT done: the caller must not retry
      // with the same annotation against a capture that does not exist.
      return fail(
        outcome.refusal.kind === 'failed'
          ? c.json({ error: 'Failed to capture page; nothing was attached' }, 500)
          : refusalResponse(c, outcome.refusal)
      )
    }
    return {
      ok: true,
      captureId: outcome.capture.id,
      captured: true,
      screenshotStatus: outcome.screenshotStatus,
      screenshotWarning: outcome.screenshotWarning
    }
  }

  // Whether a case already holds a Capture of a URL (#392). A read carried as
  // a POST on purpose: the token guard above fires on POST only, so a GET
  // here would answer any local process without a token and leak whether a
  // case holds a URL (R23, #817).
  app.post(
    '/api/captures/lookup',
    zValidator('json', UrlLookupSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: formatExtensionAttachError(result.error) }, 400)
      }
      return undefined
    }),
    (c) => {
      const { caseId, url } = c.req.valid('json')
      if (!caseRepo.getCase(caseId)) {
        return c.json({ error: 'Case not found' }, 404)
      }
      const hit = resolveCaptureForUrl(url, captureRepo.listCaptureUrlCandidates(caseId))
      return c.json({
        found: hit !== null,
        canonicalUrl: canonicalizeUrl(url),
        capture: hit
      } satisfies UrlLookupResult)
    }
  )

  // Apply a Tag to the Capture of a URL, auto-capturing first when the case
  // holds none (#392). Find-or-create by case-insensitive name, matching the
  // archive importer's merge rule; re-applying is a no-op (INSERT OR IGNORE).
  app.post(
    '/api/tags/apply',
    zValidator('form', ExtensionTagApplySchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: formatExtensionAttachError(result.error) }, 400)
      }
      return undefined
    }),
    async (c) => {
      const input = c.req.valid('form')
      const target = await resolveOrIngestCapture(c, input)
      if (!target.ok) return target.response
      try {
        // Exact name wins before the case-insensitive fallback: `tags.name` is
        // case-sensitive, so `Evidence` and `evidence` can both exist (the IPC
        // path permits it) and the insensitive lookup could return either,
        // attaching a tag with a different identity and colour than the one
        // the request named (PR #835 review).
        const exactId = tagRepo.findTagIdByNameExact(input.tagName)
        const foundId = exactId ?? tagRepo.findTagIdByNameInsensitive(input.tagName)
        const found = foundId ? tagRepo.getTag(foundId) : undefined
        const applied = found ?? tagRepo.createTag({ name: input.tagName })
        tagRepo.addTagToCapture({ captureId: target.captureId, tagId: applied.id })
        emitExtensionAttach({ kind: 'tag', caseId: input.caseId, captureId: target.captureId })
        return c.json({
          status: 'ok',
          captureId: target.captureId,
          captured: target.captured,
          screenshotStatus: target.screenshotStatus,
          screenshotWarning: target.screenshotWarning,
          tag: { id: applied.id, name: applied.name }
        } satisfies ExtensionTagApplyResult)
      } catch (err) {
        logger.error('captureServer', 'captureServer.tag_apply_failed', undefined, err)
        // The capture (pre-existing or just ingested) is real evidence either
        // way, so name it — the caller must not retry with a fresh payload.
        // `captured` says which of the two it was: the extension records and
        // reports a fresh capture differently from one the case already held.
        return c.json(
          { error: 'Failed to apply tag', captureId: target.captureId, captured: target.captured },
          500
        )
      }
    }
  )

  // Create a Note on the Capture of a URL, auto-capturing first when the case
  // holds none (#392).
  app.post(
    '/api/notes',
    zValidator('form', ExtensionNoteCreateSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: formatExtensionAttachError(result.error) }, 400)
      }
      return undefined
    }),
    async (c) => {
      const input = c.req.valid('form')
      const target = await resolveOrIngestCapture(c, input)
      if (!target.ok) return target.response
      try {
        // Born on the Mention-capable document schema (#389): body_doc is the
        // stored document and the plain body column is derived from it by
        // createNote, never written directly.
        const note = noteRepo.createNote({
          caseId: input.caseId,
          captureId: target.captureId,
          title: input.noteTitle,
          bodyDoc: JSON.stringify(plainTextToNoteDoc(input.noteText)),
          sourceUrl: input.url
        })
        emitExtensionAttach({ kind: 'note', caseId: input.caseId, captureId: target.captureId })
        return c.json({
          status: 'ok',
          captureId: target.captureId,
          captured: target.captured,
          screenshotStatus: target.screenshotStatus,
          screenshotWarning: target.screenshotWarning,
          note
        } satisfies ExtensionNoteCreateResult)
      } catch (err) {
        logger.error('captureServer', 'captureServer.note_create_failed', undefined, err)
        return c.json(
          {
            error: 'Failed to create note',
            captureId: target.captureId,
            captured: target.captured
          },
          500
        )
      }
    }
  )

  // Test pipeline endpoint
  app.post(CAPTURE_TEST_ROUTE, async (c) => {
    const startTime = Date.now()
    let sandbox: PipelineSelfTestSandbox | null = null
    try {
      const operatorName = getSettings().operatorName?.trim() ?? ''
      if (!operatorName) {
        emitCaptureEvent({
          type: 'failed',
          source: 'manual',
          url: PIPELINE_SELF_TEST_URL,
          timestamp: new Date().toISOString(),
          error: 'Operator name required'
        })
        return c.json({ error: OPERATOR_NAME_REQUIRED_MSG }, 400)
      }
      const testBody = Buffer.from('<html><body>test</body></html>')
      const { Readable } = await import('stream')
      const stream = Readable.from([testBody])

      emitCaptureEvent({
        type: 'received',
        source: 'manual',
        url: PIPELINE_SELF_TEST_URL,
        timestamp: new Date().toISOString()
      })

      // Where this route writes, and why (#614): into a sandbox — a temp
      // storage root carrying its own manifest, plus a case row created for
      // this request — and never into an investigation. It used to ingest into
      // `listCases()[0]`, so a diagnostic left two signed entries and the
      // retained sentinel URL in an append-only chain the operator never chose.
      // Nothing about the diagnostic needs a real case: it acquires nothing, so
      // the only case that can hold it is one that holds nothing else. The
      // sandbox's `dispose` runs from the `finally` below on every path the
      // process survives, including the throw, and attempts both halves
      // whatever the other did.
      //
      // It is also the one producer the per-case exclusion list is deliberately
      // not applied to (#400, #766). Every acquisition route is checked — the
      // extension/manual route above, and both recapture enforcement points —
      // but this one acquires nothing: the URL is the fixed sentinel and the
      // body is a literal, so no page content and no operator-supplied URL
      // enters any case. What a check would buy is the ability for a broad
      // pattern like `/./` to break the operator's only proof that the capture
      // pipeline works, which is the worse failure for a diagnostic. The
      // residue that argument used to weigh against — signed entries in an
      // investigation's chain — is gone; what a failed teardown can leave is
      // the sandbox itself.
      //
      // The ingest itself is the production one, storage root apart: a
      // regression in it still fails the diagnostic.
      sandbox = createPipelineSelfTestSandbox()
      const { capture } = await ingestMhtmlCapture(
        {
          caseId: sandbox.caseId,
          url: PIPELINE_SELF_TEST_URL,
          title: 'Pipeline Test',
          timestamp: new Date().toISOString(),
          stream: stream as unknown as ReadableStream<Uint8Array>,
          textContent: '',
          headers: {},
          browserVersion: '',
          userAgent: '',
          // The self-test synthesizes its bytes for a birdbrain:// URL — no
          // HTTP transaction happens, so there is no status to record and none
          // is anchored (R7, #797).
          httpStatus: 0,
          extensionVersion: '',
          operatorId: getInstallationId(),
          operatorName,
          toolVersion: resolveToolVersion()
        },
        undefined,
        sandbox.store
      )

      const durationMs = Date.now() - startTime
      emitCaptureEvent({
        type: 'stored',
        captureId: capture.id,
        source: 'manual',
        url: PIPELINE_SELF_TEST_URL,
        timestamp: new Date().toISOString(),
        durationMs
      })
      return c.json({ success: true, durationMs })
    } catch (err) {
      return c.json({ success: false, durationMs: Date.now() - startTime, error: String(err) })
    } finally {
      sandbox?.dispose()
    }
  })

  return app
}

/**
 * The port this process's capture server is listening on, or null when it is
 * not running. Callers that need to reach our own server must resolve the port
 * through this rather than through CAPTURE_SERVER_PORT — the constant says
 * where we would like to listen, not whether we are, nor whose process answers
 * there (#462).
 */
export function getCaptureServerPort(): number | null {
  return server ? listeningPort : null
}

/**
 * Rejection of `startCaptureServer` when the listener never bound — in practice
 * `EADDRINUSE` on 127.0.0.1:19845, held by a second copy of Birdbrain or by the
 * exploratory harness running against a throwaway profile. Caught by name in
 * src/main/index.ts so boot can name the port instead of falling through to the
 * generic startup dialog (#513).
 */
export class CaptureServerBindError extends Error {
  readonly port: number
  readonly code: string | undefined

  constructor(port: number, cause: NodeJS.ErrnoException) {
    super(`Capture server could not bind to 127.0.0.1:${port}: ${cause.message}`, { cause })
    this.name = 'CaptureServerBindError'
    this.port = port
    this.code = cause.code
  }
}

export function startCaptureServer(
  deps: CaptureServerDeps,
  port: number = CAPTURE_SERVER_PORT
): Promise<void> {
  if (deps.sessionService) sessionService = deps.sessionService
  return new Promise((resolve, reject) => {
    const app = createApp(deps)
    const instance = serve(
      {
        fetch: app.fetch,
        port,
        hostname: '127.0.0.1'
      },
      (info) => {
        // Published only once the bind succeeded, so a failed listen leaves
        // getCaptureServerPort() and stopCaptureServer() looking at nothing
        // rather than at a socket that was never opened. The corollary for a
        // future caller: stopCaptureServer() during an in-flight start sees
        // null and resolves at once, leaving this line to publish a listener
        // that stop no longer knows about. Boot's single call site awaits the
        // start before anything can quit, so nothing hits that today.
        server = instance
        // Read the bound port back rather than echoing the request, so a
        // caller that asked for port 0 gets the ephemeral port it actually got.
        listeningPort = info.port
        resolve()
      }
    ) as unknown as Server
    // Without this listener a failed bind surfaces as an unhandled 'error'
    // event and takes the process down mid-boot, so the operator sees a crash
    // rather than a startup failure the app can explain (#513). It stays
    // installed after the bind, where the promise has already settled and the
    // reject is a no-op: a running server's later error is logged and its
    // socket left alone, since clearing the module state would strand a
    // listener stopCaptureServer could no longer close.
    instance.on('error', (err: NodeJS.ErrnoException) => {
      logger.error('captureServer', 'captureServer.listen_failed', { port }, err)
      reject(new CaptureServerBindError(port, err))
    })
  })
}

export function stopCaptureServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.closeAllConnections()
      server.close(() => {
        server = null
        listeningPort = null
        resolve()
      })
    } else {
      listeningPort = null
      resolve()
    }
  })
}

export function startExtensionConnectionCheck(): void {
  sessionService.startHeartbeatMonitor()
}

export function stopExtensionConnectionCheck(): void {
  sessionService.stopHeartbeatMonitor()
}
