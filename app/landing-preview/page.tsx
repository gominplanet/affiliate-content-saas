// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// /landing-preview — STAGING SLOT. A Creator-Lens-styled redesign of the
// homepage, kept here so it can be compared against the live page at / before
// anything replaces it. Public via middleware, noindex via the metadata below.
//
// Look (matched to getcreatorlens.com from Seb's screenshots): warm cream
// background with warm tonal bands, a TEAL accent (#008080, Seb's choice), big
// bold rounded headlines in Plus Jakarta Sans (already loaded as --font-jakarta),
// light eyebrow pills, pill-shaped buttons with a soft glow, and soft white
// rounded cards with lots of air. Scaled up for desktop: wide containers, large
// type.
//
// THE MODEL (Seb, confirmed): ONE plan, Pro. A card is required; the first 7
// days are free (not charged until day 8, cancel before then and pay nothing).
// Then $199/month, rising to $299/month for new members on January 1, 2027.
// There is no free-forever tier and no Amazon plan here. Prices and the change
// date are read from TIERS / price-schedule at render time, never typed.
import { TIERS } from '@/lib/tier'
import { FREE_WEEK_DAYS, FREE_WEEK_SENTENCE } from '@/lib/guarantee'
import { newPricesLive, PRICE_CHANGE_AT } from '@/lib/price-schedule'
import { FAQSection, HeroVideo, StickyBottomBar } from '@/components/landing/islands'
import {
  ArrowRight, Check, X as XIcon, Rocket,
  Search, Sparkles, Globe, FileText, Store, ShieldCheck, Scissors, Zap,
} from 'lucide-react'
import NextImage from 'next/image'

// Re-rendered every 10 minutes so the January 1 price change shows without a deploy.
export const revalidate = 600

// Public (see middleware) but kept out of search while it is a staging page.
export const metadata = {
  title: 'MVP Affiliate',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
}

// The date Pro's price rises, formatted from the real constant so it can't drift.
const PRICE_UP_DATE = new Date(PRICE_CHANGE_AT).toLocaleDateString('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
})

// ── Warm cream palette with a single teal accent. Matches Creator Lens. ──
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
  cardShadow: '0 1px 3px rgba(28,25,23,0.04), 0 16px 38px -16px rgba(28,25,23,0.20)',
  glow: '0 10px 28px rgba(0,128,128,0.34)',
  ok: '#16A34A',
} as const

const DISPLAY = { fontFamily: 'var(--font-jakarta), var(--font-sans), system-ui, sans-serif' } as const
const PRIMARY_CTA = `Try Pro free for ${FREE_WEEK_DAYS} days`

/** Light eyebrow pill above each section heading. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-bold uppercase tracking-[0.14em]" style={{ backgroundColor: C.accentSoft, color: C.accentText }}>
      {children}
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
    <nav className="sticky top-0 z-30 backdrop-blur-md px-5 sm:px-8 lg:px-12 py-4 flex items-center justify-between" style={{ backgroundColor: 'rgba(251,247,242,0.82)', borderBottom: `1px solid ${C.borderSoft}` }}>
      <a href="/" className="flex items-center gap-2.5">
        <NextImage src="/png/mvp-affiliate-trial.png" alt="MVP Affiliate" width={32} height={32} priority className="w-8 h-8 rounded-lg" />
        <span className="text-[17px] font-extrabold tracking-tight" style={{ ...DISPLAY, color: C.text }}>MVP Affiliate</span>
      </a>
      <div className="hidden md:flex items-center gap-3 absolute left-1/2 -translate-x-1/2">
        {links.map(l => (
          <a key={l.href} href={l.href} className="px-3 py-2 rounded-lg text-[15px] font-medium transition-colors hover:opacity-70" style={{ color: C.muted }}>{l.label}</a>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <a href="/login" className="hidden sm:inline px-3 py-2 text-[15px] font-medium transition-colors hover:opacity-70" style={{ color: C.muted }}>Sign in</a>
        <a href="/signup?plan=pro" className="px-5 py-2.5 rounded-full text-[15px] font-bold text-white transition-transform hover:-translate-y-px whitespace-nowrap" style={{ backgroundColor: C.accent, boxShadow: C.glow }}>
          Start free trial
        </a>
      </div>
    </nav>
  )
}

/* ─────────────────────────────── Hero ─────────────────────────────── */
function Hero() {
  return (
    <section className="px-5 sm:px-8 lg:px-12 pt-20 sm:pt-28 pb-14 sm:pb-20">
      <div className="max-w-4xl mx-auto text-center">
        <Eyebrow>For Amazon influencers</Eyebrow>
        <h1 className="text-[48px] sm:text-[68px] lg:text-[80px] font-extrabold tracking-[-0.03em] leading-[0.98] mt-8" style={{ ...DISPLAY, color: C.text }}>
          Your storefront is rented.{' '}
          <span style={{ background: C.grad, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Build the one you own.</span>
        </h1>
        <p className="mt-7 text-[18px] sm:text-[22px] leading-relaxed max-w-2xl mx-auto" style={{ color: C.muted }}>
          MVP turns the reviews you already film into a blog that is yours forever, written in your real voice, then publishes it everywhere and cuts it into shoppable clips. No video? Drop any product link and it writes the review itself.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3.5">
          <a href="/signup?plan=pro" className="px-8 py-4 rounded-full text-[17px] font-bold text-white inline-flex items-center gap-2 transition-transform hover:-translate-y-px" style={{ backgroundColor: C.accent, boxShadow: C.glow }}>
            {PRIMARY_CTA} <ArrowRight size={18} />
          </a>
          <a href="#how" className="px-8 py-4 rounded-full text-[17px] font-bold inline-flex items-center gap-2 transition-colors" style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, color: C.text }}>
            See how it works
          </a>
        </div>
        <p className="mt-6 text-[15px]" style={{ color: C.faint }}>
          {FREE_WEEK_DAYS} days free, then ${TIERS.pro.price}/month. Cancel before day {FREE_WEEK_DAYS + 1} and you pay nothing.
        </p>
      </div>

      {/* Explainer video at the top: the one thing a cold visitor can watch to
          understand what MVP does, the move Creator Lens makes. Reuses the
          preconfigured HeroVideo island (first sales video, click to play). */}
      <div className="max-w-5xl mx-auto mt-16">
        <HeroVideo />
      </div>
    </section>
  )
}

/* ──────────────────────── Trial band (try before you pay) ──────────────────────── */
function TrialBand() {
  return (
    <section className="px-5 sm:px-8 lg:px-12 py-20 sm:py-28" style={{ backgroundColor: C.band, borderTop: `1px solid ${C.borderSoft}`, borderBottom: `1px solid ${C.borderSoft}` }}>
      <div className="max-w-3xl mx-auto text-center">
        <Eyebrow>Your first week is on us</Eyebrow>
        <h2 className="text-[36px] sm:text-[50px] lg:text-[56px] font-extrabold tracking-[-0.025em] leading-[1.02] mt-6" style={{ ...DISPLAY, color: C.text }}>
          Try all of it before you pay.
        </h2>
        <p className="mt-5 text-[18px] leading-relaxed max-w-2xl mx-auto" style={{ color: C.muted }}>
          Every feature is unlocked from day one of your free trial. Nothing is held back. Add your card to start, and it is not charged until day {FREE_WEEK_DAYS + 1}. Cancel before then and you pay nothing.
        </p>
        <div className="mt-8 inline-flex flex-wrap items-center justify-center gap-x-6 gap-y-2 rounded-2xl px-6 py-4 text-[15px] font-semibold" style={{ backgroundColor: C.card, boxShadow: C.cardShadow, color: C.muted }}>
          <span className="inline-flex items-center gap-2"><Check size={17} style={{ color: C.accentText }} /> {FREE_WEEK_DAYS} days free</span>
          <span className="inline-flex items-center gap-2"><Check size={17} style={{ color: C.accentText }} /> Every feature unlocked</span>
          <span className="inline-flex items-center gap-2"><Check size={17} style={{ color: C.accentText }} /> Cancel anytime</span>
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
    <section id="how" className="px-5 sm:px-8 lg:px-12 py-20 sm:py-28">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <Eyebrow>The MVP Loop</Eyebrow>
          <h2 className="text-[36px] sm:text-[50px] lg:text-[56px] font-extrabold tracking-[-0.025em] leading-[1.02] mt-6" style={{ ...DISPLAY, color: C.text }}>
            One system runs the business side.
          </h2>
          <p className="mt-5 text-[18px]" style={{ color: C.muted }}>You keep creating. MVP does the rest, start to finish.</p>
        </div>
        <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {STEPS.map((s, i) => (
            <li key={s.n} className="rounded-3xl p-7" style={{ backgroundColor: C.card, boxShadow: C.cardShadow }}>
              <div className="flex items-center gap-3 mb-5">
                <span className="w-10 h-10 rounded-full grid place-items-center text-[16px] font-extrabold text-white" style={{ background: C.grad }}>{i + 1}</span>
                <span className="text-[12.5px] font-bold uppercase tracking-[0.12em]" style={{ color: C.accentText }}>{s.n}</span>
              </div>
              <h3 className="text-[19px] font-extrabold mb-2" style={{ ...DISPLAY, color: C.text }}>{s.title}</h3>
              <p className="text-[15px] leading-relaxed" style={{ color: C.soft }}>{s.desc}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

/* ─────────────────────────── Feature grid ─────────────────────────── */
const FEATURES: { icon: React.ReactNode; title: string; desc: string }[] = [
  { icon: <Sparkles size={20} />, title: 'Writes in your real voice', desc: 'MVP learns how you actually sound from your own videos and edits, and sharpens over time.' },
  { icon: <Scissors size={20} />, title: 'Clips for TikTok, Reels and Shorts', desc: 'Clip Factory turns long videos into vertical shorts and reframes them for you before you post.' },
  { icon: <Globe size={20} />, title: 'Passport geo-links, no click fees', desc: 'Send every shopper to their own country Amazon and keep the commission. No per-click fees, ever.' },
  { icon: <Zap size={20} />, title: 'Amazon Deal Radar', desc: 'Live, price-history-verified deals, not fake was-prices, turned into posts and a shoppable bio.' },
  { icon: <Search size={20} />, title: 'All-of-Amazon product research', desc: 'Filter by sales, rating, price and video competition. Scout Creator Connections and more.' },
  { icon: <FileText size={20} />, title: 'SEO and AI-ready articles', desc: 'Reviews, comparisons and buying guides built to rank on Google and get quoted by AI answers.' },
  { icon: <Store size={20} />, title: 'Your own blog, forever', desc: 'A beautifully designed WordPress site that stays yours even if you leave. No lock-in.' },
  { icon: <Sparkles size={20} />, title: 'Thumbnails and designs with your face', desc: 'One product photo in, bright thumbnails and ready-to-post social designs out, with your own face.' },
  { icon: <ShieldCheck size={20} />, title: 'Your data stays yours', desc: 'MVP never uses or sells your personal data. It works from your content, nothing else.' },
]
function FeatureGrid() {
  return (
    <section id="features" className="px-5 sm:px-8 lg:px-12 py-20 sm:py-28" style={{ backgroundColor: C.band, borderTop: `1px solid ${C.borderSoft}`, borderBottom: `1px solid ${C.borderSoft}` }}>
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <Eyebrow>Everything in one place</Eyebrow>
          <h2 className="text-[36px] sm:text-[50px] lg:text-[56px] font-extrabold tracking-[-0.025em] leading-[1.02] mt-6" style={{ ...DISPLAY, color: C.text }}>
            One subscription replaces your whole stack.
          </h2>
          <p className="mt-5 text-[18px]" style={{ color: C.muted }}>The writer, the researcher, the editor, the social team and the link cloaker. All of it, and it sounds like you.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(f => (
            <div key={f.title} className="rounded-3xl p-7 transition-transform hover:-translate-y-0.5" style={{ backgroundColor: C.card, boxShadow: C.cardShadow }}>
              <span className="w-12 h-12 rounded-2xl grid place-items-center mb-5" style={{ backgroundColor: C.accentSoft, color: C.accentText }}>{f.icon}</span>
              <h3 className="text-[18px] font-extrabold mb-2" style={{ ...DISPLAY, color: C.text }}>{f.title}</h3>
              <p className="text-[15px] leading-relaxed" style={{ color: C.soft }}>{f.desc}</p>
            </div>
          ))}
        </div>
        <div className="text-center mt-12">
          <a href="/features" className="inline-flex items-center gap-1.5 text-[16px] font-bold" style={{ color: C.accentText }}>
            See every feature <ArrowRight size={16} />
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
    <section id="compare" className="px-5 sm:px-8 lg:px-12 py-20 sm:py-28">
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <Eyebrow>The honest comparison</Eyebrow>
          <h2 className="text-[36px] sm:text-[50px] lg:text-[56px] font-extrabold tracking-[-0.025em] leading-[1.02] mt-6" style={{ ...DISPLAY, color: C.text }}>
            One tool, or three or four.
          </h2>
          <p className="mt-5 text-[18px]" style={{ color: C.muted }}>Most affiliate tools do one slice of the job and make you pay the rest in your personal data. MVP does the whole job and never touches yours.</p>
        </div>
        <div className="rounded-3xl overflow-hidden" style={{ backgroundColor: C.card, boxShadow: C.cardShadow }}>
          <div className="grid grid-cols-[1fr_auto_auto]" style={{ backgroundColor: C.band }}>
            <div className="px-6 py-4 text-[12.5px] font-bold uppercase tracking-[0.1em]" style={{ color: C.faint }}>Feature</div>
            <div className="w-[100px] sm:w-[128px] px-2 py-4 text-center text-[15px] font-extrabold" style={{ ...DISPLAY, color: C.text }}>MVP</div>
            <div className="w-[100px] sm:w-[128px] px-2 py-4 text-center text-[13px] font-semibold" style={{ color: C.faint }}>The usual stack</div>
          </div>
          {COMPARE.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto] items-center" style={{ borderTop: `1px solid ${C.borderSoft}`, backgroundColor: r.highlight ? C.accentSoft : 'transparent' }}>
              <div className="px-6 py-4 text-[15px]" style={{ color: C.muted, fontWeight: r.highlight ? 700 : 500 }}>{r.label}</div>
              <div className="w-[100px] sm:w-[128px] px-2 py-4 flex items-center justify-center">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-white" style={{ backgroundColor: C.accent }}><Check size={15} strokeWidth={3} /></span>
              </div>
              <div className="w-[100px] sm:w-[128px] px-2 py-4 flex items-center justify-center">
                {r.them === 'some'
                  ? <span className="text-[12.5px] font-semibold" style={{ color: C.faint }}>Some</span>
                  : <span className="inline-flex items-center justify-center w-7 h-7 rounded-full" style={{ backgroundColor: C.band, color: C.faint }}><XIcon size={14} strokeWidth={2.5} /></span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─────────────────────────────── Pricing (one plan) ─────────────────────────────── */
// Pro is the only plan (SELLABLE_TIERS === ['pro']). One centered card. The
// current price and the Jan-1 increase both come from the constants.
const PRO_BULLETS = [
  'Your own blog, written in your real voice',
  'Video-to-blog, comparisons and buying guides',
  'Thumbnails and social designs with your own face',
  'Clips to TikTok, Instagram, Reels and YouTube Shorts',
  'Auto-post to X, TikTok, LinkedIn, Threads, Bluesky, Telegram, Pinterest and Facebook',
  'Passport geo-links, unlimited clicks, no per-click fees',
  'Creator Connections and partner programs in one place',
  'Multiple WordPress sites and team seats',
]
function Pricing() {
  const priceRising = !newPricesLive() && TIERS.pro.regularPrice > TIERS.pro.price
  return (
    <section id="pricing" className="px-5 sm:px-8 lg:px-12 py-20 sm:py-28" style={{ backgroundColor: C.band, borderTop: `1px solid ${C.borderSoft}`, borderBottom: `1px solid ${C.borderSoft}` }}>
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-12">
          <Eyebrow>Pricing</Eyebrow>
          <h2 className="text-[36px] sm:text-[50px] lg:text-[56px] font-extrabold tracking-[-0.025em] leading-[1.02] mt-6" style={{ ...DISPLAY, color: C.text }}>
            One plan. Everything in it.
          </h2>
          <p className="mt-5 text-[18px]" style={{ color: C.muted }}>No tiers to decode. Start with a free week, cancel anytime, and keep your WordPress site forever.</p>
        </div>

        <div className="relative rounded-3xl p-8 sm:p-10" style={{ backgroundColor: C.card, border: `1.5px solid ${C.accent}`, boxShadow: C.cardShadow }}>
          <div className="flex items-center gap-3 mb-2">
            <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl text-white" style={{ backgroundColor: C.accent }}><Rocket size={18} /></span>
            <h3 className="text-[26px] font-extrabold tracking-tight" style={{ ...DISPLAY, color: C.text }}>Pro</h3>
          </div>
          <p className="text-[15px] leading-snug mb-6" style={{ color: C.soft }}>Everything MVP does, in your voice, on a blog you own.</p>

          <div className="mb-6">
            <div className="flex items-baseline gap-2">
              <span className="text-[56px] font-extrabold tracking-[-0.02em] tabular-nums leading-none" style={{ ...DISPLAY, color: C.text }}>${TIERS.pro.price}</span>
              <span className="text-[16px] font-medium" style={{ color: C.soft }}>/month</span>
            </div>
            <p className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-bold rounded-full px-3 py-1" style={{ backgroundColor: C.accentSoft, color: C.accentText }}>
              <Sparkles size={14} /> {FREE_WEEK_DAYS} days free, then ${TIERS.pro.price}/month
            </p>
            {priceRising && (
              <p className="text-[12.5px] mt-3" style={{ color: C.faint }}>
                Lock in ${TIERS.pro.price}/month for life. The price rises to ${TIERS.pro.regularPrice}/month for new members on {PRICE_UP_DATE}.
              </p>
            )}
          </div>

          <a href="/signup?plan=pro" className="block w-full px-4 py-4 rounded-full text-center text-[16px] font-bold text-white transition-transform hover:-translate-y-px" style={{ backgroundColor: C.accent, boxShadow: C.glow }}>
            {PRIMARY_CTA}
          </a>
          <p className="text-[12px] text-center mt-3" style={{ color: C.faint }}>{FREE_WEEK_SENTENCE}</p>

          <ul className="flex flex-col gap-3 mt-7 pt-7" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
            {PRO_BULLETS.map((b, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[15px] leading-relaxed" style={{ color: C.muted }}>
                <Check size={17} strokeWidth={2.5} className="mt-0.5 flex-shrink-0" style={{ color: C.accent }} /> {b}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-[14px]" style={{ color: C.soft }}>
          <span className="inline-flex items-center gap-1.5"><Check size={15} style={{ color: C.ok }} /> Cancel anytime</span>
          <span className="inline-flex items-center gap-1.5"><Check size={15} style={{ color: C.ok }} /> Founder pricing locked for life</span>
          <span className="inline-flex items-center gap-1.5"><Check size={15} style={{ color: C.ok }} /> Your site stays yours</span>
        </div>
        <div className="mt-7 text-center">
          <a href="/pricing" className="inline-flex items-center gap-1.5 text-[16px] font-bold" style={{ color: C.accentText }}>
            See the full breakdown <ArrowRight size={16} />
          </a>
        </div>
      </div>
    </section>
  )
}

/* ─────────────────────── Proof (one slim line, not a section) ─────────────────────── */
function ProofLine() {
  return (
    <section className="px-5 sm:px-8 lg:px-12 py-20 sm:py-28">
      <div className="max-w-3xl mx-auto text-center">
        <p className="text-[26px] sm:text-[34px] font-extrabold tracking-tight leading-snug" style={{ ...DISPLAY, color: C.text }}>
          Built by creators who grew their own affiliate business past <span style={{ color: C.accentText }}>$3M a year</span>, and run it on MVP.
        </p>
        <p className="mt-5 text-[16px]" style={{ color: C.soft }}>Seb and Michelle, Gominplanet. We made the tool we wished existed, then opened it up.</p>
      </div>
    </section>
  )
}

/* ─────────────────────────────── Final CTA ─────────────────────────────── */
function FinalCTA() {
  return (
    <section className="px-5 sm:px-8 lg:px-12 py-20 sm:py-28" style={{ backgroundColor: C.band, borderTop: `1px solid ${C.borderSoft}` }}>
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="text-[40px] sm:text-[56px] lg:text-[64px] font-extrabold tracking-[-0.03em] leading-[1.0]" style={{ ...DISPLAY, color: C.text }}>
          Build the business{' '}
          <span style={{ background: C.grad, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>you own.</span>
        </h2>
        <p className="mt-6 text-[18px] leading-relaxed" style={{ color: C.muted }}>
          Every feature unlocked, free for {FREE_WEEK_DAYS} days. Cancel before day {FREE_WEEK_DAYS + 1} and you pay nothing. See if MVP fits before you spend a cent.
        </p>
        <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3.5">
          <a href="/signup?plan=pro" className="px-8 py-4 rounded-full text-[17px] font-bold text-white inline-flex items-center gap-2 transition-transform hover:-translate-y-px" style={{ backgroundColor: C.accent, boxShadow: C.glow }}>
            {PRIMARY_CTA} <ArrowRight size={18} />
          </a>
          <a href="/tour" className="px-8 py-4 rounded-full text-[17px] font-bold inline-flex items-center gap-2" style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, color: C.text }}>
            Take the tour
          </a>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[14px]" style={{ color: C.soft }}>
          <span className="inline-flex items-center gap-1.5"><Check size={15} style={{ color: C.ok }} /> {FREE_WEEK_DAYS} days free</span>
          <span className="inline-flex items-center gap-1.5"><Check size={15} style={{ color: C.ok }} /> Cancel anytime</span>
          <span className="inline-flex items-center gap-1.5"><Check size={15} style={{ color: C.ok }} /> Your site stays yours</span>
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
    <footer className="px-5 sm:px-8 lg:px-12 pt-16 pb-28 sm:pb-14" style={{ backgroundColor: C.bg, borderTop: `1px solid ${C.borderSoft}` }}>
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-8 pb-12">
          <div className="col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2.5 mb-2.5">
              <NextImage src="/png/mvp-affiliate-trial.png" alt="MVP Affiliate" width={28} height={28} className="w-7 h-7 rounded-lg" />
              <span className="text-[16px] font-extrabold tracking-tight" style={{ ...DISPLAY, color: C.text }}>MVP Affiliate</span>
            </div>
            <p className="text-[13px] leading-relaxed max-w-[230px]" style={{ color: C.soft }}>One review video, every output, in your voice, on a blog you own.</p>
          </div>
          {cols.map(col => (
            <div key={col.title}>
              <p className="text-[11.5px] uppercase tracking-[0.14em] mb-4 font-bold" style={{ color: C.text }}>{col.title}</p>
              <ul className="flex flex-col gap-3">
                {col.links.map(l => (
                  <li key={l.href}><a href={l.href} className="text-[13.5px] transition-colors hover:opacity-70" style={{ color: C.soft }}>{l.label}</a></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="pt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
          <p className="text-[11.5px]" style={{ color: C.faint }}>© {new Date().getFullYear()} MVP Affiliate. All rights reserved.</p>
          <p className="text-[11.5px]" style={{ color: C.faint }}>Your WordPress site stays yours, forever.</p>
        </div>
      </div>
    </footer>
  )
}
