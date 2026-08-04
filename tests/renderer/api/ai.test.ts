import { describe, it, expect, vi } from 'vitest'
import { fakeBridge } from '../fakeBridge'
import {
  analyzeCapture,
  captureAnalysisQueryOptions,
  saveCaptureAnalysis
} from '@renderer/lib/api/ai'
import { queryKeys } from '@renderer/lib/api/keys'

const analysis = {
  id: 'a1',
  captureId: 'c1',
  caseId: 'case1',
  content: 'findings',
  model: 'm',
  tokenUsage: { prompt: 1, completion: 2, total: 3 },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
}

describe('captureAnalysisQueryOptions', () => {
  it('reads the saved analysis under the shared key', async () => {
    const getAnalysis = vi.fn(async () => analysis)
    fakeBridge({ ai: { getAnalysis } })

    const opts = captureAnalysisQueryOptions('c1')

    expect(opts.queryKey).toEqual(queryKeys.captureAnalysis('c1'))
    expect(opts.enabled).toBe(true)
    await expect(opts.queryFn?.({} as never)).resolves.toEqual(analysis)
    expect(getAnalysis).toHaveBeenCalledWith('c1')
  })

  it('stays disabled without a capture', () => {
    expect(captureAnalysisQueryOptions('').enabled).toBe(false)
  })
})

describe('ai commands', () => {
  it('passes analyze params straight through', async () => {
    const analyze = vi.fn(async () => ({ content: 'x', tokenUsage: analysis.tokenUsage }))
    fakeBridge({ ai: { analyze } })

    const params = { captureId: 'c1', caseId: 'case1', model: 'm' }
    await expect(analyzeCapture(params)).resolves.toEqual({
      content: 'x',
      tokenUsage: analysis.tokenUsage
    })
    expect(analyze).toHaveBeenCalledWith(params)
  })

  it('passes the whole analysis row to saveAnalysis', async () => {
    const saveAnalysis = vi.fn(async () => undefined)
    fakeBridge({ ai: { saveAnalysis } })

    await saveCaptureAnalysis(analysis)

    expect(saveAnalysis).toHaveBeenCalledWith(analysis)
  })
})
