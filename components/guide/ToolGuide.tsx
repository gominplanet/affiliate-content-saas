'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ToolGuide — the reusable per-tool "how to use this" modal, generalised from
// the Deal Radar guide. Each page drops one <ToolGuide> (usually via PageHero's
// `guide` slot); it renders its own "Full guide" trigger, the modal, and
// auto-opens ONCE the first time a browser visits that tool (tracked per
// guideKey in localStorage). Content lives in components/guide/tool-guides.tsx.

import { useEffect, useState, type ReactNode } from 'react'
import { HelpCircle, X } from 'lucide-react'

export interface GuideSection {
  icon: ReactNode
  title: string
  body: ReactNode
}

export default function ToolGuide({
  guideKey,
  title,
  subtitle,
  icon,
  sections,
  accent = '#7C3AED',
  footerNote,
  ctaLabel = 'Got it',
  buttonLabel = 'Full guide',
  autoOpen = true,
}: {
  /** Stable key; drives the once-per-browser auto-open (localStorage). */
  guideKey: string
  title: string
  subtitle: string
  icon: ReactNode
  sections: GuideSection[]
  accent?: string
  footerNote?: ReactNode
  ctaLabel?: string
  buttonLabel?: string
  autoOpen?: boolean
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!autoOpen) return
    try { if (!localStorage.getItem(`mvp_guide_seen_${guideKey}`)) setOpen(true) } catch { /* no-op */ }
  }, [autoOpen, guideKey])

  const close = () => {
    setOpen(false)
    try { localStorage.setItem(`mvp_guide_seen_${guideKey}`, '1') } catch { /* no-op */ }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs font-semibold underline whitespace-nowrap"
        style={{ color: accent }}
      >
        <HelpCircle size={13} /> {buttonLabel}
      </button>

      {open && (
        <div className="fixed inset-0 z-[9999] flex items-start sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
          <div className="absolute inset-0 bg-black/50" onClick={close} />
          <div className="relative w-full sm:max-w-2xl max-h-full sm:max-h-[85vh] flex flex-col rounded-none sm:rounded-2xl border bg-white dark:bg-[#16161a] shadow-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl shrink-0" style={{ background: `${accent}1f`, color: accent }}>{icon}</div>
                <div className="min-w-0">
                  <div className="text-base font-bold leading-tight truncate">{title}</div>
                  <div className="text-xs text-muted-foreground">{subtitle}</div>
                </div>
              </div>
              <button onClick={close} className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" title="Close"><X size={18} /></button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto px-5 py-4 space-y-4">
              {sections.map((s, i) => (
                <div key={i} className="flex gap-3">
                  <div className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-foreground/80">{s.icon}</div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{s.title}</div>
                    <div className="text-[13px] text-muted-foreground leading-relaxed mt-0.5">{s.body}</div>
                  </div>
                </div>
              ))}
              {footerNote && (
                <div className="rounded-lg bg-muted/60 px-3.5 py-3 text-[12px] text-muted-foreground leading-relaxed">{footerNote}</div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t shrink-0">
              <span className="text-xs text-muted-foreground">Reopen anytime from <span className="font-medium text-foreground">{buttonLabel}</span>.</span>
              <button onClick={close} className="inline-flex items-center rounded-lg px-3.5 py-2 text-sm font-semibold text-white" style={{ background: accent }}>{ctaLabel}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
