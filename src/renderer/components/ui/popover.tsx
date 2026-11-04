import { useEffect, type ComponentPropsWithoutRef } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { motion } from 'motion/react'
import { presets } from '@renderer/lib/motion/presets'
import { useAppStore } from '@renderer/stores/appStore'
import { cn } from '@renderer/lib/utils'

/**
 * A panel anchored to a control: the Capture Session popover in the top bar and the overlay the
 * rail's strip opens (#1831), wrapping `radix-ui`'s Popover as context-menu.tsx wraps its
 * ContextMenu. Radix places it and closes it on Escape or a press outside. While it is open it
 * counts in the open-dialog registry (dialog.tsx), so the keyboard guards that read the registry
 * stand down for it as they do for a Dialog.
 */

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverAnchor = PopoverPrimitive.Anchor

// Mounted only while the content is, so the count follows the popover being open.
function OpenDialogRegistration() {
  useEffect(() => {
    const { registerOpenDialog, unregisterOpenDialog } = useAppStore.getState()
    registerOpenDialog()
    return unregisterOpenDialog
  }, [])
  return null
}

// Fades in over the app's overlay duration and closes at once.
function PopoverContent({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        // The capture list clears its multi-selection on Escape and stands down for an overlay
        // that carries this attribute (#686).
        data-selection-escape-guard=""
        className={cn(
          'z-50 overflow-hidden rounded-md border border-border bg-card shadow-[var(--shadow-overlay)] outline-none',
          className
        )}
        asChild
        {...props}
      >
        <motion.div
          initial={presets.overlay.initial}
          animate={presets.overlay.animate}
          transition={presets.overlay.transition}
        >
          <OpenDialogRegistration />
          {children}
        </motion.div>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent }
