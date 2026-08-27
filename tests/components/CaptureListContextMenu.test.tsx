// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture } from '@shared/types'

// The header menu and the selection bar have their own files; what is under
// test here is the row context menu the list mounts (#701).
vi.mock('@renderer/components/captures/CaptureMenu', () => ({
  CaptureMenu: () => null
}))
vi.mock('@renderer/components/captures/CaptureSelectionBar', () => ({
  CaptureSelectionBar: () => <div data-testid="selection-bar-stub" />
}))

const notifySuccess = vi.hoisted(() => vi.fn())
vi.mock('@renderer/lib/notify', () => ({
  notify: { success: notifySuccess, error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))

import { CaptureList } from '@renderer/components/captures/CaptureList'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'

function makeCapture(id: string, minutesAgo: number): Capture {
  const ts = new Date(Date.UTC(2026, 7, 1, 12, 0, 0) - minutesAgo * 60000).toISOString()
  return {
    id,
    caseId: 'case1',
    url: `https://example.com/${id}`,
    title: `Capture ${id}`,
    hash: `hash-${id}`,
    timestamp: ts,
    createdAt: ts,
    format: 'mhtml',
    method: 'extension'
  }
}

// Newest first is the default sort, so the display order is cap-a, cap-b, cap-c.
const CAPTURES = [makeCapture('cap-a', 1), makeCapture('cap-b', 2), makeCapture('cap-c', 3)]
const TAGS = [{ id: 't1', name: 'evidence', color: '#22c55e' }]

let props: {
  onDeleteSelection: ReturnType<typeof vi.fn>
  onOpenExternal: ReturnType<typeof vi.fn>
  onQuoteIntoNote: ReturnType<typeof vi.fn>
}
let addToCaptures: ReturnType<typeof vi.fn>
let setFavoriteMany: ReturnType<typeof vi.fn>
let enqueueCaptures: ReturnType<typeof vi.fn>
let duplicate: ReturnType<typeof vi.fn>
let toggleFavorite: ReturnType<typeof vi.fn>
let writeText: ReturnType<typeof vi.fn>

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(
    <CaptureList
      caseId="case1"
      view="detailed"
      onChangeView={vi.fn()}
      onCollapse={vi.fn()}
      {...props}
    />,
    { wrapper: Wrapper }
  )
}

async function rows() {
  await screen.findByText('Capture cap-a')
  return screen.getAllByTestId('capture-item')
}

/** Right-click a row and wait for its menu. */
async function openRowMenu(index: number) {
  const list = await rows()
  fireEvent.contextMenu(list[index])
  return screen.findByRole('menu')
}

function check(row: HTMLElement) {
  fireEvent.click(within(row).getByTestId('capture-select-checkbox'))
}

beforeEach(() => {
  props = {
    onDeleteSelection: vi.fn(),
    onOpenExternal: vi.fn(),
    onQuoteIntoNote: vi.fn()
  }
  addToCaptures = vi.fn(async () => ({ affected: 1 }))
  setFavoriteMany = vi.fn(async () => ({ affected: 2 }))
  enqueueCaptures = vi.fn(async () => ({ accepted: 2, rejected: [] }))
  duplicate = vi.fn(async () => ({ status: 'duplicated', capture: CAPTURES[0] }))
  toggleFavorite = vi.fn(async () => true)
  writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true
  })
  fakeBridge({
    captures: {
      list: vi.fn(async () => CAPTURES),
      listFavorites: vi.fn(async () => []),
      getMatchingSelectors: vi.fn(async () => []),
      getThumbnail: vi.fn(async () => null),
      toggleFavorite,
      setFavoriteMany,
      duplicate
    },
    tags: { list: vi.fn(async () => TAGS), addToCaptures },
    recapture: { enqueueCaptures }
  })
  useAppStore.setState({
    selectedCaptureId: null,
    selectedCaptureIds: new Set(),
    selectionAnchorId: null,
    filteredCaptureIds: null,
    activeSelectorFilters: []
  })
})

afterEach(() => {
  cleanup()
  notifySuccess.mockReset()
  useAppStore.getState().clearCaptureSelection()
  useAppStore.getState().setSelectedCaptureId(null)
})

describe('capture row context menu', () => {
  it('names the right-clicked row, not the selected one', async () => {
    renderList()
    const list = await rows()
    fireEvent.click(list[0])
    expect(useAppStore.getState().selectedCaptureId).toBe('cap-a')

    fireEvent.contextMenu(list[2])

    const menu = await screen.findByRole('menu')
    expect(menu.getAttribute('aria-label')).toBe('Capture actions: Capture cap-c')
  })

  it('does not change the selection just because a row was right-clicked', async () => {
    renderList()
    await openRowMenu(1)

    expect(useAppStore.getState().selectedCaptureId).toBeNull()
    expect(useAppStore.getState().selectedCaptureIds.size).toBe(0)
  })

  it('opens the capture from the menu, same as clicking the row', async () => {
    renderList()
    await openRowMenu(1)

    fireEvent.click(screen.getByTestId('context-menu-item-capture-open'))

    expect(useAppStore.getState().selectedCaptureId).toBe('cap-b')
  })

  it('copies the right-clicked row’s URL and digest, not the selected row’s', async () => {
    renderList()
    const list = await rows()
    fireEvent.click(list[0])

    fireEvent.contextMenu(list[2])
    await screen.findByRole('menu')
    fireEvent.click(screen.getByTestId('context-menu-item-capture-copy-url'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://example.com/cap-c'))

    fireEvent.contextMenu(list[2])
    await screen.findByRole('menu')
    fireEvent.click(screen.getByTestId('context-menu-item-capture-copy-hash'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('hash-cap-c'))
  })

  it('hands the route the row the operator aimed at, for both dialogs it owns', async () => {
    renderList()
    await openRowMenu(2)
    fireEvent.click(screen.getByTestId('context-menu-item-capture-open-source'))
    expect(props.onOpenExternal).toHaveBeenCalledWith('https://example.com/cap-c')

    await openRowMenu(2)
    fireEvent.click(screen.getByTestId('context-menu-item-capture-quote-note'))
    expect(props.onQuoteIntoNote).toHaveBeenCalledWith('cap-c')
  })

  it('duplicates and favourites the right-clicked row', async () => {
    renderList()
    await openRowMenu(1)
    fireEvent.click(screen.getByTestId('context-menu-item-capture-duplicate'))
    await waitFor(() => expect(duplicate).toHaveBeenCalledWith('cap-b'))

    await openRowMenu(1)
    fireEvent.click(screen.getByTestId('context-menu-item-capture-favorite'))
    await waitFor(() => expect(toggleFavorite).toHaveBeenCalledWith('cap-b'))
  })

  it('applies a tag from the submenu to the one row', async () => {
    renderList()
    await openRowMenu(1)

    fireEvent.keyDown(screen.getByTestId('context-menu-item-capture-add-tag'), { key: 'Enter' })
    fireEvent.click(await screen.findByText('evidence'))

    await waitFor(() =>
      expect(addToCaptures).toHaveBeenCalledWith({
        caseId: 'case1',
        captureIds: ['cap-b'],
        tagId: 't1'
      })
    )
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Tag applied to 1 capture'))
  })

  it('sends one row to the delete confirmation, not the whole list', async () => {
    renderList()
    await openRowMenu(1)

    fireEvent.click(screen.getByTestId('context-menu-item-capture-delete'))

    expect(props.onDeleteSelection).toHaveBeenCalledWith(['cap-b'])
  })
})

// R20. The destructive case is the acceptance criterion: inside the selection
// the menu acts on all of it, outside it acts on the one row.
describe('capture row context menu, selection-aware (R20)', () => {
  async function selectTwo() {
    const list = await rows()
    check(list[0])
    check(list[1])
    return list
  }

  it('acts on the whole selection when the row is inside it, and says so', async () => {
    renderList()
    const list = await selectTwo()

    fireEvent.contextMenu(list[0])
    const menu = await screen.findByRole('menu')

    expect(menu.getAttribute('aria-label')).toBe('Actions for 2 captures')
    expect(screen.getByTestId('context-menu-item-capture-delete').textContent).toContain(
      'Delete 2 captures…'
    )

    fireEvent.click(screen.getByTestId('context-menu-item-capture-delete'))
    expect(props.onDeleteSelection).toHaveBeenCalledWith(['cap-a', 'cap-b'])
  })

  it('acts on that row alone when the row is outside the selection', async () => {
    renderList()
    const list = await selectTwo()

    fireEvent.contextMenu(list[2])
    const menu = await screen.findByRole('menu')

    expect(menu.getAttribute('aria-label')).toBe('Capture actions: Capture cap-c')

    fireEvent.click(screen.getByTestId('context-menu-item-capture-delete'))
    expect(props.onDeleteSelection).toHaveBeenCalledWith(['cap-c'])
  })

  it('favourites and recaptures the whole selection through the batch routes', async () => {
    renderList()
    const list = await selectTwo()

    fireEvent.contextMenu(list[1])
    await screen.findByRole('menu')
    fireEvent.click(screen.getByTestId('context-menu-item-capture-favorite'))
    await waitFor(() =>
      expect(setFavoriteMany).toHaveBeenCalledWith({
        caseId: 'case1',
        captureIds: ['cap-a', 'cap-b'],
        favorite: true
      })
    )

    fireEvent.contextMenu(list[1])
    await screen.findByRole('menu')
    fireEvent.click(screen.getByTestId('context-menu-item-capture-recapture'))
    await waitFor(() =>
      expect(enqueueCaptures).toHaveBeenCalledWith({
        caseId: 'case1',
        captureIds: ['cap-a', 'cap-b']
      })
    )
  })

  it('tags the whole selection and counts it in the confirmation', async () => {
    addToCaptures.mockResolvedValue({ affected: 2 })
    renderList()
    const list = await selectTwo()

    fireEvent.contextMenu(list[0])
    await screen.findByRole('menu')
    fireEvent.keyDown(screen.getByTestId('context-menu-item-capture-add-tag'), { key: 'Enter' })
    fireEvent.click(await screen.findByText('evidence'))

    await waitFor(() =>
      expect(addToCaptures).toHaveBeenCalledWith({
        caseId: 'case1',
        captureIds: ['cap-a', 'cap-b'],
        tagId: 't1'
      })
    )
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Tag applied to 2 captures'))
  })

  it('clears the selection from the menu, the same as Escape does', async () => {
    renderList()
    const list = await selectTwo()

    fireEvent.contextMenu(list[0])
    await screen.findByRole('menu')
    fireEvent.click(screen.getByTestId('context-menu-item-capture-clear-selection'))

    await waitFor(() => expect(useAppStore.getState().selectedCaptureIds.size).toBe(0))
  })

  it('drops the row out of the selection without touching the rest', async () => {
    renderList()
    const list = await selectTwo()

    fireEvent.contextMenu(list[0])
    await screen.findByRole('menu')
    fireEvent.click(screen.getByTestId('context-menu-item-capture-deselect'))

    await waitFor(() => expect([...useAppStore.getState().selectedCaptureIds]).toEqual(['cap-b']))
  })

  // One selected row is still one capture, so the row keeps its own action set
  // rather than a selection of one.
  it('keeps the single-row set when only one row is selected', async () => {
    renderList()
    const list = await rows()
    check(list[0])

    fireEvent.contextMenu(list[0])
    const menu = await screen.findByRole('menu')

    expect(menu.getAttribute('aria-label')).toBe('Capture actions: Capture cap-a')
    expect(screen.getByTestId('context-menu-item-capture-toggle-selection').textContent).toContain(
      'Remove from selection'
    )
  })

  // The selection bar is on screen exactly while a multi-selection is, and its
  // Escape is what the menu's guard attribute stands in front of.
  it('does not empty the selection when Escape closes the menu', async () => {
    renderList()
    const list = await selectTwo()

    fireEvent.contextMenu(list[0])
    const menu = await screen.findByRole('menu')

    // One Escape. It bubbles to the window listener the list installed, which
    // must stand down because the menu's guard attribute is on screen.
    fireEvent.keyDown(menu, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(useAppStore.getState().selectedCaptureIds.size).toBe(2)

    // The next Escape, with no menu up, is the selection's again.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useAppStore.getState().selectedCaptureIds.size).toBe(0)
  })
})
