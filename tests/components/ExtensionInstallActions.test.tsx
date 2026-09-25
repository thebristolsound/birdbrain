// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ExtensionBanner } from '@renderer/components/dashboard/ExtensionBanner'
import { CapturesGettingStarted } from '@renderer/components/captures/CapturesGettingStarted'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubMatchMedia } from './matchMediaStub'
const openFolder = vi.fn()
beforeEach(() => {
  stubMatchMedia()
  openFolder.mockReset()
  fakeBridge({ extension: { openFolder } })
})
afterEach(cleanup)
it.each([ExtensionBanner, CapturesGettingStarted])(
  'describes the file-manager action and presents folder failures',
  async (Component) => {
    openFolder.mockRejectedValue(new Error('not found'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Component connected={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open extension folder' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/reveals the bundled files in your file manager/)).toBeTruthy()
    openFolder.mockResolvedValue(undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Open extension folder' }))
    expect(screen.queryByRole('alert')).toBeNull()
    log.mockRestore()
  }
)
