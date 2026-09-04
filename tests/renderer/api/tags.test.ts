import { describe, it, expect, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  invalidateAfterTagApply,
  invalidateTagCounts,
  tagCapturesWithAnyQueryOptions
} from '@renderer/lib/api/tags'
import { queryKeys } from '@renderer/lib/api/keys'
import { fakeBridge } from '../fakeBridge'

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

  // The capture list's tag filter (#918) is in the list: it is membership
  // derived, so a write that moves a count also moves what the filter shows.
  it('invalidates every read derived from tag membership', () => {
    const { client, keys } = spyOnClient()

    invalidateTagCounts(client)

    expect(keys()).toEqual([
      ['tags', 'usageCounts'],
      ['tags', 'caseCount'],
      ['tags', 'captureMatrix'],
      ['tags', 'capturesWithAnyTag']
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
      ['tags', 'captureMatrix'],
      ['tags', 'capturesWithAnyTag']
    ])
  })

  it('scopes the per-capture invalidation to the capture it was given', () => {
    const { client, keys } = spyOnClient()

    invalidateAfterTagApply(client, 'cap-1')

    expect(keys()).not.toContainEqual(queryKeys.tagsForCapture('cap-2'))
  })
})

describe('tagCapturesWithAnyQueryOptions (#918)', () => {
  it('keys under the prefix the membership invalidation clears', () => {
    const { queryKey } = tagCapturesWithAnyQueryOptions('case1', ['t1', 't2'])

    expect(queryKey).toEqual(['tags', 'capturesWithAnyTag', 'case1', 't1', 't2'])
    expect(queryKey.slice(0, 2)).toEqual([...queryKeys.tagCapturesWithAnyAll])
  })

  it('is disabled without a case or without a tag', () => {
    expect(tagCapturesWithAnyQueryOptions('', ['t1']).enabled).toBe(false)
    expect(tagCapturesWithAnyQueryOptions('case1', []).enabled).toBe(false)
    expect(tagCapturesWithAnyQueryOptions('case1', ['t1']).enabled).toBe(true)
  })

  it('asks main for the captures carrying any of the given tags', async () => {
    const capturesWithAnyTag = vi.fn(async () => ['c1', 'c2'])
    fakeBridge({ tags: { capturesWithAnyTag } })
    const client = new QueryClient()

    await expect(
      client.fetchQuery(tagCapturesWithAnyQueryOptions('case1', ['t1', 't2']))
    ).resolves.toEqual(['c1', 'c2'])
    expect(capturesWithAnyTag).toHaveBeenCalledWith('case1', ['t1', 't2'])
  })
})
