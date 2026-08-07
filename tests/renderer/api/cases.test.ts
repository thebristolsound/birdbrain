import { describe, it, expect, vi } from 'vitest'
import { fakeBridge } from '../fakeBridge'
import { inspectCaseArchive } from '@renderer/lib/api/cases'

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
