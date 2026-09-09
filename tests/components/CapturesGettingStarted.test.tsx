// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { CapturesGettingStarted } from '@renderer/components/captures/CapturesGettingStarted'
import { stubMatchMedia } from './matchMediaStub'
import { fakeBridge } from '../renderer/fakeBridge'

describe('CapturesGettingStarted', () => {
  let openFolder: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stubMatchMedia()
    openFolder = vi.fn().mockResolvedValue(undefined)
    fakeBridge({ extension: { openFolder } })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders three onboarding steps', () => {
    render(<CapturesGettingStarted />)
    expect(screen.getByText('Install the browser extension')).toBeDefined()
    expect(screen.getByText('Start a capture session')).toBeDefined()
    expect(screen.getByText('Browse and investigate')).toBeDefined()
  })

  // Session auto-capture is HOTFIX-disabled in the extension, so step 2 must
  // not say pages are recorded as you browse: an operator who believes that
  // browses a target and collects nothing. Pinned as a string, because the
  // false version reads as perfectly reasonable copy.
  it('describes the session as selector matching, not as recording pages', () => {
    render(<CapturesGettingStarted />)
    expect(
      screen.getByText(
        'Once the extension connects, a Capture Session toggle appears in the header bar — switch it on. The extension then checks each page you visit against your case selectors and flags the matches.'
      )
    ).toBeDefined()
  })

  // SessionControls returns null while the extension is disconnected, which is
  // the state this panel is shown in, so step 2 has to name that precondition
  // before it names the header bar. Asserted separately from the pinned string
  // above: that one fails on any rewrite, this one states what a rewrite must
  // keep (#468).
  it('names the extension connection as the precondition for the session toggle', () => {
    render(<CapturesGettingStarted />)
    const step = screen.getByText(/Capture Session toggle appears in the header bar/)
    expect(step.textContent).toMatch(/^Once the extension connects,/)
  })

  // jsdom does no layout, so the class is the only thing assertable here; the
  // geometry it produces is measured in e2e/empty-captures-state.spec.ts. Pinned
  // because `items-center` reads as the obvious choice and silently clips the top
  // of the illustration once the panel outgrows the pane (#474), and because a
  // misspelled safe utility emits no CSS at all — `items-safe-center` compiles to
  // nothing, which would leave the container at `align-items: normal`.
  it('centres the panel with safe alignment so an overflowing top stays reachable', () => {
    render(<CapturesGettingStarted />)
    const panel = screen.getByTestId('captures-getting-started')
    expect(panel.className).toContain('items-center-safe')
    expect(panel.className).toContain('overflow-y-auto')
    expect(panel.className).not.toMatch(/\bitems-center\b(?!-safe)/)
  })

  it('opens the extension folder when Install Extension clicked', async () => {
    render(<CapturesGettingStarted />)
    fireEvent.click(screen.getByTestId('captures-getting-started-install-btn'))
    expect(openFolder).toHaveBeenCalledTimes(1)
  })

  it('replays the extension tour chapter when Learn more clicked', () => {
    const chapters: string[] = []
    const listener = (e: Event) => {
      chapters.push((e as CustomEvent<{ chapter: string }>).detail.chapter)
    }
    window.addEventListener('birdbrain:tour', listener)
    try {
      render(<CapturesGettingStarted />)
      fireEvent.click(screen.getByTestId('captures-getting-started-learn-more-btn'))
      expect(chapters).toEqual(['ext'])
    } finally {
      window.removeEventListener('birdbrain:tour', listener)
    }
  })
})
