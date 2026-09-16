import {
  Crosshair,
  ExternalLink,
  Eye,
  Hash,
  Merge,
  Palette,
  Pencil,
  RefreshCcw,
  Search,
  SquareMinus,
  SquarePlus,
  Star,
  StickyNote,
  Tag as TagIcon,
  ToggleLeft,
  ToggleRight,
  Trash2,
  CopyPlus,
  Clipboard,
  Download,
  X,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  Crosshair as Target,
  FileText,
  Folder,
  Link,
  ShieldCheck
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { accelerator } from '@renderer/lib/accelerator'

/**
 * The per-kind context-menu registry (#701).
 *
 * One place decides what a right-click on each entity offers, so thirteen
 * surfaces cannot drift into thirteen different answers. Everything here is a
 * pure function of its target: the surfaces supply the callbacks, this module
 * decides the labels, the order, the separators and which items exist at all.
 *
 * **Every item here has an inline or keyboard route elsewhere in the app.**
 * That is ruling 3 on the ticket — the menu is an accelerator, never the sole
 * way to reach a capability — and it is why several of the mock's items are
 * absent rather than stubbed. Each builder documents its own omissions.
 */

export interface MenuAction {
  id: string
  label: string
  icon: LucideIcon
  /** Shown right-aligned. Only ever a route that exists; never a promise. */
  shortcut?: string
  danger?: boolean
  separatorBefore?: boolean
  disabled?: boolean
  run: () => void
}

export interface MenuSubmenu {
  id: string
  label: string
  icon: LucideIcon
  separatorBefore?: boolean
  /** Rendered in place of the items when there are none. */
  emptyLabel: string
  items: MenuAction[]
}

export type MenuEntry = MenuAction | MenuSubmenu

export function isSubmenu(entry: MenuEntry): entry is MenuSubmenu {
  return 'items' in entry
}

export interface TagOption {
  id: string
  name: string
  color: string | null
}

export interface CaptureMenuActions {
  open: () => void
  toggleSelection: () => void
  clearSelection: () => void
  openSourceUrl: () => void
  copyUrl: () => void
  copyHash: () => void
  addTag: (tagId: string) => void
  quoteIntoNote: () => void
  toggleFavorite: () => void
  duplicate: () => void
  recapture: () => void
  remove: () => void
}

export interface CaptureMenuTarget {
  kind: 'capture'
  /** The row that was right-clicked, whatever the selection is. */
  captureId: string
  title: string
  /**
   * Every capture the menu acts on. Ruling R20: the visible multi-selection
   * when the right-clicked row is inside it, that row alone otherwise. The
   * surface decides which; this module only reads the length.
   */
  targetIds: string[]
  /** Whether the right-clicked row is currently in the multi-selection. */
  inSelection: boolean
  isFavorite: boolean
  /**
   * Whether every capture in `targetIds` is already a favourite. The multi
   * target's toggle unfavourites in exactly that case, so the label reads from
   * this rather than from `isFavorite`, which describes one row.
   */
  allFavorite: boolean
  /** Tags available to apply, for the "Add tag" submenu. */
  tags: TagOption[]
  actions: CaptureMenuActions
}

export interface NoteMenuTarget {
  kind: 'note'
  noteId: string
  title: string
  /** Absent on a note written from scratch rather than against a page. */
  sourceUrl: string | null
  actions: {
    edit: () => void
    openSourceUrl: () => void
    remove: () => void
  }
}

export interface SelectorMenuTarget {
  kind: 'selector'
  selectorId: string
  label: string
  enabled: boolean
  matchCount: number
  actions: {
    editPattern: () => void
    toggleEnabled: () => void
    showMatches: () => void
    exportMatches: () => void
    remove: () => void
  }
}

export interface TagMenuTarget {
  kind: 'tag'
  tagId: string
  name: string
  color: string | null
  /** Colours the tag can be set to, paired with the name each is shown under. */
  palette: { value: string; label: string }[]
  actions: {
    filterCaptures: () => void
    rename: () => void
    setColor: (color: string) => void
    merge: () => void
    remove: () => void
  }
}

// --- The Data screen's four kinds (#1151, X38) ------------------------------
//
// Backed items only: every one accelerates a control the screen already has.
// Reveal in folder and Copy absolute path are absent on purpose — the
// `shell:showItemInFolder` allowlist is not widened for evidence files, which
// is #1194's ruling to make, not this menu's. Rename, Delete, Re-extract, Run
// selectors, Verify chain from here, Show signature detail and Export are
// absent because the app has no route for them.

export interface ExhibitMenuTarget {
  kind: 'exhibit'
  exhibitId: string
  name: string
  // 'exhibit' or 'derived-file': a Derived File has no viewer of its own, so
  // Open in viewer opens its parent and the label says so.
  entity: 'exhibit' | 'derived-file'
  // Only a Capture has a viewer; an attachment or document opens nowhere yet.
  canOpen: boolean
  // A legacy Capture may record no stored path; there is nothing to copy.
  hasPath: boolean
  actions: {
    open: () => void
    copyHash: () => void
    copyPath: () => void
    verify: () => void
  }
}

export interface NodeMenuTarget {
  kind: 'node'
  nodeKey: string
  label: string
  hasChildren: boolean
  // Whether any Exhibit sits under this node, for Verify.
  hasExhibits: boolean
  actions: {
    showOnly: () => void
    expandBelow: () => void
    collapseBelow: () => void
    verify: () => void
  }
}

export interface LedgerMenuTarget {
  kind: 'ledger'
  index: number
  entryType: string
  // Absent when the entry names nothing the screen can show (an export, an
  // unreadable line, a deleted Capture).
  canShowTarget: boolean
  // An unreadable line has no entry hash to copy.
  hasEntryHash: boolean
  // The genesis entry has no previous hash to copy.
  hasPrevHash: boolean
  actions: {
    showTarget: () => void
    copyEntryHash: () => void
    copyPrevHash: () => void
  }
}

export interface StagedMenuTarget {
  kind: 'staged'
  stagingId: string
  name: string
  actions: {
    commit: () => void
    discard: () => void
    copyHash: () => void
  }
}

export type EntityMenuTarget =
  | CaptureMenuTarget
  | NoteMenuTarget
  | SelectorMenuTarget
  | TagMenuTarget
  | ExhibitMenuTarget
  | NodeMenuTarget
  | LedgerMenuTarget
  | StagedMenuTarget

/** Derived rather than declared, so the two cannot drift as kinds are added. */
export type EntityKind = EntityMenuTarget['kind']

export interface MenuHeader {
  icon: LucideIcon
  title: string
  subtitle: string
  /**
   * The menu's own accessible name. The header is drawn `aria-hidden` because
   * Radix's Label carries no role, so this is the only place the target's
   * identity reaches the accessibility tree.
   */
  ariaLabel: string
}

function captureNoun(n: number): string {
  return n === 1 ? '1 capture' : `${n} captures`
}

/**
 * Capture rows in the captures list.
 *
 * Selection-aware per ruling R20: a right-click inside a multi-selection acts
 * on the whole selection with pluralized labels, a right-click on a row outside
 * it acts on that row alone. The two sets are not the same list with different
 * labels — single-target items (copy this URL, copy this digest, open this
 * page) have no defined meaning over three rows.
 *
 * The multi set follows the selection bar, which is the inline route those
 * items accelerate, without being item-for-item the same list. It omits the
 * bar's Export button for the reason below, and it adds "Remove from
 * selection", whose inline route is Ctrl+click on the row rather than anything
 * the bar offers.
 *
 * Absent from the mock's thirteen, each because the app has no route to
 * accelerate: Rename (captures are not renameable), Create selector from…, and
 * Export… (per-entity evidence export is #830 and has not landed; a selection
 * still exports from the bar, through the same dialog #830 will reach for one
 * row).
 */
export function captureMenuEntries(target: CaptureMenuTarget): MenuEntry[] {
  const { actions, targetIds, inSelection, isFavorite, allFavorite, tags } = target
  const count = targetIds.length

  if (count > 1) {
    const noun = captureNoun(count)
    return [
      {
        id: 'capture-deselect',
        label: 'Remove from selection',
        icon: SquareMinus,
        shortcut: accelerator('click', { macJoin: '-' }),
        run: actions.toggleSelection
      },
      {
        id: 'capture-clear-selection',
        label: 'Clear selection',
        icon: X,
        shortcut: 'Esc',
        run: actions.clearSelection
      },
      tagSubmenu(tags, actions.addTag, `Add tag to ${noun}`, true),
      {
        id: 'capture-favorite',
        label: allFavorite ? `Unfavorite ${noun}` : `Favorite ${noun}`,
        icon: Star,
        run: actions.toggleFavorite
      },
      {
        id: 'capture-recapture',
        label: `Recapture ${noun}`,
        icon: RefreshCcw,
        run: actions.recapture
      },
      {
        id: 'capture-delete',
        label: `Delete ${noun}…`,
        icon: Trash2,
        danger: true,
        separatorBefore: true,
        run: actions.remove
      }
    ]
  }

  return [
    {
      id: 'capture-open',
      label: 'Open capture',
      icon: Eye,
      shortcut: 'Enter',
      run: actions.open
    },
    {
      id: 'capture-toggle-selection',
      label: inSelection ? 'Remove from selection' : 'Add to selection',
      icon: inSelection ? SquareMinus : SquarePlus,
      shortcut: accelerator('click', { macJoin: '-' }),
      run: actions.toggleSelection
    },
    {
      id: 'capture-open-source',
      label: 'Open source URL',
      icon: ExternalLink,
      separatorBefore: true,
      run: actions.openSourceUrl
    },
    {
      id: 'capture-copy-url',
      label: 'Copy URL',
      icon: Clipboard,
      shortcut: accelerator('C'),
      run: actions.copyUrl
    },
    {
      id: 'capture-copy-hash',
      label: 'Copy SHA-256',
      icon: Hash,
      run: actions.copyHash
    },
    tagSubmenu(tags, actions.addTag, 'Add tag', true),
    {
      id: 'capture-quote-note',
      label: 'Quote into note',
      icon: StickyNote,
      run: actions.quoteIntoNote
    },
    {
      id: 'capture-favorite',
      label: isFavorite ? 'Remove from favorites' : 'Add to favorites',
      icon: Star,
      run: actions.toggleFavorite
    },
    {
      id: 'capture-duplicate',
      label: 'Duplicate',
      icon: CopyPlus,
      separatorBefore: true,
      run: actions.duplicate
    },
    {
      id: 'capture-delete',
      label: 'Delete capture…',
      icon: Trash2,
      danger: true,
      separatorBefore: true,
      run: actions.remove
    }
  ]
}

function tagSubmenu(
  tags: TagOption[],
  addTag: (tagId: string) => void,
  label: string,
  separatorBefore: boolean
): MenuSubmenu {
  return {
    id: 'capture-add-tag',
    label,
    icon: TagIcon,
    separatorBefore,
    emptyLabel: 'No tags yet — add one on Signals',
    items: tags.map((tag) => ({
      id: `capture-add-tag-${tag.id}`,
      label: tag.name,
      icon: TagIcon,
      run: () => addTag(tag.id)
    }))
  }
}

/**
 * Note cards on the Notes screen.
 *
 * Three items, and short on purpose. Of the mock's eight, five name
 * capabilities the app does not have anywhere: copy as markdown, copy a wiki
 * link, duplicate a note, pin a note to the case, and per-entity export
 * (#830). Adding any of them here would make the menu the only route to it,
 * which ruling 3 forbids; they arrive with the tickets that build the inline
 * route, and the registry absorbs them then (ruling R13). "Rename" is not
 * separate from Edit — a note's title is a field of the editor this opens.
 */
export function noteMenuEntries(target: NoteMenuTarget): MenuEntry[] {
  const { actions, sourceUrl } = target
  const entries: MenuEntry[] = [
    {
      id: 'note-edit',
      label: 'Edit note',
      icon: Pencil,
      run: actions.edit
    }
  ]
  if (sourceUrl) {
    entries.push({
      id: 'note-open-source',
      label: 'Open source URL',
      icon: ExternalLink,
      run: actions.openSourceUrl
    })
  }
  entries.push({
    id: 'note-delete',
    label: 'Delete note…',
    icon: Trash2,
    danger: true,
    separatorBefore: true,
    run: actions.remove
  })
  return entries
}

/**
 * Selector rows on the Signals screen.
 *
 * Missing from the mock's eight: Duplicate and Copy pattern, neither of which
 * the app offers anywhere; and "Backfill existing captures", which is #829 and
 * had not landed. Export here is the selector-match CSV the detail rail
 * already writes, not the evidence package of #830.
 */
export function selectorMenuEntries(target: SelectorMenuTarget): MenuEntry[] {
  const { actions, enabled, matchCount } = target
  return [
    {
      id: 'selector-edit',
      label: 'Edit pattern',
      icon: Pencil,
      shortcut: 'Enter',
      run: actions.editPattern
    },
    {
      id: 'selector-toggle',
      label: enabled ? 'Stop watching' : 'Start watching',
      icon: enabled ? ToggleRight : ToggleLeft,
      shortcut: 'Space',
      run: actions.toggleEnabled
    },
    {
      id: 'selector-show-matches',
      label: 'Show matches in Captures',
      icon: Search,
      separatorBefore: true,
      run: actions.showMatches
    },
    {
      id: 'selector-export',
      label: 'Export matches to CSV',
      icon: Download,
      // The CSV joins selector_matches to captures, so a selector that has
      // matched nothing would write a file with no rows in it. The rail's
      // button is disabled on the same condition.
      disabled: matchCount === 0,
      run: actions.exportMatches
    },
    {
      id: 'selector-delete',
      label: 'Delete selector',
      icon: Trash2,
      shortcut: 'Backspace',
      danger: true,
      separatorBefore: true,
      run: actions.remove
    }
  ]
}

/**
 * Tag rows on the Signals screen.
 *
 * Missing from the mock's seven: Duplicate and Export, which the app does not
 * offer for a tag anywhere. "Filter captures by tag" was the third omission
 * until the capture list grew a tag filter (#918); it is now the first item,
 * where the mock puts it, and shares the detail rail's route into the list.
 */
export function tagMenuEntries(target: TagMenuTarget): MenuEntry[] {
  const { actions, palette, color } = target
  return [
    {
      id: 'tag-filter-captures',
      label: 'Filter captures by tag',
      icon: Search,
      run: actions.filterCaptures
    },
    {
      id: 'tag-rename',
      label: 'Rename',
      icon: Pencil,
      shortcut: 'Enter',
      separatorBefore: true,
      run: actions.rename
    },
    {
      id: 'tag-color',
      label: 'Change color',
      icon: Palette,
      emptyLabel: 'No colors available',
      items: palette.map((swatch) => ({
        id: `tag-color-${swatch.value}`,
        // The current colour is named rather than ticked: a tick needs a
        // second item shape, and "(current)" reaches a screen reader as part
        // of the item's own name.
        label: swatch.value === color ? `${swatch.label} (current)` : swatch.label,
        icon: Palette,
        run: () => actions.setColor(swatch.value)
      }))
    },
    {
      id: 'tag-merge',
      label: 'Merge into…',
      icon: Merge,
      separatorBefore: true,
      run: actions.merge
    },
    {
      id: 'tag-delete',
      label: 'Delete tag…',
      icon: Trash2,
      shortcut: 'Backspace',
      danger: true,
      separatorBefore: true,
      run: actions.remove
    }
  ]
}

/**
 * Exhibit and Derived File rows on the Data screen (#1151, X38).
 *
 * Open in viewer accelerates Enter on the focused row (and a double-click);
 * the two copies accelerate the copy buttons on the Properties tab; Verify
 * accelerates the strip's Verify button. A Derived File opens its parent,
 * because it has no viewer of its own; a non-Capture Exhibit opens nothing
 * yet and the item says so rather than vanishing.
 */
export function exhibitMenuEntries(target: ExhibitMenuTarget): MenuEntry[] {
  const { actions, entity, canOpen, hasPath } = target
  return [
    {
      id: 'exhibit-open',
      label: entity === 'derived-file' ? 'Open parent in viewer' : 'Open in viewer',
      icon: Eye,
      shortcut: 'Enter',
      disabled: !canOpen,
      run: actions.open
    },
    {
      id: 'exhibit-copy-hash',
      label: 'Copy SHA-256',
      icon: Hash,
      separatorBefore: true,
      run: actions.copyHash
    },
    {
      id: 'exhibit-copy-path',
      label: 'Copy relative path',
      icon: Clipboard,
      disabled: !hasPath,
      run: actions.copyPath
    },
    {
      id: 'exhibit-verify',
      label: 'Verify',
      icon: ShieldCheck,
      separatorBefore: true,
      run: actions.verify
    }
  ]
}

/**
 * Tree nodes on the Data screen. Show only this is the click; Expand and
 * Collapse below are Shift+click on the twist; Verify is the pane header's
 * Verify over the same rows, except on Integrity Exceptions, where the
 * header's Verify all covers every anchored Exhibit and this covers only the
 * exceptions shown.
 */
export function nodeMenuEntries(target: NodeMenuTarget): MenuEntry[] {
  const { actions, hasChildren, hasExhibits } = target
  return [
    {
      id: 'node-show-only',
      label: 'Show only this',
      icon: Target,
      shortcut: 'Enter',
      run: actions.showOnly
    },
    {
      id: 'node-expand-below',
      label: 'Expand below',
      icon: ChevronsUpDown,
      separatorBefore: true,
      disabled: !hasChildren,
      run: actions.expandBelow
    },
    {
      id: 'node-collapse-below',
      label: 'Collapse below',
      icon: ChevronsDownUp,
      disabled: !hasChildren,
      run: actions.collapseBelow
    },
    {
      id: 'node-verify',
      label: 'Verify',
      icon: ShieldCheck,
      separatorBefore: true,
      disabled: !hasExhibits,
      run: actions.verify
    }
  ]
}

/**
 * Manifest Ledger entries. Show target is the row click; the two copies are
 * the hash cells, which copy on click.
 */
export function ledgerMenuEntries(target: LedgerMenuTarget): MenuEntry[] {
  const { actions, canShowTarget, hasEntryHash, hasPrevHash } = target
  return [
    {
      id: 'ledger-show-target',
      label: 'Show target',
      icon: Link,
      shortcut: 'Enter',
      disabled: !canShowTarget,
      run: actions.showTarget
    },
    {
      id: 'ledger-copy-entry-hash',
      label: 'Copy entry hash',
      icon: Hash,
      separatorBefore: true,
      disabled: !hasEntryHash,
      run: actions.copyEntryHash
    },
    {
      id: 'ledger-copy-prev-hash',
      label: 'Copy previous hash',
      icon: Hash,
      disabled: !hasPrevHash,
      run: actions.copyPrevHash
    }
  ]
}

/**
 * Pooled rows in the Staging group. Commit and Discard are the row's inline
 * buttons; Discard confirms through the same dialog either way. The copied
 * hash is labelled not anchored (X38): a pooled file's digest names bytes the
 * chain does not cover, and a paste that read as evidence would be wrong.
 */
export function stagedMenuEntries(target: StagedMenuTarget): MenuEntry[] {
  const { actions } = target
  return [
    {
      id: 'staged-commit',
      label: 'Commit to the chain',
      icon: Check,
      run: actions.commit
    },
    {
      id: 'staged-discard',
      label: 'Discard…',
      icon: Trash2,
      danger: true,
      run: actions.discard
    },
    {
      id: 'staged-copy-hash',
      label: 'Copy SHA-256 (not anchored)',
      icon: Hash,
      separatorBefore: true,
      run: actions.copyHash
    }
  ]
}

/** The registry proper: one kind, one action set, one place to change it. */
export function entityMenuEntries(target: EntityMenuTarget): MenuEntry[] {
  switch (target.kind) {
    case 'capture':
      return captureMenuEntries(target)
    case 'note':
      return noteMenuEntries(target)
    case 'selector':
      return selectorMenuEntries(target)
    case 'tag':
      return tagMenuEntries(target)
    case 'exhibit':
      return exhibitMenuEntries(target)
    case 'node':
      return nodeMenuEntries(target)
    case 'ledger':
      return ledgerMenuEntries(target)
    case 'staged':
      return stagedMenuEntries(target)
  }
}

export function entityMenuHeader(target: EntityMenuTarget): MenuHeader {
  switch (target.kind) {
    case 'capture': {
      const count = target.targetIds.length
      if (count > 1) {
        return {
          icon: Eye,
          title: `${captureNoun(count)} selected`,
          subtitle: `${accelerator('click', { join: '-', macJoin: '-' })} to change the selection`,
          ariaLabel: `Actions for ${captureNoun(count)}`
        }
      }
      return {
        icon: Eye,
        title: target.title,
        subtitle: 'capture',
        ariaLabel: `Capture actions: ${target.title}`
      }
    }
    case 'note':
      return {
        icon: StickyNote,
        title: target.title,
        subtitle: 'note',
        ariaLabel: `Note actions: ${target.title}`
      }
    case 'selector':
      return {
        icon: Crosshair,
        title: target.label,
        subtitle: 'selector',
        ariaLabel: `Selector actions: ${target.label}`
      }
    case 'tag':
      return {
        icon: TagIcon,
        title: target.name,
        subtitle: 'tag',
        ariaLabel: `Tag actions: ${target.name}`
      }
    case 'exhibit':
      return {
        icon: FileText,
        title: target.name,
        subtitle: target.entity === 'derived-file' ? 'derived file' : 'exhibit',
        ariaLabel: `Exhibit actions: ${target.name}`
      }
    case 'node':
      return {
        icon: Folder,
        title: target.label,
        subtitle: 'node',
        ariaLabel: `Node actions: ${target.label}`
      }
    case 'ledger':
      return {
        icon: Link,
        title: `seq ${String(target.index).padStart(4, '0')} · ${target.entryType}`,
        subtitle: 'manifest entry',
        ariaLabel: `Manifest entry actions: seq ${target.index}`
      }
    case 'staged':
      return {
        icon: FileText,
        title: target.name,
        subtitle: 'pooled · not anchored',
        ariaLabel: `Pooled file actions: ${target.name}`
      }
  }
}
