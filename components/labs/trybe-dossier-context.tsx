'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A BRAND'S NAME OPENS ITS PAGE (components/labs/TrybeDossier), wherever the
// name is shown: Find brands, Star brands, Ready to send, Sent, What changed.
// Outside the new TRYBE (no opener given) the name stays plain words.

import { createContext, useContext, type CSSProperties } from 'react'

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
