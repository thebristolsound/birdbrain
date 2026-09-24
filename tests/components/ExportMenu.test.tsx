// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { ArchiveExportResult } from '@shared/ipc'

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

const notifySuccess = vi.hoisted(() => vi.fn())
const notifyError = vi.hoisted(() => vi.fn())
vi.mock('@renderer/lib/notify', () => ({
  notify: { success: notifySuccess, error: notifyError }
}))

import { ExportMenu } from '@renderer/components/export/ExportMenu'
import { fakeBridge } from '../renderer/fakeBridge'

const ARCHIVE_PATH = '/home/tester/Case_One.bbcase'

function renderMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<ExportMenu caseId="case-1" caseName="Case One" />, { wrapper: Wrapper })
}

function chooseExportCaseFile() {
  fireEvent.click(screen.getByRole('button', { name: 'Export' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /export case file/i }))
}

// Drives the menu to a completed archive export and returns the toast's
// options, where the "Show in folder" affordance now lives.
async function exportArchiveThen() {
  renderMenu()
  chooseExportCaseFile()
  await waitFor(() => expect(notifySuccess).toHaveBeenCalledOnce())
  const [title, opts] = notifySuccess.mock.calls[0]
  expect(title).toBe('Archive saved')
  return opts
}

describe('ExportMenu', () => {
  let exportArchive: ReturnType<typeof vi.fn>
  let showItemInFolder: ReturnType<typeof vi.fn>

  beforeEach(() => {
    exportArchive = vi.fn().mockResolvedValue({
      canceled: false,
      filePath: ARCHIVE_PATH
    } satisfies ArchiveExportResult)
    showItemInFolder = vi.fn().mockResolvedValue(undefined)
    fakeBridge({
      cases: { exportArchive },
      shell: { showItemInFolder }
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    notifySuccess.mockReset()
    notifyError.mockReset()
  })

  // The mock reports an archive as a transient toast with the path as its
  // subtitle (Birdbrain.dc.html 3907-3918), not an anchored banner.
  it('reports a saved archive as a toast with the path and a reveal action', async () => {
    const opts = await exportArchiveThen()

    expect(opts.description).toBe(ARCHIVE_PATH)
    expect(screen.queryByText('Archive saved')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()

    opts.action.onClick()
    await waitFor(() => expect(showItemInFolder).toHaveBeenCalledWith(ARCHIVE_PATH))
  })

  it('surfaces a failed reveal as an error toast', async () => {
    showItemInFolder.mockRejectedValue(new Error(`no such directory: ${ARCHIVE_PATH}`))
    const opts = await exportArchiveThen()

    opts.action.onClick()

    await waitFor(() => expect(notifyError).toHaveBeenCalledOnce())
    expect(notifyError.mock.calls[0][0]).toBe("Couldn't show the file in its folder.")
  })

  it('raises no toast when the save dialog is canceled', async () => {
    exportArchive.mockResolvedValue({ canceled: true } satisfies ArchiveExportResult)
    renderMenu()
    chooseExportCaseFile()

    await waitFor(() => expect(exportArchive).toHaveBeenCalledOnce())
    expect(notifySuccess).not.toHaveBeenCalled()
  })

  // UI pass finding: the failure banner had no close control and outlived
  // navigation. It stays until dismissed, and now it can be.
  it('keeps a failed archive on screen until the operator dismisses it', async () => {
    exportArchive.mockRejectedValue(new Error('disk full'))
    renderMenu()
    chooseExportCaseFile()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('disk full')
    expect(notifySuccess).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
