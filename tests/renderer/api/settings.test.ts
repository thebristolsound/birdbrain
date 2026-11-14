import { describe, it, expect, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { fakeBridge } from '../fakeBridge'
import { settingsUpdateMutationOptions } from '@renderer/lib/api/settings'
import { queryKeys } from '@renderer/lib/api/keys'

describe('settingsUpdateMutationOptions', () => {
  it('writes the response into the settings cache', async () => {
    const updated = { theme: 'dark', reduceMotion: false }
    fakeBridge({ settings: { update: vi.fn(async () => updated) } })
    const qc = new QueryClient()

    const opts = settingsUpdateMutationOptions(qc)
    const data = await opts.mutationFn({ theme: 'dark' })
    opts.onSuccess?.(data, { theme: 'dark' })

    expect(qc.getQueryData(queryKeys.settings)).toEqual(updated)
  })

  // X47 (#1332): main signs the entries a blank name held before it answers the save.
  it('rereads every inventory and Manifest when the operator name is saved, and only then', async () => {
    const updated = { operatorName: 'Agent Smith' }
    fakeBridge({ settings: { update: vi.fn(async () => updated) } })
    const qc = new QueryClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const opts = settingsUpdateMutationOptions(qc)

    opts.onSuccess?.(await opts.mutationFn({ theme: 'dark' }), { theme: 'dark' })
    expect(invalidate).not.toHaveBeenCalled()

    opts.onSuccess?.(await opts.mutationFn(updated), updated)
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ['exhibits'],
      ['manifest']
    ])
    expect(queryKeys.exhibitInventory('c1').slice(0, 1)).toEqual(['exhibits'])
    expect(queryKeys.manifestSnapshot('c1').slice(0, 1)).toEqual(['manifest'])
  })
})
