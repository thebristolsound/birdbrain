// @vitest-environment jsdom
//
// The pre-v11 HTML evidence viewer (#906). What matters here is the shape of the
// mount rather than the denial itself: the denial is main-process
// (hardenWebviewSessions -> decideWebviewRequest, covered by
// tests/main/webviewPolicy.test.ts), and it only reaches this component through
// the partition the element declares. So the partition, the JavaScript setting and
// the absence of the presence-is-truth attributes are the answers this file keeps.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { LEGACY_HTML_PARTITION } from '@shared/constants'
import { LegacyHtmlViewer } from '@renderer/components/captures/LegacyHtmlViewer'
import { fakeBridge } from '../renderer/fakeBridge'

const FILE_URL = 'file:///store/case1/cap1.html'

function renderViewer(emptyLabel?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<LegacyHtmlViewer captureId="cap1" emptyLabel={emptyLabel} />, { wrapper: Wrapper })
}

beforeEach(() => {
  fakeBridge({ captures: { getHtmlUrl: vi.fn().mockResolvedValue(FILE_URL) } })
})

afterEach(() => {
  cleanup()
})

describe('LegacyHtmlViewer', () => {
  it('mounts the artefact as a guest on the no-network partition', async () => {
    const { container } = renderViewer()

    const guest = await screen.findByTestId('legacy-html-viewer')
    expect(guest.getAttribute('src')).toBe(FILE_URL)
    expect(guest.getAttribute('partition')).toBe(LEGACY_HTML_PARTITION)
    expect(guest.getAttribute('webpreferences')).toContain('javascript=no')
    expect(guest.getAttribute('webpreferences')).toContain('sandbox=yes')
    // Presence is truth for these two, so absence is the posture.
    expect(guest.getAttribute('nodeintegration')).toBeNull()
    expect(guest.getAttribute('allowpopups')).toBeNull()
    // The frame this replaced is gone rather than kept as a fallback.
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('disables links in the guest once it is ready', async () => {
    renderViewer()
    const guest = await screen.findByTestId('legacy-html-viewer')
    const insertCSS = vi.fn()
    Object.assign(guest, { insertCSS })

    fireEvent(guest, new Event('dom-ready'))

    expect(insertCSS).toHaveBeenCalledOnce()
    expect(insertCSS.mock.calls[0][0]).toContain('pointer-events: none')
  })

  it('refuses a navigation the guest attempts anyway', async () => {
    renderViewer()
    const guest = await screen.findByTestId('legacy-html-viewer')

    for (const type of ['will-navigate', 'new-window']) {
      const event = new Event(type, { cancelable: true })
      fireEvent(guest, event)
      expect(event.defaultPrevented).toBe(true)
    }
  })

  it('words the missing-artefact state for the pane it is mounted in', async () => {
    fakeBridge({ captures: { getHtmlUrl: vi.fn().mockResolvedValue(null) } })
    renderViewer('No stored page archive available')

    expect(await screen.findByText('No stored page archive available')).toBeDefined()
    expect(screen.queryByTestId('legacy-html-viewer')).toBeNull()
  })

  it('surfaces a failure to resolve the artefact rather than rendering an empty guest', async () => {
    fakeBridge({
      captures: { getHtmlUrl: vi.fn().mockRejectedValue(new Error('EACCES')) }
    })
    renderViewer()

    await waitFor(() => expect(screen.getByText(/EACCES/)).toBeDefined())
    expect(screen.queryByTestId('legacy-html-viewer')).toBeNull()
  })
})
