import { Fragment, type ReactNode } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuHeader,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import {
  entityMenuEntries,
  entityMenuHeader,
  isSubmenu,
  type EntityMenuTarget,
  type MenuAction,
  type MenuEntry
} from '@renderer/components/contextmenu/entityMenu'

interface EntityContextMenuProps {
  target: EntityMenuTarget
  children: ReactNode
}

function ActionItem({ action }: { action: MenuAction }) {
  const Icon = action.icon
  return (
    <ContextMenuItem
      danger={action.danger}
      disabled={action.disabled}
      data-testid={`context-menu-item-${action.id}`}
      onSelect={action.run}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.8} />
      <span className="min-w-0 flex-1 truncate">{action.label}</span>
      {action.shortcut && <ContextMenuShortcut>{action.shortcut}</ContextMenuShortcut>}
    </ContextMenuItem>
  )
}

function Entry({ entry }: { entry: MenuEntry }) {
  if (!isSubmenu(entry)) return <ActionItem action={entry} />
  const Icon = entry.icon
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger data-testid={`context-menu-item-${entry.id}`}>
        <Icon
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 text-text-muted"
          strokeWidth={1.8}
        />
        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent aria-label={entry.label}>
        {entry.items.length === 0 ? (
          // Not a disabled menuitem: there is nothing to select, and an item
          // that can never run still reaches the roving focus order.
          <p className="px-2 py-1.5 text-[11px] text-text-faint">{entry.emptyLabel}</p>
        ) : (
          entry.items.map((item) => <ActionItem key={item.id} action={item} />)
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

/**
 * A right-click menu for one entity row (#701).
 *
 * The surface says what was clicked and supplies the callbacks; the registry
 * decides the menu. Adopting a surface is therefore one wrapper and one target
 * object, with no menu markup and no focus or Escape handling of its own.
 */
export function EntityContextMenu({ target, children }: EntityContextMenuProps) {
  const header = entityMenuHeader(target)
  const entries = entityMenuEntries(target)
  const HeaderIcon = header.icon

  return (
    <ContextMenu>
      {/* A plain block wrapper, which every adopting surface's row already
          fills. The trigger has to be a real element: the menu opens at the
          pointer, so it needs the event, not just the children. */}
      <ContextMenuTrigger asChild>
        <div data-context-menu-kind={target.kind}>{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={header.ariaLabel}>
        <ContextMenuHeader
          icon={<HeaderIcon className="h-3.5 w-3.5" strokeWidth={2} />}
          title={header.title}
          subtitle={header.subtitle}
        />
        {entries.map((entry) => (
          // A Fragment, not a wrapper element: `role="menu"` owns its items,
          // and boxing them in anonymous divs is how a menu stops announcing
          // its length.
          <Fragment key={entry.id}>
            {entry.separatorBefore && <ContextMenuSeparator />}
            <Entry entry={entry} />
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}
