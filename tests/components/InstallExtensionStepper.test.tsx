// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { InstallExtensionStepper } from '@renderer/components/extension/InstallExtensionStepper'
import { stubMatchMedia } from './matchMediaStub'

describe('InstallExtensionStepper', () => {
  beforeEach(() => {
    stubMatchMedia()
  })

  afterEach(() => {
    cleanup()
  })

  // #469: step 3's illustration painted "Extension installed · Active" in the
  // same live-status green the app uses for a connected extension, directly
  // above the real status. Both marks are pinned as strings because the green
  // version reads as perfectly reasonable markup.
  it('labels the step 3 outcome as an example, not as a live Active status', () => {
    render(<InstallExtensionStepper step={2} />)
    const outcome = screen.getByTestId('install-step-outcome')
    expect(outcome.textContent).toContain('Extension installed')
    expect(outcome.textContent).toContain('Example')
    expect(screen.queryByText('Active')).toBeNull()
  })

  it('paints the step 3 outcome in neutral tokens rather than live-status green', () => {
    render(<InstallExtensionStepper step={2} />)
    const outcome = screen.getByTestId('install-step-outcome')
    expect(outcome.className).not.toContain('emerald')
    expect(outcome.querySelectorAll('[class*="emerald"]').length).toBe(0)
  })

  it('renders the folder-picker illustration for step 3', () => {
    render(<InstallExtensionStepper step={2} />)
    expect(screen.getByText('Select the extension folder')).toBeDefined()
    expect(screen.getByText('~/birdbrain/extension')).toBeDefined()
  })
})
