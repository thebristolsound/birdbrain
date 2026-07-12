// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { fakeBridge } from '../fakeBridge'
import { queryKeys } from '@renderer/lib/api/keys'
import { settingsUpdateMutationOptions } from '@renderer/lib/api/settings'
import type { BirdbrainSettings } from '@shared/types'

describe('settingsUpdateMutationOptions', () => {
  it('settings update writes result into the settings cache', async () => {
    const updated = { theme: 'dark', operatorName: 'Op' } as Partial<BirdbrainSettings>
    fakeBridge({
      settings: { update: vi.fn(async () => updated as BirdbrainSettings) }
    })
    const queryClient = new QueryClient()

    const opts = settingsUpdateMutationOptions(queryClient)
    const data = await opts.mutationFn({ theme: 'dark' })
    opts.onSuccess(data, { theme: 'dark' })

    expect(queryClient.getQueryData(['settings'])).toEqual(updated)
  })

  it('invalidates openRouterModels only when the api key changes', async () => {
    const update = vi.fn(
      async (partial: Partial<BirdbrainSettings>) => partial as BirdbrainSettings
    )
    fakeBridge({ settings: { update } })
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()

    const opts = settingsUpdateMutationOptions(queryClient)

    const noKey = await opts.mutationFn({ operatorName: 'A' })
    opts.onSuccess(noKey, { operatorName: 'A' })
    expect(invalidate).not.toHaveBeenCalled()

    const withKey = await opts.mutationFn({ openRouterApiKey: 'sk' })
    opts.onSuccess(withKey, { openRouterApiKey: 'sk' })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.openRouterModels })
  })
})
