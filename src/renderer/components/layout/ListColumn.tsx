import type { InputHTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  LayoutGrid,
  List as ListIcon,
  Search
} from 'lucide-react'

// The chrome of the list column the Captures and Notes screens share: the search and
// toolbar header, the view toggle, the footer and the collapsed rail. Each screen keeps its
// own rows, menus and filters; these parts are what make the two columns read as one.

export function ListColumnSearch(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
      <input
        {...props}
        className="w-full rounded border border-border-strong bg-canvas py-1.5 pl-7 pr-2.5 text-xs text-text-primary placeholder:text-text-faint"
      />
    </div>
  )
}

interface ListColumnHeaderProps {
  search: ReactNode
  collapseLabel: string
  collapseTestId: string
  onCollapse: () => void
  /** The accent "new" control at the end of the search row. */
  action: ReactNode
  /** Sort, filter and view controls, on the row under the search. */
  toolbar: ReactNode
  /** Anything the list shows under the toolbar, such as a narrowing strip. */
  children?: ReactNode
}

export function ListColumnHeader({
  search,
  collapseLabel,
  collapseTestId,
  onCollapse,
  action,
  toolbar,
  children
}: ListColumnHeaderProps) {
  return (
    <div className="border-b border-border p-2">
      <div className="flex items-center gap-2">
        {search}
        <button
          onClick={onCollapse}
          title={collapseLabel}
          aria-label={collapseLabel}
          data-testid={collapseTestId}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        {action}
      </div>
      <div className="mt-1 flex items-center gap-1">{toolbar}</div>
      {children}
    </div>
  )
}

export type ListColumnView = 'detailed' | 'list'

const VIEWS: { value: ListColumnView; label: string; icon: LucideIcon }[] = [
  { value: 'detailed', label: 'Detailed view', icon: LayoutGrid },
  { value: 'list', label: 'List view', icon: ListIcon }
]

export function ListColumnViewToggle({
  view,
  onChange,
  groupLabel
}: {
  view: ListColumnView
  onChange: (view: ListColumnView) => void
  groupLabel: string
}) {
  return (
    <div
      role="group"
      aria-label={groupLabel}
      className="ml-auto flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-canvas p-0.5"
    >
      {VIEWS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          title={label}
          aria-label={label}
          aria-pressed={view === value}
          className={`flex h-5 w-[22px] items-center justify-center rounded ${
            view === value ? 'bg-card text-text-primary' : 'text-text-faint'
          }`}
        >
          <Icon className="h-3 w-3" />
        </button>
      ))}
    </div>
  )
}

export function ListColumnFooter({ children }: { children: ReactNode }) {
  return (
    <div className="border-t border-border bg-surface p-3 text-center text-[11px] text-text-muted">
      {children}
    </div>
  )
}

const RAIL_BUTTON_CLASS =
  'flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary disabled:opacity-40 disabled:hover:bg-transparent'

interface ListColumnRailProps {
  /** Singular item name, as in "capture" or "note". */
  noun: string
  icon: LucideIcon
  count: number
  testId: string
  onExpand: () => void
  onPrev: () => void
  onNext: () => void
  canGoPrev: boolean
  canGoNext: boolean
}

/** The 40px stand-in for a list column while it is collapsed. */
export function ListColumnRail({
  noun,
  icon: Icon,
  count,
  testId,
  onExpand,
  onPrev,
  onNext,
  canGoPrev,
  canGoNext
}: ListColumnRailProps) {
  return (
    <aside
      data-testid={testId}
      className="flex h-full w-10 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface py-2"
    >
      <button
        onClick={onExpand}
        title={`Expand ${noun} list`}
        data-testid={`${testId}-expand`}
        className={RAIL_BUTTON_CLASS}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <button
        onClick={onExpand}
        title={`${count} ${noun}${count === 1 ? '' : 's'}`}
        className={RAIL_BUTTON_CLASS}
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onPrev}
        disabled={!canGoPrev}
        title={`Previous ${noun}`}
        className={RAIL_BUTTON_CLASS}
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onNext}
        disabled={!canGoNext}
        title={`Next ${noun}`}
        className={RAIL_BUTTON_CLASS}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </aside>
  )
}
