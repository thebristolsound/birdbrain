import { describe, it, expect, vi } from 'vitest'
import { fakeBridge } from '../fakeBridge'
import {
  checkForUpdate,
  downloadUpdate,
  getUpdateStatus,
  installUpdate
} from '@renderer/lib/api/updates'

const status = { state: 'idle', currentVersion: '1.0.0' }

describe('update commands', () => {
  it('reads the mount snapshot', async () => {
    const getStatus = vi.fn(async () => status)
    fakeBridge({ updates: { getStatus } })

    await expect(getUpdateStatus()).resolves.toEqual(status)
    expect(getStatus).toHaveBeenCalledOnce()
  })

  it('returns the status a manual check resolves with', async () => {
    const check = vi.fn(async () => status)
    fakeBridge({ updates: { check } })

    await expect(checkForUpdate()).resolves.toEqual(status)
  })

  it('kicks download and install without a return value', async () => {
    const download = vi.fn(async () => undefined)
    const install = vi.fn(async () => undefined)
    fakeBridge({ updates: { download, install } })

    await downloadUpdate()
    await installUpdate()

    expect(download).toHaveBeenCalledOnce()
    expect(install).toHaveBeenCalledOnce()
  })
})
