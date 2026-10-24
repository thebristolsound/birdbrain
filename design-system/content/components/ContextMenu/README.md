# ContextMenu

The app's one right-click menu, on radix-ui: a `color-card` panel with a `color-border-strong` border, 4px radius, an entity header, items, a danger item, submenus, separators, shortcuts and a footer. Hand-written from `src/renderer/components/ui/context-menu.tsx`; the static preview shows the open panel.

## When to use

Any right-click on an entity (a capture, an exhibit, a selector). Do not hand-roll another menu; the three older menus are deliberately not migrated, and no fourth is added.

## What the consumer provides

- `ContextMenu` + `ContextMenuTrigger` around the entity; `ContextMenuContent` portals the panel and carries the Escape guard other surfaces read.
- `ContextMenuHeader` with `icon`, `title`, `subtitle` (aria-hidden; the same words go on the menu's `aria-label`).
- `ContextMenuItem` (`danger` for destructive), `ContextMenuCheckboxItem`, `ContextMenuSub` / `SubTrigger` / `SubContent`, `ContextMenuSeparator`, `ContextMenuShortcut` (only real routes), `ContextMenuFooter`.

## Rules

- Panel: 13 to 16rem wide, 4px padding, `shadow-xl`. Items: 12px `color-text-secondary`, 6px 8px padding, `color-elevated` when highlighted, 45% opacity when disabled. The header sits on `color-surface` with an accent icon and a 10px `color-text-faint` subtitle.
- Roving focus, typeahead, arrow keys, Escape and focus return come from radix; keep them.
