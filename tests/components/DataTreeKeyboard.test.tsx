// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DataTree } from '@renderer/components/data/DataTree'
import type { DataTreeNode } from '@renderer/components/data/dataTreeModel'

const nodes: DataTreeNode[] = [
  {
    key: 'data-sources',
    label: 'Data Sources',
    depth: 0,
    group: true,
    hasChildren: true,
    expanded: true,
    count: null,
    alert: false
  },
  {
    key: 'kind:capture',
    label: 'Captures',
    depth: 1,
    group: false,
    hasChildren: true,
    expanded: false,
    count: 2,
    alert: false
  },
  {
    key: 'staging',
    label: 'Staging',
    depth: 1,
    group: false,
    hasChildren: false,
    expanded: false,
    count: 0,
    alert: false
  }
]

function selectButton(key: string): HTMLElement {
  return screen.getByTestId(`data-tree-node-${key}`).querySelector('[data-tree-select]')!
}

afterEach(() => cleanup())

it('keeps one Tab stop on the selected node and walks the rest with the arrow keys', () => {
  render(<DataTree nodes={nodes} selected="kind:capture" onSelect={vi.fn()} onToggle={vi.fn()} />)
  expect(selectButton('kind:capture').tabIndex).toBe(0)
  expect(selectButton('data-sources').tabIndex).toBe(-1)
  expect(selectButton('staging').tabIndex).toBe(-1)

  const captures = selectButton('kind:capture')
  captures.focus()
  fireEvent.keyDown(captures, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(selectButton('staging'))
  fireEvent.keyDown(selectButton('staging'), { key: 'ArrowUp' })
  expect(document.activeElement).toBe(captures)
  fireEvent.keyDown(captures, { key: 'End' })
  expect(document.activeElement).toBe(selectButton('staging'))
  fireEvent.keyDown(selectButton('staging'), { key: 'Home' })
  expect(document.activeElement).toBe(selectButton('data-sources'))
})

it('expands on ArrowRight and collapses on ArrowLeft, and leaves other keys alone', () => {
  const onToggle = vi.fn()
  render(<DataTree nodes={nodes} selected="staging" onSelect={vi.fn()} onToggle={onToggle} />)

  fireEvent.keyDown(selectButton('kind:capture'), { key: 'ArrowRight' })
  expect(onToggle).toHaveBeenLastCalledWith('kind:capture')
  fireEvent.keyDown(selectButton('data-sources'), { key: 'ArrowLeft' })
  expect(onToggle).toHaveBeenLastCalledWith('data-sources')

  onToggle.mockClear()
  // A leaf has nothing to expand; a letter key is not the tree's.
  fireEvent.keyDown(selectButton('staging'), { key: 'ArrowRight' })
  fireEvent.keyDown(selectButton('staging'), { key: 'a' })
  expect(onToggle).not.toHaveBeenCalled()
})

it('falls back to the first node as the Tab stop when nothing is selected', () => {
  render(
    <DataTree nodes={nodes} selected="exhibit:missing" onSelect={vi.fn()} onToggle={vi.fn()} />
  )
  expect(selectButton('data-sources').tabIndex).toBe(0)
  // The twist button is not a tree key target.
  const twist = screen
    .getByTestId('data-tree-node-kind:capture')
    .querySelector('button:first-of-type')!
  fireEvent.keyDown(twist, { key: 'ArrowDown' })
  expect(document.activeElement).not.toBe(selectButton('staging'))
})
