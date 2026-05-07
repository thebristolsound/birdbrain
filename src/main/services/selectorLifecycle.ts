import * as db from '@main/services/database'
import { readCaptureFile } from '@main/services/storage'
import type { Selector } from '@shared/types'
import type { CreateSelectorParams, BulkCreateSelectorsParams } from '@shared/ipc'

const RETRO_MAX_CAPTURES = 500
const RETRO_CHUNK_SIZE = 50

export type RematchedStatus = 'done' | 'error'

export interface RematchedEvent {
  selectorId: string
  caseId: string
  status: RematchedStatus
}

export interface SelectorLifecycleDeps {
  emitRematched: (event: RematchedEvent) => void
}

export interface SelectorLifecycle {
  createSelector: (params: CreateSelectorParams) => Selector
  bulkCreateSelectors: (params: BulkCreateSelectorsParams) => Selector[]
}

export function createSelectorLifecycle(deps: SelectorLifecycleDeps): SelectorLifecycle {
  function loadCaptureText(caseId: string, captureId: string): string | null {
    const buffer = readCaptureFile(caseId, captureId, 'txt')
    if (buffer) return buffer.toString('utf-8')
    return db.getCaptureTextContent(captureId)
  }

  function scheduleRetroactiveMatch(selectors: Selector[], caseId: string): void {
    if (selectors.length === 0) return
    const allCaptures = db.listCaptures(caseId)
    const captures = allCaptures.slice(0, RETRO_MAX_CAPTURES)

    const emit = (status: RematchedStatus): void => {
      for (const sel of selectors) {
        deps.emitRematched({ selectorId: sel.id, caseId, status })
      }
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
            db.matchSelectorAgainstCaptures(sel.id, captureTexts)
          }
        }

        if (end < captures.length) {
          setImmediate(() => processChunk(end))
        } else {
          emit('done')
        }
      } catch (err) {
        console.error('selectorLifecycle: retroactive match failed', err)
        emit('error')
      }
    }

    setImmediate(() => processChunk(0))
  }

  return {
    createSelector(params) {
      const selector = db.createSelector(params)
      scheduleRetroactiveMatch([selector], params.caseId)
      return selector
    },
    bulkCreateSelectors(params) {
      const created = db.bulkCreateSelectors(
        params.selectors.map((s) => ({
          caseId: params.caseId,
          pattern: s.pattern,
          isRegex: s.isRegex,
          label: s.label
        }))
      )
      scheduleRetroactiveMatch(created, params.caseId)
      return created
    }
  }
}
