// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import type { LaunchedBrowserStatus } from '@shared/types'
import { WINDOW_CONTROLS_RIGHT_PROPERTY } from '@renderer/lib/windowControls'
import { fakeBridge } from './fakeBridge'
import { stubMatchMedia } from '../components/matchMediaStub'

const OPEN: LaunchedBrowserStatus = {
  state: 'open',
  browser: {
    family: 'chromium',
    label: 'Chromium',
    caseId: 'case-1',
    version: '154.0.8037.97',
    extensionWarnings: [],
    sessionStartedAt: null,
    tabs: []
  }
}

describe('the pop-out page (pop-out.html)', () => {
  it('renders the Capture Session window into its root', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    stubMatchMedia(false)
    fakeBridge({
      cases: { list: vi.fn(async () => []) },
      settings: { get: vi.fn(async () => ({ egress: { kind: 'direct' } })) },
      launchedBrowser: { status: vi.fn(async () => OPEN) }
    })
    await import('@renderer/popOut')
    expect(await screen.findByRole('button', { name: 'Dock' })).toBeTruthy()
    expect(await screen.findByText('Launched Chromium')).toBeTruthy()
    // Set before the first render, as in the main window.
    expect(document.documentElement.style.getPropertyValue(WINDOW_CONTROLS_RIGHT_PROPERTY)).toBe(
      '0px'
    )
  })
})
