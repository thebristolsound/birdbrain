// The capture-UI suppression protocol (#386) — one suppress/restore boundary so
// no Birdbrain chrome can appear in an evidence image or archived DOM.
//
// Two halves of the same protocol live here because they are one contract:
//
//   Page side    — a teardown registry every piece of injected in-page UI signs
//                  up with, so a single call strips all of it before a frame is
//                  taken. New in-page UI registers here instead of adding
//                  another removal call to the capture paths — and must also be
//                  added to removeInjectedBirdbrainUi() in captureHygiene.ts,
//                  which is the background's fallback strip for a tab whose
//                  content script is orphaned or cannot clear itself. That
//                  function is serialised into the page by executeScript, so it
//                  cannot reach this registry; the two are separate on purpose
//                  and have to be kept in step by hand.
//                  The strip is paired with a latch (#393): suppressCaptureUi()
//                  raises it, and it stays up until the background's restore
//                  effect sends RELEASE_CAPTURE_UI once no capture on the tab
//                  is collecting frames. The registry alone only removes what
//                  is injected at the instant of the strip; UI raised by a page
//                  gesture (the selection bar's mouseup) would otherwise
//                  re-inject itself between the strip and the frames. Such UI
//                  consults isCaptureUiSuppressed() before every injection. The
//                  latch has no timeout on purpose: a release that never
//                  arrives fails closed — no bar until reload — rather than
//                  reopening #386 mid-capture.
//   Orchestration — createCaptureSuppression(), the bracket the background wraps
//                  every capture in: suppress before frames, hold suppression
//                  for as long as any capture on the tab is collecting frames,
//                  restore afterwards on the failure path too.
//
// The orchestration half touches no chrome or DOM API — the effects are injected
// — so bracketing order and restore-on-failure are testable without a browser.

type CaptureUiTeardown = () => void

const teardowns = new Set<CaptureUiTeardown>()

// The page-side latch (#393). True from the first strip of a capture bracket
// until the background's release message; while true, nothing may inject UI.
let uiSuppressionInForce = false
const releaseListeners = new Set<() => void>()

/** Whether a capture bracket is open on this page — injection must wait. */
export function isCaptureUiSuppressed(): boolean {
  return uiSuppressionInForce
}

/**
 * Clears the latch and tells subscribers the page may carry UI again. Called
 * from the RELEASE_CAPTURE_UI handler; the background sends that message from
 * its restore effect only once no capture on the tab is collecting frames.
 */
export function releaseCaptureUiSuppression(): void {
  if (!uiSuppressionInForce) return
  uiSuppressionInForce = false
  for (const listener of releaseListeners) {
    try {
      listener()
    } catch (err) {
      // One subscriber that throws must not keep the rest suppressed.
      console.warn('[Birdbrain] Suppression release listener failed:', err)
    }
  }
}

/** Subscribe to the latch clearing. Returns the unsubscribe function. */
export function onCaptureUiSuppressionReleased(listener: () => void): () => void {
  releaseListeners.add(listener)
  return () => {
    releaseListeners.delete(listener)
  }
}

/**
 * Registers in-page UI to be torn down before any capture frame is taken.
 * Returns the unregister function.
 */
export function registerCaptureUiTeardown(teardown: CaptureUiTeardown): () => void {
  teardowns.add(teardown)
  return () => {
    teardowns.delete(teardown)
  }
}

/**
 * Tears down every registered piece of in-page UI, in registration order, and
 * returns whatever any of them threw. Every teardown runs even after one throws:
 * one widget that cannot remove itself must not leave the rest of the
 * extension's UI in the frame. A non-empty result means the page could not be
 * proven clean, and the caller must not treat suppression as successful.
 */
export function suppressCaptureUi(): unknown[] {
  // Latch before stripping: a gesture handler that fires between the strip and
  // the frames must already see the page as suppressed.
  uiSuppressionInForce = true
  const failures: unknown[] = []
  for (const teardown of teardowns) {
    try {
      teardown()
    } catch (err) {
      failures.push(err)
    }
  }
  return failures
}

export class CaptureUiSuppressionError extends Error {
  constructor(failures: unknown[]) {
    super(`Injected Birdbrain UI could not be removed: ${failures.map(String).join('; ')}`)
    this.name = 'CaptureUiSuppressionError'
  }
}

/**
 * Suppression as a capture path must use it: a page that cannot be proven clean
 * aborts the frame rather than producing an image of unknown provenance.
 */
export function suppressCaptureUiOrThrow(): void {
  const failures = suppressCaptureUi()
  if (failures.length > 0) throw new CaptureUiSuppressionError(failures)
}

export interface CaptureSuppressionEffects {
  /** Strips every injected Birdbrain node from the tab. Rejecting aborts the capture. */
  suppress: (tabId: number) => Promise<void>
  /** Re-injects what the operator should see once the capture is over. */
  restore: (tabId: number) => Promise<void>
}

export interface FrameCollector {
  /**
   * Runs the frame-collecting step inside the suppression window and reports
   * whether this capture was the last one collecting frames on the tab — only
   * that one may put UI back on the page. Callable once per capture; a second
   * call throws rather than releasing another capture's slot.
   */
  collectFrames: <T>(collect: () => Promise<T>) => Promise<{ frames: T; lastOnTab: boolean }>
}

export interface CaptureSuppression {
  /** True while any capture on the tab is collecting frames — nothing may inject UI. */
  isCollectingFrames: (tabId: number) => boolean
  /**
   * Brackets one capture: suppression is in force from before `suppress` until
   * the body's frame collection ends, and `restore` runs exactly once when the
   * body settles, however it settles.
   */
  withSuppression: <T>(tabId: number, body: (collector: FrameCollector) => Promise<T>) => Promise<T>
}

export function createCaptureSuppression(effects: CaptureSuppressionEffects): CaptureSuppression {
  // Count of captures currently collecting frames, per tab. Per tab rather than
  // global: a capture on one tab must not suppress another tab's UI.
  const collectingByTab = new Map<number, number>()

  function isCollectingFrames(tabId: number): boolean {
    return (collectingByTab.get(tabId) ?? 0) > 0
  }

  function enter(tabId: number): void {
    collectingByTab.set(tabId, (collectingByTab.get(tabId) ?? 0) + 1)
  }

  function leave(tabId: number): number {
    const remaining = (collectingByTab.get(tabId) ?? 1) - 1
    if (remaining > 0) collectingByTab.set(tabId, remaining)
    else collectingByTab.delete(tabId)
    return remaining
  }

  async function withSuppression<T>(
    tabId: number,
    body: (collector: FrameCollector) => Promise<T>
  ): Promise<T> {
    enter(tabId)
    let collecting = true
    let collectStarted = false
    const endCollection = (): number => {
      collecting = false
      return leave(tabId)
    }

    try {
      await effects.suppress(tabId)
      return await body({
        collectFrames: async (collect) => {
          // One capture holds one slot, so only one collectFrames call may
          // release it. A second release would drop a concurrent capture's
          // slot, reporting the tab idle while that capture is still mid-frame
          // — the one state this protocol exists to prevent. Fail loudly rather
          // than hand back a stale lastOnTab.
          if (collectStarted) throw new Error('collectFrames called twice for one capture')
          collectStarted = true
          const frames = await collect()
          return { frames, lastOnTab: endCollection() === 0 }
        }
      })
    } finally {
      // A body that threw before or during frame collection still holds the
      // slot; releasing here is what keeps a failed capture from suppressing
      // the tab's UI forever.
      if (collecting) endCollection()
      try {
        await effects.restore(tabId)
      } catch (restoreErr) {
        // Restore is best-effort cleanup: surfacing its failure in place of the
        // capture's own error would hide why the capture failed.
        console.warn('[Birdbrain] Capture UI restore failed:', restoreErr)
      }
    }
  }

  return { isCollectingFrames, withSuppression }
}
