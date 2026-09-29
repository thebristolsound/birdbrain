// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { BirdbrainSettings, CaseAutoCapturePolicy } from '@shared/types'
import { AutoCaptureCard } from '@renderer/components/signals/AutoCaptureCard'
import { fakeBridge } from '../renderer/fakeBridge'

const SETTINGS = {
  autoCaptureMode: 'notify',
  ignoredUrlPatterns: ['facebook.com', 'x.com']
} as unknown as BirdbrainSettings

function renderCard(
  policy: CaseAutoCapturePolicy = { exclusions: [], mode: 'stack' },
  settings: BirdbrainSettings = SETTINGS
) {
  const getAutoCapturePolicy = vi.fn(async () => policy)
  const setAutoCapturePolicy = vi.fn(async () => policy)
  const update = vi.fn(async () => settings)
  fakeBridge({
    cases: { getAutoCapturePolicy, setAutoCapturePolicy },
    settings: { get: vi.fn(async () => settings), update }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  render(<AutoCaptureCard caseId="case-1" />, { wrapper: Wrapper })
  return { setAutoCapturePolicy, update }
}

async function openDisclosure() {
  const summary = await screen.findByTestId('exclusions-summary')
  fireEvent.click(summary)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AutoCaptureCard summary and disclosure', () => {
  it('summarises the exclusion count and what it does to the global list', async () => {
    renderCard({ exclusions: ['a.com', 'b.com', 'c.com'], mode: 'override' })

    await waitFor(() =>
      expect(screen.getByTestId('exclusions-summary').textContent).toContain(
        '3 exclusions · overrides global'
      )
    )
  })

  it('opens and closes the exclusion list', async () => {
    renderCard()
    expect(screen.queryByTestId('exclusion-input')).toBeNull()

    await openDisclosure()
    expect(screen.getByTestId('exclusion-input')).toBeTruthy()

    fireEvent.click(screen.getByTestId('exclusions-summary'))
    expect(screen.queryByTestId('exclusion-input')).toBeNull()
  })
})

describe('AutoCaptureCard exclusion editing', () => {
  it('adds a trimmed pattern on Enter', async () => {
    const { setAutoCapturePolicy } = renderCard({ exclusions: ['a.com'], mode: 'stack' })
    await openDisclosure()

    const input = screen.getByTestId('exclusion-input')
    fireEvent.change(input, { target: { value: '  mail.google.com  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(setAutoCapturePolicy).toHaveBeenCalledWith({
        caseId: 'case-1',
        exclusions: ['a.com', 'mail.google.com'],
        mode: 'stack'
      })
    )
  })

  it('refuses an exact duplicate and says so', async () => {
    const { setAutoCapturePolicy } = renderCard({ exclusions: ['a.com'], mode: 'stack' })
    await openDisclosure()

    const input = screen.getByTestId('exclusion-input')
    fireEvent.change(input, { target: { value: 'a.com' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(setAutoCapturePolicy).not.toHaveBeenCalled()
    expect(screen.getByTestId('exclusion-error').textContent).toContain('already excluded')
  })

  // A pattern that cannot compile is skipped by the matcher, so storing one
  // would leave a chip on screen that excludes nothing.
  it('refuses an uncompilable regex before it becomes a chip', async () => {
    const { setAutoCapturePolicy } = renderCard()
    await openDisclosure()

    const input = screen.getByTestId('exclusion-input')
    fireEvent.change(input, { target: { value: '/[/' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(setAutoCapturePolicy).not.toHaveBeenCalled()
    expect(screen.getByTestId('exclusion-error')).toBeTruthy()
  })

  it('ignores Enter on an empty input', async () => {
    const { setAutoCapturePolicy } = renderCard()
    await openDisclosure()

    fireEvent.keyDown(screen.getByTestId('exclusion-input'), { key: 'Enter' })

    expect(setAutoCapturePolicy).not.toHaveBeenCalled()
  })

  it('removes the chip that was asked for, not the first one', async () => {
    const { setAutoCapturePolicy } = renderCard({
      exclusions: ['a.com', 'b.com', 'c.com'],
      mode: 'stack'
    })
    await openDisclosure()

    fireEvent.click(screen.getByLabelText('Remove exclusion b.com'))

    await waitFor(() =>
      expect(setAutoCapturePolicy).toHaveBeenCalledWith({
        caseId: 'case-1',
        exclusions: ['a.com', 'c.com'],
        mode: 'stack'
      })
    )
  })

  it('writes the mode without disturbing the list', async () => {
    const { setAutoCapturePolicy } = renderCard({ exclusions: ['a.com'], mode: 'stack' })
    await openDisclosure()

    fireEvent.click(screen.getByRole('radio', { name: 'Override global' }))

    await waitFor(() =>
      expect(setAutoCapturePolicy).toHaveBeenCalledWith({
        caseId: 'case-1',
        exclusions: ['a.com'],
        mode: 'override'
      })
    )
  })
})

describe('AutoCaptureCard footer copy', () => {
  it('states the live global count and points at Capture Preferences', async () => {
    renderCard({ exclusions: [], mode: 'stack' })
    await openDisclosure()

    const footer = screen.getByTestId('exclusion-footer').textContent ?? ''
    expect(footer).toContain('(2 entries, Settings → Capture Preferences)')
    expect(footer).not.toContain('Privacy')
  })

  it('names every capture route rather than only selectors', async () => {
    renderCard({ exclusions: [], mode: 'stack' })
    await openDisclosure()

    expect(screen.getByTestId('exclusion-footer').textContent).toContain(
      'by any route, including manual capture'
    )
  })

  it('says the global list is bypassed under override', async () => {
    renderCard({ exclusions: [], mode: 'override' })
    await openDisclosure()

    expect(screen.getByTestId('exclusion-footer').textContent).toContain('is bypassed')
  })
})

describe('AutoCaptureCard switch', () => {
  it('reads off for notify and writes per-case when switched on', async () => {
    const { update } = renderCard()

    const toggle = await screen.findByTestId('auto-capture-switch')
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'))
    fireEvent.click(toggle)

    await waitFor(() => expect(update).toHaveBeenCalledWith({ autoCaptureMode: 'per-case' }))
  })

  it('reads on for per-case and writes notify when switched off', async () => {
    const { update } = renderCard(
      { exclusions: [], mode: 'stack' },
      { ...SETTINGS, autoCaptureMode: 'per-case' }
    )

    const toggle = await screen.findByTestId('auto-capture-switch')
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
    fireEvent.click(toggle)

    await waitFor(() => expect(update).toHaveBeenCalledWith({ autoCaptureMode: 'notify' }))
  })

  // A two-state control cannot represent 'auto', and silently rewriting a
  // capture policy to something narrower is the wrong failure on this tool.
  it('locks on for the auto mode rather than downgrading it', async () => {
    const { update } = renderCard(
      { exclusions: [], mode: 'stack' },
      { ...SETTINGS, autoCaptureMode: 'auto' }
    )

    const toggle = await screen.findByTestId('auto-capture-switch')
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
    expect(toggle).toHaveProperty('disabled', true)
    fireEvent.click(toggle)

    expect(update).not.toHaveBeenCalled()
    expect(screen.getByTestId('auto-capture-locked').textContent).toContain('capture every page')
  })

  it('says the setting is app-wide, not case-level', async () => {
    renderCard()

    expect(await screen.findByText(/Applies to every case/)).toBeTruthy()
    expect(screen.queryByText(/Case-level/)).toBeNull()
  })

  // The description and the disclosure are one claim between them: without the
  // second the first overstates what the build does, so both are pinned here
  // as well as in signalsModel.test.ts.
  it('describes the setting without claiming browsing captures pages today', async () => {
    renderCard()

    const description = (await screen.findByTestId('auto-capture-description')).textContent ?? ''
    expect(description).not.toMatch(/captured automatically/)
  })

  it('discloses that passive capture is suspended', async () => {
    renderCard()

    const suspended = (await screen.findByTestId('auto-capture-suspended')).textContent ?? ''
    expect(suspended).toContain('Passive capture is suspended')
    expect(suspended).toContain('without an explicit action')
  })
})
