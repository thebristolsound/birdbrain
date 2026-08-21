// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture } from '@shared/types'

// The header's capture menu and the bar itself each have their own graph and
// their own coverage; what is under test here is the wiring between the rows,
// the gesture hook and the bar's props.
vi.mock('@renderer/components/captures/CaptureMenu', () => ({
  CaptureMenu: () => null
}))

const barProps = vi.hoisted(() => vi.fn())
vi.mock('@renderer/components/captures/CaptureSelectionBar', () => ({
  CaptureSelectionBar: (props: {
    selectedIds: string[]
    allSelected: boolean
    onToggleSelectAll: () => void
    onClear: () => void
    onDeleteSelection: (ids: string[]) => void
  }) => {
    barProps(props)
    return (
      <div data-testid="selection-bar-stub">
        <span>{props.selectedIds.length} selected</span>
        <span>{props.allSelected ? 'all' : 'some'}</span>
        <button onClick={props.onToggleSelectAll}>bar: toggle all</button>
        <button onClick={props.onClear}>bar: clear</button>
        <button onClick={() => props.onDeleteSelection(props.selectedIds)}>bar: delete</button>
      </div>
    )
  }
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

let onDeleteSelection: ReturnType<typeof vi.fn>

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<CaptureList caseId="case1" onDeleteSelection={onDeleteSelection} />, {
    wrapper: Wrapper
  })
}

async function rows() {
  await screen.findByText('Capture cap-a')
  return screen.getAllByTestId('capture-item')
}

beforeEach(() => {
  onDeleteSelection = vi.fn()
  fakeBridge({
    captures: {
      list: vi.fn(async () => CAPTURES),
      listFavorites: vi.fn(async () => []),
      getMatchingSelectors: vi.fn(async () => []),
      getThumbnail: vi.fn(async () => null)
    }
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
  barProps.mockReset()
  useAppStore.getState().clearCaptureSelection()
  useAppStore.getState().setSelectedCaptureId(null)
})

describe('CaptureList selection', () => {
  it('keeps the bar hidden until a row is checked, then shows the visible count', async () => {
    renderList()
    const [first] = await rows()
    expect(screen.queryByTestId('selection-bar-stub')).toBeNull()

    // A plain row click moves the detail selection only — never the multi-set.
    fireEvent.click(first)
    expect(useAppStore.getState().selectedCaptureId).toBe('cap-a')
    expect(screen.queryByTestId('selection-bar-stub')).toBeNull()

    fireEvent.click(within(first).getByTestId('capture-select-checkbox'))
    const bar = screen.getByTestId('selection-bar-stub')
    expect(within(bar).getByText('1 selected')).toBeDefined()
    expect(within(bar).getByText('some')).toBeDefined()
  })

  it('shows the rail and a checked box on multi-selected rows only', async () => {
    renderList()
    const [first, second] = await rows()

    fireEvent.click(within(first).getByTestId('capture-select-checkbox'))

    expect(within(first).getByTestId('capture-multiselect-rail')).toBeDefined()
    expect(within(second).queryByTestId('capture-multiselect-rail')).toBeNull()
    expect(within(first).getByRole('checkbox')).toHaveProperty('ariaChecked', 'true')
    expect(within(first).getByLabelText('Deselect capture')).toBeDefined()
    // Sticky mode: every row's checkbox is visible once anything is checked.
    expect(within(second).getByTestId('capture-select-checkbox').className).toContain('opacity-100')
  })

  it('cmd-clicks and shift-clicks rows into a range without disturbing the detail pane', async () => {
    renderList()
    const [first, , third] = await rows()

    fireEvent.click(first, { metaKey: true })
    expect(useAppStore.getState().selectedCaptureId).toBeNull()
    fireEvent.click(third, { shiftKey: true })

    expect([...useAppStore.getState().selectedCaptureIds].sort()).toEqual([
      'cap-a',
      'cap-b',
      'cap-c'
    ])
    expect(within(screen.getByTestId('selection-bar-stub')).getByText('all')).toBeDefined()
  })

  it('reuses the row gesture for keyboard activation', async () => {
    renderList()
    const [, second] = await rows()

    fireEvent.keyDown(second, { key: 'Enter' })
    expect(useAppStore.getState().selectedCaptureId).toBe('cap-b')

    fireEvent.keyDown(second, { key: ' ', metaKey: true })
    expect([...useAppStore.getState().selectedCaptureIds]).toEqual(['cap-b'])
  })

  it('suppresses the native text selection a shift-click would otherwise start', async () => {
    renderList()
    const [first] = await rows()

    const plain = fireEvent.mouseDown(first)
    const shifted = fireEvent.mouseDown(first, { shiftKey: true })

    expect(plain).toBe(true)
    expect(shifted).toBe(false)
  })

  it('hands select-all, clear and delete straight to the store and the route', async () => {
    renderList()
    const [first] = await rows()
    fireEvent.click(within(first).getByTestId('capture-select-checkbox'))

    fireEvent.click(screen.getByText('bar: toggle all'))
    expect(useAppStore.getState().selectedCaptureIds.size).toBe(3)

    fireEvent.click(screen.getByText('bar: delete'))
    expect(onDeleteSelection).toHaveBeenCalledWith(['cap-a', 'cap-b', 'cap-c'])

    fireEvent.click(screen.getByText('bar: clear'))
    expect(useAppStore.getState().selectedCaptureIds.size).toBe(0)
    expect(screen.queryByTestId('selection-bar-stub')).toBeNull()
  })

  it('keeps filtered-out ids selected while scoping the bar to what is on screen', async () => {
    renderList()
    await rows()
    act(() => useAppStore.getState().selectAllCaptures(['cap-a', 'cap-b', 'cap-c']))

    // A selector filter narrows the list to one row; the other two stay in the
    // store so the selection survives clearing the filter again.
    act(() => useAppStore.getState().setFilteredCaptureIds(['cap-b']))

    expect(within(screen.getByTestId('selection-bar-stub')).getByText('1 selected')).toBeDefined()
    expect(barProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectedIds: ['cap-b'], allSelected: true })
    )
    expect(useAppStore.getState().selectedCaptureIds.size).toBe(3)
  })

  it('unchecking select-all under a filter drops only the rows on screen', async () => {
    renderList()
    await rows()
    act(() => useAppStore.getState().selectAllCaptures(['cap-a', 'cap-b', 'cap-c']))
    act(() => useAppStore.getState().setFilteredCaptureIds(['cap-b']))

    // The checkbox reads checked because every visible row is selected, and the
    // bar says "1 selected". Unchecking has to mean that one row, not all three
    // — the operator was never told the other two were still in the set.
    act(() => barProps.mock.lastCall![0].onToggleSelectAll())

    expect([...useAppStore.getState().selectedCaptureIds].sort()).toEqual(['cap-a', 'cap-c'])
  })
})
