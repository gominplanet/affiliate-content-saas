/**
 * / — public-facing homepage (mvpaffiliate.io).
 *
 * Promoted from /landing-preview on 2026-06-04 — the dark sales page
 * is now the canonical landing surface. The previous light-themed
 * homepage was archived (git history) when this took over.
 *
 * Sits outside /preview/* so it doesn't inherit the dashboard preview's
 * sidebar/topbar layout. Uses the same CSS-variable theme system so the
 * sun/moon toggle works identically.
 *
 * Source of truth for tier copy: lib/tier.ts → mirrored in PRICING_TIERS
 * below and in app/pricing/page.tsx. If you change one, change all three.
 */
import {
  FileText, Image as ImageIcon, Mail, Scale, Calendar,
  Play, Sparkles, ArrowRight, Bookmark,
  Twitter, Cloud, Send, Linkedin, Facebook, Instagram, AtSign,
  Globe, TrendingUp, Wand2,
  ShieldCheck, Zap, Upload, X as XIcon, Check,
  Crown, Rocket,
  Pin,
  ShoppingBag, Store, Search,
  Radar, Scissors,
} from 'lucide-react'
import NextImage from 'next/image'
import { FAQSection, StickyBottomBar } from '@/components/landing/islands'

// Local CSS-var override for a DARK emphasis band inside the otherwise-light
// page. Any section wrapped in <DarkBand> flips its text/surface tokens so
// var(--text)/var(--surface)/etc. read correctly on a dark background.
const DARK_SECTION_VARS: React.CSSProperties = {
  ['--surface' as string]: 'rgba(255,255,255,0.06)',
  ['--surface-bright' as string]: 'rgba(255,255,255,0.10)',
  ['--border' as string]: 'rgba(255,255,255,0.14)',
  ['--text' as string]: '#F8F8FB',
  ['--text-muted' as string]: 'rgba(255,255,255,0.90)',
  ['--text-soft' as string]: 'rgba(255,255,255,0.70)',
  ['--text-subtle' as string]: 'rgba(255,255,255,0.55)',
  ['--text-faint' as string]: 'rgba(255,255,255,0.42)',
  ['--card-shadow' as string]: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 30px rgba(0,0,0,0.35)',
  ['--accent-soft' as string]: 'rgba(124,58,237,0.18)',
  ['--accent-text' as string]: '#C4B5FD',
}

// ── Sales-page config (edit these; each renders only when it has a real value,
//    so nothing fake ever ships) ──────────────────────────────────────────────
//
// GUARANTEE: the risk-reversal line near the CTAs and pricing. Set to your real
//   terms, or leave null to show none. (Awaiting the exact terms.)
const GUARANTEE: string | null = null
//
// FOUNDING_DEADLINE: ISO date the founding prices end (e.g. '2026-09-30'). When
//   set AND in the future, a real countdown shows. null = no urgency. Never fake
//   this — only set a genuine deadline. (Awaiting a real date.)
const FOUNDING_DEADLINE: string | null = null
//
// TESTIMONIALS: real customer quotes only — never fabricated. The section is
//   hidden until this has entries. Add { quote, name, handle? }.
const TESTIMONIALS: { quote: string; name: string; handle?: string }[] = [
  {
    quote: 'I was skeptical at first but I needed to try something new to push my Amazon offsite revenue. Within the first 2 weeks of testing MVP, I made the subscription back and then some. So grateful for this tool and what it generates for my business.',
    name: 'Verified MVP creator',
  },
]

/** Wrap a section to give it a bold dark (or gradient) background — used to
 *  break up the bright page and make key sections punch. Pass `accent` to also
 *  recolor its card accents. */
function DarkBand({ children, bg, accent }: { children: React.ReactNode; bg?: string; accent?: React.CSSProperties }) {
  return (
    <div style={{ ...DARK_SECTION_VARS, ...accent, background: bg ?? '#0D0D11', color: 'var(--text)' }} className="relative overflow-hidden">
      {children}
    </div>
  )
}

const LIGHT_VARS: React.CSSProperties = {
  ['--bg' as string]: '#FAFAF8',
  ['--surface' as string]: '#FFFFFF',
  ['--surface-bright' as string]: 'rgba(0,0,0,0.05)',
  ['--border' as string]: 'rgba(0,0,0,0.10)',
  ['--text' as string]: '#1D1D1F',
  ['--text-muted' as string]: 'rgba(0,0,0,0.82)',
  ['--text-soft' as string]: 'rgba(0,0,0,0.62)',
  ['--text-subtle' as string]: 'rgba(0,0,0,0.50)',
  ['--text-faint' as string]: 'rgba(0,0,0,0.40)',
  ['--card-shadow' as string]: '0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.03)',
  ['--hero-opacity' as string]: '0.22',
  ['--line-color' as string]: 'rgba(124,58,237,0.55)',
  ['--line-glow' as string]: 'rgba(124,58,237,0.18)',
  ['--center-bg' as string]: 'linear-gradient(135deg, #7C3AED, #C026D3)',
  ['--accent-soft' as string]: 'rgba(124,58,237,0.12)',
  ['--accent-text' as string]: '#7C3AED',
}


export default function LandingPreview() {
  // Light mode only — bright, high-contrast sales page. Sections that need
  // emphasis darken their OWN background locally (see DarkBand), rather than a
  // global dark theme.
  return (
    <div
      style={{
        ...LIGHT_VARS,
        backgroundColor: 'var(--bg)',
        color: 'var(--text)',
      }}
      className="min-h-screen font-[Inter,system-ui,sans-serif]"
    >
      {/* Hub-animation keyframes + smooth scroll now live in globals.css so
          this page can render as a Server Component (styled-jsx is client-only). */}
      {/* Condensed funnel (2026-08): the page was ~24 stacked sections, which
          lost cold visitors before pricing. Now it's a tight ~10-section flow —
          hero → how it works → one features grid (absorbs the old feature
          sections and surfaces the new voice/Shorts/Passport work) → comparison
          → proof → pricing → FAQ → CTA. The dropped section components are kept
          defined below (reusable / not deleted), just no longer rendered. The
          Amazon-only buyer is routed by AmazonRouter instead of the old pre-hero
          two-panel splitter. */}
      <Nav />
      <Hero />
      <AmazonRouter variant="strip" />
      <PlatformBar />
      <HowItWorks />
      <FeaturesGridCondensed />
      {/* Flagship new work, shown with real product images. */}
      <FeatureSpotlights />
      {/* Real proof: actual thumbnails MVP made from one product photo. */}
      <ThumbnailShowcase />
      <ComparisonSection />
      <ProofSection />
      <TestimonialsSection />
      <FounderSection />
      <PricingSection />
      <FAQSection />
      <DarkBand bg="linear-gradient(160deg, #16091E 0%, #2A0E3A 55%, #3A0E22 100%)">
        <FinalCTASection />
      </DarkBand>
      <Footer />
      <StickyBottomBar />
    </div>
  )
}

/** Amazon-only router — the "no blog, no YouTube" buyer. Replaces the old
 *  pre-hero two-panel splitter with two light touchpoints: a slim strip under
 *  the hero, and a callout at the pricing decision point. Both deep-link to the
 *  Amazon plan's own sales page. */
function AmazonRouter({ variant }: { variant: 'strip' | 'callout' }) {
  if (variant === 'callout') {
    return (
      <section className="px-6 lg:px-8 pb-16 sm:pb-20 relative">
        <p className="max-w-3xl mx-auto text-center text-[14px]" style={{ color: 'var(--text-soft)' }}>
          Not building a blog? The{' '}
          <a href="/amazon-influencer" className="font-bold" style={{ color: '#EA580C' }}>Amazon storefront plan</a>{' '}
          covers thumbnails, designs, storefront and brand deals only, from $79/mo.
        </p>
      </section>
    )
  }
  return (
    <div style={{ background: 'linear-gradient(90deg, rgba(234,88,12,0.09), rgba(192,38,211,0.06))', borderBottom: '1px solid var(--border)' }}>
      <div className="max-w-6xl mx-auto px-6 lg:px-8 py-3.5 flex items-center justify-center gap-x-4 gap-y-1.5 flex-wrap text-center text-[13.5px]">
        <b style={{ color: 'var(--text)' }}>Not building a blog or YouTube?</b>
        <span style={{ color: 'var(--text-soft)' }}>MVP has an Amazon storefront plan: thumbnails, designs, storefront and brand deals, from $79/mo.</span>
        <a href="/amazon-influencer" className="font-bold whitespace-nowrap inline-flex items-center gap-1" style={{ color: '#EA580C' }}>
          See the Amazon plan <ArrowRight size={13} />
        </a>
      </div>
    </div>
  )
}

/** The MVP Loop — the named signature process (Find → Create → Publish → Earn).
 *  Branding the flow reads as a system that runs the business side, not a set of
 *  generic steps. */
const LOOP_STEPS = [
  { n: 'Find', d: 'Research all of Amazon and live Deal Radar for products worth promoting, or just paste any product, brand or Amazon link.' },
  { n: 'Create', d: 'MVP writes the review, comparisons and social posts in your real voice, and makes the thumbnail and the Shorts for you.' },
  { n: 'Publish', d: 'It all lands on a blog that stays yours, plus your socials and a shoppable bio, with affiliate links already in place.' },
  { n: 'Earn', d: 'Free Passport geo-links and Creator Connections keep every shopper earning, with the commission going to you.' },
]
function HowItWorks() {
  return (
    <section id="how-it-works" className="px-6 lg:px-8 pt-16 sm:pt-24 pb-8 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#7C3AED' }}>The MVP Loop</span>
          <h2 className="text-[32px] sm:text-[44px] font-extrabold tracking-[-0.03em] leading-[1.03] mt-3" style={{ color: 'var(--text)' }}>
            Find. Create. Publish. Earn.
          </h2>
          <p className="mt-4 text-[15.5px]" style={{ color: 'var(--text-soft)' }}>
            One system that runs the whole business side while you create.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 mt-10">
          {LOOP_STEPS.map((s, i) => (
            <div key={s.n} className="rounded-2xl border p-6" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-lg grid place-items-center text-white font-extrabold text-[15px]" style={{ background: 'linear-gradient(135deg,#7C3AED,#C026D3)' }}>{i + 1}</div>
                <h3 className="text-[18px] font-extrabold tracking-tight" style={{ color: 'var(--text)' }}>{s.n}</h3>
              </div>
              <p className="text-[14px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Condensed features grid — absorbs ~10 of the old feature sections into one
 *  scannable grid, and leads with the new work (voice, Shorts, Passport). */
const CONDENSED_FEATURES: { icon: React.ReactNode; title: string; desc: string; isNew?: boolean }[] = [
  { icon: <Sparkles size={19} />, title: 'Writes in your real voice', desc: 'MVP learns how you actually sound from your own videos and edits, and sharpens over time. Every post reads like you, not generic AI.', isNew: true },
  { icon: <Scissors size={19} />, title: 'Post Shorts to TikTok & Instagram', desc: 'Clip Factory turns long videos into ready-to-post shorts, and reframes a horizontal video to vertical for you before you post.', isNew: true },
  { icon: <Globe size={19} />, title: 'Free Passport geo-links', desc: 'Send every shopper to their own country’s Amazon and keep the commission, with no per-click fees. Included on every paid plan.', isNew: true },
  { icon: <Zap size={19} />, title: 'Amazon Deal Radar', desc: 'Live, price-history-verified deals, not fake “was” prices. MVP turns the real drops into posts and a shoppable bio.' },
  { icon: <FileText size={19} />, title: 'SEO & AI-optimized articles', desc: 'Reviews, comparisons, buying guides and researched articles built to rank on Google and get quoted by AI answers.' },
  { icon: <Search size={19} />, title: 'Free product research', desc: 'Filter all of Amazon by sales, rating, price and video competition. Scout Creator Connections, Levanta and PartnerBoost too.' },
  { icon: <Store size={19} />, title: 'Your own blog, forever', desc: 'A beautifully designed WordPress site that stays yours, even if you leave. No walled garden, no lock-in.' },
  { icon: <ShieldCheck size={19} />, title: 'Your data stays yours', desc: 'MVP never uses or sells your personal data. It works from your content, nothing else.' },
]
function FeaturesGridCondensed() {
  return (
    <section id="features" className="px-6 lg:px-8 pt-12 pb-16 sm:pb-24 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#7C3AED' }}>Everything in one place</span>
          <h2 className="text-[32px] sm:text-[44px] font-extrabold tracking-[-0.03em] leading-[1.03] mt-3" style={{ color: 'var(--text)' }}>
            One subscription replaces your whole stack
          </h2>
          <p className="mt-4 text-[15.5px]" style={{ color: 'var(--text-soft)' }}>
            The writer, the researcher, the editor, the social team and the link cloaker. All of it, and it sounds like you.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-10">
          {CONDENSED_FEATURES.map(f => (
            <div key={f.title} className="rounded-2xl border p-5 transition-all hover:-translate-y-0.5" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="w-10 h-10 rounded-xl grid place-items-center mb-3.5" style={{ background: 'rgba(124,58,237,0.1)', color: '#7C3AED' }}>{f.icon}</div>
              <h3 className="text-[16.5px] font-bold mb-1.5 flex items-center gap-2 flex-wrap" style={{ color: 'var(--text)' }}>
                {f.title}
                {f.isNew && <span className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-white px-1.5 py-0.5 rounded-full" style={{ background: 'linear-gradient(135deg,#7C3AED,#C026D3)' }}>New</span>}
              </h3>
              <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Feature spotlights — a headline paired with a REAL product image, for the
 *  flagship new work. Alternating sides. Add an entry as each image lands in
 *  public/png. */
const SPOTLIGHTS: { img: string; eyebrow: string; title: string; desc: string }[] = [
  {
    img: '/png/mvp-voice.webp',
    eyebrow: 'New',
    title: 'It writes in your real voice',
    desc: 'MVP learns how you actually sound from your own videos and the edits you make, and gets sharper every time you publish. Your posts read like you wrote them, not like generic AI. Train it once, or just let it learn as you go.',
  },
  {
    img: '/png/mvp-horiz-to-vertical.webp',
    eyebrow: 'New',
    title: 'Post your Shorts to TikTok and Instagram',
    desc: 'Clip Factory turns your long videos into ready-to-post shorts. Upload a horizontal video and MVP reframes it to vertical for you, center crop or split screen, so it is ready to post everywhere in a couple of clicks.',
  },
]
function FeatureSpotlights() {
  if (SPOTLIGHTS.length === 0) return null
  return (
    <section className="px-6 lg:px-8 pt-4 pb-8 relative">
      <div className="max-w-6xl mx-auto flex flex-col gap-14">
        {SPOTLIGHTS.map((s, i) => (
          <div key={s.title} className={`grid lg:grid-cols-2 gap-8 lg:gap-12 items-center ${i % 2 ? 'lg:[&>*:first-child]:order-2' : ''}`}>
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white px-2 py-0.5 rounded-full" style={{ background: 'linear-gradient(135deg,#7C3AED,#C026D3)' }}>{s.eyebrow}</span>
              <h3 className="text-[28px] sm:text-[36px] font-extrabold tracking-[-0.03em] leading-[1.05] mt-4" style={{ color: 'var(--text)' }}>{s.title}</h3>
              <p className="mt-4 text-[15.5px] leading-relaxed max-w-xl" style={{ color: 'var(--text-soft)' }}>{s.desc}</p>
            </div>
            <NextImage src={s.img} alt={s.title} width={1200} height={800} loading="lazy" className="w-full h-auto rounded-2xl border" style={{ borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }} />
          </div>
        ))}
      </div>
    </section>
  )
}

function PricingSection() {
  return (
    <section id="pricing" className="px-6 lg:px-8 pt-12 pb-16 sm:pb-28 relative overflow-hidden">
      {/* Decorative glow behind the cards — a soft violet bloom centred on the
          popular column so the whole section reads as a spotlight, not a flat
          grey band. Pointer-events off; sits below the content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[560px] rounded-full blur-[120px] opacity-[0.5]"
        style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.22) 0%, rgba(192,38,211,0.10) 45%, transparent 70%)' }}
      />
      <div className="max-w-6xl mx-auto relative">
        <div className="text-center max-w-3xl mx-auto mb-10">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{
              backgroundColor: 'rgba(124,58,237,0.12)',
              color: '#9D6BFF',
              border: '1px solid rgba(124,58,237,0.25)',
            }}
          >
            <Sparkles size={10} />
            Pricing
          </span>
          <h2
            className="text-[40px] sm:text-[54px] font-extrabold tracking-[-0.03em] leading-[1.02] mb-5"
            style={{ color: 'var(--text)' }}
          >
            Start free.{' '}
            <span
              style={{
                background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Scale when you&apos;re ready.
            </span>
          </h2>
          <p
            className="text-[16px] sm:text-[17px] leading-relaxed max-w-2xl mx-auto"
            style={{ color: 'var(--text-soft)' }}
          >
            Every blog plan includes the full Central Hub. Cancel anytime. Your WordPress site stays yours forever.
          </p>
          {/* Risk reversal + honest urgency. Each renders only when set in the
              sales-page config, so nothing unverified ships. */}
          <div className="mt-5 flex items-center justify-center gap-x-5 gap-y-2 flex-wrap">
            {GUARANTEE && (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: '#059669' }}>
                <ShieldCheck size={15} /> {GUARANTEE}
              </span>
            )}
            {(() => {
              if (!FOUNDING_DEADLINE) return null
              const end = new Date(FOUNDING_DEADLINE + 'T23:59:59')
              if (isNaN(end.getTime()) || end.getTime() <= Date.now()) return null
              const when = end.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
              return (
                <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-3 py-1 rounded-full" style={{ background: 'rgba(234,88,12,0.1)', color: '#C2410C' }}>
                  <Zap size={14} /> Founding prices end {when}
                </span>
              )
            })()}
          </div>
        </div>

        {/* Trial banner — the no-card "way in" sits ABOVE the cards so it
            reads as "start here, then pick a tier when you're ready." */}
        <div
          className="rounded-2xl border p-5 mb-8 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6"
          style={{
            backgroundColor: 'rgba(16,185,129,0.06)',
            borderColor: 'rgba(16,185,129,0.25)',
          }}
        >
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #10B981, #059669)', color: '#FFFFFF' }}
          >
            <Sparkles size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-semibold mb-1" style={{ color: 'var(--text)' }}>
              Free to start. No card required.
            </p>
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
              Product research and Deal Radar are free forever. Plus 5 full posts on the house, so you can generate, publish and share before you pay a cent. No time limit on the trial.
            </p>
          </div>
          <a
            href="/signup"
            className="px-5 py-2.5 rounded-lg text-[13px] font-medium text-white whitespace-nowrap"
            style={{ background: 'linear-gradient(135deg, #10B981, #059669)' }}
          >
            Start free →
          </a>
        </div>

        {/* 3-tier grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5">
          {PRICING_TIERS.map(tier => (
            <PricingCard key={tier.name} tier={tier} />
          ))}
        </div>

        {/* Amazon Influencer — a DIFFERENT track (no blog, no YouTube). Own band
            below the blog ladder so storefront creators see there's a plan built
            for them without hunting on a second page. Orange to match its hub. */}
        <a
          href="/amazon-influencer"
          className="group mt-5 rounded-2xl border p-6 sm:p-7 flex flex-col lg:flex-row lg:items-center gap-5 transition-all hover:-translate-y-0.5"
          style={{ borderColor: 'rgba(234,88,12,0.35)', background: 'linear-gradient(180deg, rgba(234,88,12,0.10), rgba(234,88,12,0.03))' }}
        >
          <div className="flex items-center gap-3 lg:w-[32%]">
            <span className="w-11 h-11 rounded-xl grid place-items-center flex-shrink-0 text-white" style={{ backgroundColor: '#C2410C' }}><ShoppingBag size={20} /></span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: '#C2410C' }}>Amazon Associates & Influencers</p>
              <p className="text-[19px] font-extrabold" style={{ color: 'var(--text)' }}>No blog? No YouTube? Start here.</p>
            </div>
          </div>
          <p className="text-[13.5px] leading-relaxed lg:flex-1" style={{ color: 'var(--text-soft)' }}>
            Incredible Amazon video-review thumbnails in one click, ready-to-post pins, Reels & Facebook
            designs with your face on them, and paid brand deals. <span style={{ color: 'var(--text)' }}>From $79/mo.</span>
          </p>
          <span className="inline-flex items-center gap-1.5 px-5 py-3 rounded-xl text-[13.5px] font-semibold text-white whitespace-nowrap transition-all group-hover:gap-2.5" style={{ backgroundColor: '#C2410C' }}>
            See the Amazon plan <ArrowRight size={14} />
          </span>
        </a>
        <p className="mt-3 text-center text-[12.5px]" style={{ color: 'var(--text-soft)' }}>
          Already on <span className="font-semibold" style={{ color: 'var(--text)' }}>Studio</span> or <span className="font-semibold" style={{ color: 'var(--text)' }}>Pro</span>? The full Amazon toolkit is already in your plan, on top of the blog + YouTube engine. This plan is for storefront creators who don’t want the website side.
        </p>

        {/* Link to the full pricing page (bundle math + free-research breakdown). */}
        <div className="mt-6 text-center">
          <a href="/pricing" className="inline-flex items-center gap-1.5 text-[14px] font-semibold" style={{ color: '#9D6BFF' }}>
            See the full breakdown, plus what MVP replaces
            <ArrowRight size={15} />
          </a>
        </div>

        {/* Trust strip below the cards. */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12px]" style={{ color: 'var(--text-soft)' }}>
          <span className="inline-flex items-center gap-1.5">
            <Check size={12} className="text-[#10B981]" /> Cancel anytime
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check size={12} className="text-[#10B981]" /> Switch plans up or down
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check size={12} className="text-[#10B981]" /> Your WordPress site stays yours forever
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check size={12} className="text-[#10B981]" /> Founder pricing locked for life
          </span>
        </div>
      </div>
    </section>
  )
}

interface PricingTier {
  name: string
  tagline: string
  price: number
  regularPrice: number
  highlight: boolean
  icon: React.ReactNode
  /** Brand tier logo (app-icon) shown instead of the gradient icon chip. */
  logo?: string
  features: string[]
  cta: string
  /** Per-tier accent so each card has its own identity while violet stays the
   *  hero. `grad` = icon chip / price number / gradient strip; `solid` = a
   *  readable check colour on the light card; `tint`/`ring` = fills + borders. */
  accent: { grad: string; solid: string; tint: string; ring: string }
}

// Refreshed 2026-08 to match the live tier matrix (lib/tier.ts) AND surface the
// features shipped since (Clip Factory, Creator Connections finder + daily
// digest, all-deals & full-catalogue research). This preview page is the
// headline sales deck; numbers MUST match /pricing. If you edit one, edit both
// (and update tier.ts if the change is real).
//
// Feature lists read as a full breakdown: Creator lists the base explicitly;
// Studio and Pro lead with "Everything in <lower>, plus:" then their net-new
// unlocks — so every capability in the product is represented across the three
// cards without a wall of repeated text.
const PRICING_TIERS: PricingTier[] = [
  {
    name: 'Creator',
    tagline: 'Best for one channel in one niche, getting started.',
    price: 49,
    regularPrice: 99,
    highlight: false,
    icon: <Sparkles size={16} />,
    logo: '/png/mvp-affiliate-3-creator.png',
    accent: {
      grad: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
      solid: '#059669',
      tint: 'rgba(16,185,129,0.12)',
      ring: 'rgba(16,185,129,0.35)',
    },
    features: [
      '⚡ Amazon Deal Radar + all-deals & full-catalogue research',
      'Creator Connections finder + daily picked-for-you campaign digest',
      'Shoppable Link-in-Bio page',
      '20 generations / month — blog + thumbnail + metadata bundle',
      'Video-to-Blog + Blog-to-Social, written in your voice',
      'Auto-post to Facebook, Threads, LinkedIn & Bluesky',
      '10 video scripts + shot-lists / month',
      '1 trained face + 1 LoRA retrain, 10 Photobooth headshots',
      'Newsletter taster — 500 subs, 1 send / month',
      '5 brand-collab pitch emails / month',
      '200 AI assistant messages / month',
      '1 WordPress site, yours forever',
    ],
    cta: 'Start as Creator',
  },
  {
    name: 'Studio',
    tagline: 'Best for the all-in solo review creator. Most popular.',
    price: 99,
    regularPrice: 199,
    highlight: true,
    icon: <Crown size={16} />,
    logo: '/png/mvp-affiliate-studio.png',
    accent: {
      grad: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
      solid: '#7C3AED',
      tint: 'rgba(124,58,237,0.14)',
      ring: 'rgba(124,58,237,0.45)',
    },
    features: [
      'Everything in Creator, plus:',
      '45 generations / month',
      'Pinterest, Instagram & Telegram auto-post',
      'Deals Hub — 15 deal posts / month + Amazon CSV bulk import',
      'Topic hubs + Refresh Images on published posts',
      '2 faces + 3 LoRA retrains, 15 Photobooth headshots',
      '30 video scripts, 15 brand pitches / month',
      'Newsletter — 5,000 subs, weekly sends + scheduling',
      '1,000 AI assistant messages / month',
      'Priority generation queue + priority support',
    ],
    cta: 'Go Studio',
  },
  {
    name: 'Pro',
    tagline: 'Best for the serious affiliate marketer.',
    price: 199,
    regularPrice: 499,
    highlight: false,
    icon: <Rocket size={16} />,
    logo: '/png/mvp-affiliate-pro.png',
    accent: {
      grad: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
      solid: '#4F46E5',
      tint: 'rgba(79,70,229,0.12)',
      ring: 'rgba(79,70,229,0.35)',
    },
    features: [
      'Everything in Studio, plus:',
      '🎬 Clip Factory — turn long videos into ready-to-post shorts',
      '100 generations / month',
      'Comparison posts + Buying Guides',
      'Rebuild-from-video on any legacy WordPress post',
      'X (Twitter) & TikTok auto-post',
      'Multi-account social + one-click Publish All',
      'Up to 10 WordPress sites + 3 Virtual Assistant seats',
      'Multiple YouTube channels — one per site, or pull from any',
      '30 deal posts, 100 brand pitches / month',
      'Newsletter — 10k subs, weekly + A/B + segments',
      '2,500 AI assistant messages / month',
    ],
    cta: 'Go Pro',
  },
]

function PricingCard({ tier }: { tier: PricingTier }) {
  const highlight = tier.highlight
  const a = tier.accent
  return (
    <div className={`relative ${highlight ? 'lg:-translate-y-2 lg:scale-[1.03] z-10' : ''}`}>
      {highlight && (
        <div
          className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.15em] text-white z-20 whitespace-nowrap"
          style={{ background: a.grad, boxShadow: `0 6px 18px ${a.ring}` }}
        >
          ★ Most popular
        </div>
      )}
      <div
        className="relative rounded-[22px] h-full overflow-hidden transition-all duration-200 hover:-translate-y-1"
        style={{
          backgroundColor: 'var(--surface)',
          // Gradient hairline "ring" via a padded border for the popular card;
          // a soft accent-tinted border for the rest. Both far richer than the
          // flat grey border they replace.
          border: highlight ? '1.5px solid transparent' : '1px solid var(--border)',
          backgroundImage: highlight
            ? `linear-gradient(var(--surface), var(--surface)), ${a.grad}`
            : `linear-gradient(180deg, ${a.tint} 0%, transparent 180px)`,
          backgroundOrigin: 'border-box',
          backgroundClip: highlight ? 'padding-box, border-box' : 'border-box',
          boxShadow: highlight
            ? `0 20px 50px ${a.ring}, 0 2px 8px rgba(0,0,0,0.06)`
            : 'var(--card-shadow)',
        }}
      >
        {/* Gradient accent strip across the top — the single biggest "pop" cue,
            gives each card a colour identity at a glance. */}
        <div className="absolute top-0 inset-x-0 h-1.5" style={{ background: a.grad }} />

        <div className="p-6 pt-7 h-full flex flex-col gap-5">
          {/* Header — icon + tier name + tagline. */}
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              {tier.logo ? (
                <NextImage src={tier.logo} alt={`MVP ${tier.name}`} width={40} height={40} className="w-10 h-10 rounded-xl flex-shrink-0 shadow-sm" />
              ) : (
                <span
                  className="inline-flex items-center justify-center w-9 h-9 rounded-xl text-white flex-shrink-0"
                  style={{ background: a.grad, boxShadow: `0 4px 14px ${a.ring}` }}
                >
                  {tier.icon}
                </span>
              )}
              <h3 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                {tier.name}
              </h3>
            </div>
            <p className="text-[13px] leading-snug" style={{ color: 'var(--text-soft)' }}>
              {tier.tagline}
            </p>
          </div>

          {/* Feature list. Fills the middle so the price + CTA pin to the bottom
              and line up across all three cards. */}
          <ul className="flex flex-col gap-2.5 flex-1">
            {tier.features.map((f, i) => {
              // "Everything in X, plus:" renders as a divider-style lead line
              // (no check), not a feature bullet.
              if (/^everything in/i.test(f)) {
                return (
                  <li key={i} className="text-[12px] font-bold uppercase tracking-[0.06em] pb-1 mb-0.5" style={{ color: a.solid }}>
                    {f}
                  </li>
                )
              }
              return (
                <li key={i} className="flex items-start gap-2.5">
                  <span
                    className="inline-flex items-center justify-center w-4 h-4 rounded-full flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: a.tint }}
                  >
                    <Check size={11} strokeWidth={3} style={{ color: a.solid }} />
                  </span>
                  <span className="text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {f}
                  </span>
                </li>
              )
            })}
          </ul>

          {/* Price block — now at the BOTTOM, right above the CTA, so the eye
              lands on the value first and the price after. */}
          <div className="mt-auto pt-4" style={{ borderTop: '1px solid var(--border)' }}>
            <p className="text-[12px] line-through mb-0.5" style={{ color: 'var(--text-faint)' }}>
              ${tier.regularPrice}/month regular
            </p>
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-[44px] font-extrabold tracking-[-0.02em] tabular-nums leading-none"
                style={{
                  background: a.grad,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                ${tier.price}
              </span>
              <span className="text-[14px] font-medium" style={{ color: 'var(--text-soft)' }}>
                /month
              </span>
            </div>
            <p className="text-[11px] mt-1.5 mb-4" style={{ color: 'var(--text-faint)' }}>
              Founder pricing, locked for the life of your subscription.
            </p>

            {/* CTA. Carries the plan slug so the signup flow lands the user
                on the right checkout post-signup. */}
            <a
              href={`/signup?plan=${tier.name.toLowerCase()}`}
              className="block w-full px-4 py-3 rounded-xl text-center text-[14px] font-bold transition-all hover:brightness-110"
              style={{
                background: highlight ? a.grad : 'var(--surface-bright)',
                color: highlight ? '#FFFFFF' : a.solid,
                boxShadow: highlight ? `0 6px 22px ${a.ring}` : 'none',
                border: highlight ? 'none' : `1.5px solid ${a.ring}`,
              }}
            >
              {tier.cta} →
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Section 7 — Proof.
 *
 *  The proof is the founder's own brand, Gominplanet: a +$3M/yr affiliate
 *  business run on MVP, and the edge it gives in attracting brand partners.
 *  Backed by defensible numbers (the 4-min workflow, 9 outputs/video, the
 *  fact-grounding guarantee). No fabricated customer quotes.
 */
/** Founder section — a real face + the $3M story. Trust lever the competitors
 *  both use (logie5's "since day one", Oink's "I'm Rob"). Photo: sebmichelle. */
function FounderSection() {
  return (
    <section id="founder" className="px-6 lg:px-8 pt-12 pb-8 relative">
      <div className="max-w-5xl mx-auto">
        <div className="rounded-3xl border p-6 sm:p-10 grid md:grid-cols-[minmax(0,300px)_1fr] gap-8 items-center"
          style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.05), rgba(192,38,211,0.04))', borderColor: 'var(--border)' }}>
          <NextImage
            src="/png/sebmichelle.png"
            alt="Seb and Michelle, the founders of MVP Affiliate"
            width={600}
            height={600}
            loading="lazy"
            className="w-full h-auto rounded-2xl border"
            style={{ borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}
          />
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#7C3AED' }}>Built by creators, not a software company</span>
            <h2 className="text-[28px] sm:text-[38px] font-extrabold tracking-[-0.03em] leading-[1.05] mt-3" style={{ color: 'var(--text)' }}>
              We built MVP to run our own business.
            </h2>
            <p className="mt-4 text-[15.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
              We&apos;re Seb and Michelle. We grew Gominplanet past <span className="font-semibold" style={{ color: 'var(--text)' }}>$3M a year</span> in affiliate revenue, and we got tired of stitching together a stack of tools that each took a cut and none of which sounded like us. So we built the tool we wished existed and ran our whole business on it. Now it runs yours, in your voice.
            </p>
            <p className="mt-4 text-[13px] font-semibold" style={{ color: '#9D6BFF' }}>Seb and Michelle, Gominplanet</p>
          </div>
        </div>
      </div>
    </section>
  )
}

/** Testimonials wall — real customer quotes only (never fabricated). Hidden
 *  until TESTIMONIALS has entries. */
function TestimonialsSection() {
  if (TESTIMONIALS.length === 0) return null
  return (
    <section id="testimonials" className="px-6 lg:px-8 pt-16 sm:pt-20 pb-8 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#7C3AED' }}>Loved by creators</span>
          <h2 className="text-[32px] sm:text-[44px] font-extrabold tracking-[-0.03em] leading-[1.03] mt-3" style={{ color: 'var(--text)' }}>
            What creators say
          </h2>
        </div>
        <div className={`mt-10 gap-4 ${TESTIMONIALS.length === 1 ? 'max-w-xl mx-auto' : TESTIMONIALS.length === 2 ? 'grid sm:grid-cols-2 max-w-3xl mx-auto' : 'grid sm:grid-cols-2 lg:grid-cols-3'}`}>
          {TESTIMONIALS.map((t, i) => (
            <figure key={i} className="rounded-2xl border p-5 flex flex-col" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="text-[13px] mb-2" style={{ color: '#F5A623' }}>★★★★★</div>
              <blockquote className="text-[14px] leading-relaxed flex-1" style={{ color: 'var(--text)' }}>“{t.quote}”</blockquote>
              <figcaption className="mt-4 text-[12.5px]">
                <span className="font-semibold" style={{ color: 'var(--text)' }}>{t.name}</span>
                {t.handle && <span style={{ color: 'var(--text-faint)' }}> · {t.handle}</span>}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}

function ProofSection() {
  return (
    <section id="proof" className="px-6 lg:px-8 pt-12 pb-16 sm:pb-28 relative">
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{
              backgroundColor: 'rgba(124,58,237,0.12)',
              color: '#9D6BFF',
              border: '1px solid rgba(124,58,237,0.25)',
            }}
          >
            <TrendingUp size={10} />
            Proven, not projected
          </span>
          <h2
            className="text-[36px] sm:text-[46px] font-extrabold tracking-[-0.03em] leading-[1.05] mb-4"
            style={{ color: 'var(--text)' }}
          >
            The system behind a $3M/year affiliate business.
          </h2>
          <p
            className="text-[16px] leading-relaxed max-w-2xl mx-auto"
            style={{ color: 'var(--text-soft)' }}
          >
            Gominplanet grew this affiliate business past $3M a year in revenue, and it&apos;s a big reason brands want to work with us. We built MVP to run our own business. Now it runs yours, in your voice.
          </p>
          <p className="mt-4 text-[13px] font-semibold" style={{ color: '#9D6BFF' }}>
            Seb and Michelle, Gominplanet
          </p>
        </div>

        {/* 4-up stat row. Each big number with a label. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {STATS.map(s => (
            <StatCard key={s.label} stat={s} />
          ))}
        </div>

      </div>
    </section>
  )
}

interface Stat {
  value: string
  label: string
  detail: string
}

const STATS: Stat[] = [
  { value: '$3M+', label: '/yr at Gominplanet', detail: 'real affiliate revenue, run on MVP' },
  { value: '4 min', label: 'average workflow', detail: 'video → 9 outputs' },
  { value: '9', label: 'outputs per video', detail: 'blog, comparison, thumbnail, newsletter, script + social fan-out' },
  { value: '0', label: 'fabricated claims', detail: 'every output grounded in your video' },
]

function StatCard({ stat }: { stat: Stat }) {
  return (
    <div
      className="rounded-2xl border p-5 text-center"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <p
        className="text-[36px] sm:text-[42px] font-semibold tracking-tight tabular-nums leading-none"
        style={{
          background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        {stat.value}
      </p>
      <p className="text-[12px] uppercase tracking-[0.12em] mt-2 mb-1" style={{ color: 'var(--text)' }}>
        {stat.label}
      </p>
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        {stat.detail}
      </p>
    </div>
  )
}

/** Section 9 — Final CTA.
 *
 *  Full-bleed dark/light closing panel that re-states the offer one
 *  more time before the scroll ends. Big headline, twin CTAs, and the
 *  same trust elements as the pricing section for consistency.
 *
 *  Background uses a soft radial gradient so the section reads as a
 *  visual "landing" rather than just another card.
 */
function FinalCTASection() {
  return (
    <section
      id="get-started"
      className="px-6 lg:px-8 pt-14 sm:pt-16 pb-16 sm:pb-24 relative overflow-hidden"
    >
      {/* Background: soft violet radial that fades out, matching the hub
          diagram's visual rhythm. Theme-aware via --bg + the overlay. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 50% 30%, rgba(124,58,237,0.18), transparent 70%)',
        }}
        aria-hidden
      />

      <div className="max-w-4xl mx-auto text-center relative">
        <span
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-6"
          style={{
            backgroundColor: 'rgba(124,58,237,0.15)',
            color: '#C4B5FD',
            border: '1px solid rgba(124,58,237,0.30)',
          }}
        >
          Ready when you are
        </span>
        <h2
          className="text-[44px] sm:text-[64px] font-extrabold tracking-[-0.035em] leading-[1.0] mb-5"
          style={{ color: 'var(--text)' }}
        >
          Start your{' '}
          <span
            style={{
              background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Central Hub.
          </span>
        </h2>
        <p
          className="text-[17px] sm:text-[18px] leading-relaxed max-w-2xl mx-auto mb-8"
          style={{ color: 'var(--text-soft)' }}
        >
          Five free posts. No card. No time limit. See if MVP fits your workflow before you pay a cent.
        </p>

        {/* Twin CTAs — primary action + lower-friction demo link. */}
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-center mb-8">
          <a
            href="/signup"
            className="px-7 py-3.5 rounded-xl text-[15px] font-semibold text-white inline-flex items-center gap-2 transition-all hover:scale-[1.02]"
            style={{
              background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
              boxShadow: '0 8px 28px rgba(124,58,237,0.40)',
            }}
          >
            Start your free trial
            <ArrowRight size={16} />
          </a>
          <a
            href="/tour"
            className="px-5 py-3.5 rounded-xl text-[15px] inline-flex items-center gap-2 transition-colors"
            style={{
              backgroundColor: 'var(--surface-bright)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
            }}
          >
            Take the product tour
            <ArrowRight size={14} />
          </a>
        </div>

        {/* Trust strip — matches pricing section's strip for consistency. */}
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12px]" style={{ color: 'var(--text-soft)' }}>
          <span className="inline-flex items-center gap-1.5">
            <Check size={12} className="text-[#10B981]" /> No card required
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check size={12} className="text-[#10B981]" /> 5 full posts free
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check size={12} className="text-[#10B981]" /> Cancel anytime
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check size={12} className="text-[#10B981]" /> Your WordPress site stays yours
          </span>
        </div>

        {/* Founder signature line — final reassurance. */}
        <p className="text-[12px] mt-10" style={{ color: 'var(--text-faint)' }}>
          Built by a creator who&apos;s done <span className="font-semibold" style={{ color: 'var(--text-soft)' }}>$3M+/yr</span> in affiliate sales. Made for creators who want the same.
        </p>

        {/* Hero product visual — the whole machine at a glance. */}
        <div className="mt-12 mx-auto w-full max-w-5xl">
          <NextImage
            src="/png/44bf146a-8a53-461d-a77f-57c81e7ef03a.webp"
            alt="MVP Affiliate: find products, create content, and publish everywhere from one dashboard"
            width={1717}
            height={916}
            loading="lazy"
            className="w-full h-auto rounded-2xl border"
            style={{ borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}
          />
        </div>
      </div>
    </section>
  )
}

/** Top nav — minimal: logo + sign in + theme toggle. Sticky so it stays
 *  accessible while scrolling. Will gain Pricing/Demo links when those
 *  sections exist further down the page. */
function Nav() {
  return (
    <nav
      className="sticky top-0 z-20 backdrop-blur-md px-4 sm:px-8 py-4 flex items-center justify-between relative"
      style={{
        backgroundColor: 'rgba(250,250,248,0.75)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <a href="/" className="flex items-center gap-2">
        <NextImage src="/png/mvp-affiliate-trial.png" alt="MVP Affiliate" width={32} height={32} priority className="w-8 h-8 rounded-lg" />
        <span className="font-semibold text-[15px] tracking-tight" style={{ color: 'var(--text)' }}>
          MVP Affiliate
        </span>
      </a>
      {/* Anchor links — visible on lg+ so the long page stays skimmable.
          Each item points at a section id elsewhere on the page; smooth
          scroll is enabled globally via the `html { scroll-behavior:
          smooth }` rule near the top of LandingPreview. */}
      <div className="hidden lg:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
        {NAV_ANCHORS.map(a => (
          <a
            key={a.href}
            href={a.href}
            className="mvp-hover-text px-3 py-1.5 rounded-lg text-[13px] transition-colors hover:opacity-100"
            style={{ color: 'var(--text-soft)' }}
          >
            {a.label}
          </a>
        ))}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        <a
          href="/login"
          className="px-2.5 sm:px-3 py-1.5 rounded-lg text-[13px] transition-colors"
          style={{ color: 'var(--text-soft)' }}
        >
          Sign in
        </a>
        {/* Primary CTA — full label on sm+, trimmed to "Start free" on the
            tightest phones so it never crowds the wordmark. */}
        <a
          href="/signup"
          className="px-3.5 py-1.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-[13px] font-medium text-white transition-colors whitespace-nowrap"
        >
          Start free<span className="hidden sm:inline"> trial</span>
        </a>
      </div>
    </nav>
  )
}

const NAV_ANCHORS = [
  { label: 'Roles', href: '#roles' },
  { label: 'Workflow', href: '#how-it-works' },
  // Full public product tour — a standalone page (/tour), not an in-page
  // anchor. Sits before Pricing so prospects can see what it does, then price.
  { label: 'Tour', href: '/tour' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'FAQ', href: '#faq' },
  // /affiliates is a full page, not an in-page anchor — added here so the
  // top nav surfaces the program for prospects who'd otherwise only see
  // it via the footer link.
  { label: 'Affiliates', href: '/affiliates' },
]

/** The hero — locked copy + animated hub diagram + CTAs. */
function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Base backdrop — the special hero background image, held subtle and faded
          at the bottom so it never fights the headline. The color mesh sits on
          top for the brand glow. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'url(/png/specialbkg.webp)',
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          opacity: 0.5,
          maskImage: 'linear-gradient(to bottom, black 55%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 55%, transparent 100%)',
        }}
      />
      {/* Background mesh gradient — same recipe as the dashboard preview's
          hero, scaled up. Opacity adapts to theme via var. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 'var(--hero-opacity)',
          background: `
            radial-gradient(50% 70% at 25% 25%, rgba(124,58,237,0.55), transparent 60%),
            radial-gradient(45% 65% at 80% 20%, rgba(192,38,211,0.45), transparent 65%),
            radial-gradient(70% 50% at 60% 100%, rgba(99,102,241,0.30), transparent 70%)
          `,
        }}
      />

      <div className="relative max-w-7xl mx-auto px-5 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-28 grid lg:grid-cols-[1fr_minmax(0,560px)] gap-10 lg:gap-14 items-center">
        {/* ── Left: copy + CTAs ────────────────────────────────────── */}
        <div>
          {/* Pill */}
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[11px] uppercase tracking-[0.16em] font-medium mb-4"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text-soft)',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
            For affiliate creators
          </div>

          {/* Trust strip — lifted to live above the headline. Establishes
              credibility BEFORE the bold value claim, so the headline
              lands on a primed visitor. */}
          <p className="mb-6 text-[12px] font-medium" style={{ color: 'var(--text-subtle)' }}>
            Built by a <span style={{ color: 'var(--text-muted)' }}>$3M/yr affiliate creator</span>. No card to start.
          </p>

          {/* Main + Secondary headlines — fat, tight, high-contrast (logie5-style).
              Leads with the positioning: one tool, every feature, no compromise. */}
          <h1
            className="text-[40px] sm:text-[58px] lg:text-[70px] font-extrabold tracking-[-0.035em] leading-[0.98]"
            style={{ color: 'var(--text)' }}
          >
            Everything an Amazon<br />affiliate needs.{' '}
            <span style={{ background: 'linear-gradient(120deg, #F97316 0%, #C026D3 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Zero compromise.
            </span>
          </h1>
          <p
            className="mt-5 text-[20px] sm:text-[22px] font-semibold tracking-tight"
            style={{ color: 'var(--text-muted)' }}
          >
            It runs the whole business side while you create, and writes every word in your real voice.
          </p>

          {/* Sub */}
          <p
            className="mt-6 text-[16px] leading-relaxed max-w-xl"
            style={{ color: 'var(--text-soft)' }}
          >
            Connect your channel and MVP turns each video into a published, SEO and AI optimized review, then finishes the upload for you: description, tags, affiliate links and a tested thumbnail. <span style={{ color: 'var(--text)' }}>No video? Drop any product link</span> and it writes the review, buying guides and comparisons itself. Everything lands on a blog that&apos;s yours to keep, forever.
          </p>

          {/* CTAs — primary button + its supporting reassurance live as
              separate elements so the button stays readable and the
              "yours forever" promise sits clearly below both CTAs. */}
          <div className="mt-8">
            <div className="flex flex-wrap items-center gap-3">
              <a
                href="/signup"
                className="px-5 py-3 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-[14px] font-semibold text-white inline-flex items-center gap-2 transition-colors shadow-[0_4px_16px_rgba(124,58,237,0.3)]"
              >
                Start your free trial
                <ArrowRight size={14} />
              </a>
              {/* Secondary CTA — the full public product tour (/tour). No video;
                  the tour walks the features directly. */}
              <a
                href="/tour"
                className="px-5 py-3 rounded-xl border text-[14px] font-medium inline-flex items-center gap-2 transition-colors"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)',
                }}
              >
                See the product tour
                <ArrowRight size={13} />
              </a>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px]" style={{ color: 'var(--text-faint)' }}>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-[#10B981]" />
                Keep your WordPress site forever.
              </span>
              <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--text-soft)' }}>
                <ShieldCheck size={13} style={{ color: '#10B981' }} />
                We never use or sell your personal data.
              </span>
            </div>

            {/* New-feature ribbon — ties the hero to the flagship new work in the
                features grid below (voice + Shorts). */}
            <a
              href="#features"
              className="mt-6 inline-flex items-center gap-2.5 rounded-2xl px-4 py-3 text-[13px] font-medium transition-transform hover:-translate-y-0.5"
              style={{
                background: 'linear-gradient(135deg, rgba(249,115,22,0.14), rgba(192,38,211,0.14))',
                border: '1px solid rgba(249,115,22,0.3)',
                color: 'var(--text)',
              }}
            >
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0" style={{ background: 'linear-gradient(135deg, #F97316, #C026D3)', color: '#fff' }}>
                <Sparkles size={14} />
              </span>
              <span>
                <span className="font-semibold">New.</span>{' '}
                <span style={{ color: 'var(--text-soft)' }}>MVP now writes in your real voice, learned from your own videos, and posts your Shorts to TikTok and Instagram.</span>
              </span>
              <ArrowRight size={14} className="flex-shrink-0" style={{ color: '#F97316' }} />
            </a>
          </div>
        </div>

        {/* ── Right: product mock in a browser frame ────────────────── */}
        <ProductMock />
      </div>
    </section>
  )
}

/** The hub diagram: SVG lines drawn between a central node and 8 spoke
 *  nodes, animated on page load (lines draw outward in sequence; spokes
 *  pop in once each line arrives; lines then breathe gently forever).
 *
 *  Layered:
 *    - SVG (z-0): lines + radial pulse rings under center
 *    - HTML (z-10): the 8 spoke nodes
 *    - HTML (z-20): the center video node, drawn last so it covers line
 *                   endpoints
 */
/** Hero visual — a stylized mock of the product inside a browser frame:
 *  one YouTube review card at the top, then the outputs MVP publishes from it,
 *  each ticked "done". Bounded + padded so nothing crowds the edge (the old
 *  radial hub did), with a soft gradient glow and two floating feature chips
 *  for depth. Pure markup (no client JS) so it stays in the Server Component. */
function ProductMock() {
  const outputs: Array<{ icon: React.ReactNode; label: string }> = [
    { icon: <FileText size={13} />, label: 'Blog post' },
    { icon: <Scale size={13} />, label: 'Comparison' },
    { icon: <Bookmark size={13} />, label: 'Buying guide' },
    { icon: <ImageIcon size={13} />, label: 'Thumbnail' },
    { icon: <Mail size={13} />, label: 'Newsletter' },
    { icon: <Instagram size={13} />, label: 'Instagram' },
    { icon: <Facebook size={13} />, label: 'Facebook' },
    { icon: <Pin size={13} />, label: 'Pinterest' },
  ]
  const chip = (bg: string, border: string, color: string) => ({
    backgroundColor: bg, border: `1px solid ${border}`, color,
  })
  return (
    <div className="relative mx-auto w-full max-w-[540px]">
      {/* Soft glow behind the frame */}
      <div
        aria-hidden
        className="absolute -inset-8 pointer-events-none"
        style={{ background: 'radial-gradient(55% 55% at 60% 35%, rgba(124,58,237,0.28), transparent 70%)', filter: 'blur(24px)' }}
      />

      {/* Browser frame */}
      <div
        className="relative rounded-2xl border overflow-hidden"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', boxShadow: '0 34px 64px -22px rgba(24,24,40,0.4)' }}
      >
        {/* Chrome bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <span className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#FF5F57' }} />
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#FEBC2E' }} />
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#28C840' }} />
          </span>
          <div className="flex-1 ml-2 text-center text-[11px] rounded-md py-1" style={{ background: 'var(--bg)', color: 'var(--text-faint)' }}>
            app.mvpaffiliate.io/library
          </div>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5" style={{ background: 'var(--bg)' }}>
          {/* Source review card */}
          <div className="flex items-center gap-3 rounded-xl border p-3" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <span className="w-16 h-11 rounded-lg flex items-center justify-center flex-shrink-0 text-white" style={{ background: 'linear-gradient(135deg,#7C3AED,#C026D3)' }}>
              <Play size={16} fill="currentColor" className="ml-0.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text)' }}>Best Robot Vacuums (2026)</p>
              <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>YouTube review · 12:04</p>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 flex-shrink-0" style={chip('rgba(16,185,129,0.12)', 'transparent', '#10B981')}>
              <Check size={10} /> Published
            </span>
          </div>

          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] mt-4 mb-2" style={{ color: 'var(--text-faint)' }}>
            Auto-published to 9 places
          </p>

          {/* Output grid */}
          <div className="grid grid-cols-2 gap-2">
            {outputs.map((o, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border px-2.5 py-2" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0" style={{ background: 'rgba(124,58,237,0.12)', color: '#7C3AED' }}>{o.icon}</span>
                <span className="text-[12px] font-medium flex-1 truncate" style={{ color: 'var(--text)' }}>{o.label}</span>
                <Check size={13} style={{ color: '#10B981' }} />
              </div>
            ))}
          </div>

          {/* Footer stat row */}
          <div className="flex items-center gap-2 mt-3">
            <span className="text-[11px] font-medium px-2 py-1 rounded-lg inline-flex items-center gap-1.5" style={chip('rgba(59,130,246,0.1)', 'transparent', '#3B82F6')}>
              <TrendingUp size={12} /> SEO score 94
            </span>
            <span className="text-[11px] font-medium px-2 py-1 rounded-lg inline-flex items-center gap-1.5" style={chip('rgba(124,58,237,0.12)', 'transparent', '#7C3AED')}>
              <Sparkles size={12} /> Cited by AI
            </span>
          </div>
        </div>
      </div>

      {/* Floating feature chips for depth */}
      <div
        className="hidden sm:flex absolute -top-3 -right-3 items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold text-white"
        style={{ background: 'linear-gradient(135deg,#F97316,#C026D3)', boxShadow: '0 12px 26px -8px rgba(192,38,211,0.5)' }}
      >
        <Zap size={13} /> Deal Radar
      </div>
      <div
        className="hidden sm:flex absolute -bottom-3 -left-3 items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold"
        style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', boxShadow: '0 12px 26px -10px rgba(24,24,40,0.3)' }}
      >
        <Calendar size={13} style={{ color: '#7C3AED' }} /> Scheduled
      </div>
    </div>
  )
}

/** Platform showcase — the distribution-reach strip under the hero. Every
 *  generated post auto-publishes NATIVELY to each of these channels (amplifies
 *  the content-first pitch; it's reach, not the headline). LIVE today: your
 *  WordPress site + X, LinkedIn, Facebook, Instagram, Threads, Bluesky,
 *  Telegram, Pinterest. Meta cleared App Review 2026-06-15, Pinterest 2026-06-16.
 *  TikTok is live (Direct Post audit approved) but it's VIDEO-only (Shorts /
 *  Clip Factory), not blog-post syndication, so it's not in this strip; it's
 *  called out in the footnote instead. The count is derived from PLATFORMS so
 *  it can't drift.
 *
 *  Visual: a count-driven headline + brand-colored channel chips that wrap.
 *  Chip border/text are theme-aware; the icon carries the platform's brand
 *  color (X/Threads use --text-soft so their black mark adapts to the theme).
 */
/** MVP vs the rest — the "only tool, zero compromise, your data stays yours"
 *  argument as a scannable comparison. Generic "Other tools" column (no named
 *  competitors). The privacy row is the emphasized differentiator. */
const COMPARE_ROWS: { label: string; mvp: boolean; others: 'no' | 'partial'; highlight?: boolean }[] = [
  { label: 'Turn a YouTube video into a full SEO blog post', mvp: true, others: 'no' },
  { label: 'Any product link or Amazon ASIN → review, comparison, buying guide & deal post', mvp: true, others: 'partial' },
  { label: 'Finish the upload: description, tags, affiliate links & a CTR-tested thumbnail', mvp: true, others: 'no' },
  { label: 'Auto-syndicate every post to all your socials (FB, IG, X, LinkedIn, Threads, Bluesky, Telegram, Pinterest)', mvp: true, others: 'partial' },
  { label: 'Price-history-verified Amazon Deal Radar', mvp: true, others: 'no' },
  { label: 'Creator Connections: a daily brand-deal digest auto-matched to your content, plus accept & message', mvp: true, others: 'no' },
  { label: 'Levanta, PartnerBoost & Walmart campaigns in one place', mvp: true, others: 'no' },
  { label: 'Turn one long video into vertical Reels, TikToks & YouTube Shorts', mvp: true, others: 'no' },
  { label: 'Clean up + migrate your existing site (404s, duplicates, old affiliate links)', mvp: true, others: 'no' },
  { label: 'Display-ad + affiliate-banner revenue on your own site', mvp: true, others: 'no' },
  { label: 'A beautiful blog on your own site that you keep forever', mvp: true, others: 'no' },
  { label: 'Never uses or sells your personal data', mvp: true, others: 'no', highlight: true },
]

/** Thumbnail showcase — the money feature, shown not told. Real Amazon
 *  video-review thumbnails MVP generated from a single product, one click each.
 *  Answers the "no product visuals" gap: this is the most persuasive proof on
 *  the page. */
const SHOWCASE_THUMBS: { src: string; w: number; h: number; alt: string }[] = [
  { src: '/png/mvp-tn1.png', w: 1280, h: 720, alt: 'Amazon video-review thumbnail made by MVP from a single product photo' },
  { src: '/png/mvp-tn2.png', w: 1280, h: 720, alt: 'Amazon video-review thumbnail made by MVP from a single product photo' },
  { src: '/png/mvp-tn3.png', w: 1280, h: 720, alt: 'Amazon video-review thumbnail made by MVP from a single product photo' },
  { src: '/png/mvp-tn4.png', w: 1280, h: 720, alt: 'Amazon video-review thumbnail made by MVP from a single product photo' },
]
function ThumbnailShowcase() {
  return (
    <section id="thumbnails" className="px-5 sm:px-8 pt-4 pb-16 sm:pb-24 relative">
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-9">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.18em] mb-5"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)', border: '1px solid var(--border)' }}
          >
            <Wand2 size={11} /> One product photo in. One click.
          </span>
          <h2 className="text-[32px] sm:text-[44px] font-extrabold tracking-[-0.03em] leading-[1.03]" style={{ color: 'var(--text)' }}>
            Thumbnails that make people stop.
          </h2>
          <p className="mt-4 text-[15px] sm:text-[16px]" style={{ color: 'var(--text-soft)' }}>
            Every one of these started as a single Amazon product and one click. No Photoshop, no designer, no hours lost. That is the MVP Art Director.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 sm:gap-5">
          {SHOWCASE_THUMBS.map((t) => (
            <NextImage
              key={t.src}
              src={t.src}
              alt={t.alt}
              width={t.w}
              height={t.h}
              loading="lazy"
              className="w-full h-auto rounded-2xl border"
              style={{ borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

function ComparisonSection() {
  return (
    <section id="compare" className="px-5 sm:px-8 pt-16 sm:pt-24 pb-16 sm:pb-24 relative">
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.18em] mb-5"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)', border: '1px solid var(--border)' }}
          >
            <ShieldCheck size={11} /> The only one that does it all
          </span>
          <h2 className="text-[36px] sm:text-[52px] font-extrabold tracking-[-0.03em] leading-[1.0]" style={{ color: 'var(--text)' }}>
            One tool. Every feature.<br />
            <span style={{ background: 'linear-gradient(120deg, #F97316 0%, #C026D3 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Your data stays yours.
            </span>
          </h2>
          <p className="mt-5 text-[16px] sm:text-[17px] leading-relaxed max-w-2xl mx-auto" style={{ color: 'var(--text-soft)' }}>
            Other Amazon affiliate tools make you stitch together three or four services — and pay for it with your personal data. MVP does the whole job in one place, and never touches yours.
          </p>
        </div>

        <div className="rounded-3xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
          {/* Header row */}
          <div className="grid grid-cols-[1fr_auto_auto]">
            <div className="px-5 sm:px-7 py-4 text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-faint)' }}>
              Feature
            </div>
            <div className="w-[92px] sm:w-[120px] px-2 py-4 text-center text-[13px] sm:text-[15px] font-extrabold" style={{ color: 'var(--text)', background: 'var(--accent-soft)' }}>
              MVP
            </div>
            <div className="w-[92px] sm:w-[120px] px-2 py-4 text-center text-[12px] sm:text-[13px] font-semibold" style={{ color: 'var(--text-subtle)' }}>
              Other tools
            </div>
          </div>

          {COMPARE_ROWS.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_auto_auto] items-center border-t"
              style={{ borderColor: 'var(--border)', background: r.highlight ? 'var(--accent-soft)' : 'transparent' }}
            >
              <div className="px-5 sm:px-7 py-4 text-[14px] sm:text-[15px]" style={{ color: 'var(--text-muted)', fontWeight: r.highlight ? 700 : 500 }}>
                {r.label}
              </div>
              <div className="w-[92px] sm:w-[120px] px-2 py-4 flex items-center justify-center" style={{ background: r.highlight ? 'transparent' : 'var(--accent-soft)' }}>
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-white" style={{ background: 'linear-gradient(135deg, #7C3AED, #C026D3)' }}>
                  <Check size={15} strokeWidth={3} />
                </span>
              </div>
              <div className="w-[92px] sm:w-[120px] px-2 py-4 flex items-center justify-center">
                {r.others === 'partial' ? (
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-faint)' }}>Some</span>
                ) : (
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full" style={{ background: 'var(--surface-bright)', color: 'var(--text-faint)' }}>
                    <XIcon size={14} strokeWidth={2.5} />
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Privacy promise strip */}
        <div
          className="mt-6 rounded-2xl border px-5 sm:px-7 py-5 flex items-start gap-4"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0 text-white" style={{ background: 'linear-gradient(135deg, #10B981, #059669)' }}>
            <ShieldCheck size={20} />
          </span>
          <div>
            <p className="text-[16px] font-bold" style={{ color: 'var(--text)' }}>Your data is never the product.</p>
            <p className="mt-1 text-[14px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
              We don&apos;t harvest, sell, or train on your personal data — not your audience, not your earnings, not your content. Your accounts stay connected to <span style={{ color: 'var(--text)' }}>you</span>, and your site is yours to keep forever.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function PlatformBar() {
  return (
    <section className="px-6 lg:px-8 pt-2 pb-14 relative">
      <div className="max-w-4xl mx-auto text-center">
        <p
          className="text-[10px] uppercase tracking-[0.18em] mb-3"
          style={{ color: 'var(--text-faint)' }}
        >
          One review video → published everywhere
        </p>
        <p className="text-lg sm:text-xl font-medium mb-7 leading-snug" style={{ color: 'var(--text-soft)' }}>
          Every post auto-publishes natively to{' '}
          <span className="font-bold" style={{ color: '#7C3AED' }}>{PLATFORMS.length} channels</span>
          {' '}— no copy-paste, no separate scheduler.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          {PLATFORMS.map((p) => (
            <span
              key={p.name}
              className="inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-medium"
              style={{
                color: 'var(--text-soft)',
                border: '1px solid var(--text-faint)',
                background: 'color-mix(in srgb, var(--text-soft) 4%, transparent)',
              }}
            >
              <span style={{ color: p.color }}>{p.icon}</span>
              {p.name}
            </span>
          ))}
        </div>
        <p className="text-[11px] mt-5" style={{ color: 'var(--text-faint)' }}>
          TikTok included: your Shorts post straight to your feed from MVP, no phone step.
        </p>
      </div>
    </section>
  )
}

const PLATFORMS = [
  { name: 'WordPress', icon: <Globe size={15} />, color: '#21759B' },
  // X + Threads brand marks are black/white — use the theme-aware token so
  // they stay visible in both light and dark mode.
  { name: 'X', icon: <Twitter size={15} />, color: 'var(--text-soft)' },
  { name: 'LinkedIn', icon: <Linkedin size={15} />, color: '#0A66C2' },
  { name: 'Facebook', icon: <Facebook size={15} />, color: '#1877F2' },
  { name: 'Instagram', icon: <Instagram size={15} />, color: '#E1306C' },
  { name: 'Threads', icon: <AtSign size={15} />, color: 'var(--text-soft)' },
  { name: 'Bluesky', icon: <Cloud size={15} />, color: '#1185FE' },
  { name: 'Telegram', icon: <Send size={15} />, color: '#229ED9' },
  { name: 'Pinterest', icon: <Pin size={15} />, color: '#E60023' },
]

/** Footer — closes the page with a clean lockup of navigation, legal,
 *  and social links. Required before this preview can replace the live
 *  root landing.
 *
 *  Layout: 4-column desktop (Product / Resources / Company / Legal),
 *  collapsing to 2 columns on tablet and 1 column on mobile. Brand
 *  lockup + tagline sit on top spanning the full width.
 *
 *  All links are placeholders pointing at expected routes — the user
 *  can adjust each href once the actual destinations exist.
 */
function Footer() {
  return (
    <footer
      className="px-6 lg:px-8 pt-16 pb-28 sm:pb-10 mt-12 border-t"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="max-w-6xl mx-auto">
        {/* Brand row */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 pb-10 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg"
                style={{ background: 'linear-gradient(135deg, #7C3AED, #C026D3)' }}
              >
                <Sparkles size={14} className="text-white" />
              </span>
              <span className="text-[16px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
                MVP Affiliate
              </span>
            </div>
            <p className="text-[13px] max-w-md leading-relaxed" style={{ color: 'var(--text-soft)' }}>
              Your central content hub. One review video, every output, your voice — grounded in what you actually said.
            </p>
          </div>
          <a
            href="/signup"
            className="px-4 py-2 rounded-lg text-[13px] font-medium text-white whitespace-nowrap"
            style={{ background: 'linear-gradient(135deg, #7C3AED, #C026D3)' }}
          >
            Start free →
          </a>
        </div>

        {/* Link columns */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 py-10">
          <FooterCol
            title="Product"
            links={[
              { label: 'Roles', href: '#roles' },
              { label: 'Workflow', href: '#how-it-works' },
              { label: 'Product tour', href: '/tour' },
              { label: 'Pricing', href: '/pricing' },
              { label: 'FAQ', href: '#faq' },
              { label: 'Product tour', href: '/tour' },
            ]}
          />
          {/* Public resources only — no member-only in-app tools here (WordPress
              setup / Connection Doctor live behind auth and would just bounce a
              logged-out visitor to /login). */}
          <FooterCol
            title="Resources"
            links={[
              { label: 'Product tour', href: '/tour' },
              { label: 'SCOUT extension', href: 'https://chromewebstore.google.com/detail/scout-%E2%80%94-mvp-affiliate/blpmlneliggaekangckpgknphpacapkg' },
              { label: 'Pricing', href: '/pricing' },
              { label: 'FAQ', href: '#faq' },
            ]}
          />
          {/* About / Contact / Cookie policy hidden until those public pages
              exist — they'd otherwise bounce a logged-out visitor to /login. */}
          <FooterCol
            title="Company"
            links={[
              { label: 'Affiliates', href: '/affiliates' },
            ]}
          />
          <FooterCol
            title="Legal"
            links={[
              { label: 'Privacy', href: '/privacy' },
              { label: 'Terms', href: '/terms' },
            ]}
          />
        </div>

        {/* Bottom strip — copyright + small print */}
        <div className="pt-8 border-t flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
            © {new Date().getFullYear()} MVP Affiliate. All rights reserved. Built by a creator, for creators.
          </p>
          <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
            Your WordPress site stays yours, forever.
          </p>
        </div>
      </div>
    </footer>
  )
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.15em] mb-4 font-semibold" style={{ color: 'var(--text)' }}>
        {title}
      </p>
      <ul className="flex flex-col gap-2.5">
        {links.map(l => (
          <li key={l.href}>
            <a
              href={l.href}
              className="mvp-hover-text text-[13px] transition-colors"
              style={{ color: 'var(--text-soft)' }}
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

