// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { LaunchedBrowserOption } from '@shared/types'
import { FoundBrowsers } from '@renderer/components/launchedBrowser/FoundBrowsers'
import { fakeBridge } from '../renderer/fakeBridge'

const CHROME: LaunchedBrowserOption = {
  family: 'chrome',
  label: 'Google Chrome',
  executablePath: '/opt/google/chrome/chrome',
  chosen: false,
  lastVersion: '149.0.7827.55'
}
const BRAVE: LaunchedBrowserOption = {
  family: 'brave',
  label: 'Brave',
  executablePath: '/opt/brave.com/brave/brave',
  chosen: false,
  lastVersion: null
}
const CHOSEN: LaunchedBrowserOption = {
  family: 'chrome-for-testing',
  label: 'Chrome for Testing',
  executablePath: '/home/a/chrome-linux64/chrome',
  chosen: true,
  lastVersion: null
}

// `launch` is left unstubbed, so a call to it rejects and fails the test that made it.
function mount(launchedBrowser: Record<string, unknown>) {
  fakeBridge({ launchedBrowser })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <FoundBrowsers />
    </QueryClientProvider>
  )
}

function row(label: string) {
  return screen.getByText(label, { selector: '[data-browser-label]' }).closest('li')!
}

afterEach(cleanup)

describe('FoundBrowsers', () => {
  it('shows no version for a browser Birdbrain has not launched', async () => {
    mount({ list: vi.fn(async () => [BRAVE]) })
    await screen.findByText('Brave')
    const brave = row('Brave')
    expect(within(brave).getByText('not launched yet')).toBeDefined()
    expect(brave.textContent).not.toMatch(/\d+\.\d+/)
  })

  it('shows the version from the last launch, and says so', async () => {
    mount({ list: vi.fn(async () => [CHROME]) })
    await screen.findByText('Google Chrome')
    const chrome = row('Google Chrome')
    expect(within(chrome).getByText('149.0.7827.55')).toBeDefined()
    expect(within(chrome).getByText('from its last launch')).toBeDefined()
    expect(
      within(chrome).getByRole('img', {
        name: 'The version Google Chrome reported at the last launch that passed its checks.'
      })
    ).toBeDefined()
  })

  it('shows the path of the executable the Operator chose', async () => {
    mount({ list: vi.fn(async () => [CHROME, CHOSEN]) })
    await screen.findByText('Chrome for Testing')
    expect(within(row('Chrome for Testing')).getByText(CHOSEN.executablePath)).toBeDefined()
    expect(within(row('Google Chrome')).queryByText(CHROME.executablePath)).toBeNull()
  })

  it('says when it found no browser', async () => {
    mount({ list: vi.fn(async () => []) })
    expect(
      await screen.findByText('Birdbrain found no supported browser in the usual install folders.')
    ).toBeDefined()
  })

  it('says when the list could not be read', async () => {
    mount({ list: vi.fn(async () => Promise.reject(new Error('boom'))) })
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Birdbrain could not list the browsers it can launch.'
    )
  })

  it('lists a chosen executable once main accepts it', async () => {
    const list = vi.fn().mockResolvedValueOnce([CHROME]).mockResolvedValue([CHROME, CHOSEN])
    const chooseExecutable = vi.fn(async () => CHOSEN)
    mount({ list, chooseExecutable })
    await screen.findByText('Google Chrome')
    fireEvent.click(screen.getByRole('button', { name: 'Choose an executable…' }))
    expect(await screen.findByText('Chrome for Testing')).toBeDefined()
    expect(chooseExecutable).toHaveBeenCalledOnce()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it("shows main's refusal of a chosen file and keeps the list", async () => {
    const list = vi.fn(async () => [CHROME])
    const chooseExecutable = vi.fn(async () =>
      Promise.reject(new Error('/usr/bin/brave-origin is a script, not a browser program.'))
    )
    mount({ list, chooseExecutable })
    await screen.findByText('Google Chrome')
    fireEvent.click(screen.getByRole('button', { name: 'Choose an executable…' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      '/usr/bin/brave-origin is a script, not a browser program.'
    )
    expect(list).toHaveBeenCalledOnce()
  })

  it('changes nothing when the Operator cancels the file dialog', async () => {
    const list = vi.fn(async () => [CHROME])
    const chooseExecutable = vi.fn(async () => null)
    mount({ list, chooseExecutable })
    await screen.findByText('Google Chrome')
    fireEvent.click(screen.getByRole('button', { name: 'Choose an executable…' }))
    await waitFor(() => expect(chooseExecutable).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Choose an executable…' })).toHaveProperty(
        'disabled',
        false
      )
    )
    expect(list).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('clears an earlier refusal when the next choice is accepted', async () => {
    const chooseExecutable = vi
      .fn()
      .mockRejectedValueOnce(new Error('Not a browser Birdbrain recognizes.'))
      .mockResolvedValue(CHOSEN)
    mount({ list: vi.fn(async () => [CHROME]), chooseExecutable })
    await screen.findByText('Google Chrome')
    const choose = screen.getByRole('button', { name: 'Choose an executable…' })
    fireEvent.click(choose)
    await screen.findByRole('alert')
    fireEvent.click(choose)
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})
