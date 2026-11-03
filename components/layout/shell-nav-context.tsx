'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The menu's job sections as this member sees them, handed down by
// DashboardShellV2 to any page inside it. The Dashboard's "Everything MVP
// does" reads it, so it lists exactly the rows the menu shows: the gates live
// in the menu alone, and a feature can never be listed for someone who cannot
// open it, or left off for someone who can.

import { createContext, useContext } from 'react'

export type ShellNavItem = {
  href: string
  label: string
  /** An unread count, or a short word like "New". */
  badge?: number | string
}

export type ShellNavGroup = {
  label: string
  /** The section's colour for this theme (the menu header's colour). */
  color: string
  /** A pale wash of that colour, for a header background. */
  tint: string
  items: ShellNavItem[]
}

export const ShellNavContext = createContext<ShellNavGroup[] | null>(null)

/** The job sections, or null outside the dashboard shell. */
export function useShellNav(): ShellNavGroup[] | null {
  return useContext(ShellNavContext)
}
