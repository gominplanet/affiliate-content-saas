/**
 * /area/[section] — ONE MAIN AREA OF MVP AND ITS TOOLS (lib/labs-preview
 * section_nav; Seb, 2026-11-08: "if I click on find products, it would bring
 * me to a page where inside that page, I would have the different sub
 * pages"). The tools are the menu's own rows for this member
 * (shell-nav-context), so nothing is listed that the member cannot open.
 * Each card says what the tool does and can be pinned to the Dashboard.
 */
'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { Loader2, Pin, ChevronRight } from 'lucide-react'
import { useShellSections, type ShellNavItem } from '@/components/layout/shell-nav-context'
import { featureLine } from '@/lib/feature-lines'
import { useNavFavorites, MAX_NAV_FAVORITES } from '@/lib/nav-favorites'

export default function SectionPage() {
  const { section } = useParams<{ section: string }>()
  const sections = useShellSections()
  const { favorites, toggle, savedTo } = useNavFavorites()
  const [note, setNote] = useState<string | null>(null)

  if (!sections) return <div className="flex items-center justify-center py-24" style={{ color: 'var(--text-faint)' }}><Loader2 size={16} className="animate-spin" /></div>
  const area = sections.find((s) => s.slug === section && !s.direct)
  if (!area) {
    return (
      <div className="rounded-2xl border p-6 max-w-xl" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <p className="text-[16px] font-bold">This part of MVP is not in your menu</p>
        <p className="text-[14px] mt-1" style={{ color: 'var(--text-soft)' }}>The address may be old, or your plan does not include it. <Link href="/dashboard" className="font-semibold underline">Go to your Dashboard</Link>.</p>
      </div>
    )
  }
  const mine = area.label === 'My features'
  const pinned = (f: ShellNavItem) => [f.href, ...(f.aliases || [])].some((h) => favorites.includes(h))
  const pin = (f: ShellNavItem) => { const { full } = toggle(f.href, f.aliases || []); setNote(full ? `You can pin ${MAX_NAV_FAVORITES}. Unpin one to pin ${f.label}.` : null) }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-2xl inline-flex items-center justify-center" style={{ background: area.tint, color: area.color }} aria-hidden="true">{area.icon}</span>
        <div>
          <h1 className="text-[26px] font-extrabold leading-tight">{area.label}</h1>
          <p className="text-[14px]" style={{ color: 'var(--text-soft)' }}>
            {mine ? 'The tools you pinned, here and at the top of your Dashboard.' : `${area.items.length} tool${area.items.length === 1 ? '' : 's'}. Each says what it does; pin the ones you use most to your Dashboard.`}
          </p>
        </div>
      </header>

      {area.items.length === 0 ? (
        <p className="rounded-[18px] border border-dashed px-5 py-4 text-[14px]" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
          {mine ? <>Nothing pinned yet. Open any area on the left and press <Pin size={13} className="inline -mt-0.5" /> <b>Pin</b> on a tool: it shows here and at the top of your Dashboard.</> : 'Nothing here is open on your plan yet.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {area.items.map((f) => {
            const line = featureLine(f.href)
            const on = pinned(f)
            return (
              <div key={f.href + f.label} className="relative rounded-[18px] border overflow-hidden transition-shadow hover:shadow-md" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <Link href={f.href} className="flex items-start gap-3 px-4 py-4 pr-12 h-full focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--accent)]">
                  <span className="shrink-0 w-10 h-10 rounded-xl inline-flex items-center justify-center" style={{ background: area.tint, color: area.color }} aria-hidden="true">{f.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[15.5px] font-extrabold" style={{ color: 'var(--text)' }}>
                      {f.label}
                      {typeof f.badge === 'number' && f.badge > 0 && <span className="rounded-full px-1.5 min-w-[18px] text-center text-[11px] font-bold text-white" style={{ background: '#E5484D' }}>{f.badge > 99 ? '99+' : f.badge}</span>}
                      {typeof f.badge === 'string' && f.badge && <span className="rounded-md px-1.5 py-[2px] text-[10px] font-bold uppercase tracking-[0.05em]" style={{ background: 'var(--new-bg)', color: 'var(--new-text)' }}>{f.badge}</span>}
                    </span>
                    {line && <span className="block text-[13px] leading-snug mt-1" style={{ color: 'var(--text-faint)' }}>{line}</span>}
                    <span className="mt-2 inline-flex items-center gap-0.5 text-[12.5px] font-bold" style={{ color: area.color }}>Open <ChevronRight size={13} /></span>
                  </span>
                </Link>
                <button type="button" onClick={() => pin(f)} aria-pressed={on} aria-label={on ? `Unpin ${f.label}` : `Pin ${f.label} to the top of your Dashboard`}
                  title={on ? 'Pinned to your Dashboard. Press to unpin.' : 'Pin to the top of your Dashboard'}
                  className="absolute top-3 right-3 w-8 h-8 rounded-lg inline-flex items-center justify-center transition-colors hover:bg-[color:var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
                  style={{ color: on ? 'var(--accent-text)' : 'var(--text-dim)' }}>
                  <Pin size={15} fill={on ? 'currentColor' : 'none'} />
                </button>
              </div>
            )
          })}
        </div>
      )}
      {note && <p className="text-[13px] font-semibold" style={{ color: 'var(--hot)' }}>{note}</p>}
      {savedTo === 'device' && <p className="text-[12.5px]" style={{ color: 'var(--hot)' }}>Pins are saved in this browser only for now, so they will not follow you to another computer yet.</p>}
    </div>
  )
}
