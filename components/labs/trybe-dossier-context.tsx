'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A BRAND'S NAME OPENS ITS PAGE (components/labs/TrybeDossier), wherever the
// name is shown: Find brands, Star brands, Ready to send, Sent, What changed.
// Outside the new TRYBE (no opener given) the name stays plain words.

import { createContext, useContext, type CSSProperties, type MouseEvent, type ReactNode } from 'react'

export const DossierCtx = createContext<((brandId: string, name: string) => void) | null>(null)

/** The brand's name, as a button that opens its page when the page can. */
export function BrandName({ id, name, className = '', style }: { id: string; name: string; className?: string; style?: CSSProperties }) {
  const open = useContext(DossierCtx)
  if (!open) return <span className={className} style={style}>{name}</span>
  return (
    <button type="button" className={`${className} text-left hover:underline underline-offset-4 decoration-2 focus-visible:outline focus-visible:outline-2`}
      style={{ ...style, textDecorationColor: 'rgb(var(--brand-rgb) / 0.5)', outlineColor: 'var(--accent)' }}
      title={`Everything MVP knows about ${name}`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); open(id, name) }}>
      {name}
    </button>
  )
}

// ── THE WHOLE CARD OPENS IT (Seb, 2026-11-06: "make the card clickable
// because people are probably just going to click on the card itself") ────
// A press anywhere on a brand's card or row opens its page, the same as its
// name. A press on a button, link, box or field inside does that control's own
// job instead, and a press that ends a text selection selects. The name stays
// the keyboard's way in, so no control sits inside another.

const OWN_JOB = 'a, button, input, select, textarea, label, summary, video, audio, [role="button"], [data-own-click]'

/** The click handler that opens a brand's page from anywhere on its card,
 *  or null outside the new TRYBE. */
export function useBrandOpen(): ((id: string, name: string) => (e: MouseEvent<HTMLElement>) => void) | null {
  const open = useContext(DossierCtx)
  if (!open) return null
  return (id, name) => (e) => {
    const t = e.target as HTMLElement | null
    const inner = t?.closest?.(OWN_JOB)
    if (inner && inner !== e.currentTarget && e.currentTarget.contains(inner)) return
    const sel = typeof window !== 'undefined' ? window.getSelection?.() : null
    if (sel && !sel.isCollapsed && String(sel).trim()) return
    open(id, name)
  }
}

/** A card or row that opens the brand's page when pressed anywhere. */
export function BrandOpen({ id, name, className = '', style, lift = false, children }: { id: string; name: string; className?: string; style?: CSSProperties; lift?: boolean; children: ReactNode }) {
  const onOpen = useBrandOpen()
  if (!onOpen || !id || !name) return <div className={className} style={style}>{children}</div>
  return (
    <div className={`${className} cursor-pointer ${lift ? 'transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-md' : 'transition-colors hover:bg-[rgb(var(--brand-rgb)/0.05)]'}`}
      style={style} title={`Everything MVP knows about ${name}`} onClick={onOpen(id, name)}>
      {children}
    </div>
  )
}
