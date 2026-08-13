// The capture-UI suppression protocol (#386) — one suppress/restore boundary so
// no Birdbrain chrome can appear in an evidence image or archived DOM.
//
// Two halves of the same protocol live here because they are one contract:
//
//   Page side    — a teardown registry every piece of injected in-page UI signs
//                  up with, so a single call strips all of it before a frame is
//                  taken. New in-page UI registers here instead of adding
//                  another removal call to the capture paths.
//   Orchestration — createCaptureSuppression(), the bracket the background wraps
//                  every capture in: suppress before frames, hold suppression
//                  for as long as any capture on the tab is collecting frames,
//                  restore afterwards on the failure path too.
//
// The orchestration half touches no chrome or DOM API — the effects are injected
// — so bracketing order and restore-on-failure are testable without a browser.

type CaptureUiTeardown = () => void

const teardowns = new Set<CaptureUiTeardown>()

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
   * that one may put UI back on the page.
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
    const endCollection = (): number => {
      collecting = false
      return leave(tabId)
    }

    try {
      await effects.suppress(tabId)
      return await body({
        collectFrames: async (collect) => {
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
