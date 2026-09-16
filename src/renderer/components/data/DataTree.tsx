import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { DataNodeKey, DataTreeNode } from '@renderer/components/data/dataTreeModel'

interface DataTreeProps {
  nodes: DataTreeNode[]
  selected: DataNodeKey
  onSelect: (key: DataNodeKey) => void
  onToggle: (key: DataNodeKey) => void
}

// The rail. Row height is `var(--d-tree)` (R21), not the mock's 21/24/28, so
// the density setting drives it like every other list in the app.
export function DataTree({ nodes, selected, onSelect, onToggle }: DataTreeProps) {
  return (
    <div role="tree" aria-label="Case data" className="px-1.5 pb-4 pt-1.5">
      {nodes.map((node) => {
        const isSelected = node.key === selected
        const Twist = node.expanded ? ChevronDown : ChevronRight
        return (
          <div
            key={node.key}
            role="treeitem"
            aria-selected={isSelected}
            aria-expanded={node.hasChildren ? node.expanded : undefined}
            aria-level={node.depth + 1}
            data-testid={`data-tree-node-${node.key}`}
            className="flex items-center gap-0.5"
            style={{ paddingLeft: 4 + node.depth * 13 }}
          >
            <button
              type="button"
              tabIndex={-1}
              aria-label={node.expanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
              onClick={(event) => {
                event.stopPropagation()
                onToggle(node.key)
              }}
              className={cn(
                'grid h-[18px] w-3.5 shrink-0 place-items-center rounded text-text-faint',
                node.hasChildren ? 'cursor-pointer' : 'pointer-events-none opacity-0'
              )}
            >
              <Twist size={11} strokeWidth={2.4} />
            </button>
            <button
              type="button"
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
        )
      })}
    </div>
  )
}
