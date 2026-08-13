import { forwardRef, type HTMLAttributes } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { cn } from '@renderer/lib/utils'
import { presets } from '@renderer/lib/motion'

type NativeDivProps = Omit<HTMLAttributes<HTMLDivElement>, keyof HTMLMotionProps<'div'>>

type CardProps = NativeDivProps &
  HTMLMotionProps<'div'> & {
    hover?: boolean
    interactive?: boolean
  }

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, hover, interactive, ...props }, ref) => (
    <motion.div
      ref={ref}
      whileHover={interactive ? presets.cardHover.whileHover : undefined}
      transition={interactive ? presets.cardHover.transition : undefined}
      className={cn('neu-card rounded-2xl', hover && 'neu-card-hover', className)}
      {...props}
    />
  )
)
Card.displayName = 'Card'

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div className={cn('flex flex-col space-y-1.5 p-5 pb-0', className)} ref={ref} {...props} />
  )
)
CardHeader.displayName = 'CardHeader'

const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      className={cn(
        'font-display text-xs font-semibold tracking-display text-text-primary',
        className
      )}
      ref={ref}
      {...props}
    />
  )
)
CardTitle.displayName = 'CardTitle'

// The recessed inner surface inside a Card — the inversion of Card itself:
// stronger border on the dimmer surface, so it reads as sunk into its parent.
const CardPanel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      className={cn('rounded-lg border border-border-strong bg-surface p-3', className)}
      ref={ref}
      {...props}
    />
  )
)
CardPanel.displayName = 'CardPanel'

const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p className={cn('text-sm text-text-muted', className)} ref={ref} {...props} />
  )
)
CardDescription.displayName = 'CardDescription'

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div className={cn('p-5', className)} ref={ref} {...props} />
)
CardContent.displayName = 'CardContent'

const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div className={cn('flex items-center p-5 pt-0', className)} ref={ref} {...props} />
  )
)
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardPanel }
