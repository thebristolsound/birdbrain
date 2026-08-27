import { describe, it, expect, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invalidateNoteQueries } from '@renderer/lib/api/notes'
import { queryKeys } from '@renderer/lib/api/keys'

// The list the note mutations and the extension-attach listener share (#852),
// asserted beside the mutations so neither caller can drift from it.
describe('note cache invalidation', () => {
  const spyOnClient = () => {
    const client = new QueryClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    const keys = (): unknown[] => spy.mock.calls.map(([filters]) => filters?.queryKey)
    return { client, keys }
  }

  it('covers the list, the count, an open search and the backlink map', () => {
    const { client, keys } = spyOnClient()

    invalidateNoteQueries(client, 'case-1')

    expect(keys()).toEqual([
      queryKeys.notes('case-1'),
      queryKeys.noteCount('case-1'),
      ['notes', 'search', 'case-1'],
      queryKeys.noteReferenceEdges('case-1')
    ])
  })

  // ['notes', caseId] does not prefix-match ['notes', 'referenceEdges', caseId],
  // which is why the map is listed separately rather than covered by the list
  // key. Pinned so a later key change cannot silently drop it.
  it('does not rely on the list key to reach the backlink map', () => {
    const { client, keys } = spyOnClient()

    invalidateNoteQueries(client, 'case-1')

    const listKey = queryKeys.notes('case-1') as readonly unknown[]
    const mapKey = queryKeys.noteReferenceEdges('case-1') as readonly unknown[]
    expect(mapKey.slice(0, listKey.length)).not.toEqual([...listKey])
    expect(keys()).toContainEqual(mapKey)
  })

  it('scopes every key to the case it was given', () => {
    const { client, keys } = spyOnClient()

    invalidateNoteQueries(client, 'case-1')

    expect(keys()).not.toContainEqual(queryKeys.notes('case-2'))
    expect(keys().every((key) => (key as unknown[]).includes('case-1'))).toBe(true)
  })
})
