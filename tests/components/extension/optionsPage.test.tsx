// @vitest-environment jsdom
// The read-only extension options page (#406). The page's whole job is to
// explain a state, so the states the prototype never drew — loading, no token,
// desktop app closed — are pinned here alongside the one it did draw.
//
// Lives under tests/components/ because that is the only .tsx glob the jsdom
// vitest project runs — a tests/extension/*.test.tsx would be collected by no
// project at all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { CaptureServerStatus } from '@shared/schemas'

vi.mock('@extension/utils/api', async () => {
  const actual =
    await vi.importActual<typeof import('@extension/utils/api')>('@extension/utils/api')
  return {
    // The page must display the address the client actually calls, so the real
    // constant is used rather than a second literal in this file.
    BASE_URL: actual.BASE_URL,
    getStatus: vi.fn(),
    getServerToken: vi.fn()
  }
})

import { BASE_URL, getStatus, getServerToken } from '@extension/utils/api'
import { OptionsPage } from '@extension/options/OptionsApp'

const TOKEN = `${'a'.repeat(60)}3f9c`
const MASK = `${'•'.repeat(20)}3f9c`

function status(overrides: Partial<CaptureServerStatus> = {}): CaptureServerStatus {
  return {
    running: true,
    activeCase: { id: 'case-a', name: 'Operation Nightjar' },
    sessionActive: false,
    captureCount: 12,
    autoCaptureMode: 'notify',
    cases: [],
    ignoredUrlPatterns: [],
    captureScreenshots: true,
    dedupeWindowSeconds: 60,
    theme: 'dark',
    ...overrides
  }
}

const createdTabs: string[] = []

function stubChrome(): void {
  vi.stubGlobal('chrome', {
    runtime: {
      lastError: undefined,
      getManifest: () => ({ version: '1.2.3' })
    },
    tabs: {
      create: ({ url }: { url: string }) => createdTabs.push(url)
    }
  })
}

// Faithful to api.ts: the token cache is empty until a status response fills it,
// which is why the page must await getStatus before reading getServerToken.
function serveStatus(value: CaptureServerStatus, token: string | null = TOKEN): void {
  let cached: string | null = null
  vi.mocked(getStatus).mockImplementation(async () => {
    cached = token
    return value
  })
  vi.mocked(getServerToken).mockImplementation(() => cached)
}

async function renderPage(): Promise<void> {
  render(<OptionsPage />)
  await waitFor(() => expect(vi.mocked(getStatus)).toHaveBeenCalled())
}

beforeEach(() => {
  createdTabs.length = 0
  stubChrome()
  serveStatus(status())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('extension options page', () => {
  it('reads the token only after the status response that issues it', async () => {
    await renderPage()

    expect(await screen.findByText(MASK)).toBeTruthy()
    const statusCall = vi.mocked(getStatus).mock.invocationCallOrder[0]
    const tokenCall = vi.mocked(getServerToken).mock.invocationCallOrder[0]
    expect(statusCall).toBeLessThan(tokenCall)
  })

  it('masks the token and never puts the whole value in the DOM', async () => {
    const { container } = render(<OptionsPage />)
    await waitFor(() => expect(vi.mocked(getStatus)).toHaveBeenCalled())

    expect(await screen.findByText(MASK)).toBeTruthy()
    expect(container.textContent).not.toContain(TOKEN)
  })

  it('asks the server to skip the case list it never shows', async () => {
    await renderPage()

    expect(vi.mocked(getStatus)).toHaveBeenCalledWith({ includeCases: false })
  })

  it('shows the one address the client talks to, as a fact', async () => {
    await renderPage()

    expect(await screen.findByText('http://127.0.0.1:19845')).toBeTruthy()
    expect(BASE_URL).toBe('http://127.0.0.1:19845')
  })

  it('follows the app for the screenshot setting', async () => {
    serveStatus(status({ captureScreenshots: false }))
    await renderPage()

    expect(await screen.findByText('Off')).toBeTruthy()
    expect(screen.queryByText('On')).toBeNull()
  })

  it('reports the connection from the status response', async () => {
    await renderPage()

    expect(await screen.findByText('Connected')).toBeTruthy()
    expect(screen.getByText(/Status refreshes every 30 seconds/)).toBeTruthy()
  })

  it('says the app is closed, and what to do about it, when status fails', async () => {
    vi.mocked(getStatus).mockRejectedValue(new Error('ECONNREFUSED'))
    vi.mocked(getServerToken).mockReturnValue(null)
    await renderPage()

    expect(await screen.findByText('Not connected')).toBeTruthy()
    expect(
      screen.getByText(/Open the desktop app and this page reconnects on its own/)
    ).toBeTruthy()
    expect(screen.getByText('Unavailable while the app is closed')).toBeTruthy()
    // No status means no honest claim about the app's screenshot setting.
    expect(screen.getByText('Unknown')).toBeTruthy()
    expect(screen.getByText(/Open the desktop app to see the setting/)).toBeTruthy()
  })

  it('says the token is not issued yet when the app has not sent one', async () => {
    serveStatus(status(), null)
    await renderPage()

    expect(await screen.findByText('Not issued yet')).toBeTruthy()
    expect(screen.getByText(/The app issues one automatically on first contact/)).toBeTruthy()
  })

  it('renders a neutral state before the first status resolves', () => {
    vi.mocked(getStatus).mockReturnValue(new Promise(() => {}))
    vi.mocked(getServerToken).mockReturnValue(null)
    render(<OptionsPage />)

    expect(screen.getByText('Checking')).toBeTruthy()
    expect(screen.getByText('Reading from the app')).toBeTruthy()
    // The address is a constant, so it is stated even before anything resolves.
    expect(screen.getByText('http://127.0.0.1:19845')).toBeTruthy()
  })

  it('is read-only: no control on the page writes anything', async () => {
    const { container } = render(<OptionsPage />)
    await waitFor(() => expect(vi.mocked(getStatus)).toHaveBeenCalled())
    await screen.findByText('Connected')

    expect(
      container.querySelectorAll(
        'input, select, textarea, [role="switch"], [role="checkbox"], [contenteditable]'
      )
    ).toHaveLength(0)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Open Birdbrain settings'])
  })

  it('routes the footnote to app settings, the gear no longer does', async () => {
    await renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Open Birdbrain settings' }))

    expect(createdTabs).toEqual(['birdbrain://settings'])
  })

  it('applies the app theme so the page does not fight the popup', async () => {
    serveStatus(status({ theme: 'light' }))
    await renderPage()

    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false))
    expect(localStorage.getItem('bb-theme')).toBe('light')
  })
})
