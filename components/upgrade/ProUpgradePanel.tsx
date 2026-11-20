'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What a user sees when they open a Pro page their plan does not include: what
// the page does, that it is part of Pro, and the way to get it. It replaces a
// silent bounce to the dashboard, which read as a broken link (Seb,
// 2026-10-02: "we should always show an upgrade panel instead").
import Link from 'next/link'
import { Lock, ArrowRight } from 'lucide-react'
import { FREE_WEEK_SENTENCE } from '@/lib/guarantee'

const ACCENT = '#7C3AED'

/** `trybeFree`: a TRYBE Free account (lib/trybe-free): the card checkout to
 *  start Pro, what the free week is, and the way back to TRYBE. */
export default function ProUpgradePanel({ feature, body, trybeFree = false }: { feature: string; body: string; trybeFree?: boolean }) {
  return (
    <div className="max-w-3xl mx-auto pt-6">
      <div className="rounded-2xl border p-6 sm:p-8" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
        <div className="flex items-start gap-4 mb-5">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${ACCENT}1F`, color: ACCENT }}>
            <Lock size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[20px] font-semibold leading-tight mb-1.5" style={{ color: 'var(--text)' }}>{feature} is part of Pro</h2>
            <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{body}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
        <Link
          href={trybeFree ? '/billing?plan=pro' : '/billing'}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
          style={{ backgroundColor: ACCENT }}
        >
          {trybeFree ? 'Go Pro' : 'Upgrade to Pro'}
          <ArrowRight size={13} />
        </Link>
        {trybeFree && <Link href="/trybe" className="text-[13px] font-semibold hover:underline" style={{ color: ACCENT }}>Back to TRYBE, free</Link>}
        </div>
        {trybeFree && <p className="text-[12px] leading-relaxed mt-3" style={{ color: 'var(--text-soft)' }}>{FREE_WEEK_SENTENCE}</p>}
      </div>
    </div>
  )
}
