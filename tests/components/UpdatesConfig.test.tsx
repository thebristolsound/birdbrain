// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { BirdbrainSettings, UpdateStatus } from '@shared/types'
import { UpdatesConfig } from '@renderer/components/settings/UpdatesConfig'
import { fakeBridge } from '../renderer/fakeBridge'

// Asserted, not annotated: UpdatesConfig reads one field off BirdbrainSettings,
// and spelling out the rest here would say nothing about the behaviour tested.
const settings = { releaseChannel: 'beta' } as BirdbrainSettings

function renderWithStatus(status: UpdateStatus) {
  fakeBridge({ updates: { getStatus: vi.fn(async () => status) } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<UpdatesConfig settings={settings} onUpdate={vi.fn(async () => {})} />, {
    wrapper: Wrapper
  })
}

const downloaded: UpdateStatus = {
  state: 'downloaded',
  currentVersion: '1.0.1-beta.20',
  availableVersion: '1.0.1-beta.21',
  supportsAutoInstall: true,
  installOnQuit: false
}

afterEach(cleanup)

describe('UpdatesConfig', () => {
  /**
   * The reason this reminder exists (#632): an in-place update replaces the
   * extension's files on disk, but Chrome keeps serving the copy it loaded at
   * sideload time. A tester who skips the reload is running new app against old
   * extension, which is how a fixed bug (#610) presented as still broken. The
   * offer to update is the only moment the app knows to say so.
   */
  it('tells the operator to reload the extension once an update is downloaded', async () => {
    renderWithStatus(downloaded)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /restart to update/i })).toBeTruthy()
    )
    expect(screen.getByText(/reload the Birdbrain extension/i)).toBeTruthy()
    expect(screen.getByText('chrome://extensions')).toBeTruthy()
  })

  it('does not raise the reload reminder before an update is downloaded', async () => {
    renderWithStatus({
      state: 'up-to-date',
      currentVersion: '1.0.1-beta.20',
      supportsAutoInstall: true,
      installOnQuit: false
    })

    await waitFor(() => expect(screen.getByText(/latest version/i)).toBeTruthy())
    expect(screen.queryByText(/reload the Birdbrain extension/i)).toBeNull()
  })
})
