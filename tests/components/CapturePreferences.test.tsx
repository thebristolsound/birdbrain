// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { BirdbrainSettings } from '@shared/types'
import { validateIgnorePattern } from '@shared/urlPatterns'
import { CapturePreferences } from '@renderer/components/settings/CapturePreferences'
import { fakeBridge } from '../renderer/fakeBridge'

// Asserted, not annotated: CapturePreferences reads two fields off
// BirdbrainSettings, and spelling out the other twenty here would be noise.
// The launched browsers group on the same card reads its own list.
function renderPanel(overrides: Partial<BirdbrainSettings> = {}) {
  const onUpdate = vi.fn(async () => {})
  const settings = {
    captureScreenshots: true,
    ignoredUrlPatterns: [],
    ...overrides
  } as BirdbrainSettings
  fakeBridge({ launchedBrowser: { list: vi.fn(async () => []) } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CapturePreferences settings={settings} onUpdate={onUpdate} />
    </QueryClientProvider>
  )
  return { onUpdate }
}

function screenshotsCheckbox() {
  return screen.getByRole('checkbox', { name: 'Capture screenshots' })
}

describe('CapturePreferences screenshots toggle', () => {
  afterEach(cleanup)

  it('reflects the stored value', () => {
    renderPanel({ captureScreenshots: false })
    expect((screenshotsCheckbox() as HTMLInputElement).checked).toBe(false)
  })

  it('persists a toggle', () => {
    const { onUpdate } = renderPanel({ captureScreenshots: false })
    fireEvent.click(screenshotsCheckbox())
    expect(onUpdate).toHaveBeenCalledWith({ captureScreenshots: true })
  })

  // #473: left native, Chromium paints the box from its own colour scheme, so it
  // stayed blue-on-white against the dark canvas. accent-color (Tailwind
  // `accent-*`) does reach a native control, but it recolours only the checked
  // fill — the unchecked box stays browser-white. appearance-none is the class
  // that makes both states themeable; drop it and the control returns to the
  // browser default regardless of what the token classes below say.
  it('suppresses the native control rendering', () => {
    renderPanel()
    expect(screenshotsCheckbox().className).toContain('appearance-none')
  })

  // These paint the box once appearance-none has removed the native rendering.
  // Dropping one does not restore the native control: without a background the
  // box is unfilled, without a border colour it falls back to currentColor.
  // Each assertion therefore fails for its own reason.
  it('draws the box from theme tokens in both states', () => {
    renderPanel()
    const { className } = screenshotsCheckbox()
    expect(className).toContain('border-border-strong')
    expect(className).toContain('bg-canvas')
    expect(className).toContain('checked:border-accent')
    expect(className).toContain('checked:bg-accent')
  })

  // The class list opts out of the UA outline, so the replacement ring carries
  // the whole keyboard indicator. Full-strength accent, not an alpha tint: over
  // the dark card (#6467f2 on #131316) that is 4.21:1, past WCAG 2.4.11's 3:1,
  // where the /25 tint it replaces was 1.34:1. The offset is what keeps the ring
  // visible when the box is checked and already filled accent.
  it('keeps a visible keyboard focus indicator', () => {
    renderPanel()
    const { className } = screenshotsCheckbox()
    expect(className).toContain('focus-visible:ring-2')
    expect(className).toContain('focus-visible:ring-accent')
    expect(className).toContain('focus-visible:ring-offset-1')
    expect(className).toContain('focus-visible:ring-offset-card')
    expect(className).not.toContain('ring-accent/25')
  })
})

describe('CapturePreferences launched browsers', () => {
  afterEach(cleanup)

  it('holds the launched browsers group', async () => {
    renderPanel()
    expect(screen.getByText('Launched browsers')).toBeDefined()
    expect(await screen.findByText(/found no supported browser/)).toBeDefined()
  })
})

describe('CapturePreferences ignored URL patterns', () => {
  afterEach(cleanup)

  it('adds a trimmed pattern', () => {
    const { onUpdate } = renderPanel({ ignoredUrlPatterns: ['a.com'] })
    fireEvent.change(screen.getByPlaceholderText(/e\.g\./), { target: { value: '  b.com  ' } })
    fireEvent.click(screen.getByText('Add'))
    expect(onUpdate).toHaveBeenCalledWith({ ignoredUrlPatterns: ['a.com', 'b.com'] })
  })

  it('adds on Enter', () => {
    const { onUpdate } = renderPanel()
    const input = screen.getByPlaceholderText(/e\.g\./)
    fireEvent.change(input, { target: { value: 'b.com' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onUpdate).toHaveBeenCalledWith({ ignoredUrlPatterns: ['b.com'] })
  })

  it('ignores a blank pattern', () => {
    const { onUpdate } = renderPanel()
    fireEvent.change(screen.getByPlaceholderText(/e\.g\./), { target: { value: '   ' } })
    fireEvent.click(screen.getByText('Add'))
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('removes a listed pattern', () => {
    const { onUpdate } = renderPanel({ ignoredUrlPatterns: ['a.com', 'b.com'] })
    fireEvent.click(screen.getAllByText('×')[0])
    expect(onUpdate).toHaveBeenCalledWith({ ignoredUrlPatterns: ['b.com'] })
  })

  it('adds a regex pattern that compiles', () => {
    const { onUpdate } = renderPanel()
    fireEvent.change(screen.getByPlaceholderText(/e\.g\./), { target: { value: '/^https:/i' } })
    fireEvent.click(screen.getByText('Add'))
    expect(onUpdate).toHaveBeenCalledWith({ ignoredUrlPatterns: ['/^https:/i'] })
    expect(screen.queryByTestId('ignore-pattern-error')).toBeNull()
  })

  // #724: the same refusal the per-case list gives (AutoCaptureCard), with the
  // engine's reason, and the typed pattern kept so it can be corrected.
  it('refuses an uncompilable pattern inline and stores nothing', () => {
    const { onUpdate } = renderPanel({ ignoredUrlPatterns: ['a.com'] })
    const input = screen.getByPlaceholderText(/e\.g\./) as HTMLInputElement
    fireEvent.change(input, { target: { value: '/[/' } })
    fireEvent.click(screen.getByText('Add'))
    expect(onUpdate).not.toHaveBeenCalled()
    const reason = validateIgnorePattern('/[/')
    expect(reason.ok).toBe(false)
    expect(screen.getByTestId('ignore-pattern-error').textContent).toBe(
      reason.ok ? '' : reason.reason
    )
    expect(input.value).toBe('/[/')
  })

  it('clears the refusal once a valid pattern is added', () => {
    renderPanel()
    const input = screen.getByPlaceholderText(/e\.g\./)
    fireEvent.change(input, { target: { value: '/some/path' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('ignore-pattern-error')).toBeDefined()
    fireEvent.change(input, { target: { value: 'some.com/path' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByTestId('ignore-pattern-error')).toBeNull()
  })

  describe('a pattern stored before the list was validated', () => {
    const stored = ['a.com', '/[/']

    it('keeps it listed and marks it with the reason', () => {
      renderPanel({ ignoredUrlPatterns: stored })
      expect(screen.getByText('/[/')).toBeDefined()
      const marks = screen.getAllByTestId('ignore-pattern-invalid')
      expect(marks).toHaveLength(1)
      const reason = validateIgnorePattern('/[/')
      expect(marks[0].textContent).toBe(reason.ok ? '' : reason.reason)
    })

    // The matcher does not trim, so these exclude nothing as stored, and the row's text
    // does not show the space.
    it.each(['/example/ ', ' example.com'])('marks %j, which has a space at one end', (padded) => {
      renderPanel({ ignoredUrlPatterns: ['a.com', padded] })
      const marks = screen.getAllByTestId('ignore-pattern-invalid')
      expect(marks).toHaveLength(1)
      expect(marks[0].textContent).toBe('Pattern has leading or trailing whitespace')
    })

    it('can remove one with a space at one end, sending the others as stored', () => {
      const { onUpdate } = renderPanel({ ignoredUrlPatterns: ['/example/ ', ' example.com'] })
      fireEvent.click(screen.getAllByText('×')[0])
      expect(onUpdate).toHaveBeenCalledWith({ ignoredUrlPatterns: [' example.com'] })
    })

    // Only the typed pattern is checked: main exempts what is already stored.
    it('does not stop another pattern being added', () => {
      const { onUpdate } = renderPanel({ ignoredUrlPatterns: stored })
      fireEvent.change(screen.getByPlaceholderText(/e\.g\./), { target: { value: 'b.com' } })
      fireEvent.click(screen.getByText('Add'))
      expect(onUpdate).toHaveBeenCalledWith({ ignoredUrlPatterns: [...stored, 'b.com'] })
      expect(screen.queryByTestId('ignore-pattern-error')).toBeNull()
    })

    it('can be removed', () => {
      const { onUpdate } = renderPanel({ ignoredUrlPatterns: stored })
      fireEvent.click(screen.getAllByText('×')[1])
      expect(onUpdate).toHaveBeenCalledWith({ ignoredUrlPatterns: ['a.com'] })
    })

    // Each removal leaves the other invalid pattern in the list.
    it('can be removed one at a time when two are stored', () => {
      const first = renderPanel({ ignoredUrlPatterns: ['/admin/users', '/[/'] })
      fireEvent.click(screen.getAllByText('×')[0])
      expect(first.onUpdate).toHaveBeenCalledWith({ ignoredUrlPatterns: ['/[/'] })
      cleanup()
      const second = renderPanel({ ignoredUrlPatterns: ['/[/'] })
      fireEvent.click(screen.getAllByText('×')[0])
      expect(second.onUpdate).toHaveBeenCalledWith({ ignoredUrlPatterns: [] })
      expect(screen.queryByTestId('ignore-pattern-error')).toBeNull()
    })
  })
})
