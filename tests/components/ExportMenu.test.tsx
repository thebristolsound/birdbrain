// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { ArchiveExportResult } from '@shared/ipc'

// Strips the animation-only props (they are not valid DOM attributes) and
// forwards the rest — Button renders through motion.button, so dropping props
// here would silently drop its onClick.
//
// One component per tag, cached: a fresh forwardRef on every property read is
// a new component type on every render, so React would remount the Export
// trigger each time and a focus hand-back would aim at a detached node.
vi.mock('motion/react', async () => {
  const React = await import('react')
  const components = new Map<string, unknown>()
  const motion = new Proxy(
    {},
    {
      get: (_, tag: string) => {
        if (!components.has(tag)) components.set(tag, makeMotionComponent(tag))
        return components.get(tag)
      }
    }
  )
  function makeMotionComponent(tag: string) {
    return React.forwardRef<HTMLElement, Record<string, unknown> & { children?: ReactNode }>(
      ({ children, ...props }, ref) => {
        const { initial, animate, exit, transition, whileTap, whileHover, layout, ...domProps } =
          props
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
  return { motion, AnimatePresence: ({ children }: { children: ReactNode }) => children }
})

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

// Drives the menu to the state where the "Show in folder" affordance exists:
// it only appears on the success banner of a completed archive export.
async function exportArchiveThen() {
  renderMenu()
  fireEvent.click(screen.getByRole('button', { name: 'Export' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /export case file/i }))
  expect(await screen.findByText('Archive saved')).toBeDefined()
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
  })

  it('reveals the exported archive with no error banner on success', async () => {
    await exportArchiveThen()

    fireEvent.click(screen.getByText('Show in folder'))

    await waitFor(() => expect(showItemInFolder).toHaveBeenCalledWith(ARCHIVE_PATH))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('surfaces a failed reveal through the export error banner', async () => {
    // Path-bearing on purpose: a real shell error names the path it failed on.
    showItemInFolder.mockRejectedValue(new Error(`no such directory: ${ARCHIVE_PATH}`))
    await exportArchiveThen()

    fireEvent.click(screen.getByText('Show in folder'))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('no such directory')
    // The banner is local component state, which #350's third criterion
    // explicitly permits to show the path — same as ExportComplete's
    // actionError, the reference implementation the issue names. Asserted so
    // the decision is pinned rather than ambient.
    expect(alert.textContent).toContain(ARCHIVE_PATH)
  })

  // The menu item unmounts with the menu, so the dialog would record a
  // detached opener. The trigger stands in for it, and gets focus back when
  // the dialog closes (#1536).
  it('hands focus back to the Export trigger when the report dialog closes', () => {
    fakeBridge({
      cases: { exportArchive, get: vi.fn(async () => null) },
      shell: { showItemInFolder },
      export: { preflight: vi.fn(async () => null) },
      wayback: { listForCase: vi.fn(async () => []) }
    })
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'Export' })
    fireEvent.click(trigger)
    const item = screen.getByRole('menuitem', { name: /export evidence report/i })
    item.focus()

    fireEvent.click(item)
    const dialog = screen.getByRole('dialog', { name: 'Export case' })
    expect(dialog.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
