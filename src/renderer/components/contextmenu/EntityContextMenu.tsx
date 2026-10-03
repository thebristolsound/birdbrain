import { Fragment, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Check, ChevronRight, Settings2 } from 'lucide-react'
import {
  readHiddenActions,
  saveHiddenActions
} from '@renderer/components/contextmenu/menuPreferences'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuHeader,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuFooter,
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
  /** Classes for the trigger wrapper, for a surface that must fill its parent. */
  className?: string
}

type Defer = (run: () => void) => void

function ActionItem({ action, defer }: { action: MenuAction; defer: Defer }) {
  const Icon = action.icon
  return (
    <ContextMenuItem
      danger={action.danger}
      disabled={action.disabled}
      data-testid={`context-menu-item-${action.id}`}
      onSelect={() => (action.takesFocus ? defer(action.run) : action.run())}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.8} />
      <span className="min-w-0 flex-1 truncate">{action.label}</span>
      {action.shortcut && <ContextMenuShortcut>{action.shortcut}</ContextMenuShortcut>}
    </ContextMenuItem>
  )
}

function Entry({
  entry,
  defer,
  onDrill
}: {
  entry: MenuEntry
  defer: Defer
  onDrill: (id: string) => void
}) {
  if (!isSubmenu(entry)) return <ActionItem action={entry} defer={defer} />
  const Icon = entry.icon
  if (entry.drill) {
    return (
      <ContextMenuItem
        data-testid={`context-menu-item-${entry.id}`}
        onSelect={(event) => {
          event.preventDefault()
          onDrill(entry.id)
        }}
      >
        <Icon aria-hidden="true" className="h-3.5 w-3.5 text-text-muted" />
        <span className="flex-1">{entry.label}</span>
        <ChevronRight aria-hidden="true" className="h-3 w-3" />
      </ContextMenuItem>
    )
  }
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
          entry.items.map((item) => <ActionItem key={item.id} action={item} defer={defer} />)
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
export function EntityContextMenu({ target, children, className }: EntityContextMenuProps) {
  const [editing, setEditing] = useState(false)
  const [drilled, setDrilled] = useState<string | null>(null)
  const [hidden, setHidden] = useState(readHiddenActions)
  const keyFor = (id: string) => `${target.kind}:${id}`
  const header = entityMenuHeader(target)
  const rootEntries = entityMenuEntries(target)
  const drillEntry = rootEntries.find((entry) => entry.id === drilled)
  const entries = drillEntry && isSubmenu(drillEntry) ? drillEntry.items : rootEntries
  const HeaderIcon = header.icon
  // An item that moves focus into an inline editor runs once the menu has
  // closed, in place of handing focus back to the row. Run on select, the
  // editor focuses while the menu still traps focus, loses it straight back,
  // and a blur commits the editor.
  const deferred = useRef<(() => void) | null>(null)
  const defer: Defer = (run) => {
    deferred.current = run
  }
  const visible = entries.filter((entry) => editing || !hidden.includes(keyFor(entry.id)))
  function toggle(id: string) {
    const key = keyFor(id)
    const next = hidden.includes(key) ? hidden.filter((item) => item !== key) : [...hidden, key]
    setHidden(next)
    saveHiddenActions(next)
  }

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) setHidden(readHiddenActions())
        setEditing(false)
        setDrilled(null)
      }}
    >
      {/* A plain block wrapper, which every adopting surface's row already
          fills. The trigger has to be a real element: the menu opens at the
          pointer, so it needs the event, not just the children. */}
      <ContextMenuTrigger asChild>
        <div data-context-menu-kind={target.kind} className={className}>
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        aria-label={header.ariaLabel}
        onCloseAutoFocus={(event) => {
          const run = deferred.current
          if (!run) return
          deferred.current = null
          event.preventDefault()
          run()
        }}
      >
        <ContextMenuHeader
          icon={<HeaderIcon className="h-3.5 w-3.5" strokeWidth={2} />}
          title={header.title}
          subtitle={drilled ? 'export destination' : header.subtitle}
        />
        {drilled && (
          <ContextMenuItem
            onSelect={(event) => {
              event.preventDefault()
              setDrilled(null)
            }}
          >
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
            Back
          </ContextMenuItem>
        )}
        {visible.map((entry, index) => (
          // A Fragment, not a wrapper element: `role="menu"` owns its items,
          // and boxing them in anonymous divs is how a menu stops announcing
          // its length.
          <Fragment key={entry.id}>
            {entry.separatorBefore && index > 0 && <ContextMenuSeparator />}
            {editing ? (
              <ContextMenuCheckboxItem
                checked={!hidden.includes(keyFor(entry.id))}
                onCheckedChange={() => toggle(entry.id)}
                onSelect={(event) => event.preventDefault()}
                className={hidden.includes(keyFor(entry.id)) ? 'opacity-45' : undefined}
              >
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border-strong">
                  {!hidden.includes(keyFor(entry.id)) && <Check className="h-3 w-3 text-accent" />}
                </span>
                {entry.label}
              </ContextMenuCheckboxItem>
            ) : (
              <Entry entry={entry} defer={defer} onDrill={setDrilled} />
            )}
          </Fragment>
        ))}
        <ContextMenuFooter
          onSelect={(event) => {
            event.preventDefault()
            setEditing(!editing)
            setDrilled(null)
          }}
        >
          <Settings2 aria-hidden="true" className="h-3.5 w-3.5" />
          {editing ? 'Done — hidden actions can be restored here' : 'Customise this menu…'}
        </ContextMenuFooter>
      </ContextMenuContent>
    </ContextMenu>
  )
}
