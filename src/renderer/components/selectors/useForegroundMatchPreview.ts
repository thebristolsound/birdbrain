import { useState } from 'react'
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
    const matchingIds = await deps.listMatchingCaptureIds(caseId, [selectorId])
    candidates = candidates.filter((c) => matchingIds.includes(c.id))
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

  async function run(pattern: string, isRegex: boolean, selectorId?: string) {
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
      setPreviews(results)
    } catch (err) {
      console.error('Failed to compute foreground match preview:', err)
      // null = "no preview available" — consumers may retry on the next trigger.
      setPreviews(null)
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setPreviews(null)
  }

  return { previews, loading, run, reset }
}
