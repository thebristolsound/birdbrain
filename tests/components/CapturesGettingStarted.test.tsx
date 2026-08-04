// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { CapturesGettingStarted } from '@renderer/components/captures/CapturesGettingStarted'
import { useAppStore } from '@renderer/stores/appStore'
import { stubMatchMedia } from './matchMediaStub'
import { fakeBridge } from '../renderer/fakeBridge'

describe('CapturesGettingStarted', () => {
  let openFolder: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stubMatchMedia()
    openFolder = vi.fn().mockResolvedValue(undefined)
    fakeBridge({ extension: { openFolder } })
    useAppStore.setState({ onboardingOverlayOpen: false })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders three onboarding steps', () => {
    render(<CapturesGettingStarted />)
    expect(screen.getByText('Install the browser extension')).toBeDefined()
    expect(screen.getByText('Enable Auto-Capture')).toBeDefined()
    expect(screen.getByText('Browse and investigate')).toBeDefined()
  })

  it('opens the extension folder when Install Extension clicked', async () => {
    render(<CapturesGettingStarted />)
    fireEvent.click(screen.getByTestId('captures-getting-started-install-btn'))
    expect(openFolder).toHaveBeenCalledTimes(1)
  })

  it('opens the onboarding overlay when Learn more clicked', () => {
    render(<CapturesGettingStarted />)
    expect(useAppStore.getState().onboardingOverlayOpen).toBe(false)
    fireEvent.click(screen.getByTestId('captures-getting-started-learn-more-btn'))
    expect(useAppStore.getState().onboardingOverlayOpen).toBe(true)
  })
})
