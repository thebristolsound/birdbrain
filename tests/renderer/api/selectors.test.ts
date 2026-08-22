import { describe, it, expect, vi } from 'vitest'
import { fakeBridge } from '../fakeBridge'
import {
  createSelector,
  deleteSelector,
  exportSelectorMatches,
  listMatchingCaptureIds,
  updateSelector
} from '@renderer/lib/api/selectors'

const selector = {
  id: 's1',
  caseId: 'case1',
  pattern: 'acme',
  isRegex: false,
  enabled: true,
  createdAt: '2026-08-01T00:00:00.000Z'
}

describe('selector commands', () => {
  it('creates a selector from the given params', async () => {
    const create = vi.fn(async () => selector)
    fakeBridge({ selectors: { create } })

    const params = { caseId: 'case1', pattern: 'acme', isRegex: false }
    await expect(createSelector(params)).resolves.toEqual(selector)
    expect(create).toHaveBeenCalledWith(params)
  })

  it('sends a partial update through', async () => {
    const update = vi.fn(async () => selector)
    fakeBridge({ selectors: { update } })

    await expect(updateSelector({ id: 's1', enabled: false })).resolves.toEqual(selector)
    expect(update).toHaveBeenCalledWith({ id: 's1', enabled: false })
  })

  it('deletes by id', async () => {
    const remove = vi.fn(async () => true)
    fakeBridge({ selectors: { delete: remove } })

    await expect(deleteSelector('s1')).resolves.toBe(true)
    expect(remove).toHaveBeenCalledWith('s1')
  })

  it('reports a cancelled match export rather than throwing', async () => {
    const exportMatches = vi.fn(async () => ({ exported: false }))
    fakeBridge({ selectors: { exportMatches } })

    await expect(exportSelectorMatches('case1')).resolves.toEqual({ exported: false })
    // No selector id: case-wide, the shape the card header's export uses (#400).
    expect(exportMatches).toHaveBeenCalledWith('case1', undefined)
  })

  it('scopes a match export to one selector when asked', async () => {
    const exportMatches = vi.fn(async () => ({ exported: true, path: '/tmp/x.csv' }))
    fakeBridge({ selectors: { exportMatches } })

    await expect(exportSelectorMatches('case1', 's1')).resolves.toEqual({
      exported: true,
      path: '/tmp/x.csv'
    })
    expect(exportMatches).toHaveBeenCalledWith('case1', 's1')
  })

  it('asks for matching capture ids for an ad-hoc selector set', async () => {
    const matchingCaptures = vi.fn(async () => ['c1', 'c2'])
    fakeBridge({ selectors: { matchingCaptures } })

    await expect(listMatchingCaptureIds('case1', ['s1', 's2'])).resolves.toEqual(['c1', 'c2'])
    expect(matchingCaptures).toHaveBeenCalledWith('case1', ['s1', 's2'])
  })
})
