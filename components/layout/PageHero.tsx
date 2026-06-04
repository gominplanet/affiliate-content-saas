// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// PageHero — the V2 page-header used across the dashboard routes.
//
// Replaces the legacy <Header> component (task #143 Phase 2). Renders a
// hero banner with violet/pink radial gradients (opacity adapts to the
// theme via --hero-opacity), a 32px page title, an optional subtitle,
// and an optional actions slot to the right.
//
// Pages opt in by importing this and dropping it at the top of their
// return statement. The negative margins pull the hero out to the
// shell's edges so the gradient bleeds full-width.

import type { ReactNode } from 'react'

interface PageHeroProps {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  /** Optional accent colour mixed into the gradient. Defaults to the
   *  violet/pink combo used on the dashboard hero. Pass any rgba string
   *  with alpha; the component layers it as a third radial. */
  accent?: string
}

export default function PageHero({ title, subtitle, actions, accent }: PageHeroProps) {
  return (
    <div
      className="-mx-4 sm:-mx-6 lg:-mx-8 -mt-6 mb-8 relative overflow-hidden border-b"
      style={{ borderColor: 'var(--border)' }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 'var(--hero-opacity)',
          background: `
            radial-gradient(50% 80% at 20% 30%, rgba(124, 58, 237, 0.45), transparent 60%),
            radial-gradient(50% 70% at 85% 20%, rgba(192, 38, 211, 0.30), transparent 65%)
            ${accent ? `, radial-gradient(60% 60% at 50% 90%, ${accent}, transparent 70%)` : ''}
          `,
        }}
      />
      <div className="relative px-6 sm:px-8 pt-10 pb-8 flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1
            className="text-[32px] font-semibold tracking-tight"
            style={{ color: 'var(--text)' }}
          >
            {title}
          </h1>
          {subtitle && (
            <p className="text-[14px] mt-2" style={{ color: 'var(--text-soft)' }}>
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}
