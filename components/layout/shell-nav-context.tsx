'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The menu's job sections as this member sees them, handed down by
// DashboardShellV2 to any page inside it. The Dashboard's "Everything MVP
// does" reads it, so it lists exactly the rows the menu shows: the gates live
// in the menu alone, and a feature can never be listed for someone who cannot
// open it, or left off for someone who can.

import { createContext, useContext, type ReactNode } from 'react'

export type ShellNavItem = {
  href: string
  label: string
  /** An unread count, or a short word like "New". */
  badge?: number | string
  /** The row's other addresses (its tabs): a pin saved on one is this row's. */
  aliases?: string[]
  /** The row's menu icon. */
  icon?: ReactNode
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

/** A main area of the menu (lib/labs-preview section_nav): what the left side
 *  shows, and what its page lists. `direct` areas (the Dashboard, TRYBE) open
 *  their one page straight away. */
export type ShellSection = {
  label: string
  slug: string
  href: string
  color?: string
  tint?: string
  icon?: ReactNode
  direct: boolean
  items: ShellNavItem[]
}
export const ShellSectionsContext = createContext<ShellSection[] | null>(null)

/** Every main area this member can open, in menu order; null outside the shell. */
export function useShellSections(): ShellSection[] | null {
  return useContext(ShellSectionsContext)
}

/** The job sections, or null outside the dashboard shell. */
export function useShellNav(): ShellNavGroup[] | null {
  return useContext(ShellNavContext)
}

/** The look the shell is drawn in (lib/look), for a page that lays itself
 *  out differently in the new look. 'classic' outside the shell. */
export const ShellLookContext = createContext<'teal' | 'classic'>('classic')

export function useLook(): 'teal' | 'classic' {
  return useContext(ShellLookContext)
}

/** One job section of the menu by its label (its colour and wash), or null. */
export function useSection(label: string): ShellNavGroup | null {
  return useShellNav()?.find((g) => g.label === label) ?? null
}

/** The menu row the page you are on belongs to: its section (with the
 *  section's colour and wash), its name and its icon. The new look's page
 *  header (PageHero, teal-ui TealHeader) reads it, so every page says which
 *  part of MVP it is without saying so itself. Null outside the shell, or on
 *  a page that is not in the menu. */
export type ShellActive = { section: string | null; color?: string; tint?: string; label: string; icon: ReactNode } | null
export const ShellActiveContext = createContext<ShellActive>(null)

export function useActiveNav(): ShellActive {
  return useContext(ShellActiveContext)
}
