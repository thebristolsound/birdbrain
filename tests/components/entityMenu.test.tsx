// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { MAC_PLATFORM, restorePlatform, stubPlatform } from '../renderer/platformStub'
import {
  captureMenuEntries,
  entityMenuEntries,
  entityMenuHeader,
  exhibitMenuEntries,
  isSubmenu,
  ledgerMenuEntries,
  nodeMenuEntries,
  noteMenuEntries,
  selectorMenuEntries,
  stagedMenuEntries,
  tagMenuEntries,
  type CaptureMenuActions,
  type CaptureMenuTarget,
  type ExhibitMenuTarget,
  type LedgerMenuTarget,
  type NodeMenuTarget,
  type StagedMenuTarget,
  type MenuAction,
  type MenuEntry,
  type NoteMenuTarget,
  type SelectorMenuTarget,
  type TagMenuTarget
} from '@renderer/components/contextmenu/entityMenu'

function captureActions(): CaptureMenuActions {
  return {
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

function captureTarget(overrides: Partial<CaptureMenuTarget> = {}): CaptureMenuTarget {
  return {
    kind: 'capture',
    captureId: 'cap-a',
    title: 'Example page',
    targetIds: ['cap-a'],
    inSelection: false,
    isFavorite: false,
    allFavorite: false,
    tags: [{ id: 't1', name: 'evidence', color: '#22c55e' }],
    actions: captureActions(),
    ...overrides
  }
}

const noteTarget: NoteMenuTarget = {
  kind: 'note',
  noteId: 'n1',
  title: 'Working note',
  sourceUrl: 'https://example.com/a',
  actions: { edit: vi.fn(), openSourceUrl: vi.fn(), remove: vi.fn() }
}

const selectorTarget: SelectorMenuTarget = {
  kind: 'selector',
  selectorId: 's1',
  label: 'Acme mentions',
  enabled: true,
  matchCount: 4,
  actions: {
    editPattern: vi.fn(),
    toggleEnabled: vi.fn(),
    showMatches: vi.fn(),
    exportMatches: vi.fn(),
    remove: vi.fn()
  }
}

const tagTarget: TagMenuTarget = {
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
    rename: vi.fn(),
    setColor: vi.fn(),
    merge: vi.fn(),
    remove: vi.fn()
  }
}

function labels(entries: MenuEntry[]): string[] {
  return entries.map((entry) => entry.label)
}

function actionById(entries: MenuEntry[], id: string): MenuAction {
  const found = entries.find((entry) => entry.id === id)
  if (!found || isSubmenu(found)) throw new Error(`no action ${id}`)
  return found
}

describe('capture menu, single target', () => {
  it('offers the ten actions the app has an inline route for, in the designed order', () => {
    expect(labels(captureMenuEntries(captureTarget()))).toEqual([
      'Open capture',
      'Add to selection',
      'Open source URL',
      'Copy URL',
      'Copy SHA-256',
      'Add tag',
      'Quote into note',
      'Add to favorites',
      'Duplicate',
      'Delete capture…'
    ])
  })

  // Ruling 3 forbids a menu-only action. These are the mock's capture items the
  // app cannot reach any other way, so each must stay out until its own ticket
  // builds the route (#830 for export).
  it('offers nothing the app cannot already do inline', () => {
    const shown = labels(captureMenuEntries(captureTarget()))
    expect(shown).not.toContain('Rename')
    expect(shown).not.toContain('Create selector from…')
    expect(shown.some((label) => label.startsWith('Export'))).toBe(false)
  })

  it('names the selection toggle for what it will do to this row', () => {
    expect(actionById(captureMenuEntries(captureTarget()), 'capture-toggle-selection').label).toBe(
      'Add to selection'
    )
    // A single selected row: still the single set, but the toggle now removes.
    const inSel = captureTarget({ inSelection: true, targetIds: ['cap-a'] })
    expect(actionById(captureMenuEntries(inSel), 'capture-toggle-selection').label).toBe(
      'Remove from selection'
    )
  })

  it('names the favourite toggle for what it will do to this row', () => {
    expect(actionById(captureMenuEntries(captureTarget()), 'capture-favorite').label).toBe(
      'Add to favorites'
    )
    expect(
      actionById(captureMenuEntries(captureTarget({ isFavorite: true })), 'capture-favorite').label
    ).toBe('Remove from favorites')
  })

  it('claims a key hint only where the app really binds one', () => {
    const entries = captureMenuEntries(captureTarget())
    expect(actionById(entries, 'capture-open').shortcut).toBe('Enter')
    expect(actionById(entries, 'capture-copy-url').shortcut).toBe('Ctrl+C')
    expect(actionById(entries, 'capture-toggle-selection').shortcut).toBe('Ctrl+click')
    // Copy SHA-256 has no accelerator: Ctrl+C already belongs to Copy URL.
    expect(actionById(entries, 'capture-copy-hash').shortcut).toBeUndefined()
    // Deleting a capture is dialog-confirmed and has no Delete-key route.
    expect(actionById(entries, 'capture-delete').shortcut).toBeUndefined()
  })

  it('runs the callback the surface supplied, and only that one', () => {
    const actions = captureActions()
    const entries = captureMenuEntries(captureTarget({ actions }))

    actionById(entries, 'capture-copy-hash').run()

    expect(actions.copyHash).toHaveBeenCalledOnce()
    expect(actions.copyUrl).not.toHaveBeenCalled()
  })

  it('builds one submenu item per tag, each carrying its own id', () => {
    const actions = captureActions()
    const target = captureTarget({
      actions,
      tags: [
        { id: 't1', name: 'evidence', color: '#22c55e' },
        { id: 't2', name: 'finance', color: null }
      ]
    })
    const submenu = captureMenuEntries(target).find(
      (entry) => entry.id === 'capture-add-tag'
    ) as MenuEntry
    if (!isSubmenu(submenu)) throw new Error('expected a submenu')

    expect(submenu.items.map((item) => item.label)).toEqual(['evidence', 'finance'])
    submenu.items[1].run()
    expect(actions.addTag).toHaveBeenCalledWith('t2')
  })

  it('keeps the submenu with an empty-state label when the case has no tags', () => {
    const submenu = captureMenuEntries(captureTarget({ tags: [] })).find(
      (entry) => entry.id === 'capture-add-tag'
    ) as MenuEntry
    if (!isSubmenu(submenu)) throw new Error('expected a submenu')

    expect(submenu.items).toEqual([])
    expect(submenu.emptyLabel).toContain('No tags yet')
  })
})

describe('capture menu, multi-selection (R20)', () => {
  const multi = () => captureTarget({ targetIds: ['cap-a', 'cap-b', 'cap-c'], inSelection: true })

  it('switches to the selection action set and pluralizes the count', () => {
    expect(labels(captureMenuEntries(multi()))).toEqual([
      'Remove from selection',
      'Clear selection',
      'Add tag to 3 captures',
      'Favorite 3 captures',
      'Recapture 3 captures',
      'Delete 3 captures…'
    ])
  })

  // The action toggles, so a selection that is already favourited must not be
  // offered as "Favorite 3 captures" and then unfavourited.
  it('offers to unfavourite a selection where every row is already a favourite', () => {
    const all = captureTarget({
      targetIds: ['cap-a', 'cap-b', 'cap-c'],
      inSelection: true,
      allFavorite: true
    })
    expect(labels(captureMenuEntries(all))).toContain('Unfavorite 3 captures')
    expect(labels(captureMenuEntries(multi()))).toContain('Favorite 3 captures')
  })

  // The off-macOS form of the click chord, which the macOS block below renames.
  it('keeps the Ctrl click hint on the entry that leaves the selection', () => {
    expect(actionById(captureMenuEntries(multi()), 'capture-deselect').shortcut).toBe('Ctrl+click')
  })

  it('says two captures rather than 2 capture', () => {
    const two = captureTarget({ targetIds: ['cap-a', 'cap-b'], inSelection: true })
    expect(labels(captureMenuEntries(two))).toContain('Delete 2 captures…')
  })

  // The destructive one is the acceptance criterion: a right-click inside the
  // selection must delete the selection, not the row under the pointer.
  it('deletes through the same callback, which the surface aimed at the selection', () => {
    const actions = captureActions()
    const entries = captureMenuEntries(
      captureTarget({ actions, targetIds: ['cap-a', 'cap-b', 'cap-c'], inSelection: true })
    )

    actionById(entries, 'capture-delete').run()

    expect(actions.remove).toHaveBeenCalledOnce()
  })

  // Copying one URL out of three has no meaning, and the app has no
  // copy-many route to accelerate, so these are absent rather than ambiguous.
  it('drops the single-row actions that cannot act on three rows', () => {
    const shown = labels(captureMenuEntries(multi()))
    expect(shown).not.toContain('Copy URL')
    expect(shown).not.toContain('Copy SHA-256')
    expect(shown).not.toContain('Open capture')
    expect(shown).not.toContain('Open source URL')
    expect(shown).not.toContain('Duplicate')
  })
})

describe('note, selector and tag menus', () => {
  it('gives a note three actions, and two when it has no source page', () => {
    expect(labels(noteMenuEntries(noteTarget))).toEqual([
      'Edit note',
      'Open source URL',
      'Delete note…'
    ])
    expect(labels(noteMenuEntries({ ...noteTarget, sourceUrl: null }))).toEqual([
      'Edit note',
      'Delete note…'
    ])
  })

  it('names the selector switch for the state it will move to', () => {
    expect(actionById(selectorMenuEntries(selectorTarget), 'selector-toggle').label).toBe(
      'Stop watching'
    )
    expect(
      actionById(selectorMenuEntries({ ...selectorTarget, enabled: false }), 'selector-toggle')
        .label
    ).toBe('Start watching')
  })

  it('disables the CSV export for a selector that has matched nothing', () => {
    expect(actionById(selectorMenuEntries(selectorTarget), 'selector-export').disabled).toBe(false)
    expect(
      actionById(selectorMenuEntries({ ...selectorTarget, matchCount: 0 }), 'selector-export')
        .disabled
    ).toBe(true)
  })

  it('marks only the tag colour the tag already has', () => {
    const submenu = tagMenuEntries(tagTarget).find((entry) => entry.id === 'tag-color')
    if (!submenu || !isSubmenu(submenu)) throw new Error('expected a submenu')

    expect(submenu.items.map((item) => item.label)).toEqual(['Green (current)', 'Blue'])
    submenu.items[1].run()
    expect(tagTarget.actions.setColor).toHaveBeenCalledWith('#3b82f6')
  })

  // First, where the mock puts it, and live since #918 gave the capture list a
  // tag filter to drive. Duplicate and Export stay absent: the app offers
  // neither for a tag anywhere.
  it('leads with the capture filter, then the edits, merge and delete', () => {
    const shown = labels(tagMenuEntries(tagTarget))
    expect(shown).toEqual([
      'Filter captures by tag',
      'Rename',
      'Change color',
      'Merge into…',
      'Delete tag…'
    ])
  })

  it('runs the tag filter action from the first item', () => {
    actionById(tagMenuEntries(tagTarget), 'tag-filter-captures').run()
    expect(tagTarget.actions.filterCaptures).toHaveBeenCalledOnce()
  })
})

describe('the registry dispatch and headers', () => {
  it('routes each kind to its own builder', () => {
    const capture = captureTarget()
    expect(labels(entityMenuEntries(capture))).toEqual(labels(captureMenuEntries(capture)))
    expect(labels(entityMenuEntries(noteTarget))).toEqual(labels(noteMenuEntries(noteTarget)))
    expect(labels(entityMenuEntries(selectorTarget))).toEqual(
      labels(selectorMenuEntries(selectorTarget))
    )
    expect(labels(entityMenuEntries(tagTarget))).toEqual(labels(tagMenuEntries(tagTarget)))
  })

  it('names the target in the menu label, which is the only place it is announced', () => {
    expect(entityMenuHeader(captureTarget()).ariaLabel).toBe('Capture actions: Example page')
    expect(entityMenuHeader(noteTarget).ariaLabel).toBe('Note actions: Working note')
    expect(entityMenuHeader(selectorTarget).ariaLabel).toBe('Selector actions: Acme mentions')
    expect(entityMenuHeader(tagTarget).ariaLabel).toBe('Tag actions: evidence')
  })

  it('counts the selection in the header instead of naming one row of it', () => {
    const header = entityMenuHeader(
      captureTarget({ targetIds: ['cap-a', 'cap-b', 'cap-c'], inSelection: true })
    )
    expect(header.title).toBe('3 captures selected')
    expect(header.ariaLabel).toBe('Actions for 3 captures')
    expect(header.subtitle).toBe('Ctrl-click to change the selection')
  })

  it('falls back to the URL when a capture has no title to head the menu with', () => {
    const header = entityMenuHeader(captureTarget({ title: 'https://example.com/a' }))
    expect(header.title).toBe('https://example.com/a')
    expect(header.subtitle).toBe('capture')
  })

  it('tells a submenu from an action', () => {
    const entries = captureMenuEntries(captureTarget())
    expect(entries.filter(isSubmenu).map((entry) => entry.id)).toEqual(['capture-add-tag'])
  })
})

// #902. The handlers behind these hints all test `ctrlKey || metaKey`, so the
// menu names the modifier the operator's own platform uses. The Ctrl forms are
// pinned above; these are the same entries read on macOS.
describe('accelerator hints on macOS', () => {
  afterEach(restorePlatform)

  it('sets the Command glyph flush against a key and hyphenates a click chord', () => {
    stubPlatform(MAC_PLATFORM)
    const entries = captureMenuEntries(captureTarget())
    expect(actionById(entries, 'capture-copy-url').shortcut).toBe('⌘C')
    expect(actionById(entries, 'capture-toggle-selection').shortcut).toBe('⌘-click')
    // Unchanged by the platform: neither is a modifier chord.
    expect(actionById(entries, 'capture-open').shortcut).toBe('Enter')
    expect(actionById(entries, 'capture-copy-hash').shortcut).toBeUndefined()
  })

  it('renames the multi-selection entry and the header it sits under', () => {
    stubPlatform(MAC_PLATFORM)
    const multi = captureTarget({ targetIds: ['cap-a', 'cap-b'], inSelection: true })
    expect(actionById(captureMenuEntries(multi), 'capture-deselect').shortcut).toBe('⌘-click')
    expect(entityMenuHeader(multi).subtitle).toBe('⌘-click to change the selection')
  })
})

// The Data screen's four kinds (#1151, X38): backed items only, in the
// ruling's order, and never a route to `shell:showItemInFolder`.
describe('data screen kinds', () => {
  function exhibitTarget(overrides: Partial<ExhibitMenuTarget> = {}): ExhibitMenuTarget {
    return {
      kind: 'exhibit',
      exhibitId: 'cap-a',
      name: 'Example page',
      entity: 'exhibit',
      canOpen: true,
      hasPath: true,
      actions: { open: vi.fn(), copyHash: vi.fn(), copyPath: vi.fn(), verify: vi.fn() },
      ...overrides
    }
  }
  function nodeTarget(overrides: Partial<NodeMenuTarget> = {}): NodeMenuTarget {
    return {
      kind: 'node',
      nodeKey: 'kind:capture',
      label: 'Captures',
      hasChildren: true,
      hasExhibits: true,
      actions: { showOnly: vi.fn(), expandBelow: vi.fn(), collapseBelow: vi.fn(), verify: vi.fn() },
      ...overrides
    }
  }
  function ledgerTarget(overrides: Partial<LedgerMenuTarget> = {}): LedgerMenuTarget {
    return {
      kind: 'ledger',
      index: 3,
      entryType: 'capture',
      canShowTarget: true,
      hasEntryHash: true,
      hasPrevHash: true,
      actions: { showTarget: vi.fn(), copyEntryHash: vi.fn(), copyPrevHash: vi.fn() },
      ...overrides
    }
  }
  function stagedTarget(): StagedMenuTarget {
    return {
      kind: 'staged',
      stagingId: 'staged-1',
      name: 'report.pdf',
      actions: { commit: vi.fn(), discard: vi.fn(), copyHash: vi.fn() }
    }
  }
  const labels = (entries: MenuEntry[]) => entries.map((e) => e.label)
  const run = (entries: MenuEntry[], id: string) => {
    const entry = entries.find((e) => e.id === id)
    if (!entry || isSubmenu(entry)) throw new Error(`no action ${id}`)
    entry.run()
    return entry
  }

  it('exhibit: Open in viewer, Copy SHA-256, Copy relative path, Verify — and nothing else', () => {
    const target = exhibitTarget()
    const entries = exhibitMenuEntries(target)
    expect(labels(entries)).toEqual([
      'Open in viewer',
      'Copy SHA-256',
      'Copy relative path',
      'Verify'
    ])
    run(entries, 'exhibit-open')
    run(entries, 'exhibit-copy-hash')
    run(entries, 'exhibit-copy-path')
    run(entries, 'exhibit-verify')
    expect(target.actions.open).toHaveBeenCalledOnce()
    expect(target.actions.copyHash).toHaveBeenCalledOnce()
    expect(target.actions.copyPath).toHaveBeenCalledOnce()
    expect(target.actions.verify).toHaveBeenCalledOnce()
    expect(entityMenuEntries(target)).toEqual(entries)
  })

  it('exhibit: a Derived File opens its parent, and a kind with no viewer cannot open', () => {
    const derived = exhibitMenuEntries(exhibitTarget({ entity: 'derived-file' }))
    expect(derived[0].label).toBe('Open parent in viewer')
    const attachment = exhibitMenuEntries(exhibitTarget({ canOpen: false }))
    expect((attachment[0] as MenuAction).disabled).toBe(true)
    // No stored path, nothing to copy: the item is off, like the Properties button.
    const pathless = exhibitMenuEntries(exhibitTarget({ hasPath: false }))
    expect((pathless[2] as MenuAction).disabled).toBe(true)
    expect(entityMenuHeader(exhibitTarget({ entity: 'derived-file' }))).toMatchObject({
      subtitle: 'derived file',
      ariaLabel: 'Exhibit actions: Example page'
    })
  })

  it('node: Show only this, Expand below, Collapse below, Verify, with the last three gated', () => {
    const target = nodeTarget()
    const entries = nodeMenuEntries(target)
    expect(labels(entries)).toEqual(['Show only this', 'Expand below', 'Collapse below', 'Verify'])
    run(entries, 'node-show-only')
    run(entries, 'node-expand-below')
    run(entries, 'node-collapse-below')
    run(entries, 'node-verify')
    expect(target.actions.showOnly).toHaveBeenCalledOnce()
    expect(target.actions.expandBelow).toHaveBeenCalledOnce()
    expect(target.actions.collapseBelow).toHaveBeenCalledOnce()
    expect(target.actions.verify).toHaveBeenCalledOnce()

    const leaf = nodeMenuEntries(nodeTarget({ hasChildren: false, hasExhibits: false }))
    expect(leaf.map((e) => (e as MenuAction).disabled)).toEqual([undefined, true, true, true])
    expect(entityMenuHeader(nodeTarget())).toMatchObject({ ariaLabel: 'Node actions: Captures' })
  })

  it('ledger: Show target, Copy entry hash, Copy previous hash', () => {
    const target = ledgerTarget()
    const entries = ledgerMenuEntries(target)
    expect(labels(entries)).toEqual(['Show target', 'Copy entry hash', 'Copy previous hash'])
    run(entries, 'ledger-show-target')
    run(entries, 'ledger-copy-entry-hash')
    run(entries, 'ledger-copy-prev-hash')
    expect(target.actions.showTarget).toHaveBeenCalledOnce()
    expect(target.actions.copyEntryHash).toHaveBeenCalledOnce()
    expect(target.actions.copyPrevHash).toHaveBeenCalledOnce()
    const orphan = ledgerMenuEntries(ledgerTarget({ canShowTarget: false }))
    expect((orphan[0] as MenuAction).disabled).toBe(true)
    // Genesis has no previous hash; the cell shows none and the item is off.
    const genesis = ledgerMenuEntries(ledgerTarget({ hasPrevHash: false }))
    expect((genesis[2] as MenuAction).disabled).toBe(true)
    expect(entityMenuHeader(ledgerTarget())).toMatchObject({
      title: 'seq 0003 · capture',
      ariaLabel: 'Manifest entry actions: seq 3'
    })
  })

  it('staged: Commit, Discard (confirmed), Copy SHA-256 labelled not anchored', () => {
    const target = stagedTarget()
    const entries = stagedMenuEntries(target)
    expect(labels(entries)).toEqual([
      'Commit to the chain',
      'Discard…',
      'Copy SHA-256 (not anchored)'
    ])
    expect((entries[1] as MenuAction).danger).toBe(true)
    run(entries, 'staged-commit')
    run(entries, 'staged-discard')
    run(entries, 'staged-copy-hash')
    expect(target.actions.commit).toHaveBeenCalledOnce()
    expect(target.actions.discard).toHaveBeenCalledOnce()
    expect(target.actions.copyHash).toHaveBeenCalledOnce()
    expect(entityMenuHeader(target)).toMatchObject({
      subtitle: 'pooled · not anchored',
      ariaLabel: 'Pooled file actions: report.pdf'
    })
  })

  it('offers no Reveal in folder or absolute-path item on any of the four kinds', () => {
    const all = [
      ...exhibitMenuEntries(exhibitTarget()),
      ...nodeMenuEntries(nodeTarget()),
      ...ledgerMenuEntries(ledgerTarget()),
      ...stagedMenuEntries(stagedTarget())
    ]
    expect(all.some((e) => /reveal|folder|absolute/i.test(e.label))).toBe(false)
  })
})
