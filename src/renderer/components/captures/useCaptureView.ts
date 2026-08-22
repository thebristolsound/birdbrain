import { useCallback, useState } from 'react'

export const CAPTURE_VIEW_STORAGE_KEY = 'captureView'

export const CAPTURE_LIST_COLLAPSED_STORAGE_KEY = 'captureListCollapsed'

export const CAPTURE_VIEWS = ['detailed', 'list'] as const

export type CaptureView = (typeof CAPTURE_VIEWS)[number]

export const DEFAULT_CAPTURE_VIEW: CaptureView = 'detailed'

function isCaptureView(value: unknown): value is CaptureView {
  return CAPTURE_VIEWS.includes(value as CaptureView)
}

// localStorage rather than the settings file, following useDensity.ts: this is
// per-machine view chrome, and `schemas.ts` belongs to another change this wave.
export function readStoredCaptureView(): CaptureView {
  const stored = localStorage.getItem(CAPTURE_VIEW_STORAGE_KEY)
  return isCaptureView(stored) ? stored : DEFAULT_CAPTURE_VIEW
}

export function readStoredListCollapsed(): boolean {
  return localStorage.getItem(CAPTURE_LIST_COLLAPSED_STORAGE_KEY) === 'true'
}

/** Which of the two designed row treatments the capture list draws. */
export function useCaptureView() {
  const [view, setViewState] = useState<CaptureView>(readStoredCaptureView)

  const setView = useCallback((next: CaptureView) => {
    setViewState(next)
    localStorage.setItem(CAPTURE_VIEW_STORAGE_KEY, next)
  }, [])

  return { view, setView } as const
}

/** Whether the capture list is collapsed to its rail, remembered per machine. */
export function useCaptureListCollapsed() {
  const [collapsed, setCollapsedState] = useState<boolean>(readStoredListCollapsed)

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next)
    localStorage.setItem(CAPTURE_LIST_COLLAPSED_STORAGE_KEY, String(next))
  }, [])

  return { collapsed, setCollapsed } as const
}
