// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CaptureEvent } from '@shared/types'
import { CaptureMenu } from '@renderer/components/captures/CaptureMenu'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'
import { nextTurn } from './menuKeys'

const pasted: CaptureEvent = {
  type: 'received',
  source: 'recapture',
  url: 'https://example.com/evidence',
  timestamp: '2026-08-01T12:00:00.000Z'
}

function recaptureOf(captureId: string): CaptureEvent {
  return { ...pasted, supersedesCaptureId: captureId }
}

function renderAddButton() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CaptureMenu caseId="case1" />
    </QueryClientProvider>
  )
  return screen.getByTestId('capture-menu-btn')
}

beforeEach(() => {
  fakeBridge({})
  useAppStore.setState({ selectedCaptureId: 'cap1', captureEvents: [] })
})

afterEach(() => {
  cleanup()
})

describe('the add button above the capture list', () => {
  it('is named for the one thing it does and opens no menu', () => {
    const add = renderAddButton()
    expect(add.getAttribute('aria-label')).toBe('Paste URLs to capture')
    expect(add.getAttribute('title')).toBe('Paste URLs to capture')
    expect(add.hasAttribute('aria-haspopup')).toBe(false)

    fireEvent.click(add)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByTestId('recapture-btn')).toBeNull()
    expect(screen.queryByTestId('capture-menu-paste-urls')).toBeNull()
  })

  it('opens the paste dialog on one click, and the dialog takes focus', async () => {
    const add = renderAddButton()
    expect(screen.queryByRole('dialog')).toBeNull()

    add.focus()
    fireEvent.click(add)
    const dialog = await screen.findByRole('dialog', { name: 'Paste URLs to capture' })
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    await nextTurn()
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('says a Recapture of the selected Capture is running, and not one of another Capture', () => {
    renderAddButton()
    expect(screen.queryByTestId('recapture-in-progress')).toBeNull()

    act(() => useAppStore.setState({ captureEvents: [recaptureOf('cap2')] }))
    expect(screen.queryByTestId('recapture-in-progress')).toBeNull()

    act(() => useAppStore.setState({ captureEvents: [recaptureOf('cap1')] }))
    expect(screen.getByTestId('recapture-in-progress').textContent).toBe('Recapturing…')

    // A pasted address supersedes no Capture, and no selection is not a match for it.
    act(() => useAppStore.setState({ selectedCaptureId: null, captureEvents: [pasted] }))
    expect(screen.queryByTestId('recapture-in-progress')).toBeNull()
  })
})
