import { useEffect, useRef, useState } from 'react'
import type { Capture } from '@shared/types'
import {
  testPatternAgainstText,
  type MatchResult
} from '@renderer/components/selectors/selectorUtils'

// The Foreground Match Preview (see CONTEXT.md): matches computed in the
// renderer against capture text, in-memory. It never touches Persisted
// Matches and does not go through the Selector Lifecycle.

export interface ForegroundMatchPreview {
  captureTitle: string
  captureUrl: string
  matches: MatchResult[]
}

type PreviewCandidate = Pick<Capture, 'id' | 'title' | 'url'>

export interface PreviewMatchesParams {
  caseId: string
  pattern: string
  isRegex: boolean
  /** How many candidate captures to test. */
  maxCaptures: number
  /** How many matches to keep per capture. */
  maxMatchesPerCapture: number
  /** When set, only captures with Persisted Matches for this selector are candidates. */
  selectorId?: string
}

export interface PreviewMatchesDeps {
  listCaptures: (caseId: string) => Promise<PreviewCandidate[]>
  getCaptureText: (captureId: string) => Promise<string | null>
  listMatchingCaptureIds: (caseId: string, selectorIds: string[]) => Promise<string[]>
}

// Built per call: window.birdbrain only exists in the renderer, and tests
// inject their own deps.
function birdbrainDeps(): PreviewMatchesDeps {
  const { captures, selectors } = window.birdbrain
  return {
    listCaptures: (caseId) => captures.list(caseId),
    getCaptureText: (captureId) => captures.getContent(captureId, 'txt'),
    listMatchingCaptureIds: (caseId, selectorIds) => selectors.matchingCaptures(caseId, selectorIds)
  }
}

export async function previewForegroundMatches(
  params: PreviewMatchesParams,
  deps: PreviewMatchesDeps = birdbrainDeps()
): Promise<ForegroundMatchPreview[]> {
  const { caseId, pattern, isRegex, maxCaptures, maxMatchesPerCapture, selectorId } = params

  let candidates = await deps.listCaptures(caseId)
  if (selectorId) {
    const matchingIds = new Set(await deps.listMatchingCaptureIds(caseId, [selectorId]))
    candidates = candidates.filter((c) => matchingIds.has(c.id))
  }

  const results: ForegroundMatchPreview[] = []
  for (const capture of candidates.slice(0, maxCaptures)) {
    try {
      const text = await deps.getCaptureText(capture.id)
      if (!text) continue
      const matches = testPatternAgainstText(pattern, isRegex, text, maxMatchesPerCapture)
      if (matches.length > 0) {
        results.push({
          captureTitle: capture.title || capture.url,
          captureUrl: capture.url,
          matches
        })
      }
    } catch {
      // A capture whose text fails to load is skipped, not fatal to the preview.
    }
  }
  return results
}

export interface UseForegroundMatchPreviewOptions {
  maxCaptures: number
  maxMatchesPerCapture: number
}

export function useForegroundMatchPreview(
  caseId: string,
  { maxCaptures, maxMatchesPerCapture }: UseForegroundMatchPreviewOptions
) {
  const [previews, setPreviews] = useState<ForegroundMatchPreview[] | null>(null)
  const [loading, setLoading] = useState(false)
  // Monotonic run id: a run only commits state if it is still the latest, so
  // interleaved runs, reset() mid-flight, and unmount all discard stale results
  // (the codebase's `cancelled` flag pattern, adapted to an event-driven hook).
  const runIdRef = useRef(0)

  useEffect(() => {
    return () => {
      runIdRef.current++
    }
  }, [])

  async function run(pattern: string, isRegex: boolean, selectorId?: string) {
    const runId = ++runIdRef.current
    setLoading(true)
    try {
      const results = await previewForegroundMatches({
        caseId,
        pattern,
        isRegex,
        maxCaptures,
        maxMatchesPerCapture,
        selectorId
      })
      if (runId !== runIdRef.current) return
      setPreviews(results)
    } catch (err) {
      if (runId !== runIdRef.current) return
      console.error('Failed to compute foreground match preview:', err)
      // null = "no preview available" — consumers may retry on the next trigger.
      setPreviews(null)
    } finally {
      if (runId === runIdRef.current) setLoading(false)
    }
  }

  function reset() {
    runIdRef.current++
    setPreviews(null)
    setLoading(false)
  }

  return { previews, loading, run, reset }
}
