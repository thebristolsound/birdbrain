// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { BirdbrainSettings } from '@shared/types'
import { CapturePreferences } from '@renderer/components/settings/CapturePreferences'

// Asserted, not annotated: CapturePreferences reads two fields off
// BirdbrainSettings, and spelling out the other twenty here would be noise.
function renderPanel(overrides: Partial<BirdbrainSettings> = {}) {
  const onUpdate = vi.fn(async () => {})
  const settings = {
    captureScreenshots: true,
    ignoredUrlPatterns: [],
    ...overrides
  } as BirdbrainSettings
  render(<CapturePreferences settings={settings} onUpdate={onUpdate} />)
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
})
