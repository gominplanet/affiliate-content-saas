'use client'

/**
 * Preview-but-locked wrapper for Pro-only pages.
 *
 * Non-Pro users (Trial / Creator) can SEE the whole page — its layout,
 * controls, what the feature does — but can't interact with it. The
 * tutorial video and the page header stay OUTSIDE this wrapper so they
 * remain usable; only the functional content passed as `children` is
 * greyed out + click-blocked.
 *
 * Usage:
 *   <TutorialVideo sectionKey="..." />   // keep above, stays interactive
 *   <ProLock locked={!isPro} title="..." description="...">
 *     ...the real page content...
 *   </ProLock>
 */

import Link from 'next/link'
import { Sparkles } from 'lucide-react'

export function ProLock({
  locked,
  title,
  description,
  children,
}: {
  locked: boolean
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <>
      {locked && (
        <div
          className="card p-5 mb-6 flex items-start gap-3"
          style={{ background: 'linear-gradient(180deg, rgba(0,113,227,0.05) 0%, transparent 100%)', borderColor: 'rgba(0,113,227,0.25)' }}
        >
          <div className="w-9 h-9 rounded-full bg-[#7C3AED]/15 flex items-center justify-center flex-shrink-0">
            <Sparkles size={18} className="text-[#7C3AED]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{title}</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5 mb-3">{description}</p>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#7C3AED] text-white hover:bg-[#6D28D9]"
            >
              <Sparkles size={11} /> Upgrade to Pro
            </Link>
          </div>
        </div>
      )}
      {/* When locked: visible but greyed + non-interactive. inert-style via
          pointer-events + select-none; aria-hidden keeps it out of the tab
          order so keyboard users can't reach disabled controls. */}
      <div
        className={locked ? 'opacity-60 pointer-events-none select-none' : ''}
        aria-hidden={locked || undefined}
      >
        {children}
      </div>
    </>
  )
}
