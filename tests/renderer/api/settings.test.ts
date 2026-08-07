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
    opts.onSuccess?.(data, { theme: 'dark' }, undefined, undefined as never)

    expect(qc.getQueryData(queryKeys.settings)).toEqual(updated)
  })
})
