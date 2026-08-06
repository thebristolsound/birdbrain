import { describe, it, expect, vi, afterEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { CaptureAnalysis } from '@shared/types'
import { fakeBridge } from '../fakeBridge'
import { aiMutationOptions, captureAnalysisQueryOptions } from '@renderer/lib/api/ai'
import { queryKeys } from '@renderer/lib/api/keys'

const analysis: CaptureAnalysis = {
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

describe('aiMutationOptions.analyze', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes analyze params straight through and stamps the run when it runs', async () => {
    // Only Date is faked: the mutationFn awaits, and faking the timer queue
    // would leave that await unresolved.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-08-06T10:00:00.000Z') })
    const analyze = vi.fn(async () => ({ content: 'x', tokenUsage: analysis.tokenUsage }))
    fakeBridge({ ai: { analyze } })

    const params = { captureId: 'c1', caseId: 'case1', model: 'm' }
    const run = await aiMutationOptions(new QueryClient()).analyze.mutationFn(params)

    expect(analyze).toHaveBeenCalledWith(params)
    expect(run.content).toBe('x')
    expect(run.tokenUsage).toEqual(analysis.tokenUsage)
    // The run carries its own timestamp so the tab renders the moment the
    // analysis landed rather than the moment some effect noticed it. Pinned to
    // the exact clock value: a hardcoded constant would satisfy "is a date".
    expect(run.analyzedAt).toBe('2026-08-06T10:00:00.000Z')
  })

  it('carries the model that produced the run', async () => {
    const analyze = vi.fn(async () => ({ content: 'x', tokenUsage: analysis.tokenUsage }))
    fakeBridge({ ai: { analyze } })

    const run = await aiMutationOptions(new QueryClient()).analyze.mutationFn({
      captureId: 'c1',
      caseId: 'case1',
      model: 'model-a'
    })

    // The row credits a model for the findings, so the run has to remember
    // which one it asked rather than leaving the save to re-read the picker.
    expect(run.model).toBe('model-a')
  })
})

describe('aiMutationOptions.saveAnalysis', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('mints id and createdAt at save time for a capture with no stored analysis', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-08-06T10:20:00.000Z') })
    const saveAnalysis = vi.fn(async () => undefined)
    fakeBridge({ ai: { saveAnalysis } })

    const saved = await aiMutationOptions(new QueryClient()).saveAnalysis.mutationFn({
      captureId: 'c1',
      caseId: 'case1',
      content: 'findings',
      model: 'm',
      tokenUsage: analysis.tokenUsage
    })

    expect(saveAnalysis).toHaveBeenCalledWith(saved)
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/)
    // The row is stamped when it is written, not when the analysis ran: the
    // run's own `analyzedAt` is display-only and reaches no column.
    expect(saved.createdAt).toBe('2026-08-06T10:20:00.000Z')
    expect(saved.createdAt).toBe(saved.updatedAt)
    expect(saved).toMatchObject({
      captureId: 'c1',
      caseId: 'case1',
      content: 'findings',
      model: 'm',
      tokenUsage: analysis.tokenUsage
    })
  })

  it('carries the stored identity forward on re-save', async () => {
    const saveAnalysis = vi.fn(async () => undefined)
    fakeBridge({ ai: { saveAnalysis } })

    // saveAnalysis upserts by captureId: a re-save that minted a fresh id or
    // createdAt would silently rewrite when the analysis was first produced.
    const saved = await aiMutationOptions(new QueryClient()).saveAnalysis.mutationFn({
      captureId: 'c1',
      caseId: 'case1',
      content: 'revised findings',
      model: 'm2',
      tokenUsage: analysis.tokenUsage,
      existing: analysis
    })

    expect(saved.id).toBe(analysis.id)
    expect(saved.createdAt).toBe(analysis.createdAt)
    expect(saved.updatedAt).not.toBe(analysis.updatedAt)
    expect(saved.content).toBe('revised findings')
    expect(saved.model).toBe('m2')
  })

  it('writes the saved row through to the cache and invalidates the same key', () => {
    const queryClient = new QueryClient()
    const setQueryData = vi.spyOn(queryClient, 'setQueryData')
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    aiMutationOptions(queryClient).saveAnalysis.onSuccess(analysis)

    expect(setQueryData).toHaveBeenCalledWith(queryKeys.captureAnalysis('c1'), analysis)
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.captureAnalysis('c1')
    })
  })
})
