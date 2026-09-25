// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { EntityContextMenu } from '@renderer/components/contextmenu/EntityContextMenu'
import type { EntityMenuTarget } from '@renderer/components/contextmenu/entityMenu'

// The primitive under test is the menu, not any one registry entry, so these
// use the smallest real target: a note, whose three actions cover a plain item,
// a conditional item and a destructive one.
function noteTarget(overrides: Partial<Parameters<typeof makeNote>[0]> = {}) {
  return makeNote(overrides)
}

function makeNote({
  edit = vi.fn(),
  openSourceUrl = vi.fn(),
  remove = vi.fn(),
  sourceUrl = 'https://example.com/a' as string | null
} = {}): EntityMenuTarget {
  return {
    kind: 'note',
    noteId: 'n1',
    title: 'Working note',
    sourceUrl,
    actions: { edit, openSourceUrl, remove }
  }
}

function tagTarget(setColor = vi.fn()): EntityMenuTarget {
  return {
    kind: 'tag',
    tagId: 't1',
    name: 'evidence',
    color: '#22c55e',
    palette: [
      { value: '#22c55e', label: 'Green' },
      { value: '#3b82f6', label: 'Blue' }
    ],
    actions: {
      filterCaptures: vi.fn(),
      duplicate: vi.fn(),
      exportCaptures: vi.fn(),
      copyMarkdown: vi.fn(),
      rename: vi.fn(),
      setColor,
      merge: vi.fn(),
      remove: vi.fn()
    }
  }
}

function renderMenu(target: EntityMenuTarget = noteTarget()) {
  return render(
    <EntityContextMenu target={target}>
      <div data-testid="row">a row</div>
    </EntityContextMenu>
  )
}

function openMenu() {
  fireEvent.contextMenu(screen.getByTestId('row'))
  return screen.findByRole('menu')
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('EntityContextMenu semantics', () => {
  it('renders nothing until the row is right-clicked', () => {
    renderMenu()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByTestId('row')).toBeTruthy()
  })

  // The hand-rolled dialogs this ticket exists to not repeat got their roles
  // wrong; role, items and the menu's own name are acceptance criteria.
  it('exposes a named menu of menuitems', async () => {
    renderMenu()
    const menu = await openMenu()

    expect(menu.getAttribute('role')).toBe('menu')
    expect(menu.getAttribute('aria-label')).toBe('Note actions: Working note')
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Edit note',
      'Open source URL',
      'Delete note…',
      'Customise this menu…'
    ])
  })

  // The header repeats what aria-label already says. Announced twice it is
  // noise, so it is hidden and the label carries it.
  it('keeps the visible header out of the accessibility tree', async () => {
    renderMenu()
    await openMenu()

    const header = screen.getByText('Working note')
    expect(header.closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('moves focus into the menu on open and onto its items with the arrow keys', async () => {
    renderMenu()
    const menu = await openMenu()

    await waitFor(() => expect(document.activeElement).toBe(menu))

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Edit note'))
  })

  it('closes on Escape, back to the element that had focus', async () => {
    renderMenu()
    const row = screen.getByTestId('row')
    row.tabIndex = 0
    row.focus()

    const menu = await openMenu()
    fireEvent.keyDown(menu, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(row))
  })

  // The captures list clears its multi-selection on Escape unless something on
  // screen has claimed the key. An open menu has, and this attribute is how it
  // says so — without it, one Escape would close the menu and empty the
  // selection the menu was about.
  it('claims Escape from the capture selection while it is open', async () => {
    renderMenu()
    const menu = await openMenu()

    expect(document.querySelector('[data-selection-escape-guard]')).toBe(menu)

    fireEvent.keyDown(menu, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('[data-selection-escape-guard]')).toBeNull())
  })

  it('runs the action the item was built with', async () => {
    const remove = vi.fn()
    renderMenu(noteTarget({ remove }))
    await openMenu()

    fireEvent.click(screen.getByTestId('context-menu-item-note-delete'))

    expect(remove).toHaveBeenCalledOnce()
  })

  it('separates the destructive action from the rest', async () => {
    renderMenu()
    await openMenu()

    expect(screen.getAllByRole('separator')).toHaveLength(1)
  })

  it('drops an item the target has nothing to run it against', async () => {
    renderMenu(noteTarget({ sourceUrl: null }))
    await openMenu()

    expect(screen.queryByTestId('context-menu-item-note-open-source')).toBeNull()
  })

  it('marks the trigger wrapper with the kind it will offer', () => {
    renderMenu()
    const wrapper = screen.getByTestId('row').parentElement

    expect(wrapper?.getAttribute('data-context-menu-kind')).toBe('note')
  })
})

describe('EntityContextMenu submenus', () => {
  it('nests the colour choices under their own named menu', async () => {
    const setColor = vi.fn()
    renderMenu(tagTarget(setColor))
    await openMenu()

    fireEvent.keyDown(screen.getByTestId('context-menu-item-tag-color'), { key: 'Enter' })

    const submenu = await screen.findByRole('menu', { name: 'Change color' })
    expect(submenu).toBeTruthy()
    fireEvent.click(screen.getByText('Blue'))
    expect(setColor).toHaveBeenCalledWith('#3b82f6')
  })

  it('says why an empty submenu is empty instead of listing an unusable item', async () => {
    const target: EntityMenuTarget = {
      kind: 'capture',
      captureId: 'cap-a',
      title: 'Example page',
      targetIds: ['cap-a'],
      inSelection: false,
      isFavorite: false,
      allFavorite: false,
      tags: [],
      actions: {
        open: vi.fn(),
        toggleSelection: vi.fn(),
        clearSelection: vi.fn(),
        openSourceUrl: vi.fn(),
        copyUrl: vi.fn(),
        copyHash: vi.fn(),
        addTag: vi.fn(),
        quoteIntoNote: vi.fn(),
        toggleFavorite: vi.fn(),
        duplicate: vi.fn(),
        recapture: vi.fn(),
        remove: vi.fn()
      }
    }
    renderMenu(target)
    await openMenu()

    fireEvent.keyDown(screen.getByTestId('context-menu-item-capture-add-tag'), { key: 'Enter' })

    const submenu = await screen.findByRole('menu', { name: 'Add tag' })
    expect(submenu.textContent).toContain('No tags yet')
    // Nothing focusable inside it: an item that can never run would still join
    // the roving focus order and read as an offer.
    expect(submenu.querySelectorAll('[role="menuitem"]')).toHaveLength(0)
  })
})

describe('menu customisation and export drill-in', () => {
  it('hides an action without running it, persists it, and lets it be restored', async () => {
    const remove = vi.fn()
    const first = renderMenu(noteTarget({ remove }))
    await openMenu()
    fireEvent.click(screen.getByText('Customise this menu…'))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Delete note…' }))
    expect(remove).not.toHaveBeenCalled()
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Delete note…' }).getAttribute('aria-checked')
    ).toBe('false')
    fireEvent.click(screen.getByText('Done — hidden actions can be restored here'))
    expect(screen.queryByTestId('context-menu-item-note-delete')).toBeNull()
    first.unmount()

    renderMenu(noteTarget({ remove }))
    await openMenu()
    expect(screen.queryByTestId('context-menu-item-note-delete')).toBeNull()
    fireEvent.click(screen.getByText('Customise this menu…'))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Delete note…' }))
    fireEvent.click(screen.getByText('Done — hidden actions can be restored here'))
    fireEvent.click(screen.getByTestId('context-menu-item-note-delete'))
    expect(remove).toHaveBeenCalledOnce()
  })

  it('keeps the footer reachable after hiding every action', async () => {
    renderMenu()
    await openMenu()
    fireEvent.click(screen.getByText('Customise this menu…'))
    for (const item of screen.getAllByRole('menuitemcheckbox')) fireEvent.click(item)
    fireEvent.click(screen.getByText('Done — hidden actions can be restored here'))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Customise this menu…'
    ])
  })

  it('drills into backed tag exports and returns through Back', async () => {
    const target = tagTarget()
    if (target.kind !== 'tag') throw new Error('expected tag')
    renderMenu(target)
    await openMenu()
    fireEvent.click(screen.getByTestId('context-menu-item-tag-export'))
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    expect(screen.getByText('export destination')).toBeDefined()
    expect(screen.getByRole('menuitem', { name: 'ZIP + manifest' })).toBeDefined()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Back' }))
    expect(screen.getByTestId('context-menu-item-tag-duplicate')).toBeDefined()
    fireEvent.click(screen.getByTestId('context-menu-item-tag-export'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy as markdown' }))
    expect(target.actions.copyMarkdown).toHaveBeenCalledOnce()
  })
})
