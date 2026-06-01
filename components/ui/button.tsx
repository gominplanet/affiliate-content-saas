// MVP Affiliate — Button primitive.
//
// Use this everywhere instead of hand-rolled `<button className="bg-[#0071e3]
// hover:bg-[#0062c4] ...">` patterns. Variants cover the 5 button shapes
// the dashboard actually uses; sizes cover the 3 we actually render.
//
// Loading state shows a spinner in place of (optional) leading icon and
// disables the button. Trailing icons (e.g. ChevronRight on "Continue")
// stay through the loading state because they describe intent, not state.

'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  // Base — every button is inline-flex + centered with token-driven sizing
  // and a single focus ring style. Disabled state is uniform across all
  // variants so a disabled `primary` doesn't suddenly read as `secondary`.
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium ' +
    'transition-all duration-150 outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-[#0071e3]/40 focus-visible:ring-offset-2 ' +
    'focus-visible:ring-offset-[var(--bg)] ' +
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none ' +
    'whitespace-nowrap select-none',
  {
    variants: {
      variant: {
        // The blue→violet brand gradient. Use sparingly — one per view.
        primary:
          'bg-gradient-to-br from-[#0071e3] to-[#7b61ff] text-white shadow-sm ' +
          'hover:shadow-md hover:brightness-110 active:brightness-95',
        // Default action button — neutral surface with border. The dashboard
        // default for "do the thing" when there's already a primary above.
        secondary:
          'bg-[var(--surface)] text-[var(--text)] border border-[var(--border-2)] ' +
          'hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)]',
        // Toolbar / inline button — no border, no fill. For "More", "Edit",
        // and similar lightweight actions in dense UIs.
        ghost:
          'bg-transparent text-[var(--text-2)] ' +
          'hover:bg-[var(--surface-2)] hover:text-[var(--text)] active:bg-[var(--surface-2)]',
        // Destructive — never the primary in a view. Solid fill so a user
        // can't miss what they're about to do.
        destructive:
          'bg-[#ff3b30] text-white shadow-sm ' +
          'hover:brightness-110 active:brightness-95',
        // Outlined — same shape as primary but bordered, for secondary CTAs
        // that still want the brand color.
        outline:
          'bg-transparent text-[#0071e3] border border-[#0071e3]/30 ' +
          'hover:bg-[#0071e3]/10 active:bg-[#0071e3]/15 ' +
          'dark:text-[#5fa5ff] dark:border-[#5fa5ff]/30 dark:hover:bg-[#5fa5ff]/10',
        // Link — looks like a text link but participates in button focus +
        // size rules. For "Forgot password" etc.
        link:
          'bg-transparent text-[#0071e3] hover:underline underline-offset-2 ' +
          'dark:text-[#5fa5ff] px-0 py-0',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4 text-sm',
        lg: 'h-11 px-5 text-[15px]',
        // Square icon-only — width matches height. Always pair with an
        // aria-label since there's no visible text.
        icon: 'h-9 w-9',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    compoundVariants: [
      // Link variant ignores padding from size so it reads as inline text.
      { variant: 'link', class: 'h-auto px-0 py-0' },
    ],
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
      fullWidth: false,
    },
  },
)

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>,
    VariantProps<typeof buttonVariants> {
  /** Leading icon, hidden while loading (spinner takes its place). */
  leftIcon?: React.ReactNode
  /** Trailing icon — always shown; describes intent, not state. */
  rightIcon?: React.ReactNode
  /** When true: disables the button and swaps leading icon for a spinner. */
  loading?: boolean
  children?: React.ReactNode
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant,
      size,
      fullWidth,
      leftIcon,
      rightIcon,
      loading = false,
      disabled,
      children,
      type = 'button',
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={cn(buttonVariants({ variant, size, fullWidth }), className)}
        aria-busy={loading || undefined}
        {...rest}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          leftIcon
        )}
        {children}
        {rightIcon}
      </button>
    )
  },
)

export { buttonVariants }
