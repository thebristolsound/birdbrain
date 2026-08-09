import { describe, it, expect, vi } from 'vitest'
import { fakeBridge } from '../fakeBridge'
import { getCaptureContent, listCaptures } from '@renderer/lib/api/captures'

describe('uncached capture reads', () => {
  it('lists a case’s captures', async () => {
    const list = vi.fn(async () => [{ id: 'c1' }])
    fakeBridge({ captures: { list } })

    await expect(listCaptures('case1')).resolves.toEqual([{ id: 'c1' }])
    expect(list).toHaveBeenCalledWith('case1')
  })

  it('passes the content type through and tolerates a missing artifact', async () => {
    const getContent = vi.fn(async () => null)
    fakeBridge({ captures: { getContent } })

    await expect(getCaptureContent('c1', 'txt')).resolves.toBeNull()
    expect(getContent).toHaveBeenCalledWith('c1', 'txt')
  })
})
