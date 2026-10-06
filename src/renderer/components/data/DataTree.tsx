import { Fragment, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { EntityContextMenu } from '@renderer/components/contextmenu/EntityContextMenu'
import type { EntityMenuTarget } from '@renderer/components/contextmenu/entityMenu'
import type { DataNodeKey, DataTreeNode } from '@renderer/components/data/dataTreeModel'

interface DataTreeProps {
  nodes: DataTreeNode[]
  selected: DataNodeKey
  onSelect: (key: DataNodeKey) => void
  onToggle: (key: DataNodeKey) => void
  // Shift+click on the twist: the whole subtree, not one level. The inline
  // route for the menu's Expand below and Collapse below (#1151).
  onToggleBelow?: (key: DataNodeKey, expanded: boolean) => void
  // The right-click target for a row (#1151); absent means no menu.
  menuTargetFor?: (node: DataTreeNode) => EntityMenuTarget | null
}

function MaybeMenu({ target, children }: { target: EntityMenuTarget | null; children: ReactNode }) {
  return target ? (
    <EntityContextMenu target={target}>{children}</EntityContextMenu>
  ) : (
    <Fragment>{children}</Fragment>
  )
}

// The rail. Row height is `var(--d-tree)` (R21), not the mock's 21/24/28, so
// the density setting drives it like every other list in the app.
export function DataTree({
  nodes,
  selected,
  onSelect,
  onToggle,
  onToggleBelow,
  menuTargetFor
}: DataTreeProps) {
  const treeRef = useRef<HTMLDivElement>(null)
  // Roving tab stop: Tab enters the tree once and the arrow keys move between
  // nodes. The stop follows focus so Tab leaves from the node the operator is
  // on and re-entry lands there; before any node has had focus it is the
  // selected node, else the first.
  const [focusedKey, setFocusedKey] = useState<DataNodeKey | null>(null)
  const has = (key: DataNodeKey | null) => key !== null && nodes.some((n) => n.key === key)
  const tabStopKey = has(focusedKey) ? focusedKey : has(selected) ? selected : nodes[0]?.key

  function onTreeKey(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    if (!target.hasAttribute('data-tree-select')) return
    // One select button per node, in node order, so the two indexes agree.
    const items = Array.from(
      treeRef.current?.querySelectorAll<HTMLElement>('[data-tree-select]') ?? []
    )
    const index = items.indexOf(target)
    const node = nodes[index]
    if (!node) return
    let next = -1
    if (event.key === 'ArrowDown') next = Math.min(items.length - 1, index + 1)
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else if (event.key === 'ArrowRight') {
      // Closed parent: open it. Open parent: its first child is the next
      // visible node, when there is one (a category's subcategories load
      // lazily, so an open parent can be childless for a moment). A leaf has
      // nowhere to go.
      if (!node.hasChildren) return
      if (!node.expanded) {
        event.preventDefault()
        onToggle(node.key)
        return
      }
      if (nodes[index + 1]?.depth !== node.depth + 1) return
      next = index + 1
    } else if (event.key === 'ArrowLeft') {
      // Open parent: close it. Anything else: its parent is the nearest
      // shallower node above it.
      if (node.hasChildren && node.expanded) {
        event.preventDefault()
        onToggle(node.key)
        return
      }
      for (let i = index - 1; i >= 0; i--) {
        if (nodes[i].depth < node.depth) {
          next = i
          break
        }
      }
    }
    if (next < 0) return
    event.preventDefault()
    items[next]?.focus()
  }

  return (
    <div
      ref={treeRef}
      role="tree"
      aria-label="Case data"
      className="px-1.5 pb-4 pt-1.5"
      onKeyDown={onTreeKey}
    >
      {nodes.map((node) => {
        const isSelected = node.key === selected
        const Twist = node.expanded ? ChevronDown : ChevronRight
        return (
          <MaybeMenu key={node.key} target={menuTargetFor?.(node) ?? null}>
            <div
              data-testid={`data-tree-node-${node.key}`}
              className="flex items-center gap-0.5"
              style={{ paddingLeft: 4 + node.depth * 13 }}
            >
              {/* Hidden from the tree: a tree owns only tree items, and the item
                  itself carries aria-expanded and the ArrowLeft/ArrowRight toggle. */}
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                aria-label={node.expanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
                onClick={(event) => {
                  event.stopPropagation()
                  if (event.shiftKey && onToggleBelow) onToggleBelow(node.key, !node.expanded)
                  else onToggle(node.key)
                  // The twist is hidden from the tree, so focus must not rest on it.
                  ;(event.currentTarget.nextElementSibling as HTMLElement | null)?.focus()
                }}
                className={cn(
                  'grid h-[18px] w-3.5 shrink-0 place-items-center rounded text-text-faint',
                  node.hasChildren ? 'cursor-pointer' : 'pointer-events-none opacity-0'
                )}
              >
                <Twist size={11} strokeWidth={2.4} />
              </button>
              {/* The tree item is the focusable button, so the node's role and
                  state travel with focus; the twist is a sibling helper. */}
              <button
                type="button"
                role="treeitem"
                aria-selected={isSelected}
                aria-expanded={node.hasChildren ? node.expanded : undefined}
                aria-level={node.depth + 1}
                data-tree-select
                tabIndex={node.key === tabStopKey ? 0 : -1}
                onFocus={() => setFocusedKey(node.key)}
                onClick={() => onSelect(node.key)}
                className={cn(
                  'flex h-[var(--d-tree)] min-w-0 flex-1 items-center gap-1.5 rounded px-[7px] text-left',
                  node.group
                    ? 'font-display text-[10px] font-bold uppercase tracking-label text-text-faint'
                    : 'text-xs',
                  !node.group &&
                    (isSelected
                      ? 'bg-accent-subtle font-semibold text-text-primary'
                      : 'font-medium text-text-secondary hover:bg-elevated')
                )}
              >
                <span className="min-w-0 flex-1 truncate">{node.label}</span>
                {node.alert && (
                  <span
                    aria-label="Has exceptions"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-fg"
                  />
                )}
                {node.count !== null && (
                  <span
                    className="shrink-0 font-mono text-[10px] tabular-nums text-text-faint"
                    data-testid={`data-tree-count-${node.key}`}
                  >
                    {node.count.toLocaleString()}
                  </span>
                )}
              </button>
            </div>
          </MaybeMenu>
        )
      })}
    </div>
  )
}
