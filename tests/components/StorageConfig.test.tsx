// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { BirdbrainSettings } from '@shared/types'

// Strips the animation-only props (they are not valid DOM attributes) and
// forwards the rest — Button renders through motion.button, so dropping props
// here would silently drop its onClick.
vi.mock('motion/react', async () => {
  const React = await import('react')
  const motion = new Proxy(
    {},
    {
      get: (_, tag: string) =>
        React.forwardRef<HTMLElement, Record<string, unknown> & { children?: ReactNode }>(
          ({ children, ...props }, ref) => {
            const {
              initial,
              animate,
              exit,
              transition,
              whileTap,
              whileHover,
              layout,
              ...domProps
            } = props
            void initial
            void animate
            void exit
            void transition
            void whileTap
            void whileHover
            void layout
            // forwardRef wraps P in PropsWithoutRef, which collapses an index-signature
            // props type through Omit and widens children to unknown. Narrow it back.
            return React.createElement(tag, { ...domProps, ref }, children as ReactNode)
          }
        )
    }
  )
  return { motion, AnimatePresence: ({ children }: { children: ReactNode }) => children }
})

import { StorageConfig } from '@renderer/components/settings/StorageConfig'
import { fakeBridge } from '../renderer/fakeBridge'

const RESTART_NOTICE = /restart required/i
const FAILURE = /couldn't update the storage location/i

// StorageConfig reads only storagePath (non-empty so Reset renders), but the
// fixture is complete and checked with `satisfies` rather than cast, so a new
// required field on BirdbrainSettings fails here instead of hiding.
const settings = {
  openRouterApiKey: null,
  defaultModel: 'model-a',
  captureScreenshots: true,
  dedupeWindowSeconds: 5,
  ignoredUrlPatterns: [],
  storagePath: '/home/tester/Birdbrain',
  theme: 'light',
  reduceMotion: false,
  density: 'compact',
  operatorName: '',
  operatorRole: '',
  operatorOrganization: '',
  tsaUrl: 'http://tsa.example.test',
  autoCaptureMode: 'notify',
  lastActiveCaseId: null,
  lastActiveSection: 'overview',
  hasCompletedOnboarding: true,
  analysisSystemPrompt: '',
  detailsPanelCollapsed: false,
  tooltipsSeen: {},
  onboardingChapters: {},
  isFreshInstall: false,
  demoCaseSeeded: false,
  releaseChannel: 'stable',
  autoCheckForUpdates: false
} satisfies BirdbrainSettings

let chooseStoragePath: ReturnType<typeof vi.fn>
let onUpdate: ReturnType<typeof vi.fn>

beforeEach(() => {
  chooseStoragePath = vi.fn(async () => '/home/tester/NewRoot')
  onUpdate = vi.fn(async () => {})
  fakeBridge({ settings: { chooseStoragePath } })
})

afterEach(() => {
  cleanup()
})

function renderConfig() {
  return render(<StorageConfig settings={settings} onUpdate={onUpdate} />)
}

describe('StorageConfig failure surfacing', () => {
  it('surfaces a rejected persist from Browse and withholds the restart notice', async () => {
    onUpdate.mockRejectedValue(new Error('EACCES: permission denied'))
    renderConfig()

    fireEvent.click(screen.getByText('Browse...'))

    expect(await screen.findByText(FAILURE)).toBeTruthy()
    expect(onUpdate).toHaveBeenCalledWith({ storagePath: '/home/tester/NewRoot' })
    // The write never persisted, so a restart notice would advertise a change
    // that did not happen.
    expect(screen.queryByText(RESTART_NOTICE)).toBeNull()
  })

  it('surfaces a rejected persist from Reset and withholds the restart notice', async () => {
    onUpdate.mockRejectedValue(new Error('disk I/O error'))
    renderConfig()

    fireEvent.click(screen.getByText('Reset'))

    expect(await screen.findByText(FAILURE)).toBeTruthy()
    expect(onUpdate).toHaveBeenCalledWith({ storagePath: '' })
    expect(screen.queryByText(RESTART_NOTICE)).toBeNull()
  })

  it('surfaces a rejected folder dialog without attempting a write', async () => {
    chooseStoragePath.mockRejectedValue(new Error('dialog host gone'))
    renderConfig()

    fireEvent.click(screen.getByText('Browse...'))

    expect(await screen.findByText(FAILURE)).toBeTruthy()
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.queryByText(RESTART_NOTICE)).toBeNull()
  })

  it('stays silent when the folder dialog is cancelled', async () => {
    // null is the dialog's cancel signal, not an error — no message, no write.
    chooseStoragePath.mockResolvedValue(null)
    renderConfig()

    fireEvent.click(screen.getByText('Browse...'))

    await waitFor(() => expect(chooseStoragePath).toHaveBeenCalledOnce())
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.queryByText(FAILURE)).toBeNull()
    expect(screen.queryByText(RESTART_NOTICE)).toBeNull()
  })

  it('shows the restart notice after a successful save and clears a prior failure', async () => {
    onUpdate.mockRejectedValueOnce(new Error('EACCES: permission denied'))
    renderConfig()

    fireEvent.click(screen.getByText('Browse...'))
    expect(await screen.findByText(FAILURE)).toBeTruthy()

    fireEvent.click(screen.getByText('Browse...'))

    expect(await screen.findByText(RESTART_NOTICE)).toBeTruthy()
    expect(screen.queryByText(FAILURE)).toBeNull()
  })
})
