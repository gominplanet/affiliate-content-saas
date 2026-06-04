// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// FeatureLockedCard — drop-in upsell card for any tier-gated feature.
// Used wherever a user lands on a feature their tier doesn't unlock
// (/comparison, /guides, /campaigns, /deals, /seo rebuild modal, etc.).
//
// Pattern: every locked page renders THIS instead of the feature UI.
// Single source of truth for the upgrade-pull moment — keeps copy /
// visual consistent across the whole product and prevents drift (one
// page saying "$99 for Studio" while another forgets to mention price).
//
// Usage:
//   <FeatureLockedCard
//     icon={<Scale size={28} />}
//     feature="Comparison Posts"
//     description="Paste 2-5 products. Get a ranked head-to-head article with verdict box, comparison table, and pros/cons — published to WordPress in one click."
//     bullets={[
//       'AI ranks the products by EPC + customer signals',
//       'Verdict box at the top, comparison table mid-article',
//       'Mobile-optimized layout + Schema.org markup for SEO',
//     ]}
//     requiredTier="pro"
//     currentTier={currentTier}
//   />

'use client'

import Link from 'next/link'
import { ReactNode } from 'react'
import { Lock, ArrowRight, Check } from 'lucide-react'
import type { Tier } from '@/lib/tier'

interface FeatureLockedCardProps {
  /** Lucide icon (or any ReactNode). Rendered in the hero badge. */
  icon: ReactNode
  /** Human-readable feature name (the headline). */
  feature: string
  /** One paragraph explaining what the feature does + the value pitch.
   *  Keep it concrete — name the outcome, not just the inputs. */
  description: string
  /** Optional 3-5 bullet points of capabilities. Specific > generic. */
  bullets?: string[]
  /** Minimum tier that unlocks this feature. Determines the upgrade CTA. */
  requiredTier: 'creator' | 'studio' | 'pro'
  /** Current user tier. Used to render "Currently on [Tier]" + decide
   *  whether the CTA is "Upgrade to Creator/Studio/Pro". */
  currentTier: Tier
}

export default function FeatureLockedCard({
  icon,
  feature,
  description,
  bullets,
  requiredTier,
  currentTier,
}: FeatureLockedCardProps) {
  const tierLabel =
    requiredTier === 'pro' ? 'Pro' :
    requiredTier === 'studio' ? 'Studio' : 'Creator'
  // Brand accents per tier (matches /pricing): Creator teal, Studio pink,
  // Pro violet. Keeps the visual hierarchy consistent across upsell cards.
  const tierAccent =
    requiredTier === 'pro' ? '#7C3AED' :
    requiredTier === 'studio' ? '#EC4899' : '#10B981'
  const checkoutHref = `/billing?plan=${requiredTier}`

  const currentTierLabel =
    currentTier === 'trial' ? 'Free Trial' :
    currentTier === 'creator' ? 'Creator' :
    currentTier === 'studio' ? 'Studio' :
    currentTier === 'pro' ? 'Pro' : 'Admin'

  return (
    <div
      className="rounded-2xl border p-8 max-w-3xl mx-auto"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      {/* Hero: icon + lock chip */}
      <div className="flex items-start gap-4 mb-4">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 relative"
          style={{ backgroundColor: `${tierAccent}1F`, color: tierAccent }}
        >
          {icon}
          <div
            className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'var(--surface)', border: '1.5px solid var(--border)' }}
          >
            <Lock size={11} style={{ color: 'var(--text-soft)' }} />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <h2 className="text-[22px] font-semibold leading-tight" style={{ color: 'var(--text)' }}>
              {feature}
            </h2>
            <span
              className="text-[10px] font-bold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full"
              style={{ backgroundColor: `${tierAccent}26`, color: tierAccent }}
            >
              {tierLabel} feature
            </span>
          </div>
          <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
            {description}
          </p>
        </div>
      </div>

      {/* Bullets — what they unlock */}
      {bullets && bullets.length > 0 && (
        <ul className="mt-5 space-y-2.5">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[13px]" style={{ color: 'var(--text-soft)' }}>
              <Check
                size={14}
                className="flex-shrink-0 mt-0.5"
                style={{ color: tierAccent }}
                strokeWidth={2.5}
              />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Footer: CTA + currently-on hint */}
      <div className="mt-6 pt-5 border-t flex items-center justify-between gap-4 flex-wrap" style={{ borderColor: 'var(--border)' }}>
        <p className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
          You're on the <span className="font-semibold" style={{ color: 'var(--text-soft)' }}>{currentTierLabel}</span> plan.
        </p>
        <Link
          href={checkoutHref}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
          style={{ backgroundColor: tierAccent }}
        >
          Upgrade to {tierLabel}
          <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  )
}
