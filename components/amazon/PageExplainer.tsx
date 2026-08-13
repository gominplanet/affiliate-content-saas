// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// PageExplainer — a friendly "here's how this works" block for the Amazon
// Influencer pages. Built for brand-new users who only know their Amazon
// storefront and have never touched a content tool: a short plain-English
// intro plus numbered steps. Purely presentational (no hooks), so it drops
// into both server and client pages.

import type { ReactNode } from 'react'

export interface ExplainerStep {
  title: string
  body: string
}

export default function PageExplainer({
  eyebrow = 'New here? Here’s how it works',
  heading,
  intro,
  steps,
  footnote,
}: {
  eyebrow?: string
  heading: string
  intro?: string
  steps: ExplainerStep[]
  footnote?: ReactNode
}) {
  return (
    <section
      className="mb-8 rounded-2xl border p-5 sm:p-6"
      style={{ borderColor: 'rgba(234,88,12,0.25)', background: 'linear-gradient(180deg, rgba(234,88,12,0.05), transparent)' }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#d97706' }}>
        {eyebrow}
      </p>
      <h2 className="text-lg font-bold tracking-tight mb-1.5" style={{ color: 'var(--text)' }}>
        {heading}
      </h2>
      {intro && (
        <p className="text-[13.5px] leading-relaxed mb-4 max-w-3xl" style={{ color: 'var(--text-soft)' }}>
          {intro}
        </p>
      )}
      <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {steps.map((s, i) => (
          <li
            key={i}
            className="rounded-xl border p-3.5"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className="w-6 h-6 rounded-full grid place-items-center text-[12px] font-bold text-white flex-shrink-0"
                style={{ backgroundColor: '#C2410C' }}
              >
                {i + 1}
              </span>
              <p className="font-semibold text-[13px] leading-tight" style={{ color: 'var(--text)' }}>
                {s.title}
              </p>
            </div>
            <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
              {s.body}
            </p>
          </li>
        ))}
      </ol>
      {footnote && (
        <p className="text-[12px] mt-4 leading-relaxed" style={{ color: 'var(--text-soft)' }}>
          {footnote}
        </p>
      )}
    </section>
  )
}
