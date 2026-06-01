// MVP Affiliate — Card primitive.
//
// Composable card. Use instead of the global `.card` class when you want
// a Header / Content / Footer split (which most dashboard widgets do).
//
//   <Card>
//     <CardHeader>
//       <CardTitle>Brand profile</CardTitle>
//       <CardDescription>Used to render every blog page header.</CardDescription>
//     </CardHeader>
//     <CardContent>
//       …
//     </CardContent>
//     <CardFooter>
//       <Button>Save</Button>
//     </CardFooter>
//   </Card>
//
// Variants:
//   default — bordered surface (replaces 90% of dashboard cards)
//   ghost   — no border, no shadow (for grouped content inside another card)
//   elevated — heavier shadow (use sparingly — one per view max)

'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const cardVariants = cva(
  'rounded-xl text-[var(--text)] transition-shadow',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--surface)] border border-[var(--border-2)] shadow-[var(--shadow-sm)]',
        ghost: 'bg-transparent',
        elevated:
          'bg-[var(--surface)] border border-[var(--border-2)] shadow-[var(--shadow-md)]',
        // Subtle highlight — for "you should look at this" widgets without
        // a destructive feel. Brand accent at 5% intensity.
        accent:
          'bg-[#7C3AED]/[0.04] border border-[#7C3AED]/15 shadow-[var(--shadow-sm)] ' +
          'dark:bg-[#5fa5ff]/[0.06] dark:border-[#5fa5ff]/20',
      },
      interactive: {
        true: 'hover:shadow-[var(--shadow-md)] cursor-pointer',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      interactive: false,
    },
  },
)

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  function Card({ className, variant, interactive, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(cardVariants({ variant, interactive }), className)}
        {...props}
      />
    )
  },
)

export const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function CardHeader({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        'flex flex-col gap-1 p-5 pb-3 border-b border-[var(--border-2)]',
        className,
      )}
      {...props}
    />
  )
})

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(function CardTitle({ className, ...props }, ref) {
  return (
    <h3
      ref={ref}
      className={cn(
        'text-base font-semibold tracking-tight text-[var(--text)]',
        className,
      )}
      {...props}
    />
  )
})

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function CardDescription({ className, ...props }, ref) {
  return (
    <p
      ref={ref}
      className={cn('text-xs text-[var(--text-3)] leading-relaxed', className)}
      {...props}
    />
  )
})

export const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function CardContent({ className, ...props }, ref) {
  return <div ref={ref} className={cn('p-5', className)} {...props} />
})

export const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function CardFooter({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        'flex items-center justify-end gap-2 p-5 pt-3 border-t border-[var(--border-2)]',
        className,
      )}
      {...props}
    />
  )
})
