import { describe, it, expect, vi } from 'vitest'
import { fakeBridge } from '../fakeBridge'
import { inspectCaseArchive, recentActivityQueryOptions } from '@renderer/lib/api/cases'
import { RECENT_ACTIVITY_LIMIT } from '@shared/constants'

describe('inspectCaseArchive', () => {
  it('returns null when the operator cancels the file dialog', async () => {
    const inspectArchive = vi.fn(async () => null)
    fakeBridge({ cases: { inspectArchive } })

    await expect(inspectCaseArchive()).resolves.toBeNull()
    expect(inspectArchive).toHaveBeenCalledOnce()
  })

  it('returns the verification report for a chosen archive', async () => {
    const report = { archivePath: '/a.bbcase', tampered: false }
    fakeBridge({ cases: { inspectArchive: vi.fn(async () => report) } })

    await expect(inspectCaseArchive()).resolves.toEqual(report)
  })
})

describe('recentActivityQueryOptions', () => {
  it('keys on the limit and passes it to the bridge', async () => {
    const recentActivity = vi.fn(async () => [])
    fakeBridge({ cases: { recentActivity } })

    const options = recentActivityQueryOptions(3)
    expect(options.queryKey).toEqual(['cases', 'recentActivity', 3])

    await options.queryFn?.({} as never)
    expect(recentActivity).toHaveBeenCalledWith(3)
  })

  it('defaults to the dashboard page size and always refetches on mount', async () => {
    const recentActivity = vi.fn(async () => [])
    fakeBridge({ cases: { recentActivity } })

    const options = recentActivityQueryOptions()
    expect(options.queryKey).toEqual(['cases', 'recentActivity', RECENT_ACTIVITY_LIMIT])
    // A cached-but-stale feed would hide the capture the operator just took.
    expect(options.refetchOnMount).toBe('always')

    await options.queryFn?.({} as never)
    expect(recentActivity).toHaveBeenCalledWith(RECENT_ACTIVITY_LIMIT)
  })
})
