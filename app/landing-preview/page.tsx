// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// /landing-preview — STAGING SLOT. A Creator-Lens-styled redesign of the
// homepage, kept here so it can be compared against the live page at / before
// anything replaces it. Public via middleware, noindex via the metadata below.
//
// Look (matched to getcreatorlens.com from Seb's screenshots): warm cream
// background with warm tonal bands, a coral accent (not the live violet), big
// bold rounded headlines in Plus Jakarta Sans (already loaded as --font-jakarta),
// light-coral eyebrow pills, pill-shaped buttons with a soft coral glow, and
// soft white rounded cards with lots of air. One restrained accent, generous
// whitespace, very readable.
//
// ACCENT: teal (#008080), chosen by Seb, in place of Creator Lens's coral. The
// whole accent system lives in the C palette below, so the color is a one-block
// change. Pro's card keeps violet so the two plans stay visually distinct.
//
// ACCURACY: every price and allowance is read from TIERS / FREE_TRIAL at render
// time, never typed. Two plans only, Amazon and Pro.
import { TIERS } from '@/lib/tier'
import { FREE_TRIAL } from '@/lib/free-trial'
import { FREE_WEEK_SHORT } from '@/lib/guarantee'
import { newPricesLive } from '@/lib/price-schedule'
import { FAQSection, HeroVideo, StickyBottomBar } from '@/components/landing/islands'
import {
  ArrowRight, Check, X as XIcon, ShoppingBag, Rocket,
  Search, Sparkles, Globe, FileText, Store, ShieldCheck, Scissors, Zap,
} from 'lucide-react'
import NextImage from 'next/image'

// Re-rendered every 10 minutes so the November 1 price change shows without a deploy.
export const revalidate = 600

// Public (see middleware) but kept out of search while it is a staging page.
export const metadata = {
  title: 'MVP Affiliate',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
}

// ── Warm, cream palette with a single coral accent. Matches Creator Lens. ──
const C = {
  bg: '#FBF7F2',        // warm cream page
  band: '#F6EDE4',      // warm tan band for alternating sections
  card: '#FFFFFF',      // white cards
  text: '#1C1917',      // near-black (warm)
  muted: '#57534E',     // warm grey
  soft: '#78716C',      // stone
  faint: '#A8A29E',     // light stone
  border: 'rgba(28,25,23,0.10)',
  borderSoft: 'rgba(28,25,23,0.07)',
  accent: '#008080',    // teal
  accentText: '#0C6E6B',// deeper teal for small text on cream (contrast)
  accentSoft: 'rgba(0,128,128,0.10)',
  grad: 'linear-gradient(135deg, #2DD4BF 0%, #008080 100%)', // aqua to deep teal
  cardShadow: '0 1px 3px rgba(28,25,23,0.04), 0 14px 34px -16px rgba(28,25,23,0.18)',
  glow: '0 10px 26px rgba(0,128,128,0.32)',
  ok: '#16A34A',
} as const

const DISPLAY = { fontFamily: 'var(--font-jakarta), var(--font-sans), system-ui, sans-serif' } as const

/** Small light-coral eyebrow pill above each section heading. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-[0.14em]" style={{ backgroundColor: C.accentSoft, color: C.accentText }}>
      {children}
    </span>
  )
}

/** Feature availability tag. */
type TagKind = 'Free' | 'Pro' | 'Amazon' | 'All plans'
const TAG_COLOR: Record<TagKind, string> = { Free: C.ok, Pro: '#7C3AED', Amazon: C.accentText, 'All plans': C.soft }
function Tag({ kind }: { kind: TagKind }) {
  return (
    <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full" style={{ color: TAG_COLOR[kind], backgroundColor: `color-mix(in srgb, ${TAG_COLOR[kind]} 12%, transparent)`, lineHeight: 1.5 }}>
      {kind}
    </span>
  )
}

export default function LandingPreview() {
  return (
    <div style={{ backgroundColor: C.bg, color: C.text }} className="min-h-screen antialiased font-[family-name:var(--font-sans)]">
      <Nav />
      <Hero />
      <TrialBand />
      <Steps />
      <FeatureGrid />
      <CompareTable />
      <Pricing />
      <ProofLine />
      <div id="faq">
        <FAQSection />
      </div>
      <FinalCTA />
      <Footer />
      <StickyBottomBar />
    </div>
  )
}

/* ─────────────────────────────── Nav ─────────────────────────────── */
function Nav() {
  const links = [
    { label: 'How it works', href: '#how' },
    { label: 'Compare', href: '#compare' },
    { label: 'Pricing', href: '#pricing' },
    { label: 'FAQ', href: '#faq' },
  ]
  return (
    <nav className="sticky top-0 z-30 backdrop-blur-md px-5 sm:px-8 py-3.5 flex items-center justify-between" style={{ backgroundColor: 'rgba(251,247,242,0.82)', borderBottom: `1px solid ${C.borderSoft}` }}>
      <a href="/" className="flex items-center gap-2">
        <NextImage src="/png/mvp-affiliate-trial.png" alt="MVP Affiliate" width={30} height={30} priority className="w-[30px] h-[30px] rounded-lg" />
        <span className="text-[16px] font-extrabold tracking-tight" style={{ ...DISPLAY, color: C.text }}>MVP Affiliate</span>
      </a>
      <div className="hidden md:flex items-center gap-2 absolute left-1/2 -translate-x-1/2">
        {links.map(l => (
          <a key={l.href} href={l.href} className="px-3 py-1.5 rounded-lg text-[14px] font-medium transition-colors hover:opacity-70" style={{ color: C.muted }}>{l.label}</a>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <a href="/login" className="hidden sm:inline px-3 py-1.5 text-[14px] font-medium transition-colors hover:opacity-70" style={{ color: C.muted }}>Sign in</a>
        <a href="/signup" className="px-5 py-2.5 rounded-full text-[14px] font-bold text-white transition-transform hover:-translate-y-px" style={{ backgroundColor: C.accent, boxShadow: C.glow }}>
          Start free
        </a>
      </div>
    </nav>
  )
}

/* ─────────────────────────────── Hero ─────────────────────────────── */
function Hero() {
  return (
    <section className="px-5 sm:px-8 pt-16 sm:pt-24 pb-12 sm:pb-16">
      <div className="max-w-3xl mx-auto text-center">
        <Eyebrow>For Amazon influencers</Eyebrow>
        <h1 className="text-[44px] sm:text-[68px] font-extrabold tracking-[-0.03em] leading-[1.0] mt-7" style={{ ...DISPLAY, color: C.text }}>
          Your storefront is rented.{' '}
          <span style={{ background: C.grad, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Build the one you own.</span>
        </h1>
        <p className="mt-6 text-[17px] sm:text-[20px] leading-relaxed max-w-2xl mx-auto" style={{ color: C.muted }}>
          MVP turns the reviews you already film into a blog that is yours forever, written in your real voice, then publishes it everywhere and cuts it into shoppable clips. No video? Drop any product link and it writes the review itself.
        </p>
        <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
          <a href="/signup" className="px-7 py-4 rounded-full text-[16px] font-bold text-white inline-flex items-center gap-2 transition-transform hover:-translate-y-px" style={{ backgroundColor: C.accent, boxShadow: C.glow }}>
            Start free <ArrowRight size={17} />
          </a>
          <a href="#how" className="px-7 py-4 rounded-full text-[16px] font-bold inline-flex items-center gap-2 transition-colors" style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, color: C.text }}>
            See how it works
          </a>
        </div>
        <p className="mt-6 text-[14px]" style={{ color: C.faint }}>
          Free to start, no card. Research and Deal Radar stay free forever. Paid plans unlock publishing, your voice and your blog.
        </p>
      </div>

      {/* Explainer video at the top: the one thing a cold visitor can watch to
          understand what MVP does, the move Creator Lens makes. Reuses the
          preconfigured HeroVideo island (first sales video, click to play). */}
      <div className="max-w-3xl mx-auto mt-14">
        <HeroVideo />
      </div>
    </section>
  )
}

/* ──────────────────────── Trial band (try before you pay) ──────────────────────── */
function TrialBand() {
  return (
    <section className="px-5 sm:px-8 py-16 sm:py-24" style={{ backgroundColor: C.band, borderTop: `1px solid ${C.borderSoft}`, borderBottom: `1px solid ${C.borderSoft}` }}>
      <div className="max-w-4xl mx-auto text-center">
        <Eyebrow>Free to start</Eyebrow>
        <h2 className="text-[32px] sm:text-[46px] font-extrabold tracking-[-0.025em] leading-[1.04] mt-5" style={{ ...DISPLAY, color: C.text }}>
          Try all of it before you pay.
        </h2>
        <p className="mt-4 text-[16px] leading-relaxed max-w-2xl mx-auto" style={{ color: C.muted }}>
          Start on the free plan with no card. Make a few finished designs with your own face on them, browse every live deal, and research all of Amazon. The download is free. Publishing is the upgrade.
        </p>
        <div className="mt-9 grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto text-left">
          <div className="rounded-3xl p-6" style={{ backgroundColor: C.card, boxShadow: C.cardShadow }}>
            <div className="flex items-center gap-2 mb-3.5"><Tag kind="Free" /><span className="text-[14px] font-bold" style={{ ...DISPLAY, color: C.text }}>Free, forever</span></div>
            <ul className="flex flex-col gap-2.5 text-[14px]" style={{ color: C.soft }}>
              <li className="flex gap-2.5"><Check size={17} style={{ color: C.ok }} className="mt-0.5 flex-shrink-0" /> All-of-Amazon product research</li>
              <li className="flex gap-2.5"><Check size={17} style={{ color: C.ok }} className="mt-0.5 flex-shrink-0" /> Live, price-verified Deal Radar</li>
              <li className="flex gap-2.5"><Check size={17} style={{ color: C.ok }} className="mt-0.5 flex-shrink-0" /> See brand-deal campaigns you can claim</li>
            </ul>
          </div>
          <div className="rounded-3xl p-6" style={{ backgroundColor: C.card, border: `1.5px solid ${C.accent}`, boxShadow: C.cardShadow }}>
            <div className="flex items-center gap-2 mb-3.5"><Tag kind="All plans" /><span className="text-[14px] font-bold" style={{ ...DISPLAY, color: C.text }}>Free for your first {FREE_TRIAL.trialDays} days</span></div>
            <ul className="flex flex-col gap-2.5 text-[14px]" style={{ color: C.soft }}>
              <li className="flex gap-2.5"><Check size={17} style={{ color: C.accentText }} className="mt-0.5 flex-shrink-0" /> {FREE_TRIAL.thumbnails} Art Director thumbnails</li>
              <li className="flex gap-2.5"><Check size={17} style={{ color: C.accentText }} className="mt-0.5 flex-shrink-0" /> {FREE_TRIAL.socialDesigns} ready-to-post designs with your face</li>
              <li className="flex gap-2.5"><Check size={17} style={{ color: C.accentText }} className="mt-0.5 flex-shrink-0" /> {TIERS.trial.lifetimeMax} full posts once a site is connected</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ─────────────────────────────── Steps ─────────────────────────────── */
const STEPS: { n: string; title: string; desc: string }[] = [
  { n: 'Find', desc: 'Research all of Amazon and live Deal Radar for products worth promoting, or just paste any product or Amazon link.', title: 'Find what is worth it' },
  { n: 'Create', desc: 'MVP writes the review, the comparisons and the social posts in your real voice, and makes the thumbnail and the clips for you.', title: 'Create in your voice' },
  { n: 'Publish', desc: 'It lands on a blog that stays yours, plus your socials and a shoppable bio, with affiliate links already in place.', title: 'Publish everywhere' },
  { n: 'Earn', desc: 'Passport geo-links with no per-click fees and Creator Connections keep every shopper earning, with the commission going to you.', title: 'Earn on every click' },
]
function Steps() {
  return (
    <section id="how" className="px-5 sm:px-8 py-16 sm:py-24">
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <Eyebrow>The MVP Loop</Eyebrow>
          <h2 className="text-[32px] sm:text-[46px] font-extrabold tracking-[-0.025em] leading-[1.04] mt-5" style={{ ...DISPLAY, color: C.text }}>
            One system runs the business side.
          </h2>
          <p className="mt-4 text-[16px]" style={{ color: C.muted }}>You keep creating. MVP does the rest, start to finish.</p>
        </div>
        <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STEPS.map((s, i) => (
            <li key={s.n} className="rounded-3xl p-6" style={{ backgroundColor: C.card, boxShadow: C.cardShadow }}>
              <div className="flex items-center gap-2.5 mb-4">
                <span className="w-9 h-9 rounded-full grid place-items-center text-[15px] font-extrabold text-white" style={{ background: C.grad }}>{i + 1}</span>
                <span className="text-[12px] font-bold uppercase tracking-[0.12em]" style={{ color: C.accentText }}>{s.n}</span>
              </div>
              <h3 className="text-[17px] font-extrabold mb-1.5" style={{ ...DISPLAY, color: C.text }}>{s.title}</h3>
              <p className="text-[14px] leading-relaxed" style={{ color: C.soft }}>{s.desc}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

/* ─────────────────────────── Feature grid (Free/Pro tags) ─────────────────────────── */
const FEATURES: { icon: React.ReactNode; title: string; desc: string; tag: TagKind }[] = [
  { icon: <Sparkles size={18} />, title: 'Writes in your real voice', desc: 'MVP learns how you actually sound from your own videos and edits, and sharpens over time.', tag: 'Pro' },
  { icon: <Scissors size={18} />, title: 'Clips for TikTok, Reels and Shorts', desc: 'Clip Factory turns long videos into vertical shorts and reframes them for you before you post.', tag: 'Pro' },
  { icon: <Globe size={18} />, title: 'Passport geo-links, no click fees', desc: 'Send every shopper to their own country Amazon and keep the commission. No per-click fees, ever.', tag: 'All plans' },
  { icon: <Zap size={18} />, title: 'Amazon Deal Radar', desc: 'Live, price-history-verified deals, not fake was-prices. Browsing stays free.', tag: 'Free' },
  { icon: <Search size={18} />, title: 'All-of-Amazon product research', desc: 'Filter by sales, rating, price and video competition. Scout Creator Connections and more.', tag: 'Free' },
  { icon: <FileText size={18} />, title: 'SEO and AI-ready articles', desc: 'Reviews, comparisons and buying guides built to rank on Google and get quoted by AI answers.', tag: 'Pro' },
  { icon: <Store size={18} />, title: 'Your own blog, forever', desc: 'A beautifully designed WordPress site that stays yours even if you leave. No lock-in.', tag: 'Pro' },
  { icon: <ShoppingBag size={18} />, title: 'Thumbnails and designs with your face', desc: 'One product photo in, bright thumbnails and ready-to-post social designs out, with your own face.', tag: 'Amazon' },
  { icon: <ShieldCheck size={18} />, title: 'Your data stays yours', desc: 'MVP never uses or sells your personal data. It works from your content, nothing else.', tag: 'All plans' },
]
function FeatureGrid() {
  return (
    <section id="features" className="px-5 sm:px-8 py-16 sm:py-24" style={{ backgroundColor: C.band, borderTop: `1px solid ${C.borderSoft}`, borderBottom: `1px solid ${C.borderSoft}` }}>
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <Eyebrow>Everything in one place</Eyebrow>
          <h2 className="text-[32px] sm:text-[46px] font-extrabold tracking-[-0.025em] leading-[1.04] mt-5" style={{ ...DISPLAY, color: C.text }}>
            One subscription replaces your whole stack.
          </h2>
          <p className="mt-4 text-[16px]" style={{ color: C.muted }}>The writer, the researcher, the editor, the social team and the link cloaker. All of it, and it sounds like you.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(f => (
            <div key={f.title} className="rounded-3xl p-6 transition-transform hover:-translate-y-0.5" style={{ backgroundColor: C.card, boxShadow: C.cardShadow }}>
              <div className="flex items-center justify-between mb-4">
                <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ backgroundColor: C.accentSoft, color: C.accentText }}>{f.icon}</span>
                <Tag kind={f.tag} />
              </div>
              <h3 className="text-[16.5px] font-extrabold mb-1.5" style={{ ...DISPLAY, color: C.text }}>{f.title}</h3>
              <p className="text-[14px] leading-relaxed" style={{ color: C.soft }}>{f.desc}</p>
            </div>
          ))}
        </div>
        <div className="text-center mt-10">
          <a href="/features" className="inline-flex items-center gap-1.5 text-[15px] font-bold" style={{ color: C.accentText }}>
            See every feature <ArrowRight size={15} />
          </a>
        </div>
      </div>
    </section>
  )
}

/* ─────────────────────────── Compare table ─────────────────────────── */
const COMPARE: { label: string; mvp: boolean; them: 'no' | 'some'; highlight?: boolean }[] = [
  { label: 'Turn a YouTube video into a full SEO blog post', mvp: true, them: 'no' },
  { label: 'Any product link into a review, comparison, buying guide and deal post', mvp: true, them: 'some' },
  { label: 'Finish the upload: description, tags, affiliate links and a tested thumbnail', mvp: true, them: 'no' },
  { label: 'Auto-publish every post to all your socials', mvp: true, them: 'some' },
  { label: 'Price-history-verified Amazon Deal Radar', mvp: true, them: 'no' },
  { label: 'Daily brand-deal digest matched to your content', mvp: true, them: 'no' },
  { label: 'One long video into vertical Reels, TikToks and Shorts', mvp: true, them: 'no' },
  { label: 'A blog on your own site that you keep forever', mvp: true, them: 'no' },
  { label: 'Never uses or sells your personal data', mvp: true, them: 'no', highlight: true },
]
function CompareTable() {
  return (
    <section id="compare" className="px-5 sm:px-8 py-16 sm:py-24">
      <div className="max-w-4xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <Eyebrow>The honest comparison</Eyebrow>
          <h2 className="text-[32px] sm:text-[46px] font-extrabold tracking-[-0.025em] leading-[1.04] mt-5" style={{ ...DISPLAY, color: C.text }}>
            One tool, or three or four.
          </h2>
          <p className="mt-4 text-[16px]" style={{ color: C.muted }}>Most affiliate tools do one slice of the job and make you pay the rest in your personal data. MVP does the whole job and never touches yours.</p>
        </div>
        <div className="rounded-3xl overflow-hidden" style={{ backgroundColor: C.card, boxShadow: C.cardShadow }}>
          <div className="grid grid-cols-[1fr_auto_auto]" style={{ backgroundColor: C.band }}>
            <div className="px-5 py-4 text-[12px] font-bold uppercase tracking-[0.1em]" style={{ color: C.faint }}>Feature</div>
            <div className="w-[88px] sm:w-[112px] px-2 py-4 text-center text-[14px] font-extrabold" style={{ ...DISPLAY, color: C.text }}>MVP</div>
            <div className="w-[88px] sm:w-[112px] px-2 py-4 text-center text-[13px] font-semibold" style={{ color: C.faint }}>The usual stack</div>
          </div>
          {COMPARE.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto] items-center" style={{ borderTop: `1px solid ${C.borderSoft}`, backgroundColor: r.highlight ? C.accentSoft : 'transparent' }}>
              <div className="px-5 py-4 text-[14px]" style={{ color: C.muted, fontWeight: r.highlight ? 700 : 500 }}>{r.label}</div>
              <div className="w-[88px] sm:w-[112px] px-2 py-4 flex items-center justify-center">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white" style={{ backgroundColor: C.accent }}><Check size={14} strokeWidth={3} /></span>
              </div>
              <div className="w-[88px] sm:w-[112px] px-2 py-4 flex items-center justify-center">
                {r.them === 'some'
                  ? <span className="text-[12px] font-semibold" style={{ color: C.faint }}>Some</span>
                  : <span className="inline-flex items-center justify-center w-6 h-6 rounded-full" style={{ backgroundColor: C.band, color: C.faint }}><XIcon size={13} strokeWidth={2.5} /></span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─────────────────────────────── Pricing ─────────────────────────────── */
interface PlanCard {
  name: string
  slug: string
  tagline: string
  price: number
  regularPrice: number
  icon: React.ReactNode
  accent: string
  highlight: boolean
  bullets: string[]
  cta: string
}
const PLANS: PlanCard[] = [
  {
    name: 'Amazon',
    slug: 'amazon',
    tagline: 'For Amazon storefront and influencer creators.',
    price: TIERS.amazon.price,
    regularPrice: TIERS.amazon.regularPrice,
    icon: <ShoppingBag size={16} />,
    accent: C.accent,
    highlight: true,
    bullets: [
      'Deal Radar plus all-deals and full-catalogue research',
      'Creator Connections finder and a daily picked-for-you digest',
      'Thumbnails and social designs with your own face on them',
      'Auto-post to Pinterest, Instagram and Facebook, disclosures added for you',
      'Shoppable link in bio plus Passport geo-links, unlimited clicks',
      'A YouTube channel with Co-Pilot, Amazon Live prep and clips',
    ],
    cta: 'Start storefront',
  },
  {
    name: 'Pro',
    slug: 'pro',
    tagline: 'Everything MVP does, with the biggest allowances.',
    price: TIERS.pro.price,
    regularPrice: TIERS.pro.regularPrice,
    icon: <Rocket size={16} />,
    accent: '#7C3AED',
    highlight: false,
    bullets: [
      'Everything in Amazon, plus:',
      'Your own blog, written in your real voice',
      'Video-to-blog, comparisons and buying guides',
      'Clips posted to TikTok and YouTube Shorts too',
      'X, TikTok, LinkedIn, Threads, Bluesky and Telegram auto-post',
      'Multiple WordPress sites, team seats and partner programs',
    ],
    cta: 'Go Pro',
  },
]
function Pricing() {
  return (
    <section id="pricing" className="px-5 sm:px-8 py-16 sm:py-24" style={{ backgroundColor: C.band, borderTop: `1px solid ${C.borderSoft}`, borderBottom: `1px solid ${C.borderSoft}` }}>
      <div className="max-w-4xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <Eyebrow>Pricing</Eyebrow>
          <h2 className="text-[32px] sm:text-[46px] font-extrabold tracking-[-0.025em] leading-[1.04] mt-5" style={{ ...DISPLAY, color: C.text }}>
            Start free. Scale when you are ready.
          </h2>
          <p className="mt-4 text-[16px]" style={{ color: C.muted }}>Two plans, no tiers to decode. Cancel anytime. Your WordPress site stays yours forever.</p>
          {FREE_WEEK_SHORT && (
            <p className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-bold" style={{ color: C.ok }}>
              <ShieldCheck size={15} /> {FREE_WEEK_SHORT} on the monthly plan
            </p>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
          {PLANS.map(p => <PlanTile key={p.slug} plan={p} />)}
        </div>
        <div className="mt-6 text-center">
          <a href="/pricing" className="inline-flex items-center gap-1.5 text-[15px] font-bold" style={{ color: C.accentText }}>
            See the full breakdown <ArrowRight size={15} />
          </a>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px]" style={{ color: C.soft }}>
          <span className="inline-flex items-center gap-1.5"><Check size={14} style={{ color: C.ok }} /> Cancel anytime</span>
          <span className="inline-flex items-center gap-1.5"><Check size={14} style={{ color: C.ok }} /> Switch plans up or down</span>
          <span className="inline-flex items-center gap-1.5"><Check size={14} style={{ color: C.ok }} /> Founder pricing locked for life</span>
        </div>
      </div>
    </section>
  )
}
function PlanTile({ plan }: { plan: PlanCard }) {
  const showStruck = plan.regularPrice > plan.price && !newPricesLive()
  return (
    <div className="relative rounded-3xl p-7 flex flex-col" style={{ backgroundColor: C.card, border: plan.highlight ? `1.5px solid ${plan.accent}` : `1px solid ${C.border}`, boxShadow: C.cardShadow }}>
      {plan.highlight && (
        <span className="absolute -top-3 left-7 px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-[0.1em] text-white" style={{ backgroundColor: plan.accent, boxShadow: C.glow }}>
          Most popular
        </span>
      )}
      <div className="flex items-center gap-2.5 mb-1.5">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl text-white" style={{ backgroundColor: plan.accent }}>{plan.icon}</span>
        <h3 className="text-[22px] font-extrabold tracking-tight" style={{ ...DISPLAY, color: C.text }}>{plan.name}</h3>
      </div>
      <p className="text-[13.5px] leading-snug mb-5" style={{ color: C.soft }}>{plan.tagline}</p>
      <div className="mb-5">
        {showStruck && <p className="text-[12px] mb-0.5" style={{ color: C.faint }}><span className="line-through">${plan.regularPrice}/month</span> from November 1</p>}
        <div className="flex items-baseline gap-1.5">
          <span className="text-[44px] font-extrabold tracking-[-0.02em] tabular-nums leading-none" style={{ ...DISPLAY, color: C.text }}>${plan.price}</span>
          <span className="text-[14px] font-medium" style={{ color: C.soft }}>/month</span>
        </div>
        <p className="text-[11px] mt-1.5" style={{ color: C.faint }}>Founder pricing, locked for the life of your subscription.</p>
      </div>
      <ul className="flex flex-col gap-2.5 flex-1 mb-6">
        {plan.bullets.map((b, i) => (
          /^everything in/i.test(b) ? (
            <li key={i} className="text-[11px] font-bold uppercase tracking-[0.06em]" style={{ color: plan.accent }}>{b}</li>
          ) : (
            <li key={i} className="flex items-start gap-2.5 text-[13.5px] leading-relaxed" style={{ color: C.muted }}>
              <Check size={15} strokeWidth={2.5} className="mt-0.5 flex-shrink-0" style={{ color: plan.accent }} /> {b}
            </li>
          )
        ))}
      </ul>
      <a href={`/signup?plan=${plan.slug}`} className="block w-full px-4 py-3.5 rounded-full text-center text-[14px] font-bold text-white transition-transform hover:-translate-y-px" style={{ backgroundColor: plan.accent, boxShadow: plan.highlight ? C.glow : 'none' }}>
        {plan.cta}
      </a>
    </div>
  )
}

/* ─────────────────────── Proof (one slim line, not a section) ─────────────────────── */
function ProofLine() {
  return (
    <section className="px-5 sm:px-8 py-16 sm:py-24">
      <div className="max-w-3xl mx-auto text-center">
        <p className="text-[22px] sm:text-[30px] font-extrabold tracking-tight leading-snug" style={{ ...DISPLAY, color: C.text }}>
          Built by creators who grew their own affiliate business past <span style={{ color: C.accentText }}>$3M a year</span>, and run it on MVP.
        </p>
        <p className="mt-4 text-[15px]" style={{ color: C.soft }}>Seb and Michelle, Gominplanet. We made the tool we wished existed, then opened it up.</p>
      </div>
    </section>
  )
}

/* ─────────────────────────────── Final CTA ─────────────────────────────── */
function FinalCTA() {
  return (
    <section className="px-5 sm:px-8 py-16 sm:py-24" style={{ backgroundColor: C.band, borderTop: `1px solid ${C.borderSoft}` }}>
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="text-[36px] sm:text-[52px] font-extrabold tracking-[-0.03em] leading-[1.02]" style={{ ...DISPLAY, color: C.text }}>
          Build the business{' '}
          <span style={{ background: C.grad, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>you own.</span>
        </h2>
        <p className="mt-5 text-[16px] leading-relaxed" style={{ color: C.muted }}>
          {TIERS.trial.lifetimeMax} free posts, plus {FREE_TRIAL.thumbnails} thumbnails and {FREE_TRIAL.socialDesigns} designs for {FREE_TRIAL.trialDays} days. No card. See if MVP fits before you pay a cent.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <a href="/signup" className="px-8 py-4 rounded-full text-[16px] font-bold text-white inline-flex items-center gap-2 transition-transform hover:-translate-y-px" style={{ backgroundColor: C.accent, boxShadow: C.glow }}>
            Start free <ArrowRight size={17} />
          </a>
          <a href="/tour" className="px-7 py-4 rounded-full text-[16px] font-bold inline-flex items-center gap-2" style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, color: C.text }}>
            Take the tour
          </a>
        </div>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px]" style={{ color: C.soft }}>
          <span className="inline-flex items-center gap-1.5"><Check size={14} style={{ color: C.ok }} /> No card required</span>
          <span className="inline-flex items-center gap-1.5"><Check size={14} style={{ color: C.ok }} /> Cancel anytime</span>
          <span className="inline-flex items-center gap-1.5"><Check size={14} style={{ color: C.ok }} /> Your site stays yours</span>
        </div>
      </div>
    </section>
  )
}

/* ─────────────────────────────── Footer ─────────────────────────────── */
function Footer() {
  const cols: { title: string; links: { label: string; href: string }[] }[] = [
    { title: 'Product', links: [{ label: 'How it works', href: '#how' }, { label: 'Compare', href: '#compare' }, { label: 'Pricing', href: '#pricing' }, { label: 'Tour', href: '/tour' }] },
    { title: 'Resources', links: [{ label: 'Free Guide', href: '/freeguide' }, { label: 'Features', href: '/features' }, { label: 'FAQ', href: '#faq' }] },
    { title: 'Company', links: [{ label: 'Affiliates', href: '/affiliates' }] },
    { title: 'Legal', links: [{ label: 'Privacy', href: '/privacy' }, { label: 'Terms', href: '/terms' }] },
  ]
  return (
    <footer className="px-5 sm:px-8 pt-14 pb-28 sm:pb-12" style={{ backgroundColor: C.bg, borderTop: `1px solid ${C.borderSoft}` }}>
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-8 pb-10">
          <div className="col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2 mb-2">
              <NextImage src="/png/mvp-affiliate-trial.png" alt="MVP Affiliate" width={26} height={26} className="w-[26px] h-[26px] rounded-lg" />
              <span className="text-[15px] font-extrabold tracking-tight" style={{ ...DISPLAY, color: C.text }}>MVP Affiliate</span>
            </div>
            <p className="text-[12.5px] leading-relaxed max-w-[220px]" style={{ color: C.soft }}>One review video, every output, in your voice, on a blog you own.</p>
          </div>
          {cols.map(col => (
            <div key={col.title}>
              <p className="text-[11px] uppercase tracking-[0.14em] mb-3.5 font-bold" style={{ color: C.text }}>{col.title}</p>
              <ul className="flex flex-col gap-2.5">
                {col.links.map(l => (
                  <li key={l.href}><a href={l.href} className="text-[13px] transition-colors hover:opacity-70" style={{ color: C.soft }}>{l.label}</a></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="pt-7 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
          <p className="text-[11px]" style={{ color: C.faint }}>© {new Date().getFullYear()} MVP Affiliate. All rights reserved.</p>
          <p className="text-[11px]" style={{ color: C.faint }}>Your WordPress site stays yours, forever.</p>
        </div>
      </div>
    </footer>
  )
}
