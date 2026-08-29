import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui'
import { cn } from '@renderer/lib/utils'

/**
 * The app's one right-click menu (#701).
 *
 * Adoption of `radix-ui`'s ContextMenu rather than a fourth hand-rolled menu:
 * `role="menu"`/`role="menuitem"`, roving focus, typeahead, arrow-key
 * navigation, Escape-to-close and focus return to the trigger are the parts the
 * three existing menus (`CaptureMenu`, `CaptureDownloadMenu`, `ExportMenu`)
 * each get partly right, and they are acceptance criteria here. Those three are
 * deliberately not migrated onto this primitive — see the ticket's non-goals.
 */

const ContextMenu = ContextMenuPrimitive.Root
const ContextMenuTrigger = ContextMenuPrimitive.Trigger
const ContextMenuSub = ContextMenuPrimitive.Sub

const PANEL_CLASS =
  'z-50 min-w-[13rem] max-w-[16rem] overflow-hidden rounded-md border border-border-strong bg-card p-1 shadow-xl'

const ITEM_CLASS =
  'flex w-full cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-left text-xs outline-none data-[highlighted]:bg-elevated data-[disabled]:pointer-events-none data-[disabled]:opacity-45'

function ContextMenuContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        // Escape belongs to whichever menu is open. The capture list clears its
        // multi-selection on Escape and reads this attribute — not the DOM
        // role — to stand down for overlays that own the key first; it is the
        // same opt-in the selection bar's tag popover uses (#686).
        data-selection-escape-guard=""
        data-testid="entity-context-menu"
        className={cn(PANEL_CLASS, className)}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  danger = false,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & { danger?: boolean }) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(ITEM_CLASS, danger ? 'text-red-400' : 'text-text-secondary', className)}
      {...props}
    />
  )
}

function ContextMenuSubTrigger({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger>) {
  return (
    <ContextMenuPrimitive.SubTrigger
      className={cn(ITEM_CLASS, 'text-text-secondary data-[state=open]:bg-elevated', className)}
      {...props}
    />
  )
}

function ContextMenuSubContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent
        data-selection-escape-guard=""
        className={cn(PANEL_CLASS, className)}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator className={cn('my-1 h-px bg-border', className)} {...props} />
  )
}

interface ContextMenuHeaderProps {
  icon: ReactNode
  title: string
  subtitle: string
}

/**
 * The target the menu is about, drawn from the mock's menu header.
 *
 * `aria-hidden`, and deliberately: Radix gives `Label` no role, so assistive
 * tech walking the menu would announce it as stray text between items. The
 * same words reach the accessibility tree once, as the menu's own
 * `aria-label` — see `EntityContextMenu`.
 */
function ContextMenuHeader({ icon, title, subtitle }: ContextMenuHeaderProps) {
  return (
    <ContextMenuPrimitive.Label
      aria-hidden="true"
      className="-mx-1 -mt-1 mb-1 flex items-center gap-2 border-b border-border bg-surface px-[11px] py-2"
    >
      <span className="shrink-0 text-accent">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-text-primary">{title}</span>
        <span className="block truncate text-[10px] text-text-faint">{subtitle}</span>
      </span>
    </ContextMenuPrimitive.Label>
  )
}

/** The key hint on the right of an item. Never a claim: only real routes. */
function ContextMenuShortcut({ children }: { children: ReactNode }) {
  return <span className="shrink-0 font-mono text-[10px] text-text-faint">{children}</span>
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuSeparator,
  ContextMenuHeader,
  ContextMenuShortcut
}
