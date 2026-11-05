import { randomUUID } from 'crypto'
import type {
  KnownEgress,
  LaunchedBrowserTab,
  LaunchedCaptureProgress,
  LaunchedTabRefusal
} from '@shared/types'
import type {
  AdmissionOutcome,
  AdmissionRefusal,
  LaunchedAdmissionRequest
} from '@main/services/captureLifecycle'
import { captureEgressOf } from '@main/services/egress'
import type { Logger } from '@main/services/logger'
import type { CdpClient, CdpSession } from '@main/services/launchedBrowser/cdpClient'
import type { TargetInfo } from '@main/services/launchedBrowser/commands'
import type { BrowserIdentity } from '@main/services/launchedBrowser/identify'
import type { FirstTab, RecordedSession } from '@main/services/launchedBrowser/launcher'
import {
  CaptureAbandoned,
  captureTab,
  TabNotInFront,
  type TabCaptureArtifacts,
  type TabCaptureInput
} from '@main/services/launchedBrowser/captureTab'
import {
  createTabRecording,
  TAB_RECORDING_BUDGET,
  type TabRecording
} from '@main/services/launchedBrowser/tabRecording'
import type { TabFocusState } from '@main/services/launchedBrowser/tabPicking'

// Clicked Captures in one launched browser (#1832): a recording per tab from the moment it
// attaches, the flags the panel shows for each tab, and the Capture itself, which goes through
// the Capture Lifecycle's launched route. One Capture runs at a time.

// What the engine needs of the Capture Lifecycle.
export interface LaunchedCaptureSink {
  screenLaunched: (caseId: string, url: string) => AdmissionRefusal | null
  admit: (request: LaunchedAdmissionRequest) => Promise<AdmissionOutcome>
  // The activity feed's event for a Capture the engine abandoned.
  abandonedLaunched: (url: string) => void
}

export interface LaunchedCapturesDeps {
  sink: LaunchedCaptureSink
  // The Capture Session's Active Case at the moment of the trigger.
  activeCaseId: () => string | null
  birdbrainVersion: string
  // How the panel writes the stored Capture's Exhibit Number.
  citationOf: (captureId: string, exhibitNumber: number | undefined) => string
  onChange: () => void
  log: Pick<Logger, 'warn'>
  // The known-answer suite and the unit tests pass their own.
  capture?: (input: TabCaptureInput) => Promise<TabCaptureArtifacts>
  timings?: TabCaptureInput['timings']
}

interface TabState {
  // Null for a tab the engine does not record: one outside the default browser context, one whose
  // context the browser did not name, and every tab when it did not name the first tab's.
  recording: TabRecording | null
  session: CdpSession
  browserContextId: string | undefined
  openerId: string | undefined
}

export interface CaptureRequest {
  scrollToLoad: boolean
}

export interface LaunchedCaptures {
  // The Egress the browser launched with, fixed for its life, once its proxy check passed.
  setEgress: (egress: KnownEgress) => void
  // The launcher's hook for each recorded session, composed with the Egress guard's.
  onRecordedSession: (session: CdpSession, target: TargetInfo, recorded: RecordedSession) => void
  // Once the launch has resolved: the browser's identity, its connection and its first tab.
  attach: (client: CdpClient, identity: BrowserIdentity, firstTab: FirstTab) => void
  // The panel's tab list, with each tab's flags.
  decorate: (tabs: readonly LaunchedBrowserTab[]) => LaunchedBrowserTab[]
  progress: () => LaunchedCaptureProgress | undefined
  capture: (targetId: string, request: CaptureRequest) => Promise<LaunchedCaptureProgress>
  // Visibility and focus of each tab that could be captured, for the shortcut.
  focusStates: () => Promise<TabFocusState[]>
  dispose: () => void
}

const TRANSPORT =
  'Birdbrain launched this browser and recorded it over the Chrome DevTools Protocol on ' +
  '--remote-debugging-pipe.'
const HTTP_CACHE =
  "The browser's HTTP cache was disabled with Network.setCacheDisabled on every recorded target " +
  'for the whole Capture Session, so no response came from an earlier visit.'
const REQUEST_BODIES =
  'Request bodies are not recorded (ADR-0051). A request record holds no body, even where its ' +
  'headers declare one; the inventory counts the withheld bodies.'

const REFUSAL_MESSAGES: Readonly<Record<LaunchedTabRefusal, string>> = {
  private: 'This tab is in a private window, which Birdbrain never captures.',
  'not-http': 'Birdbrain captures http and https pages only.',
  crashed: 'This tab crashed. Reload it in the browser, then capture.'
}

function isHttp(url: string | undefined): boolean {
  return url !== undefined && /^https?:\/\//i.test(url)
}

function refusalMessage(refusal: AdmissionRefusal): string {
  switch (refusal.kind) {
    case 'excluded':
      return `This Case excludes the page (${refusal.pattern}), so nothing was captured.`
    case 'operator_name_required':
      return 'Operator name required. Configure your name in Birdbrain settings.'
    case 'case_not_found':
    case 'missing_case_id':
      return 'The Active Case no longer exists.'
    case 'case_archived':
      return 'The Active Case is archived.'
    case 'failed':
      return `The Capture could not be stored: ${String(refusal.error)}`
    default:
      return 'The Capture was refused.'
  }
}

export function createLaunchedCaptures(deps: LaunchedCapturesDeps): LaunchedCaptures {
  const { sink, onChange, log, capture: take = captureTab } = deps
  const tabs = new Map<string, TabState>()
  let client: CdpClient | null = null
  let identity: BrowserIdentity | null = null
  let launchedEgress: KnownEgress | null = null
  let defaultContextId: string | undefined
  let firstTabSeen = false
  // Pages attached before the first tab, held unrecorded until the default context is known. The
  // launcher holds them paused until its checks pass, so they have loaded nothing yet.
  const unclassified: Array<{ session: CdpSession; target: TargetInfo; setup: Promise<unknown> }> =
    []
  let progress: LaunchedCaptureProgress | undefined
  let running = false
  const unsubscribes: Array<() => void> = []

  function setProgress(next: LaunchedCaptureProgress): LaunchedCaptureProgress {
    progress = next
    onChange()
    return next
  }

  // Spec, "Tabs, windows, and browser contexts": a tab in another context is never recorded.
  function addTab(session: CdpSession, target: TargetInfo, setup: Promise<unknown>): void {
    const { targetId, browserContextId, openerId } = target
    const inDefault =
      firstTabSeen && defaultContextId !== undefined && browserContextId === defaultContextId
    const recording = inDefault ? createTabRecording({ tabId: targetId, onChange }) : null
    tabs.set(targetId, { recording, session, browserContextId, openerId })
    recording?.addSession(session, 'page', setup)
  }

  function onRecordedSession(
    session: CdpSession,
    target: TargetInfo,
    { tabId, setup, firstTab }: RecordedSession
  ): void {
    if (target.type === 'page' && target.targetId === tabId) {
      if (firstTab) {
        firstTabSeen = true
        defaultContextId = target.browserContextId
        addTab(session, target, setup)
        for (const held of unclassified.splice(0)) addTab(held.session, held.target, held.setup)
        return
      }
      if (!firstTabSeen) unclassified.push({ session, target, setup })
      addTab(session, target, setup)
      return
    }
    tabs.get(tabId)?.recording?.addSession(session, target.type, setup)
  }

  function refusalOf(targetId: string): LaunchedTabRefusal | undefined {
    const tab = tabs.get(targetId)
    if (!tab) return undefined
    if (!tab.recording) return 'private'
    if (tab.recording.isCrashed()) return 'crashed'
    if (!isHttp(tab.recording.committedUrl())) return 'not-http'
    return undefined
  }

  function decorate(list: readonly LaunchedBrowserTab[]): LaunchedBrowserTab[] {
    return list.map((tab) => {
      const state = tabs.get(tab.targetId)
      if (!state) return tab
      const refusal = refusalOf(tab.targetId)
      return {
        ...tab,
        firstRequest: state.recording?.fromFirstRequest() ?? false,
        ...(refusal ? { refusal } : {})
      }
    })
  }

  async function captureOne(
    targetId: string,
    { scrollToLoad }: CaptureRequest
  ): Promise<LaunchedCaptureProgress> {
    const tab = tabs.get(targetId)
    if (!tab || !client || !identity || !launchedEgress) {
      return setProgress({ state: 'refused', targetId, message: 'That tab has closed.' })
    }
    if (running) {
      return setProgress({
        state: 'refused',
        targetId,
        message: 'A Capture is already running. Wait for it to finish.'
      })
    }
    const refusal = refusalOf(targetId)
    if (refusal || !tab.recording)
      return setProgress({
        state: 'refused',
        targetId,
        message: REFUSAL_MESSAGES[refusal ?? 'private']
      })
    const caseId = deps.activeCaseId()
    if (!caseId) {
      return setProgress({ state: 'refused', targetId, message: 'No Active Case.' })
    }
    const url = tab.recording.pageUrl() ?? ''
    const screened = sink.screenLaunched(caseId, url)
    if (screened) {
      return setProgress({ state: 'refused', targetId, message: refusalMessage(screened) })
    }

    running = true
    const { recording, session } = tab
    const { product, version, family, userAgent } = identity
    const captureId = randomUUID()
    try {
      setProgress({ state: 'capturing', targetId, title: url })
      const artifacts = await take({
        session,
        recording,
        tabId: targetId,
        scrollToLoad,
        captureId,
        recordingBudget: TAB_RECORDING_BUDGET,
        timings: deps.timings,
        writer: {
          birdbrainVersion: deps.birdbrainVersion,
          browserVersion: `${product}/${version}`,
          userAgent,
          egress: launchedEgress.kind,
          warcinfo: {
            transport: TRANSPORT,
            'http-cache': HTTP_CACHE,
            'request-bodies': REQUEST_BODIES,
            'browser-family': family,
            'tab-target-id': targetId,
            ...(tab.openerId ? { 'tab-opener-target-id': tab.openerId } : {})
          }
        }
      })
      for (const error of artifacts.errors) {
        log.warn('launchedBrowser', 'launchedBrowser.capture_part_failed', undefined, error)
      }
      const egress = captureEgressOf(launchedEgress)
      const outcome = await sink.admit({
        route: 'launched',
        caseId,
        url: artifacts.url,
        title: artifacts.title,
        timestamp: artifacts.capturedAt,
        captureId,
        mhtml: artifacts.mhtml,
        screenshot: artifacts.screenshot,
        textContent: artifacts.text,
        httpStatus: artifacts.httpStatus,
        userAgent,
        browser: { product, version, family },
        ...(egress ? { egress } : {}),
        inventory: artifacts.inventory,
        ...(artifacts.scrollToLoad ? { scrollToLoad: artifacts.scrollToLoad } : {}),
        ...(artifacts.transactionRecord ? { transactionRecord: artifacts.transactionRecord } : {}),
        ...(artifacts.boundTls ? { boundTls: artifacts.boundTls } : {}),
        ...(artifacts.boundTlsAbsent ? { boundTlsAbsent: artifacts.boundTlsAbsent } : {}),
        ...(artifacts.pdf ? { pdf: artifacts.pdf } : {})
      })
      if (!outcome.ok) {
        return setProgress({ state: 'refused', targetId, message: refusalMessage(outcome.refusal) })
      }
      const { capture } = outcome
      return setProgress({
        state: 'captured',
        targetId,
        captureId: capture.id,
        citation: deps.citationOf(capture.id, capture.exhibitNumber)
      })
    } catch (error) {
      if (error instanceof CaptureAbandoned) {
        sink.abandonedLaunched(url)
        return setProgress({ state: 'abandoned', targetId })
      }
      if (error instanceof TabNotInFront) {
        return setProgress({ state: 'refused', targetId, message: error.message })
      }
      log.warn('launchedBrowser', 'launchedBrowser.capture_failed', undefined, error)
      const message = error instanceof Error ? error.message : String(error)
      return setProgress({ state: 'failed', targetId, message })
    } finally {
      running = false
    }
  }

  async function focusOf(targetId: string, { session }: TabState): Promise<TabFocusState> {
    try {
      const { executionContextId } = await session.send('Page.createIsolatedWorld', {
        frameId: targetId,
        worldName: 'birdbrain-shortcut'
      })
      const { result } = await session.send('Runtime.evaluate', {
        expression:
          '({ visible: document.visibilityState === "visible", focused: document.hasFocus() })',
        contextId: executionContextId,
        returnByValue: true
      })
      const value = (result.value ?? {}) as { visible?: unknown; focused?: unknown }
      return { targetId, visible: value.visible === true, focused: value.focused === true }
    } catch {
      return { targetId, visible: false, focused: false }
    }
  }

  return {
    setEgress: (egress) => {
      launchedEgress = egress
    },
    onRecordedSession,
    // The default context comes from the first tab's session, before the launch resolves.
    attach: (connected, browserIdentity) => {
      client = connected
      identity = browserIdentity
      unsubscribes.push(
        connected.on('Target.targetCrashed', ({ targetId }) =>
          tabs.get(targetId)?.recording?.crashed()
        ),
        connected.on('Target.targetDestroyed', ({ targetId }) => {
          const tab = tabs.get(targetId)
          if (!tab) return
          tab.recording?.discard()
          tabs.delete(targetId)
        })
      )
      onChange()
    },
    decorate,
    progress: () => progress,
    capture: captureOne,
    focusStates: async () => {
      const candidates = [...tabs.entries()].filter(([targetId]) => !refusalOf(targetId))
      return Promise.all(candidates.map(([targetId, tab]) => focusOf(targetId, tab)))
    },
    dispose: () => {
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe()
      for (const { recording } of tabs.values()) recording?.discard()
      tabs.clear()
    }
  }
}
