// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AudienceSplit — the top-of-landing fork. MVP serves two very different buyers
// (Amazon storefront creators vs full-suite blog/YouTube marketers), so rather
// than one hero talking past half the room, this hands the visitor a toggle:
// flip between the two pitches, read the detail of each in place, then take the
// CTA. Amazon side deep-links to its own sales page; suite side scrolls on.
//
// Client island (the toggle needs state); the rest of the landing page stays a
// Server Component.

'use client'

import { useState } from 'react'
import {
  ShoppingBag, Rocket, Wand2, Share2, BadgePercent, Radar, UserSquare, Store,
  FileText, Youtube, Scale, Mail, TrendingUp, ArrowRight,
} from 'lucide-react'

type Side = 'amazon' | 'suite'

const SIDES = {
  amazon: {
    accent: '#C2410C',
    tint: 'rgba(234,88,12,',
    eyebrow: 'Amazon Associates & Influencers',
    icon: <ShoppingBag size={18} />,
    headline: 'No blog. No YouTube. Just your storefront.',
    blurb:
      'Built for creators who live on their Amazon storefront and socials. Generate incredible Amazon video-review thumbnails in one click, turn any product into scroll-stopping designs, publish everywhere at once, and land paid brand deals, no website required.',
    price: '$79',
    cta: 'See the Amazon plan',
    href: '/amazon-influencer',
    secondary: null as { label: string; href: string } | null,
    bullets: [
      { icon: <Wand2 size={15} />, text: 'Incredible Amazon video-review thumbnails, one click (200/mo)' },
      { icon: <Share2 size={15} />, text: 'Pins, Reels & Facebook designs, posted to all three at once' },
      { icon: <BadgePercent size={15} />, text: 'Creator Connections: land + message brand deals' },
      { icon: <Radar size={15} />, text: 'Amazon product research + live, verified Deal Radar' },
      { icon: <UserSquare size={15} />, text: 'Your own face on every design (1 model + photobooth)' },
      { icon: <Store size={15} />, text: 'Publish to Facebook, Pinterest & Instagram together' },
    ],
  },
  suite: {
    accent: '#7C3AED',
    tint: 'rgba(124,58,237,',
    eyebrow: 'Creators & Marketers · full suite',
    icon: <Rocket size={18} />,
    headline: 'The whole content pipeline, in your voice.',
    blurb:
      'For creators with a blog or a YouTube channel who want one tool to run everything, from a single video to a blog post, thumbnails, a newsletter, and a week of social, all in your own voice.',
    price: '$49',
    cta: 'Explore the full suite',
    href: '#free-research',
    secondary: { label: 'Compare all plans', href: '/pricing' },
    bullets: [
      { icon: <FileText size={15} />, text: 'Full product-review blog on your WordPress, in your voice' },
      { icon: <Youtube size={15} />, text: 'YouTube video → blog, thumbnails, scripts & social posts' },
      { icon: <Scale size={15} />, text: 'Comparison posts & buying guides that win search' },
      { icon: <Mail size={15} />, text: 'Your own newsletter, with scheduling & segments' },
      { icon: <TrendingUp size={15} />, text: 'Auto-post to 9+ networks + SEO & indexing tools' },
      { icon: <ShoppingBag size={15} />, text: 'Everything the Amazon plan does, included too' },
    ],
  },
} as const

export default function AudienceSplit() {
  const [side, setSide] = useState<Side>('amazon')
  const s = SIDES[side]
  return (
    <section className="px-6 lg:px-8 pt-10 sm:pt-14 pb-2 relative">
      <div className="max-w-5xl mx-auto text-center mb-6">
        <h2 className="text-[26px] sm:text-[34px] font-bold tracking-tight leading-[1.08]" style={{ color: 'var(--text)' }}>
          MVP Affiliate does it all.
        </h2>
        <p className="mt-3 text-[15px] sm:text-[16px] max-w-2xl mx-auto" style={{ color: 'var(--text-soft)' }}>
          Two very different creators use MVP. Tap your side to see exactly what you get.
        </p>
      </div>

      {/* Segmented toggle */}
      <div className="max-w-md mx-auto mb-6">
        <div
          className="grid grid-cols-2 p-1 rounded-2xl"
          style={{ background: 'var(--surface-bright)', border: '1px solid var(--border)' }}
        >
          {(['amazon', 'suite'] as Side[]).map((key) => {
            const active = side === key
            const accent = SIDES[key].accent
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSide(key)}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-all"
                style={
                  active
                    ? { backgroundColor: accent, color: '#fff', boxShadow: '0 4px 14px rgba(0,0,0,0.18)' }
                    : { color: 'var(--text-soft)' }
                }
              >
                {SIDES[key].icon}
                {key === 'amazon' ? 'Amazon Influencers' : 'Full Suite'}
              </button>
            )
          })}
        </div>
      </div>

      {/* Explainer for the active side */}
      <div className="max-w-4xl mx-auto">
        <div
          className="rounded-3xl p-7 sm:p-9 transition-all"
          style={{ border: `1.5px solid ${s.tint}0.35)`, background: `linear-gradient(180deg, ${s.tint}0.09), ${s.tint}0.02))` }}
        >
          <div className="flex items-center gap-2.5 mb-3">
            <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: `${s.tint}0.15)`, color: s.accent }}>{s.icon}</span>
            <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: s.accent }}>{s.eyebrow}</span>
          </div>
          <h3 className="text-[23px] sm:text-[26px] font-bold tracking-tight mb-2" style={{ color: 'var(--text)' }}>
            {s.headline}
          </h3>
          <p className="text-[14px] leading-relaxed mb-6 max-w-2xl" style={{ color: 'var(--text-soft)' }}>
            {s.blurb}
          </p>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-3 mb-7">
            {s.bullets.map((b) => (
              <li key={b.text} className="flex items-start gap-2.5 text-[13.5px]" style={{ color: 'var(--text)' }}>
                <span className="flex-shrink-0 mt-0.5" style={{ color: s.accent }}>{b.icon}</span>
                <span>{b.text}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-4 flex-wrap pt-5 border-t" style={{ borderColor: `${s.tint}0.20)` }}>
            <span className="text-[13.5px]" style={{ color: 'var(--text-soft)' }}>
              From <span className="font-bold text-[17px]" style={{ color: 'var(--text)' }}>{s.price}</span>/mo
            </span>
            <div className="flex items-center gap-3">
              {s.secondary && (
                <a href={s.secondary.href} className="text-[13px] font-semibold hover:opacity-80 transition-opacity" style={{ color: s.accent }}>
                  {s.secondary.label}
                </a>
              )}
              <a
                href={s.href}
                className="inline-flex items-center gap-1.5 px-5 py-3 rounded-xl text-[14px] font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                style={{ backgroundColor: s.accent }}
              >
                {s.cta} <ArrowRight size={15} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
