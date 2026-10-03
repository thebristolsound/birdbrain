// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { MAC_PLATFORM, restorePlatform, stubPlatform } from '../renderer/platformStub'
import {
  captureMenuEntries,
  entityMenuEntries,
  entityMenuHeader,
  exhibitMenuEntries,
  isSubmenu,
  linkMenuEntries,
  nodeMenuEntries,
  noteMenuEntries,
  selectorMenuEntries,
  stagedMenuEntries,
  tagMenuEntries,
  type CaptureMenuActions,
  type CaptureMenuTarget,
  type ExhibitMenuTarget,
  type LinkMenuTarget,
  type NodeMenuTarget,
  type StagedMenuTarget,
  type MenuAction,
  type MenuEntry,
  type NoteMenuTarget,
  type SelectorMenuTarget,
  type TagMenuTarget
} from '@renderer/components/contextmenu/entityMenu'
import { captureLinkBlockReason } from '@renderer/components/captures/guestLink'

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
    duplicate: vi.fn(),
    showMatches: vi.fn(),
    copyPattern: vi.fn(),
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
    duplicate: vi.fn(),
    exportCaptures: vi.fn(),
    copyMarkdown: vi.fn(),
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

  // The mock's order less Backfill, which stays on the rail (#1549). Delete
  // carries an ellipsis now that it confirms, as the tag one does.
  it('offers seven selector actions in the designed order', () => {
    expect(labels(selectorMenuEntries(selectorTarget))).toEqual([
      'Edit pattern',
      'Stop watching',
      'Duplicate…',
      'Show matches in Captures',
      'Copy pattern',
      'Export matches to CSV',
      'Delete selector…'
    ])
  })

  it('names the copy chord on Copy pattern and runs the supplied callbacks', () => {
    const entries = selectorMenuEntries(selectorTarget)
    expect(actionById(entries, 'selector-copy-pattern').shortcut).toMatch(/^(Ctrl\+C|⌘C)$/)

    actionById(entries, 'selector-copy-pattern').run()
    actionById(entries, 'selector-duplicate').run()
    expect(selectorTarget.actions.copyPattern).toHaveBeenCalledOnce()
    expect(selectorTarget.actions.duplicate).toHaveBeenCalledOnce()
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
  // tag filter to drive. The missing Duplicate and Export actions join it in #1542.
  it('leads with the capture filter, then the edits, merge and delete', () => {
    const shown = labels(tagMenuEntries(tagTarget))
    expect(shown).toEqual([
      'Filter captures by tag',
      'Rename',
      'Duplicate',
      'Change color',
      'Merge into…',
      'Export…',
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

  it('node: Show only this, Expand below, Collapse below, Verify, with the last three left out where they do not apply', () => {
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

    // Nothing is greyed: an item the node cannot take is not offered.
    expect(labels(nodeMenuEntries(nodeTarget({ hasChildren: false })))).toEqual([
      'Show only this',
      'Verify'
    ])
    expect(labels(nodeMenuEntries(nodeTarget({ hasExhibits: false })))).toEqual([
      'Show only this',
      'Expand below',
      'Collapse below'
    ])
    expect(labels(nodeMenuEntries(nodeTarget({ hasChildren: false, hasExhibits: false })))).toEqual(
      ['Show only this']
    )
    expect(nodeMenuEntries(nodeTarget()).some((e) => (e as MenuAction).disabled)).toBe(false)
    expect(entityMenuHeader(nodeTarget())).toMatchObject({ ariaLabel: 'Node actions: Captures' })
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

  it('offers no Reveal in folder or absolute-path item on any of the three kinds', () => {
    const all = [
      ...exhibitMenuEntries(exhibitTarget()),
      ...nodeMenuEntries(nodeTarget()),
      ...stagedMenuEntries(stagedTarget())
    ]
    expect(all.some((e) => /reveal|folder|absolute/i.test(e.label))).toBe(false)
  })
})

// #1708 D5. The target's reason comes from the same function the viewer uses, so
// these cases pin the address rules and the menu together.
describe('link menu', () => {
  function linkTarget(overrides: Partial<LinkMenuTarget> = {}): LinkMenuTarget {
    const linkUrl = overrides.linkUrl ?? 'https://example.com/a'
    return {
      kind: 'link',
      linkUrl,
      linkText: 'Example',
      imageUrl: '',
      selectionText: '',
      hasCapturedCopy: false,
      captureBlockedReason: captureLinkBlockReason(linkUrl),
      actions: {
        copyLinkAddress: vi.fn(),
        copyLinkText: vi.fn(),
        copyImageAddress: vi.fn(),
        copyText: vi.fn(),
        openCapturedCopy: vi.fn(),
        captureLink: vi.fn()
      },
      ...overrides
    }
  }

  it('offers the two copies and Capture link on a web link', () => {
    const target = linkTarget()
    const entries = linkMenuEntries(target)
    expect(labels(entries)).toEqual(['Copy link address', 'Copy link text', 'Capture link'])
    expect(actionById(entries, 'link-capture').disabled).toBe(false)
    actionById(entries, 'link-capture').run()
    actionById(entries, 'link-copy-address').run()
    expect(target.actions.captureLink).toHaveBeenCalledOnce()
    expect(target.actions.copyLinkAddress).toHaveBeenCalledOnce()
    expect(entityMenuEntries(target).map((e) => e.id)).toEqual(entries.map((e) => e.id))
  })

  it('offers Open captured copy only when the Case holds one', () => {
    expect(labels(linkMenuEntries(linkTarget({ hasCapturedCopy: true })))).toEqual([
      'Copy link address',
      'Copy link text',
      'Open captured copy',
      'Capture link'
    ])
    const target = linkTarget({ hasCapturedCopy: true })
    actionById(linkMenuEntries(target), 'link-open-captured').run()
    expect(target.actions.openCapturedCopy).toHaveBeenCalledOnce()
  })

  it.each([
    ['mailto:someone@example.com', 'Not a web address'],
    ['tel:+15550100', 'Not a web address'],
    ['javascript:alert(1)', 'Not a web address'],
    ['ftp://example.com/file', 'Not a web address'],
    ['http://localhost:19845/api/captures', 'Points at this computer'],
    ['http://app.localhost/', 'Points at this computer'],
    ['http://127.0.0.1/', 'Points at a loopback address'],
    ['http://2130706433/', 'Points at a loopback address'],
    ['http://0.0.0.0/', 'Points at an unspecified address'],
    ['http://10.1.2.3/', 'Points at a private address'],
    ['http://172.16.0.1/', 'Points at a private address'],
    ['http://172.31.255.255/', 'Points at a private address'],
    ['http://192.168.1.1/', 'Points at a private address'],
    ['http://169.254.169.254/latest/meta-data', 'Points at a link-local address'],
    ['http://[::1]/', 'Points at a loopback address'],
    ['http://[::]/', 'Points at an unspecified address'],
    ['http://[::ffff:127.0.0.1]/', 'Points at a loopback address'],
    ['http://[::ffff:192.168.0.1]/', 'Points at a private address'],
    ['http://[fd12:3456::1]/', 'Points at a private address'],
    ['http://[fc00::1]/', 'Points at a private address'],
    ['http://[fe80::1]/', 'Points at a link-local address']
  ])('never offers an enabled Capture link for %s', (linkUrl, reason) => {
    const entries = linkMenuEntries(linkTarget({ linkUrl }))
    const capture = actionById(entries, 'link-capture')
    expect(capture.disabled).toBe(true)
    expect(capture.label).toBe(`Capture link (${reason})`)
    expect(labels(entries).slice(0, 2)).toEqual(['Copy link address', 'Copy link text'])
  })

  it.each([
    'https://example.com/',
    'http://172.15.0.1/',
    'http://172.32.0.1/',
    'http://192.169.0.1/',
    'http://8.8.8.8/',
    'https://[2001:db8::1]/',
    'https://xn--bcher-kva.example/'
  ])('enables Capture link for the public address %s', (linkUrl) => {
    expect(actionById(linkMenuEntries(linkTarget({ linkUrl })), 'link-capture').disabled).toBe(
      false
    )
  })

  it('adds Copy image address in front of the link actions for an image inside a link', () => {
    const target = linkTarget({ imageUrl: 'https://example.com/i.png', linkText: '' })
    const entries = linkMenuEntries(target)
    expect(labels(entries)).toEqual([
      'Copy image address',
      'Copy link address',
      'Copy link text',
      'Capture link'
    ])
    // An image link has no text of its own to copy.
    expect(actionById(entries, 'link-copy-text').disabled).toBe(true)
    actionById(entries, 'link-copy-image').run()
    expect(target.actions.copyImageAddress).toHaveBeenCalledOnce()
    expect(entityMenuHeader(target).ariaLabel).toBe('Link actions: https://example.com/a')
  })

  it('offers only Copy image address for an image outside a link', () => {
    const target = linkTarget({ linkUrl: '', imageUrl: 'https://example.com/i.png' })
    expect(labels(linkMenuEntries(target))).toEqual(['Copy image address'])
    expect(entityMenuHeader(target)).toMatchObject({
      title: 'https://example.com/i.png',
      subtitle: 'image',
      ariaLabel: 'Image actions: https://example.com/i.png'
    })
  })

  it('offers only Copy text for a selection outside a link', () => {
    const target = linkTarget({ linkUrl: '', selectionText: 'a quoted passage' })
    const entries = linkMenuEntries(target)
    expect(labels(entries)).toEqual(['Copy text'])
    actionById(entries, 'link-copy-selection').run()
    expect(target.actions.copyText).toHaveBeenCalledOnce()
    expect(entityMenuHeader(target).ariaLabel).toBe('Selection actions: a quoted passage')
  })

  it('never offers to open a link or send it to an external browser', () => {
    const entries = linkMenuEntries(linkTarget({ hasCapturedCopy: true }))
    expect(entries.some((e) => /external|browser|wayback|follow/i.test(e.label))).toBe(false)
  })
})
