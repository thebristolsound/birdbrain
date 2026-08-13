import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { motion, type HTMLMotionProps } from 'motion/react'
import { cn } from '@renderer/lib/utils'
import { presets } from '@renderer/lib/motion'

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-accent text-white shadow-[var(--shadow-btn)] hover:bg-accent-hover',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
        outline: 'border border-border-strong bg-transparent hover:bg-elevated text-text-primary',
        ghost: 'hover:bg-elevated text-text-muted hover:text-text-primary',
        link: 'text-accent underline-offset-4 hover:underline'
      },
      // One control metric: 28px / 4px radius / 0 11px / 12px. Every size
      // except lg aliases to it, so untouched call sites converge without a
      // sweep. lg is the only step off that metric (36px, flat), reserved for
      // the dashboard hero CTA — which still renders raw <button> elements, so
      // lg has no call site until HeroSection is swept.
      size: {
        xs: 'h-7 px-[11px] text-xs',
        sm: 'h-7 px-[11px] text-xs',
        default: 'h-7 px-[11px] text-xs',
        lg: 'h-9 px-5 text-sm rounded-lg',
        icon: 'h-7 w-7',
        'icon-sm': 'h-6 w-6'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  keyof HTMLMotionProps<'button'>
>

type ButtonProps = NativeButtonProps &
  HTMLMotionProps<'button'> &
  VariantProps<typeof buttonVariants>

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, disabled, ...props }, ref) => (
    <motion.button
      ref={ref}
      disabled={disabled}
      whileTap={disabled ? undefined : presets.tap.whileTap}
      transition={presets.tap.transition}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
)
Button.displayName = 'Button'

export { Button, buttonVariants }
