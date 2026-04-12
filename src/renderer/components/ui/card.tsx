import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@renderer/lib/utils'

type CardProps = HTMLAttributes<HTMLDivElement> & {
  hover?: boolean
}

const Card = forwardRef<HTMLDivElement, CardProps>(({ className, hover, ...props }, ref) => (
  <div
    className={cn('neu-card rounded-2xl', hover && 'neu-card-hover', className)}
    ref={ref}
    {...props}
  />
))
Card.displayName = 'Card'

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div className={cn('flex flex-col space-y-1.5 p-5 pb-0', className)} ref={ref} {...props} />
  )
)
CardHeader.displayName = 'CardHeader'

const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 className={cn('text-lg font-semibold text-text-primary', className)} ref={ref} {...props} />
  )
)
CardTitle.displayName = 'CardTitle'

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

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
