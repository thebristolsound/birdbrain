import {
  createContext,
  useContext,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type RefObject
} from 'react'
import { DropdownMenu as MenuPrimitive } from 'radix-ui'
import { cn } from '@renderer/lib/utils'

/**
 * The menu that opens from a button, wrapping `radix-ui`'s DropdownMenu as context-menu.tsx wraps
 * its ContextMenu. Radix gives the roles, the arrow keys, Home, End, typeahead, Escape and the
 * return of focus to the trigger. An item always closes the menu: it moves focus to the trigger
 * before it acts, and a menu that is not modal closes when focus leaves it.
 */

interface MenuContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: RefObject<HTMLButtonElement | null>
}

const MenuContext = createContext<MenuContextValue | null>(null)

function useMenu(): MenuContextValue {
  const menu = useContext(MenuContext)
  if (!menu) throw new Error('A menu part was rendered outside <Menu>')
  return menu
}

interface MenuProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}

function Menu({ open: controlled, onOpenChange, children }: MenuProps) {
  const [uncontrolled, setUncontrolled] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const open = controlled ?? uncontrolled

  function setOpen(next: boolean) {
    if (controlled === undefined) setUncontrolled(next)
    onOpenChange?.(next)
  }

  return (
    <MenuContext.Provider value={{ open, setOpen, triggerRef }}>
      {/* Not modal, as the menus it replaces were not: a press outside closes the menu and still
          lands on what was pressed. */}
      <MenuPrimitive.Root modal={false} open={open} onOpenChange={setOpen}>
        {children}
      </MenuPrimitive.Root>
    </MenuContext.Provider>
  )
}

function MenuTrigger({
  onClick,
  onPointerDown,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Trigger>) {
  const { open, setOpen, triggerRef } = useMenu()
  return (
    <MenuPrimitive.Trigger
      ref={triggerRef}
      {...props}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        // A real press names its pointer. Motion's press gesture sends a pointerdown with none
        // when Enter goes down on a motion.button, as Button is, and Radix has already opened
        // the menu on that key: a second toggle would shut it.
        if (event.nativeEvent.pointerType === '') event.preventDefault()
      }}
      onClick={(event) => {
        onClick?.(event)
        // Radix opens on pointer down and on the keyboard. A click with no press behind it, as
        // assistive technology or `element.click()` sends, reaches neither.
        if (event.detail === 0) setOpen(!open)
      }}
    />
  )
}

const PANEL_CLASS =
  'z-50 w-56 rounded-lg border border-border-strong bg-card py-1 shadow-xl outline-none'

const ITEM_CLASS =
  'flex w-full cursor-default select-none items-center gap-2 px-3 py-2 text-left text-xs outline-none data-[highlighted]:bg-elevated data-[disabled]:opacity-50'

function MenuContent({
  className,
  align = 'end',
  sideOffset = 4,
  loop = true,
  onKeyDown,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Content>) {
  const { setOpen } = useMenu()
  // Radix names the menu after its trigger. A label of the menu's own replaces that name.
  const ownLabel = props['aria-label'] ? { 'aria-labelledby': undefined } : null
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        // The capture list clears its multi-selection on Escape and stands down for an overlay
        // that carries this attribute (#686).
        data-selection-escape-guard=""
        align={align}
        sideOffset={sideOffset}
        loop={loop}
        className={cn(PANEL_CLASS, className)}
        {...props}
        {...ownLabel}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          // Radix swallows Tab. Closing hands focus back to the trigger, where Tab works again.
          if (event.key === 'Tab') setOpen(false)
        }}
      />
    </MenuPrimitive.Portal>
  )
}

function MenuItem({
  className,
  danger = false,
  onSelect,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Item> & { danger?: boolean }) {
  const { triggerRef } = useMenu()
  return (
    <MenuPrimitive.Item
      className={cn(ITEM_CLASS, danger ? 'text-danger-fg' : 'text-text-secondary', className)}
      {...props}
      onSelect={(event) => {
        // The item unmounts with the menu, and Radix returns focus a turn later. A dialog the
        // item opens records its opener at once, so the trigger takes focus before the item acts.
        triggerRef.current?.focus()
        onSelect?.(event)
      }}
    />
  )
}

function MenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn('my-1 h-px bg-border', className)} {...props} />
}

/** The key hint on the right of an item. */
function MenuShortcut({ children }: { children: ReactNode }) {
  return <span className="ml-auto text-[10px] text-text-faint">{children}</span>
}

export { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator, MenuShortcut }
