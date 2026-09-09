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

  // #473: left with the native appearance the browser paints the box from its
  // own colour scheme, so it stayed blue-on-white against the dark canvas and
  // no token class could reach it. These two classes are the fix, not styling
  // taste — dropping either returns the control to the browser default.
  it('suppresses the native control rendering', () => {
    renderPanel()
    expect(screenshotsCheckbox().className).toContain('appearance-none')
  })

  it('draws the box from theme tokens in both states', () => {
    renderPanel()
    const { className } = screenshotsCheckbox()
    expect(className).toContain('border-border-strong')
    expect(className).toContain('bg-canvas')
    expect(className).toContain('checked:border-accent')
    expect(className).toContain('checked:bg-accent')
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
