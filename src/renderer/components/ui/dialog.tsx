import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { presets } from '@renderer/lib/motion/presets'
import { useAppStore } from '@renderer/stores/appStore'
import { cn } from '@renderer/lib/utils'

// Moving focus in and handing it back is keyed on `open`, which only Dialog
// has, while the node focus moves into belongs to DialogContent. The ref
// travels down so Dialog can reach it without the call site wiring one up.
const DialogContentRefContext = createContext<RefObject<HTMLDivElement | null> | null>(null)

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[tabindex]'
].join(', ')

// Deliberately not filtered on visibility: jsdom reports no layout, so an
// offsetParent test would call every candidate hidden and leave the trap with
// nothing to cycle through under test.
function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) =>
      !el.hasAttribute('disabled') &&
      !el.hasAttribute('hidden') &&
      el.getAttribute('aria-hidden') !== 'true' &&
      el.getAttribute('tabindex') !== '-1' &&
      !isSkippedRadio(el, root)
  )
}

// A native radio group is one Tab stop, its checked radio, with the arrow keys
// moving inside it. Cycling through every radio would give the trap a longer
// walk than the browser's own and land on radios Tab never reaches.
function isSkippedRadio(el: HTMLElement, root: HTMLElement): boolean {
  if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || el.checked || !el.name) {
    return false
  }
  return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]')).some(
    (radio) => radio.name === el.name && radio.checked
  )
}

/**
 * Escape-to-close plus the open-dialog registration (#686), for a surface that
 * is modal while `open` is true. Dialog runs on it; the modals that cannot take
 * Dialog's markup (the command palette, the tour, the import and export
 * panels) run on it too, rather than on a second copy.
 */
function useModalEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      // An Escape something inside the dialog already handled — a Mention
      // autocomplete dismissing itself, say — must not also close the dialog
      // and discard whatever was being written into it.
      if (e.defaultPrevented) return
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  // AnimatePresence keeps the content mounted for the exit animation, so the
  // element carrying role="dialog" outlives `open` by roughly 150ms. Anything
  // asking "is a dialog up?" therefore cannot ask the DOM. This registration
  // is the answer instead, and it is deliberately keyed on `open` alone — the
  // same dependency as the Escape-to-close listener above, so the guard other
  // components read is armed exactly while this dialog owns Escape (#686).
  useEffect(() => {
    if (!open) return
    const { registerOpenDialog, unregisterOpenDialog } = useAppStore.getState()
    registerOpenDialog()
    return unregisterOpenDialog
  }, [open])
}

/**
 * Half of the modal focus contract: focus moves into `contentRef` on open and
 * goes back to whatever opened it on close. The other half — Tab staying
 * inside — is `trapTab`, run from the content node's own keydown.
 */
function useModalFocus(open: boolean, contentRef: RefObject<HTMLElement | null>) {
  const openerRef = useRef<HTMLElement | null>(null)

  // Keyed on `open` rather than on the content unmounting, so the hand-back
  // happens when the dialog stops owning the keyboard instead of ~150ms later
  // when AnimatePresence finishes the exit animation.
  //
  // A layout effect, not a passive one, for the sake of the dialogs that pick
  // their own landing control (ConfirmDialog, RowEditModal): those run in a
  // passive effect, so they get the last word on where focus ends up, while
  // the opener is recorded here before anything inside can move it.
  useLayoutEffect(() => {
    if (!open) return
    const content = contentRef.current
    if (!content) return
    const active = document.activeElement as HTMLElement | null
    // Focus already inside means something in the dialog claimed it earlier
    // still — an autoFocus attribute, or a layout effect of its own. Leave it,
    // and record no opener rather than a node inside the dialog.
    if (content.contains(active)) return
    openerRef.current = active
    const firstInside = tabbables(content)[0] ?? content
    firstInside.focus()
  }, [open, contentRef])

  // The hand-back is a passive effect rather than the cleanup of the layout
  // effect above, because React restores the pre-commit selection between the
  // two: focus set from a layout cleanup lands back on the control inside the
  // closing dialog.
  useEffect(() => {
    if (!open) return
    const content = contentRef.current
    return () => {
      const opener = openerRef.current
      openerRef.current = null
      if (!content || !opener?.isConnected) return
      // A dialog its parent unmounts while still open never sees `open` turn
      // false: by the time this runs its content is gone, and focus has fallen
      // to the body or been left on a detached node. That is a drop rather
      // than a choice, so it is handed back as well.
      const active = document.activeElement
      const dropped = !active || active === document.body || !active.isConnected
      // Otherwise only take focus back if the dialog still holds it; something
      // that moved focus elsewhere on its way out gets to keep it.
      if (dropped || content.contains(active)) opener.focus()
    }
  }, [open, contentRef])

  // Focus can also fall out while the dialog stays open, when the control
  // holding it unmounts: a panel swapping one step's content for the next. The
  // next Tab would then start from the body and walk the page behind, so it is
  // brought back in. Only a Tab from nowhere: one from a real node belongs to
  // `trapTab`, or to whoever owns that node.
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key !== 'Tab' || e.defaultPrevented) return
      const active = document.activeElement
      if (active && active !== document.body && active.isConnected) return
      const content = contentRef.current
      if (!content) return
      e.preventDefault()
      const targets = tabbables(content)
      const landing = (e.shiftKey ? targets[targets.length - 1] : targets[0]) ?? content
      landing.focus()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, contentRef])
}

/**
 * Keeps Tab inside `content`, cycling from the last control to the first and
 * back. Call it from the content node's React `onKeyDown`.
 *
 * Handled there rather than on a window listener so React's own bubbling
 * settles first: a Tab something inside already acted on — the Mention
 * autocomplete accepting the highlighted suggestion, or a nested dialog's
 * trap — arrives already defaultPrevented and is not ours to redirect.
 */
function trapTab(e: ReactKeyboardEvent<HTMLElement>, content: HTMLElement | null) {
  if (!content || e.key !== 'Tab' || e.defaultPrevented) return
  e.preventDefault()
  const targets = tabbables(content)
  if (targets.length === 0) {
    content.focus()
    return
  }
  const last = targets.length - 1
  const index = targets.indexOf(document.activeElement as HTMLElement)
  // index === -1 is focus sitting on the container itself, which is where
  // it lands when the dialog opened with nothing tabbable in it.
  const step = e.shiftKey ? -1 : 1
  const from = index === -1 ? (e.shiftKey ? 0 : last) : index
  targets[(from + step + targets.length) % targets.length].focus()
}

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

function Dialog({ open, onOpenChange, children }: DialogProps) {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const close = useCallback(() => onOpenChange(false), [onOpenChange])

  useModalEscape(open, close)
  useModalFocus(open, contentRef)

  return (
    <DialogContentRefContext.Provider value={contentRef}>
      <AnimatePresence>{open && children}</AnimatePresence>
    </DialogContentRefContext.Provider>
  )
}

function DialogOverlay({ onClose }: { onClose: () => void }) {
  return (
    <motion.div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} {...presets.overlay} />
  )
}

// Omit React HTML event handlers that conflict with framer-motion's types
type MotionConflicts =
  | 'onDrag'
  | 'onDragStart'
  | 'onDragEnd'
  | 'onDragOver'
  | 'onAnimationStart'
  | 'onAnimationEnd'

interface DialogContentProps extends Omit<ComponentPropsWithoutRef<'div'>, MotionConflicts> {
  onClose: () => void
}

const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, onClose, onKeyDown, children, ...props }, ref) => {
    const trapRef = useContext(DialogContentRefContext)
    const nodeRef = useRef<HTMLDivElement | null>(null)

    function setRef(node: HTMLDivElement | null) {
      nodeRef.current = node
      if (trapRef) trapRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    }

    function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
      onKeyDown?.(e)
      trapTab(e, nodeRef.current)
    }

    return (
      <>
        <DialogOverlay onClose={onClose} />
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div
            // Kept for the whole exit animation on purpose: while the node is on
            // screen it is still a dialog, and dropping the role mid-exit would
            // tell assistive tech the opposite of what is rendered. Code asking
            // whether a dialog is open reads `openDialogCount` instead (#686).
            role="dialog"
            aria-modal="true"
            // Programmatically focusable so a dialog with nothing tabbable in
            // it still takes focus off the surface behind it.
            tabIndex={-1}
            className={cn('neu-overlay rounded-2xl p-6 w-full max-w-md', className)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
            ref={setRef}
            {...presets.modal}
            {...props}
          >
            {children}
          </motion.div>
        </div>
      </>
    )
  }
)
DialogContent.displayName = 'DialogContent'

const DialogHeader = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div className={cn('mb-4 space-y-1.5', className)} ref={ref} {...props} />
  )
)
DialogHeader.displayName = 'DialogHeader'

const DialogTitle = forwardRef<HTMLHeadingElement, ComponentPropsWithoutRef<'h3'>>(
  ({ className, ...props }, ref) => (
    <h3 className={cn('text-sm font-semibold text-text-primary', className)} ref={ref} {...props} />
  )
)
DialogTitle.displayName = 'DialogTitle'

const DialogDescription = forwardRef<HTMLParagraphElement, ComponentPropsWithoutRef<'p'>>(
  ({ className, ...props }, ref) => (
    <p className={cn('text-sm text-text-muted', className)} ref={ref} {...props} />
  )
)
DialogDescription.displayName = 'DialogDescription'

const DialogFooter = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div className={cn('flex justify-end gap-3 mt-6', className)} ref={ref} {...props} />
  )
)
DialogFooter.displayName = 'DialogFooter'

export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  useModalEscape,
  useModalFocus,
  trapTab
}
