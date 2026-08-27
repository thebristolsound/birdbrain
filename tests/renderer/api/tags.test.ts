import { describe, it, expect, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invalidateAfterTagApply, invalidateTagCounts } from '@renderer/lib/api/tags'
import { queryKeys } from '@renderer/lib/api/keys'

// The invalidation lists the tag mutations and the extension-attach listener
// share (#852). Asserted here, beside the mutations, so the two callers cannot
// drift apart without a failing test.
describe('tag cache invalidation', () => {
  const spyOnClient = () => {
    const client = new QueryClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    const keys = (): unknown[] => spy.mock.calls.map(([filters]) => filters?.queryKey)
    return { client, keys }
  }

  it('invalidates every count derived from tag membership', () => {
    const { client, keys } = spyOnClient()

    invalidateTagCounts(client)

    expect(keys()).toEqual([
      ['tags', 'usageCounts'],
      ['tags', 'caseCount'],
      ['tags', 'captureMatrix']
    ])
  })

  // An extension apply is find-or-create plus attach, so it stales the tag list
  // (a new tag may exist), that capture's tags, and every count.
  it('covers the tag list, the capture the tag landed on, and the counts', () => {
    const { client, keys } = spyOnClient()

    invalidateAfterTagApply(client, 'cap-1')

    expect(keys()).toEqual([
      queryKeys.tags,
      queryKeys.tagsForCapture('cap-1'),
      ['tags', 'usageCounts'],
      ['tags', 'caseCount'],
      ['tags', 'captureMatrix']
    ])
  })

  it('scopes the per-capture invalidation to the capture it was given', () => {
    const { client, keys } = spyOnClient()

    invalidateAfterTagApply(client, 'cap-1')

    expect(keys()).not.toContainEqual(queryKeys.tagsForCapture('cap-2'))
  })
})
