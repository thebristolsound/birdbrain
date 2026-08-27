import * as captureRepo from '@main/services/db/captureRepo'
import * as selectorRepo from '@main/services/db/selectorRepo'
import { defaultCaptureStore } from '@main/services/captureStore'
import type { Selector } from '@shared/types'
import type {
  CreateSelectorParams,
  BulkCreateSelectorsParams,
  UpdateSelectorParams,
  SelectorRematchedEvent,
  SelectorRematchedStatus
} from '@shared/ipc'
import { logger } from '@main/services/logger'
// Lives in @shared because the note editor states the bound in operator-facing
// copy (#391); tests read it from there too rather than hardcoding 500.
import { RETRO_MAX_CAPTURES } from '@shared/constants'

const RETRO_CHUNK_SIZE = 50

export interface SelectorLifecycleDeps {
  emitRematched: (event: SelectorRematchedEvent) => void
}

export interface SelectorLifecycle {
  createSelector: (params: CreateSelectorParams) => Selector
  bulkCreateSelectors: (params: BulkCreateSelectorsParams) => Selector[]
  updateSelector: (params: UpdateSelectorParams) => Selector | undefined
  rescanSelector: (id: string) => boolean
  runActiveSelectorsForCapture: (captureId: string, caseId: string, textContent: string) => void
}

export function createSelectorLifecycle(deps: SelectorLifecycleDeps): SelectorLifecycle {
  function loadCaptureText(caseId: string, captureId: string): string | null {
    const buffer = defaultCaptureStore.readArtifact(caseId, captureId, 'txt')
    if (buffer) return buffer.toString('utf-8')
    return captureRepo.getCaptureTextContent(captureId)
  }

  function scheduleRetroactiveMatch(
    selectors: Selector[],
    caseId: string,
    options?: { unbounded?: boolean }
  ): void {
    if (selectors.length === 0) return
    const allCaptures = captureRepo.listCaptures(caseId)
    // create / bulk-create cap recent captures to keep the first pass snappy on
    // high-volume cases. updateSelector with changed semantics passes
    // unbounded:true because leaving stale matches under the old pattern would
    // be silently wrong for older captures.
    const captures = options?.unbounded ? allCaptures : allCaptures.slice(0, RETRO_MAX_CAPTURES)
    const selectorIds = selectors.map((s) => s.id)

    const emit = (status: SelectorRematchedStatus): void => {
      deps.emitRematched({ selectorIds, caseId, status })
    }

    if (captures.length === 0) {
      setImmediate(() => emit('done'))
      return
    }

    const processChunk = (index: number): void => {
      try {
        const end = Math.min(index + RETRO_CHUNK_SIZE, captures.length)
        const captureTexts: Array<{ captureId: string; text: string }> = []
        for (let i = index; i < end; i++) {
          const cap = captures[i]
          const text = loadCaptureText(caseId, cap.id)
          if (text) captureTexts.push({ captureId: cap.id, text })
        }

        if (captureTexts.length > 0) {
          for (const sel of selectors) {
            selectorRepo.matchSelectorAgainstCaptures(sel.id, captureTexts)
          }
        }

        if (end < captures.length) {
          setImmediate(() => processChunk(end))
        } else {
          emit('done')
        }
      } catch (err) {
        logger.error(
          'selectorLifecycle',
          'selectorLifecycle.retroactive_match_failed',
          undefined,
          err
        )
        emit('error')
      }
    }

    setImmediate(() => processChunk(0))
  }

  return {
    createSelector(params) {
      const selector = selectorRepo.createSelector(params)
      scheduleRetroactiveMatch([selector], params.caseId)
      return selector
    },
    bulkCreateSelectors(params) {
      const created = selectorRepo.bulkCreateSelectors(
        params.selectors.map((s) => ({
          caseId: params.caseId,
          pattern: s.pattern,
          isRegex: s.isRegex,
          label: s.label,
          origin: s.origin
        }))
      )
      scheduleRetroactiveMatch(created, params.caseId)
      return created
    },
    updateSelector(params) {
      const existing = selectorRepo.getSelector(params.id)
      if (!existing) return undefined

      const patternChanged = params.pattern !== undefined && params.pattern !== existing.pattern
      const isRegexChanged = params.isRegex !== undefined && params.isRegex !== existing.isRegex
      const matchSemanticsChanged = patternChanged || isRegexChanged

      const updated = selectorRepo.updateSelector(params)
      if (!updated) return undefined

      if (matchSemanticsChanged) {
        selectorRepo.clearSelectorMatches(updated.id)
        scheduleRetroactiveMatch([updated], updated.caseId, { unbounded: true })
      }

      return updated
    },
    // Operator-invoked backfill (#829). Ingest already matches enabled selectors
    // against each new capture — captureLifecycle.runPostCaptureWork calls
    // runActiveSelectorsForCapture whenever textContent is present — so ordinary
    // post-creation captures are matched without this. What this closes are the
    // three gaps that path leaves: captures older than the RETRO_MAX_CAPTURES
    // window create-time backfill scanned, captures ingested while the selector
    // was disabled (matchSelectorsForCapture skips disabled selectors), and
    // captures whose text was unavailable at ingest and has since been
    // re-extracted.
    //
    // Additive, never clear-then-rescan (ruling W2): matchSelectorAgainstCaptures
    // is INSERT OR IGNORE, so this pass can only add rows. The clear-first shape
    // updateSelector uses would delete every match and then skip any capture
    // whose text will not load, silently dropping rows that ride inside case
    // archives. The accepted cost is that a stale match cannot be retired here.
    //
    // Unbounded (W10) because reaching those later captures is the whole point,
    // and not gated on `enabled` (W11) because matchSelectorAgainstCaptures does
    // not check it either — create-time backfill already behaves this way.
    rescanSelector(id) {
      const selector = selectorRepo.getSelector(id)
      if (!selector) return false
      scheduleRetroactiveMatch([selector], selector.caseId, { unbounded: true })
      return true
    },
    runActiveSelectorsForCapture(captureId, caseId, textContent) {
      selectorRepo.matchSelectorsForCapture(captureId, caseId, textContent)
    }
  }
}
