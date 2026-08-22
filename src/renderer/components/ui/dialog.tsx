import { forwardRef, useEffect, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { presets } from '@renderer/lib/motion/presets'
import { cn } from '@renderer/lib/utils'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

function Dialog({ open, onOpenChange, children }: DialogProps) {
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      // An Escape something inside the dialog already handled — a Mention
      // autocomplete dismissing itself, say — must not also close the dialog
      // and discard whatever was being written into it.
      if (e.defaultPrevented) return
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onOpenChange])

  return <AnimatePresence>{open && children}</AnimatePresence>
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
  ({ className, onClose, children, ...props }, ref) => (
    <>
      <DialogOverlay onClose={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <motion.div
          role="dialog"
          aria-modal="true"
          className={cn('neu-overlay rounded-2xl p-6 w-full max-w-md', className)}
          onClick={(e) => e.stopPropagation()}
          ref={ref}
          {...presets.modal}
          {...props}
        >
          {children}
        </motion.div>
      </div>
    </>
  )
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

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter }
