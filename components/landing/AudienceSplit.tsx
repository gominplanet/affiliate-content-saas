// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AudienceSplit — the top-of-landing fork. MVP serves two very different buyers
// (Amazon storefront creators vs full-suite blog/YouTube marketers), so the page
// opens by handing the visitor a real choice: two full, side-by-side panels,
// each a complete pitch with its own identity, feature list, price and CTA. Not
// a toggle — a deliberate "which one are you?" moment. Amazon panel deep-links
// to its sales page; suite panel scrolls into the rest of the homepage.
//
// Static (just links), so it renders as a Server Component — no client JS.

import NextImage from 'next/image'
import {
  ShoppingBag, Rocket, Wand2, Share2, BadgePercent, Radar, UserSquare, Store,
  FileText, Youtube, Scale, Mail, TrendingUp, ArrowRight,
} from 'lucide-react'

type Panel = {
  accent: string
  tint: string
  eyebrow: string
  forWho: string
  icon: React.ReactNode
  /** Brand logo (app-icon) shown instead of the colored-square lucide icon. */
  logo?: string
  headline: string
  blurb: string
  price: string
  regular: string
  cta: string
  href: string
  secondary: { label: string; href: string } | null
  bullets: { icon: React.ReactNode; text: string }[]
}

const PANELS: Panel[] = [
  {
    accent: '#C2410C',
    tint: 'rgba(234,88,12,',
    eyebrow: 'Amazon Associates & Influencers',
    forWho: 'You sell on your Amazon storefront and socials',
    icon: <ShoppingBag size={22} />,
    logo: '/png/mvp-affiliate-amz.png',
    headline: 'No blog. No YouTube.\nJust your storefront.',
    blurb: 'Generate incredible Amazon video-review thumbnails in one click, turn any product into scroll-stopping designs, publish everywhere at once, and land paid brand deals.',
    price: '$79',
    regular: '$129',
    cta: 'See the Amazon plan',
    href: '/amazon-influencer',
    secondary: null,
    bullets: [
      { icon: <Wand2 size={16} />, text: 'Incredible Amazon video-review thumbnails, one click' },
      { icon: <Share2 size={16} />, text: 'Pins, Reels & Facebook designs, posted to all three' },
      { icon: <BadgePercent size={16} />, text: 'Creator Connections: a daily brand-deal digest matched to you' },
      { icon: <Radar size={16} />, text: 'Amazon product research + live, verified Deal Radar' },
      { icon: <UserSquare size={16} />, text: 'Your own face on every design' },
    ],
  },
  {
    accent: '#7C3AED',
    tint: 'rgba(124,58,237,',
    eyebrow: 'Creators & Marketers · full suite',
    forWho: 'You have a blog or a YouTube channel',
    icon: <Rocket size={22} />,
    headline: 'The whole content pipeline,\nin your voice.',
    blurb: 'One tool to run everything, from a single video to a blog post, thumbnails, a newsletter and a week of social, all written in your own voice.',
    price: '$49',
    regular: '$99',
    cta: 'Explore the full suite',
    href: '#free-research',
    secondary: { label: 'Compare all plans', href: '/pricing' },
    bullets: [
      { icon: <FileText size={16} />, text: 'Full product-review blog on your WordPress, in your voice' },
      { icon: <Youtube size={16} />, text: 'YouTube video → blog, thumbnails, scripts & social posts' },
      { icon: <Scale size={16} />, text: 'Comparison posts & buying guides that win search' },
      { icon: <Mail size={16} />, text: 'Your own newsletter, with scheduling & segments' },
      { icon: <Store size={16} />, text: 'Auto-post to 9+ networks + everything the Amazon plan does' },
    ],
  },
]

export default function AudienceSplit() {
  return (
    <section className="px-5 sm:px-8 pt-12 sm:pt-16 pb-4 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-9">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.18em] mb-5"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)', border: '1px solid var(--border)' }}
          >
            Two ways to win with MVP
          </span>
          <h2 className="text-[32px] sm:text-[44px] font-extrabold tracking-[-0.03em] leading-[1.03]" style={{ color: 'var(--text)' }}>
            Which one are you?
          </h2>
          <p className="mt-4 text-[15px] sm:text-[16px]" style={{ color: 'var(--text-soft)' }}>
            MVP does it all. Pick your side and see exactly what you get.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-5 lg:gap-6 items-stretch">
          {PANELS.map((p) => (
            <div
              key={p.eyebrow}
              className="group relative flex flex-col rounded-[26px] overflow-hidden transition-all duration-200 hover:-translate-y-1.5"
              style={{ border: `1.5px solid ${p.tint}0.30)`, background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
            >
              {/* Accent header band */}
              <div className="px-7 sm:px-8 pt-7 pb-6" style={{ background: `linear-gradient(180deg, ${p.tint}0.12), ${p.tint}0.03))` }}>
                <div className="flex items-center gap-3 mb-4">
                  {p.logo ? (
                    <NextImage src={p.logo} alt={p.eyebrow} width={48} height={48} className="w-12 h-12 rounded-2xl flex-shrink-0 shadow-sm" />
                  ) : (
                    <span className="w-12 h-12 rounded-2xl grid place-items-center flex-shrink-0 text-white shadow-sm" style={{ backgroundColor: p.accent }}>{p.icon}</span>
                  )}
                  <div className="min-w-0">
                    <p className="text-[10.5px] font-bold uppercase tracking-[0.13em]" style={{ color: p.accent }}>{p.eyebrow}</p>
                    <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>{p.forWho}</p>
                  </div>
                </div>
                <h3 className="text-[24px] sm:text-[27px] font-extrabold tracking-[-0.02em] leading-[1.08] whitespace-pre-line" style={{ color: 'var(--text)' }}>
                  {p.headline}
                </h3>
              </div>

              {/* Body */}
              <div className="px-7 sm:px-8 pt-6 pb-7 flex flex-col flex-1">
                <p className="text-[13.5px] leading-relaxed mb-6" style={{ color: 'var(--text-soft)' }}>{p.blurb}</p>
                <ul className="space-y-3 mb-7 flex-1">
                  {p.bullets.map((b) => (
                    <li key={b.text} className="flex items-start gap-3 text-[13.5px]" style={{ color: 'var(--text)' }}>
                      <span className="w-6 h-6 rounded-lg grid place-items-center flex-shrink-0 mt-0.5" style={{ background: `${p.tint}0.12)`, color: p.accent }}>{b.icon}</span>
                      <span className="leading-snug">{b.text}</span>
                    </li>
                  ))}
                </ul>
                <div className="pt-5 border-t flex items-center justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
                    From <span className="font-extrabold text-[19px]" style={{ color: 'var(--text)' }}>{p.price}</span>/mo{' '}
                    <span className="line-through text-[12px]" style={{ color: 'var(--text-faint)' }}>{p.regular}</span>
                  </span>
                  <a href={p.href} className="inline-flex items-center gap-1.5 px-5 py-3 rounded-xl text-[13.5px] font-semibold text-white shadow-sm transition-all group-hover:gap-2.5" style={{ backgroundColor: p.accent }}>
                    {p.cta} <ArrowRight size={15} />
                  </a>
                </div>
                {p.secondary && (
                  <a href={p.secondary.href} className="mt-3 text-center text-[12.5px] font-semibold hover:opacity-80 transition-opacity" style={{ color: p.accent }}>
                    {p.secondary.label}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
