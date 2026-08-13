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
  Compass, HeartHandshake, PenLine, Share2, Globe, TrendingUp, Wand2,
  Youtube, ShieldCheck, Zap, Upload, X as XIcon, Check, Quote,
  Crown, Rocket,
  LayoutTemplate, BadgePercent, Pin,
  ShoppingBag, Store, ShoppingCart, Search,
  Radar, Coins, Scissors, Megaphone, Users, Inbox, Signpost,
} from 'lucide-react'
import NextImage from 'next/image'
import { FAQSection, StickyBottomBar } from '@/components/landing/islands'
import AudienceSplit from '@/components/landing/AudienceSplit'

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
      <Nav />
      {/* Audience splitter — the first thing a cold visitor sees. Routes the two
          very different buyers (Amazon storefront creators vs full-suite
          marketers) before the generic hero, so neither reads copy meant for the
          other. Amazon side jumps to its own sales page; suite side scrolls on. */}
      <AudienceSplit />
      {/* One accent (purple) + lots of white, logie5-style — with a few dark
          emphasis bands to break up the page and make the flagship features
          punch. The banded sections were designed for a dark background. */}
      <Hero />
      <PlatformBar />
      <WhyMvpSection />
      <ThumbnailShowcase />
      <ComparisonSection />
      <FreeResearchSection />
      <RolesSection />
      <WorkflowSection />
      <DarkBand bg="linear-gradient(160deg, #1A0B2E 0%, #2A0E3A 45%, #3A0E22 100%)">
        <DealRadarSection />
      </DarkBand>
      <AsinSection />
      <BeforeAfterSection />
      <GroundedSection />
      <DarkBand bg="linear-gradient(160deg, #120A2E 0%, #1E0E3E 100%)">
        <DiscoverabilitySection />
      </DarkBand>
      <BrandedSiteSection />
      <BusinessLayerSection />
      <PartnerNetworksSection />
      <CapabilitiesSection />
      <PricingSection />
      <BundleMathSection />
      <ProofSection />
      <FAQSection />
      <DarkBand bg="linear-gradient(160deg, #16091E 0%, #2A0E3A 55%, #3A0E22 100%)">
        <FinalCTASection />
      </DarkBand>
      <Footer />
      <StickyBottomBar />
    </div>
  )
}

/** Free research showcase — the top-of-funnel hook, placed right after the hero.
 *  Everything here is free on every plan, no card, no setup: finding products is
 *  free, publishing them is what the paid plans add. */
const FREE_TOOLS = [
  { icon: <Search size={18} />, label: 'Amazon Product Research', line: 'Filter the whole Amazon catalogue by sales volume, rating, price, review-to-sales ratio and video competition. The signals that separate a product worth reviewing from a dud.' },
  { icon: <Radar size={18} />, label: 'Deal Radar', line: 'Live, price-history-verified Amazon deals. See what genuinely dropped, not fake "was" prices, with the real high and low behind every discount.' },
  { icon: <ShoppingBag size={18} />, label: 'Levanta + PartnerBoost', line: 'Scout your own connected Levanta and PartnerBoost campaigns for the products worth promoting, above your standard Amazon tag.' },
  { icon: <Store size={18} />, label: 'Creator Connections', line: 'Already have CC access? Search the full campaign catalogue in one place, with our free Scout extension.' },
]

/** A full-width feature illustration placed inside a section, between its header
 *  and its content. Used to drop the marketing banners into their matching
 *  sections (curated — not every banner, to keep the page uncluttered). */
function FeatureBanner({ src, w, h, alt }: { src: string; w: number; h: number; alt: string }) {
  return (
    <div className="max-w-4xl mx-auto mb-12">
      <NextImage
        src={src}
        alt={alt}
        width={w}
        height={h}
        loading="lazy"
        className="w-full h-auto rounded-2xl border"
        style={{ borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}
      />
    </div>
  )
}

function FreeResearchSection() {
  return (
    <section id="free-research" className="px-6 lg:px-8 pt-16 sm:pt-24 pb-16 sm:pb-28 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{ backgroundColor: 'rgba(52,199,89,0.12)', color: '#34c759', border: '1px solid rgba(52,199,89,0.28)' }}
          >
            <Sparkles size={10} /> Free on every plan · even the free tier
          </span>
          <h2 className="text-[40px] sm:text-[56px] font-extrabold tracking-[-0.03em] leading-[1.0] mb-5" style={{ color: 'var(--text)' }}>
            One research engine.<br />
            <span
              style={{
                background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Every opportunity, found for you.
            </span>
          </h2>
          <p className="text-[16px] sm:text-[18px] leading-relaxed max-w-2xl mx-auto" style={{ color: 'var(--text-soft)' }}>
            MVP&apos;s research algorithm scans the <span style={{ color: 'var(--text)' }}>whole Amazon catalogue</span>, every <span style={{ color: 'var(--text)' }}>live deal</span>, and the <span style={{ color: 'var(--text)' }}>Creator Connections</span> campaign board — then one intuitive filter sorts them by sales volume, rating, price, real discount, commission and competition. The winners rise to the top. <span style={{ color: 'var(--text)' }}>Every plan gets the full research engine — including the free tier.</span> No card, no trial clock.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FREE_TOOLS.map((t) => (
            <RoleCard key={t.label} icon={t.icon} label={t.label} line={t.line} />
          ))}
        </div>
        <FeatureBanner src="/png/mvppicks.png" w={1536} h={1024} alt="MVP Picks is a shortlist filter — real demand, decent rating, price worth your commission, open video slot" />

        {/* Hard number — what this research stack costs everywhere else vs $0 here. */}
        <div className="mt-9 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[14px]" style={{ color: 'var(--text-soft)' }}>
          <span>Everywhere else you&apos;d pay</span>
          <span className="line-through">Jungle Scout $49</span>
          <span aria-hidden>·</span>
          <span className="line-through">Helium 10 $79</span>
          <span aria-hidden>·</span>
          <span className="line-through">Keepa $19</span>
          <span className="font-semibold" style={{ color: 'var(--text)' }}>= ~$147/mo.</span>
          <span className="font-bold" style={{ color: '#34c759' }}>Here it&apos;s free.</span>
        </div>
        <div className="text-center mt-10">
          <a
            href="/signup"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-[15px] font-semibold text-white transition-transform hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)' }}
          >
            Start free, no card <ArrowRight size={16} />
          </a>
        </div>
      </div>
    </section>
  )
}

/** Section 3 — "Roles MVP plays".
 *
 *  Frames the product as a TEAM of specialists you already have on payroll
 *  the moment you subscribe. Eight roles, 4×2 grid, glass cards. Each card:
 *  icon → role label → one product-led line that says what MVP actually
 *  does for that role.
 *
 *  Copy intent: every line passes the "would a creator hire this?" test —
 *  concrete deliverable, no vague benefit-speak.
 */
function RolesSection() {
  return (
    <section id="roles" className="px-6 lg:px-8 pt-16 sm:pt-24 pb-16 sm:pb-28 relative">
      <div className="max-w-6xl mx-auto">
        {/* Section header — eyebrow + headline + sub. Centered, same
            rhythm as the hero but slightly tighter. */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{
              backgroundColor: 'rgba(124,58,237,0.12)',
              color: '#9D6BFF',
              border: '1px solid rgba(124,58,237,0.25)',
            }}
          >
            <Sparkles size={10} />
            One hub. Many hats.
          </span>
          <h2
            className="text-[40px] sm:text-[54px] font-extrabold tracking-[-0.03em] leading-[1.02] mb-5"
            style={{ color: 'var(--text)' }}
          >
            MVP is many roles.
            <br />
            <span
              style={{
                background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              One subscription.
            </span>
          </h2>
          <p
            className="text-[16px] sm:text-[17px] leading-relaxed max-w-2xl mx-auto"
            style={{ color: 'var(--text-soft)' }}
          >
            Plans, writes, schedules, optimizes, publishes, so you focus on what only you can do.
          </p>
        </div>

        {/* 4×2 grid of role cards. Drops to 2×4 on tablet, 1×8 on phone. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ROLES.map((role) => (
            <RoleCard key={role.label} {...role} />
          ))}
        </div>
      </div>
    </section>
  )
}

/** The "business layer" — content-first doesn't mean content-ONLY. After the
 *  content engine, this section shows how MVP helps you SOURCE, EARN and SCALE:
 *  the Source & Earn finders (all paid tiers), brand deals (live), deal-moment
 *  posts (Studio+), and VA seats (Pro). */
const BUSINESS_CARDS: Array<{ icon: React.ReactNode; title: string; body: string; pro?: boolean }> = [
  {
    icon: <Search size={18} />,
    title: 'Find products worth promoting',
    body: 'Source & Earn scans Amazon Creator Connections, Levanta, and PartnerBoost for the campaigns and products actually worth your time — vetted for commission, demand, product quality, and review visibility. Message the brand right from the results, then turn any winner into a fact-grounded post in one click.',
  },
  {
    icon: <HeartHandshake size={18} />,
    title: 'Land brand deals',
    body: 'MVP writes the pitch — researches the brand, cites your real track record and reach, and attaches your media kit. The founder’s own outreach method, built in. 5–100 pitches a month by tier.',
  },
  {
    icon: <Zap size={18} />,
    title: 'Cash in on deal moments',
    body: 'Paste an Amazon deal link + promo code — MVP writes a timely deal post with a countdown thumbnail, an end-date countdown, and your code wired into every CTA. Bulk-import a CSV to schedule a month of deals at once. (Studio+)',
  },
  {
    icon: <Rocket size={18} />,
    title: 'Scale with a team',
    body: 'Add Virtual Assistants with granular permissions — they draft and publish, you keep approval control. Up to 3 seats.',
    pro: true,
  },
]

function BusinessLayerSection() {
  return (
    <section id="business" className="px-6 lg:px-8 pt-16 sm:pt-24 pb-16 sm:pb-28 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)', border: '1px solid rgba(124,58,237,0.25)' }}
          >
            <BadgePercent size={10} />
            The business layer
          </span>
          <h2 className="text-[40px] sm:text-[54px] font-extrabold tracking-[-0.03em] leading-[1.02] mb-5" style={{ color: 'var(--text)' }}>
            Content is step one.
            <br />
            <span style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              MVP runs the business around it.
            </span>
          </h2>
          <p className="text-[16px] sm:text-[17px] leading-relaxed max-w-2xl mx-auto" style={{ color: 'var(--text-soft)' }}>
            Discoverable content earns. MVP closes the loop — the products worth promoting, the brands you pitch, the deals worth your time, and the team that scales it.
          </p>
        </div>

        <FeatureBanner src="/png/cc-mvpblock.png" w={1536} h={1024} alt="Amazon Creator Connections inside MVP — connect your account, get verified, unlock invited-creator brand campaigns" />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {BUSINESS_CARDS.map((c) => (
            <div key={c.title} className="rounded-2xl border p-6" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
                  {c.icon}
                </span>
                {c.pro && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
                    Pro
                  </span>
                )}
              </div>
              <h3 className="text-[16px] font-semibold mb-1.5" style={{ color: 'var(--text)' }}>{c.title}</h3>
              <p className="text-[14px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Discoverability / AEO section — the capstone of the content-first pitch.
 *  Search engines + AI answer engines (Google AI Overviews, ChatGPT, Perplexity)
 *  answer before the click; this section shows how MVP's content is built to be
 *  the cited source. Every point maps to a real shipped feature (answer-first
 *  H2s, schema enrichment, fact-grounding, auto-indexing). */
const AEO_POINTS: Array<{ icon: React.ReactNode; title: string; body: string }> = [
  { icon: <Zap size={18} />, title: 'Answer-first structure', body: 'Every section opens with the answer — the exact shape AI engines lift into their results.' },
  { icon: <LayoutTemplate size={18} />, title: 'Schema-rich', body: 'Product, Review & FAQ schema so Google and AI read your verdict, rating, and specs — not just your prose.' },
  { icon: <Quote size={18} />, title: 'Grounded = citable', body: 'Real specs and real experience from your video. Engines quote sources they can trust, not generic AI filler.' },
  { icon: <TrendingUp size={18} />, title: 'Auto-indexed', body: 'Submitted to Google the moment it publishes, so it gets discovered — and cited — fast.' },
]

/** Amazon Deal Radar + the discover → post → shop loop — the flagship 2026
 *  additions. Punchy, benefit-first, mapping to shipped features: Deal Radar,
 *  Creator Connections cross-check, one-click blog/social posts, the shoppable
 *  Link-in-Bio page, and auto Instagram Stories. */
const DEAL_RADAR_POINTS: Array<{ icon: React.ReactNode; title: string; body: string }> = [
  { icon: <Radar size={18} />, title: 'Live deals, verified real', body: 'Amazon price drops in your niche, refreshed around the clock. We check each deal’s real price history — so you only promote a genuine low, never a fake markdown.' },
  { icon: <Coins size={18} />, title: 'Spot the double wins', body: 'Every deal is cross-checked against Creator Connections, Levanta & PartnerBoost — instantly see the ones paying you an elevated bounty on top of the sale.' },
  { icon: <Zap size={18} />, title: 'One click → content', body: 'Turn any deal into a full SEO blog post or a native post across your socials — your affiliate link (Geniuslink-wrapped) attached and the disclosure handled for you.' },
  { icon: <ShoppingBag size={18} />, title: 'Stories, without the hassle', body: 'Post Instagram Stories straight from your desktop — no phone, no copy-paste — each with a built-in “link in bio” call-to-action. It points to your shoppable Shop page, auto-filled from your picks. The whole discover → post → shop loop, closed.' },
]

function DealRadarSection() {
  return (
    <section id="deal-radar" className="px-6 lg:px-8 pt-16 sm:pt-24 pb-16 sm:pb-28 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{ backgroundColor: 'rgba(249,115,22,0.14)', color: '#FDBA74', border: '1px solid rgba(249,115,22,0.3)' }}
          >
            <Zap size={10} />
            New — Amazon Deal Radar
          </span>
          <h2 className="text-[40px] sm:text-[54px] font-extrabold tracking-[-0.03em] leading-[1.02] mb-5" style={{ color: 'var(--text)' }}>
            You’re leaving commissions on the table.
            <br />
            <span style={{ background: 'linear-gradient(135deg, #F97316 0%, #C026D3 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              MVP finds them for you.
            </span>
          </h2>
          <p className="text-[16px] sm:text-[17px] leading-relaxed max-w-2xl mx-auto" style={{ color: 'var(--text-soft)' }}>
            Right now there are price-verified deals — and elevated-bounty campaigns — live in your niche that you’re just not promoting, because finding them is the grind. Deal Radar scans every program you’re in, <span style={{ color: 'var(--text)' }}>scores each opportunity 0–100</span>, and hands you the winners ready to publish. One click turns any into an SEO post or a native social post; your Shop page and auto Instagram Stories close the sale.
          </p>
        </div>

        {/* Signature showcase — a real-looking deal card led by the Opportunity
            Score, next to the "found money" pitch. */}
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center mb-16">
          <DealRadarCardMock />
          <div>
            <h3 className="text-[22px] sm:text-[26px] font-semibold tracking-tight mb-4" style={{ color: 'var(--text)' }}>
              One number tells you what to promote.
            </h3>
            <p className="text-[15px] leading-relaxed mb-5" style={{ color: 'var(--text-soft)' }}>
              Every deal gets an <strong style={{ color: 'var(--text)' }}>Opportunity Score</strong> — a single 0–100 read that blends discount depth, whether the drop is genuine, real monthly demand, review count and your payout. Start at the top and you’re always promoting the strongest deal first, not guessing.
            </p>
            <ul className="space-y-3">
              {[
                { icon: <ShieldCheck size={15} />, t: 'Verified real', d: 'Checked against real price history — never a fake “40% off.”' },
                { icon: <Coins size={15} />, t: 'Double wins', d: 'Deals that are on sale AND paying an elevated Creator Connections, Levanta or PartnerBoost bounty at once.' },
                { icon: <Zap size={15} />, t: 'One click to content', d: 'Turn any pick into an SEO post or a native social post — link + disclosure handled.' },
              ].map((r) => (
                <li key={r.t} className="flex gap-3">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0" style={{ backgroundColor: 'rgba(249,115,22,0.14)', color: '#F97316' }}>{r.icon}</span>
                  <p className="text-[14px] leading-snug" style={{ color: 'var(--text-soft)' }}>
                    <strong style={{ color: 'var(--text)' }}>{r.t}.</strong> {r.d}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Discover → Post → Shop flow */}
        <div className="flex items-center justify-center gap-2 sm:gap-3 mb-10 text-[12px] sm:text-[13px] font-semibold" style={{ color: 'var(--text-soft)' }}>
          <span className="inline-flex items-center gap-1.5"><Search size={14} style={{ color: '#FDBA74' }} /> Discover</span>
          <ArrowRight size={13} style={{ color: 'var(--text-faint)' }} />
          <span className="inline-flex items-center gap-1.5"><Send size={14} style={{ color: '#9D6BFF' }} /> Post</span>
          <ArrowRight size={13} style={{ color: 'var(--text-faint)' }} />
          <span className="inline-flex items-center gap-1.5"><ShoppingBag size={14} style={{ color: '#F472B6' }} /> Shop</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {DEAL_RADAR_POINTS.map((p) => (
            <div key={p.title} className="rounded-2xl border p-6" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl mb-3" style={{ backgroundColor: 'rgba(249,115,22,0.14)', color: '#FDBA74' }}>
                {p.icon}
              </span>
              <h3 className="text-[15px] font-semibold mb-1.5" style={{ color: 'var(--text)' }}>{p.title}</h3>
              <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{p.body}</p>
            </div>
          ))}
        </div>

        {/* Link in bio — one shareable, self-updating URL. Explained on its own
            so it reads as a real feature, not a footnote to Stories. */}
        <div className="mt-8 rounded-2xl border px-6 py-6 flex flex-col sm:flex-row items-start gap-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
          <span className="inline-flex items-center justify-center w-12 h-12 rounded-xl flex-shrink-0 text-white" style={{ background: 'linear-gradient(135deg,#7C3AED,#C026D3)' }}>
            <ShoppingBag size={22} />
          </span>
          <div>
            <p className="text-[19px] font-bold" style={{ color: 'var(--text)' }}>One link in bio. Always up to date.</p>
            <p className="mt-1.5 text-[15px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
              MVP builds you one clean, easy-to-manage URL — <span style={{ color: 'var(--text)' }}>your own shoppable link-in-bio page</span> — to drop into your Instagram, TikTok and YouTube bios. It fills itself with your latest reviews, deals and picks, so every visitor lands on a live page of exactly what you&apos;re promoting right now. Set it once; it updates itself. No Linktree, no extra subscription, no manual editing.
            </p>
          </div>
        </div>

        <div className="text-center mt-10">
          <a href="/signup" className="px-5 py-3 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-[14px] font-semibold text-white inline-flex items-center gap-2 transition-colors shadow-[0_4px_16px_rgba(124,58,237,0.3)]">
            Start finding deals
            <ArrowRight size={14} />
          </a>
        </div>
      </div>
    </section>
  )
}

/** A stylized Deal Radar card for the landing — led by the Opportunity Score
 *  (the signature metric), with the verified-real check and a double-win
 *  bounty. Pure markup; theme-aware. */
function DealRadarCardMock() {
  return (
    <div className="relative mx-auto w-full max-w-[420px]">
      <div aria-hidden className="absolute -inset-6 pointer-events-none" style={{ background: 'radial-gradient(55% 55% at 50% 40%, rgba(249,115,22,0.22), transparent 70%)', filter: 'blur(22px)' }} />
      <div className="relative rounded-2xl border overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', boxShadow: '0 30px 60px -22px rgba(24,24,40,0.4)' }}>
        {/* Product image area + score badge */}
        <div className="relative h-40 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.12), rgba(192,38,211,0.12))' }}>
          <ShoppingCart size={40} style={{ color: 'var(--text-faint)' }} />
          <span className="absolute top-3 left-3 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg inline-flex items-center gap-1 text-white" style={{ background: 'linear-gradient(135deg, #F97316, #C026D3)' }}>
            <Zap size={11} /> Top pick
          </span>
          <div className="absolute top-3 right-3 flex flex-col items-center justify-center w-14 h-14 rounded-2xl text-white" style={{ background: 'linear-gradient(135deg, #10B981, #059669)', boxShadow: '0 8px 20px -6px rgba(16,185,129,0.6)' }}>
            <span className="text-[20px] font-bold leading-none">92</span>
            <span className="text-[8px] font-semibold uppercase tracking-wider opacity-90">score</span>
          </div>
        </div>
        {/* Body */}
        <div className="p-4">
          <p className="text-[14px] font-semibold leading-snug mb-2" style={{ color: 'var(--text)' }}>Ninja Air Fryer Pro 6-Qt</p>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-[20px] font-bold" style={{ color: 'var(--text)' }}>$89.99</span>
            <span className="text-[13px] line-through" style={{ color: 'var(--text-faint)' }}>$159.99</span>
            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(249,115,22,0.15)', color: '#F97316' }}>44% off</span>
          </div>
          <div className="flex items-center gap-1.5 text-[12px] font-medium mb-1.5" style={{ color: '#10B981' }}>
            <ShieldCheck size={13} /> Lowest price in 12 months — verified
          </div>
          <div className="flex items-center gap-1.5 text-[12px] font-medium mb-3" style={{ color: '#7C3AED' }}>
            <Coins size={13} /> +8% Creator Connections bounty
          </div>
          <div className="flex gap-2">
            <span className="flex-1 text-center text-[12px] font-semibold py-2 rounded-lg text-white" style={{ background: '#7C3AED' }}>Make blog post</span>
            <span className="flex-1 text-center text-[12px] font-semibold py-2 rounded-lg border" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Quick post</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function DiscoverabilitySection() {
  return (
    <section id="discoverability" className="px-6 lg:px-8 pt-16 sm:pt-24 pb-16 sm:pb-28 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)', border: '1px solid rgba(124,58,237,0.25)' }}
          >
            <Sparkles size={10} />
            Found by Google and AI
          </span>
          <h2 className="text-[40px] sm:text-[54px] font-extrabold tracking-[-0.03em] leading-[1.02] mb-5" style={{ color: 'var(--text)' }}>
            Search changed.
            <br />
            <span style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Be the source AI quotes.
            </span>
          </h2>
          <p className="text-[16px] sm:text-[17px] leading-relaxed max-w-2xl mx-auto" style={{ color: 'var(--text-soft)' }}>
            Google answers right in the results now. ChatGPT and Perplexity answer before the click. MVP writes every review to be the source those engines pull from — so you still show up when nobody clicks a blue link.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {AEO_POINTS.map((p) => (
            <div key={p.title} className="rounded-2xl border p-6" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl mb-3" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
                {p.icon}
              </span>
              <h3 className="text-[15px] font-semibold mb-1.5" style={{ color: 'var(--text)' }}>{p.title}</h3>
              <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

interface Role {
  icon: React.ReactNode
  label: string
  line: string
}

const ROLES: Role[] = [
  {
    icon: <Compass size={18} />,
    label: 'Planner',
    line: 'See your whole content pipeline. Plan a month in one view.',
  },
  {
    icon: <Calendar size={18} />,
    label: 'Scheduler',
    line: 'Schedule a week of content and let it publish itself, right on time.',
  },
  {
    icon: <HeartHandshake size={18} />,
    label: 'Collaborator',
    line: 'Your AI partner, trained on your voice. Always ready to think with you.',
  },
  {
    icon: <PenLine size={18} />,
    label: 'Script writer',
    line: 'Long-form video scripts in your voice. From idea to teleprompter in minutes.',
  },
  {
    icon: <Share2 size={18} />,
    label: 'Social generator',
    line: 'Native posts for Facebook, Instagram, Threads, Pinterest, X, LinkedIn, Bluesky, Telegram & TikTok — each written for that feed.',
  },
  {
    icon: <Globe size={18} />,
    label: 'WordPress publisher',
    line: 'Publish straight to your WordPress. Pro: up to 10 sites from one account.',
  },
  {
    icon: <TrendingUp size={18} />,
    label: 'SEO optimizer',
    line: 'Per-post SEO scoring + one-click "fix all" across your entire catalog.',
  },
  {
    icon: <Wand2 size={18} />,
    label: 'Thumbnail maker',
    line: 'Click-worthy thumbnails and titles, scored best-first — AI-generated with your face and the product.',
  },
]

function RoleCard({ icon, label, line }: Role) {
  return (
    <div
      className="mvp-hover-border rounded-2xl border p-5 h-full flex flex-col gap-3 transition-all duration-200 hover:-translate-y-0.5"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{
          background: 'linear-gradient(135deg, rgba(124,58,237,0.18), rgba(192,38,211,0.14))',
          color: '#C4B5FD',
          border: '1px solid rgba(124,58,237,0.25)',
        }}
      >
        {icon}
      </div>
      <h3 className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
        {label}
      </h3>
      <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
        {line}
      </p>
    </div>
  )
}

/** "No channel? Start from an ASIN" — showcases the non-YouTube path. Many
 *  affiliate creators don't make video; MVP still builds the article types
 *  that win buyer-intent search from nothing but an Amazon product ID.
 *  Availability notes are accurate to the tier/volume gates: Comparisons are
 *  on every plan, Deals Hub is Studio+, Buying Guides unlock as the catalogue
 *  grows. */
const ASIN_OUTPUTS: { icon: React.ReactNode; title: string; body: string; tag: string }[] = [
  {
    icon: <Scale size={18} />,
    title: 'Comparison articles',
    body: 'Drop two or more ASINs and MVP researches each, ranks them, and writes the head-to-head — verdict box, pros & cons, and a spec table. The exact article shoppers search for right before they buy.',
    tag: 'Pro',
  },
  {
    icon: <BadgePercent size={18} />,
    title: 'Deals Hub',
    body: 'A live deals page on your own blog. Drop ASINs and MVP writes the deal posts and keeps the hub fresh — built to catch seasonal and price-drop traffic.',
    tag: 'Studio & Pro',
  },
  {
    icon: <Bookmark size={18} />,
    title: 'Buying guides',
    body: '“Best [category]” round-ups MVP assembles from your catalogue plus fresh research — the format Google ranks at the top for buyer-intent searches.',
    tag: 'Pro',
  },
]

function AsinSection() {
  return (
    <section id="asin" className="px-6 lg:px-8 pt-12 pb-16 sm:pb-28 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)', border: '1px solid rgba(124,58,237,0.25)' }}
          >
            <Bookmark size={10} />
            No channel? No problem
          </span>
          <h2 className="text-[40px] sm:text-[54px] font-extrabold tracking-[-0.03em] leading-[1.02] mb-5" style={{ color: 'var(--text)' }}>
            Don&apos;t make videos?{' '}
            <span style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Start from a link.
            </span>
          </h2>
          <p className="text-[16px] sm:text-[17px] leading-relaxed max-w-2xl mx-auto" style={{ color: 'var(--text-soft)' }}>
            MVP isn&apos;t only for YouTubers. Paste a link to any product or service — an online store, a brand page, a SaaS, or an Amazon ASIN — and MVP builds the articles that win affiliate search: researched, fact-grounded, branded, and published to a blog you own. No camera required.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {ASIN_OUTPUTS.map((o) => (
            <div key={o.title} className="rounded-2xl border p-6 flex flex-col" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl mb-3" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
                {o.icon}
              </span>
              <h3 className="text-[15px] font-semibold mb-1.5" style={{ color: 'var(--text)' }}>{o.title}</h3>
              <p className="text-[13.5px] leading-relaxed flex-1" style={{ color: 'var(--text-soft)' }}>{o.body}</p>
              <span className="mt-4 inline-flex self-start items-center px-2 py-0.5 rounded-full text-[10.5px] font-medium uppercase tracking-wide" style={{ backgroundColor: 'var(--surface-bright)', color: 'var(--text-soft)', border: '1px solid var(--border)' }}>
                {o.tag}
              </span>
            </div>
          ))}
        </div>
        <p className="text-center mt-10 text-[13px]" style={{ color: 'var(--text-faint)' }}>
          Drop a link — MVP does the research, ranking and writing.
        </p>
      </div>
    </section>
  )
}

/** Section — "Earn beyond the Amazon tag." Multi-network affiliate: MVP plugs
 *  into Levanta + PartnerBoost (connect your own key) on top of the always-on
 *  native Amazon tag. Mirrors AsinSection's layout. Included on all paid tiers. */
function PartnerNetworksSection() {
  const networks = [
    { icon: <ShoppingBag size={18} />, title: 'MVP x Levanta', tag: 'Amazon creator network', body: 'Often higher payouts than the standard Associates rate — MVP mints a real commissionable tracking link for every product.' },
    { icon: <Store size={18} />, title: 'MVP x PartnerBoost', tag: 'Walmart · Amazon · DTC', body: 'One login to brands across multiple retailers. Join a program, then publish a cloaked-link review in your voice.' },
    { icon: <ShoppingCart size={18} />, title: 'Amazon Associates', tag: 'Always on', body: 'Your standard Amazon tag works out of the box — no connection or extra setup needed.' },
  ]
  return (
    <section id="networks" className="px-6 lg:px-8 pt-12 pb-16 sm:pb-28 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)', border: '1px solid rgba(124,58,237,0.25)' }}
          >
            <Sparkles size={10} />
            Multi-network affiliate
          </span>
          <h2 className="text-[40px] sm:text-[54px] font-extrabold tracking-[-0.03em] leading-[1.02] mb-5" style={{ color: 'var(--text)' }}>
            Earn beyond the{' '}
            <span style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Amazon tag.
            </span>
          </h2>
          <p className="text-[16px] sm:text-[17px] leading-relaxed max-w-2xl mx-auto" style={{ color: 'var(--text-soft)' }}>
            Connect your affiliate networks and MVP turns your partnered brands&apos; products into published reviews — with a real commissionable link, written in your voice. Included on the Creator, Studio &amp; Pro plans.
          </p>
        </div>

        <FeatureBanner src="/png/levanta-pb.png" w={1672} h={941} alt="Levanta and PartnerBoost live inside MVP — search products across multiple affiliate networks in one place" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {networks.map((o) => (
            <div key={o.title} className="rounded-2xl border p-6 flex flex-col" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl mb-3" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
                {o.icon}
              </span>
              <h3 className="text-[15px] font-semibold mb-1.5" style={{ color: 'var(--text)' }}>{o.title}</h3>
              <p className="text-[13.5px] leading-relaxed flex-1" style={{ color: 'var(--text-soft)' }}>{o.body}</p>
              <span className="mt-4 inline-flex self-start items-center px-2 py-0.5 rounded-full text-[10.5px] font-medium uppercase tracking-wide" style={{ backgroundColor: 'var(--surface-bright)', color: 'var(--text-soft)', border: '1px solid var(--border)' }}>
                {o.tag}
              </span>
            </div>
          ))}
        </div>
        <p className="text-center mt-10 text-[13px]" style={{ color: 'var(--text-faint)' }}>
          Bring your own affiliate accounts — connect a key once, then it&apos;s one click per product.
        </p>
      </div>
    </section>
  )
}

/** Section 4 — "The 4-minute workflow."
 *
 *  Horizontal timeline of 4 numbered steps with a connecting line through
 *  the center. The line uses a violet→fuchsia gradient that fades at both
 *  ends so it visually starts at step 1 and ends at step 4 without
 *  dangling past either side.
 *
 *  Layout:
 *  - Desktop (lg): 4 columns side-by-side, connecting line is horizontal
 *    behind the number circles.
 *  - Mobile/tablet: stacked vertically. Connecting line becomes a vertical
 *    bar on the left, number circles offset right.
 *
 *  Number circles use position: relative + z-index to sit on top of the
 *  line. Each step card is a glass card matching Section 3's rhythm.
 */
function WorkflowSection() {
  return (
    <section id="how-it-works" className="px-6 lg:px-8 pt-12 pb-16 sm:pb-28 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{
              backgroundColor: 'rgba(124,58,237,0.12)',
              color: '#9D6BFF',
              border: '1px solid rgba(124,58,237,0.25)',
            }}
          >
            <Zap size={10} />
            How it works
          </span>
          <h2
            className="text-[40px] sm:text-[54px] font-extrabold tracking-[-0.03em] leading-[1.02] mb-5"
            style={{ color: 'var(--text)' }}
          >
            The{' '}
            <span
              style={{
                background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              4-minute
            </span>{' '}
            workflow.
          </h2>
          <p
            className="text-[16px] sm:text-[17px] leading-relaxed max-w-2xl mx-auto"
            style={{ color: 'var(--text-soft)' }}
          >
            From a video — or just a product or service link — to a full content set, fact-grounded and in your voice.
          </p>
        </div>

        <FeatureBanner src="/png/mvp-blogposts.png" w={1536} h={1024} alt="MVP turns a YouTube video into a full blog post, the smart way — pick the video, MVP writes it, you skim and publish" />

        {/* Timeline container — relative so the line can be absolutely
            positioned. The line lives in two flavors that toggle by media
            query so we get one horizontal track on desktop and one vertical
            track on mobile. */}
        <div className="relative">
          {/* Horizontal line (desktop only). Sits at ~y=44px to align with
              the center of the number circles. Fades at both edges so it
              visually originates from step 1 and dies into step 4. */}
          <div
            className="hidden lg:block absolute top-[44px] left-[12.5%] right-[12.5%] h-px"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(124,58,237,0.55) 12%, rgba(192,38,211,0.55) 88%, transparent 100%)',
            }}
            aria-hidden
          />
          {/* Vertical line (mobile/tablet). Same gradient logic, rotated. */}
          <div
            className="lg:hidden absolute top-12 bottom-12 left-[26px] w-px"
            style={{
              background:
                'linear-gradient(180deg, transparent 0%, rgba(124,58,237,0.55) 8%, rgba(192,38,211,0.55) 92%, transparent 100%)',
            }}
            aria-hidden
          />

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 lg:gap-4">
            {STEPS.map((step, i) => (
              <StepCard key={step.title} index={i + 1} step={step} />
            ))}
          </div>
        </div>

        {/* Footnote below the timeline — sets expectations and re-affirms
            the "no copy-paste" pattern. */}
        <p
          className="text-center mt-12 text-[13px]"
          style={{ color: 'var(--text-faint)' }}
        >
          One channel. One workflow. Nine outputs. Zero copy-paste.
        </p>
      </div>
    </section>
  )
}

interface Step {
  icon: React.ReactNode
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    icon: <Youtube size={18} />,
    title: 'Pick a video — or drop a link.',
    body: 'Your YouTube channel is synced (transcript, product, gallery and timestamps pre-loaded) — pick a video and go. No channel? Paste any product or service link (a store page, a SaaS, or an Amazon ASIN) and MVP researches it itself. Either way, no copy-paste.',
  },
  {
    icon: <ShieldCheck size={18} />,
    title: 'It grounds everything in real facts.',
    body: 'No invented features. No fabricated stories. Just what you actually said in the video, pulled straight from the transcript and the scraped product data.',
  },
  {
    icon: <Sparkles size={18} />,
    title: 'Generate 9 outputs from one video.',
    body: 'Blog post, comparison, thumbnail, newsletter, a script for your next video, plus native posts for Facebook, Instagram, Threads, Pinterest, X, LinkedIn, Bluesky & Telegram. All in your voice. All in about four minutes.',
  },
  {
    icon: <Upload size={18} />,
    title: 'Publish or schedule.',
    body: 'Hit your WordPress site, the social queue, or the calendar. Your call. Everything you make stays yours, on your domain, forever.',
  },
]

function StepCard({ index, step }: { index: number; step: Step }) {
  return (
    <div className="relative pl-16 lg:pl-0">
      {/* Number circle. On mobile, sits flush left of the card and the
          vertical line passes through it. On desktop, centered above the
          card title. The solid background covers the connecting line so
          the circles read as nodes on a wire. */}
      <div
        className="absolute lg:relative top-0 left-0 lg:left-auto lg:mx-auto w-[52px] h-[52px] rounded-full flex items-center justify-center mb-0 lg:mb-5 z-10"
        style={{
          background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
          boxShadow: '0 0 0 6px var(--bg), 0 6px 20px rgba(124,58,237,0.35)',
        }}
      >
        <span className="text-white text-[16px] font-semibold tabular-nums">{index}</span>
      </div>

      <div
        className="mvp-hover-border rounded-2xl border p-5 lg:p-6 h-full flex flex-col gap-3 transition-all duration-200 hover:-translate-y-0.5"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, rgba(124,58,237,0.18), rgba(192,38,211,0.14))',
            color: '#C4B5FD',
            border: '1px solid rgba(124,58,237,0.25)',
          }}
        >
          {step.icon}
        </div>
        <h3 className="text-[16px] font-semibold tracking-tight leading-snug" style={{ color: 'var(--text)' }}>
          {step.title}
        </h3>
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
          {step.body}
        </p>
      </div>
    </div>
  )
}

/** Section 5 — "Grounded in real video. Trained on real voice."
 *
 *  The fact-grounded differentiator section. Sells the product against
 *  generic AI content tools without naming any competitor. Lands as a
 *  comparison table (the old way vs MVP) followed by a founder-quote
 *  card that ties back to the hero's trust strip.
 *
 *  Honesty notes:
 *  - Every row is something MVP actually does (verified against the
 *    product's current behavior — scraping product pages, using
 *    transcripts, LEARN voice profile, video frames in thumbnails,
 *    publish-ready output).
 *  - The "Thumbnails" row specifically — NOT a generic "images" row —
 *    because in-article images mix real product photos with AI; only
 *    thumbnails are reliably grounded in actual video frames.
 *
 *  Layout: 2-col comparison table on desktop. On mobile, each row
 *  stacks the two columns vertically with the label as a pill above.
 */
function GroundedSection() {
  return (
    <section id="grounded" className="px-6 lg:px-8 pt-12 pb-16 sm:pb-28 relative">
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{
              backgroundColor: 'rgba(124,58,237,0.12)',
              color: '#9D6BFF',
              border: '1px solid rgba(124,58,237,0.25)',
            }}
          >
            <ShieldCheck size={10} />
            Grounded. Never guessed.
          </span>
          <h2
            className="text-[40px] sm:text-[54px] font-extrabold tracking-[-0.03em] leading-[1.02] mb-5"
            style={{ color: 'var(--text)' }}
          >
            Grounded in{' '}
            <span
              style={{
                background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              real video.
            </span>
            <br />
            Trained on{' '}
            <span
              style={{
                background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              real voice.
            </span>
          </h2>
          <p
            className="text-[16px] sm:text-[17px] leading-relaxed max-w-2xl mx-auto"
            style={{ color: 'var(--text-soft)' }}
          >
            If MVP can&apos;t prove it from your transcript or the product page, MVP doesn&apos;t say it.
          </p>
        </div>

        {/* Comparison table. Desktop: 2 columns side by side with a faint
            vertical divider. Mobile: each row stacks both columns with the
            label-pill on top. */}
        <div
          className="rounded-2xl border overflow-hidden"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          {/* Header row */}
          <div className="hidden sm:grid grid-cols-[160px_1fr_1fr] items-center gap-4 px-5 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <span className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-faint)' }}>Dimension</span>
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center justify-center w-5 h-5 rounded-full"
                style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: 'var(--text-faint)' }}
              >
                <XIcon size={11} />
              </span>
              <span className="text-[11px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-subtle)' }}>The old way</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center justify-center w-5 h-5 rounded-full"
                style={{ background: 'linear-gradient(135deg, #7C3AED, #C026D3)', color: '#FFFFFF' }}
              >
                <Check size={11} />
              </span>
              <span className="text-[11px] uppercase tracking-[0.15em] font-semibold" style={{ color: '#9D6BFF' }}>MVP</span>
            </div>
          </div>

          {/* Rows */}
          {COMPARISON_ROWS.map((row, i) => (
            <ComparisonRow key={row.label} row={row} isLast={i === COMPARISON_ROWS.length - 1} />
          ))}
        </div>

        {/* Founder quote close — the "B touch" — ties Section 5 back to the
            hero trust strip. */}
        <div
          className="mt-10 rounded-2xl border p-6 sm:p-8 max-w-3xl mx-auto"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'rgba(124,58,237,0.25)',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <Quote size={20} className="text-[#7C3AED] mb-3" />
          <p className="text-[16px] sm:text-[17px] leading-relaxed mb-4 italic" style={{ color: 'var(--text-muted)' }}>
            &ldquo;I built MVP because at 2 a.m. I was still rewriting AI-generated posts that invented features my products didn&apos;t have. Every other tool either sounded like a robot or made me triple-check every claim. So I built the one I needed.&rdquo;
          </p>
          <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
            Built by a creator who&apos;s done{' '}
            <span className="font-semibold" style={{ color: 'var(--text)' }}>$3M+/yr</span> in affiliate sales.
          </p>
        </div>
      </div>
    </section>
  )
}

interface ComparisonRowData {
  label: string
  oldWay: string
  mvpWay: string
}

const COMPARISON_ROWS: ComparisonRowData[] = [
  {
    label: 'Facts',
    oldWay: 'Invents features the product doesn’t have.',
    mvpWay: 'Pulls real specs from the product page you reviewed.',
  },
  {
    label: 'Stories',
    oldWay: 'Fabricates “experiences” you never had.',
    mvpWay: 'Uses what you actually said in the transcript.',
  },
  {
    label: 'Voice',
    oldWay: 'Sounds like every other AI post on the internet.',
    mvpWay: 'Trained on your channel: your phrasing, your hooks.',
  },
  {
    label: 'Thumbnails',
    oldWay: 'Generic AI illustrations.',
    mvpWay: 'AI-generated with your real face and the actual product.',
  },
  {
    label: 'Time',
    oldWay: 'You spend an hour rewriting before publishing.',
    mvpWay: 'Publish-ready out of the box.',
  },
]

function ComparisonRow({ row, isLast }: { row: ComparisonRowData; isLast: boolean }) {
  return (
    <div
      className={`px-5 py-5 sm:py-4 ${isLast ? '' : 'border-b'}`}
      style={{ borderColor: 'var(--border)' }}
    >
      {/* Mobile: stacked */}
      <div className="sm:hidden flex flex-col gap-2.5">
        <span
          className="self-start inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-[0.12em] font-medium"
          style={{ backgroundColor: 'rgba(124,58,237,0.10)', color: '#9D6BFF' }}
        >
          {row.label}
        </span>
        <div className="flex items-start gap-2">
          <XIcon size={14} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--text-faint)' }} />
          <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-subtle)' }}>
            {row.oldWay}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <Check size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#9D6BFF' }} />
          <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text)' }}>
            {row.mvpWay}
          </p>
        </div>
      </div>

      {/* Desktop: 3-column grid */}
      <div className="hidden sm:grid grid-cols-[160px_1fr_1fr] items-start gap-4">
        <span className="text-[13px] font-semibold tracking-tight pt-0.5" style={{ color: 'var(--text)' }}>
          {row.label}
        </span>
        <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-subtle)' }}>
          {row.oldWay}
        </p>
        <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {row.mvpWay}
        </p>
      </div>
    </div>
  )
}

/** Section 5.5 — Branded WordPress site.
 *
 *  The "wait, there's more, and it's FREE" moment right before the price
 *  reveal. Every other affiliate AI hands you content and walks away.
 *  MVP installs a complete editorial review site on your domain the moment
 *  you connect WordPress — including a trial user. The cost-stack card at
 *  the bottom makes the value concrete by listing what you'd otherwise pay
 *  (theme + plugins + setup time).
 *
 *  Three feature columns:
 *    1. Editorial review theme (design + UX + layout)
 *    2. Affiliate marketing plugin (monetization tooling)
 *    3. SEO + automation (discovery + cross-linking)
 *  Then a unified "what you'd otherwise pay" card with the savings math.
 *
 *  Position in flow: between Grounded (the truth/no-fabrication section)
 *  and Pricing. Creates a "wait there's more" beat right before the
 *  price reveal so the cards below feel like even more of a steal. */
function BrandedSiteSection() {
  return (
    <section className="px-6 lg:px-8 py-16 sm:py-24 relative">
      <div className="max-w-6xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-14 max-w-3xl mx-auto">
          <p
            className="text-[11px] uppercase tracking-[0.18em] font-medium mb-4"
            style={{ color: 'var(--text-faint)' }}
          >
            Free with every plan, trial included
          </p>
          <h2
            className="text-[28px] lg:text-[42px] font-extrabold tracking-[-0.03em] leading-tight mb-5"
            style={{ color: 'var(--text)' }}
          >
            A real branded WordPress site.{' '}
            <span style={{ color: 'var(--text-soft)' }}>Day one.</span>{' '}
            <span style={{ color: '#9D6BFF' }}>Even on the trial.</span>
          </h2>
          <p
            className="text-[16px] sm:text-[17px] leading-relaxed"
            style={{ color: 'var(--text-soft)' }}
          >
            Every other affiliate AI hands you content and walks away. You&apos;re still
            on the hook for buying a theme, hunting plugins, building the layout, and
            figuring out conversion. MVP installs a complete editorial review site on
            YOUR WordPress, YOUR domain, the moment you connect. Designed for affiliate
            reviews. Tuned for conversion. Yours forever, even if you cancel.
          </p>
        </div>

        {/* 3-column feature stack — Theme / Plugin / SEO + Automation */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
          {SITE_FEATURE_COLUMNS.map((col) => (
            <div
              key={col.eyebrow}
              className="rounded-2xl border p-6 lg:p-7"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                boxShadow: 'var(--card-shadow)',
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="inline-flex items-center justify-center w-6 h-6 rounded-md"
                  style={{ backgroundColor: 'rgba(124,58,237,0.18)', color: '#9D6BFF' }}
                >
                  {col.icon}
                </span>
                <p className="text-[10px] uppercase tracking-[0.15em] font-semibold" style={{ color: '#9D6BFF' }}>
                  {col.eyebrow}
                </p>
              </div>
              <h3 className="text-[18px] lg:text-[20px] font-semibold mb-5 leading-snug" style={{ color: 'var(--text)' }}>
                {col.tagline}
              </h3>
              <ul className="flex flex-col gap-2.5">
                {col.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[13.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
                    <Check size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#10B981' }} strokeWidth={2.5} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* "What you'd otherwise pay" cost-stack card. Mirrors the bundle-math
            section on /pricing but tighter, and frames the savings vs. the
            cobbled-together stack a creator would normally need. */}
        <div
          className="rounded-2xl border p-7 lg:p-8 max-w-4xl mx-auto"
          style={{
            background: 'linear-gradient(180deg, rgba(124,58,237,0.04), rgba(124,58,237,0.01))',
            borderColor: 'rgba(124,58,237,0.30)',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <p className="text-center text-[11px] uppercase tracking-[0.18em] font-semibold mb-5" style={{ color: '#9D6BFF' }}>
            What this content costs the old way
          </p>
          <ul className="flex flex-col gap-2.5 max-w-2xl mx-auto mb-7">
            {SITE_COST_STACK.map(([tool, price]) => (
              <li key={tool} className="flex items-baseline justify-between gap-3 border-b border-dashed pb-2" style={{ borderColor: 'var(--border)' }}>
                <span className="text-[13.5px]" style={{ color: 'var(--text-soft)' }}>{tool}</span>
                <span className="font-mono text-[12.5px] tabular-nums" style={{ color: 'var(--text-faint)' }}>{price}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-center sm:text-left">
            <div>
              <p className="text-[12px] uppercase tracking-[0.15em] mb-1" style={{ color: 'var(--text-faint)' }}>
                The old way
              </p>
              <p className="text-[24px] font-mono font-semibold" style={{ color: 'var(--text)' }}>
                ~$3,800<span className="text-[16px]" style={{ color: 'var(--text-faint)' }}>/mo</span>
                <span className="text-[14px] ml-2" style={{ color: 'var(--text-faint)' }}>+ your time</span>
              </p>
            </div>
            <span className="hidden sm:block text-[20px]" style={{ color: 'var(--text-faint)' }}>→</span>
            <div>
              <p className="text-[12px] uppercase tracking-[0.15em] mb-1" style={{ color: '#10B981' }}>
                With MVP
              </p>
              <p className="text-[28px] font-mono font-bold" style={{ color: '#10B981' }}>
                from $49<span className="text-[16px] font-sans font-normal" style={{ color: 'var(--text-faint)' }}>/mo</span>
                <span className="text-[14px] ml-2 font-sans font-normal" style={{ color: 'var(--text-faint)' }}>
                  / done in minutes
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Own-your-audience callout — the newsletter is the one channel you
            actually own (vs rented social reach). Honest about tiers: it STARTS
            on Creator (small) and scales; not "zero setup" (domain auth). */}
        <div
          className="mt-6 max-w-2xl mx-auto rounded-2xl border p-5 sm:p-6"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'rgba(124,58,237,0.30)' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Mail size={16} style={{ color: '#9D6BFF' }} />
            <p className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>
              The audience you actually own
            </p>
          </div>
          <p className="text-[14px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
            Social reach is rented — the algorithm decides who sees you. Your email list is yours.
            MVP builds it in: a signup form on your site, broadcasts written in your voice, list
            management, and the deliverability setup that makes standalone tools a headache.
            Start your list on Creator and scale to 10,000 subscribers with A/B and segments as you grow.
          </p>
        </div>

        {/* Final emphasis line — drives home the "even trial users" angle. */}
        <p className="text-center text-[15px] mt-8 max-w-2xl mx-auto leading-relaxed" style={{ color: 'var(--text-soft)' }}>
          The site is yours. On your domain. Forever. Even after you cancel,
          even if you only use the 5 free trial posts, you keep the WordPress
          install, the theme, the plugin, and every review you published.
        </p>
      </div>
    </section>
  )
}

/** Three-column feature stack for the WordPress site section. Each column
 *  is a logical bucket (theme / plugin / discovery) with 7-8 concrete
 *  features. Bullet copy intentionally specific (real shortcode names,
 *  real plugin behaviors) so the section reads as "this is built" not
 *  "this is roadmap." */
const SITE_FEATURE_COLUMNS = [
  {
    eyebrow: 'Editorial review theme',
    tagline: 'Designed for reviews. Not generic.',
    icon: <LayoutTemplate size={13} />,
    features: [
      'Hero + verdict box + pros / cons + comparison table layout',
      'Sticky table of contents on long reviews',
      'Sticky "Buy Now" bar on mobile (your highest-converting CTA)',
      'Reviewed-by credibility box with author photo and bio',
      'FTC-compliant affiliate disclosure banners auto-inserted',
      'Light and dark theme support, mobile-first responsive',
      'Topic hub pages auto-aggregate your reviews by category',
    ],
  },
  {
    eyebrow: 'Affiliate marketing plugin',
    tagline: 'Built-in monetization tooling.',
    icon: <BadgePercent size={13} />,
    features: [
      'Geniuslink affiliate-link wrapping (your tracking, your commissions)',
      'AI Product Finder chatbot embedded on every post',
      'Deal banner + countdown timer shortcodes',
      'Buying Guides shortcode + comparison-table shortcode',
      'Newsletter signup form (one shortcode, full form)',
      'Final-verdict Buy / Skip block at the end of every post',
      'No .htaccess editing, no API key juggling',
    ],
  },
  {
    eyebrow: 'SEO + automation',
    tagline: 'Discoverable the day it ships.',
    icon: <TrendingUp size={13} />,
    features: [
      'Schema.org Review markup for rich snippets in Google',
      'Auto-generated XML sitemap kept in sync as you publish',
      'Answer-first H2 leads tuned for AI search engines (AEO)',
      'Internal linking auto-generated across your full catalog',
      'Topic clustering for compounding SEO authority',
      'Theme + plugin auto-installed when you connect WordPress',
      'Works with Hostinger, SiteGround, Bluehost, Cloudways, WP Engine',
    ],
  },
] as const

/** What it costs to PRODUCE this content the old way — hire it out — per month
 *  for ~20 reviews. The real alternative to MVP is paying writers/designers/a VA,
 *  NOT a pile of WP plugins. Conservative freelance + tool rates; the list is the
 *  math behind the ~$3,800/mo total in the card. */
const SITE_COST_STACK: ReadonlyArray<readonly [string, string]> = [
  ['SEO product-review writer (~$120 / review × 20)', '$2,400 / mo'],
  ['Comparison & buying-guide articles', '$400 / mo'],
  ['Thumbnail designer (~$25 each)', '$500 / mo'],
  ['Keyword + rank-tracking tool (Ahrefs / Semrush)', '$129 / mo'],
  ['Email + newsletter tool (Mailchimp / ConvertKit)', '$39 / mo'],
  ['A VA to format, publish & schedule', '$350 / mo'],
  ['Briefing & editing it all yourself', 'your weekends'],
]

/** Section 6 — Pricing.
 *
 *  Three monetized tiers shown side-by-side (Creator / Studio / Pro).
 *  Trial is positioned as the WAY IN (no-card banner above the cards),
 *  not as a fourth column — nobody chooses "trial" as a tier.
 *
 *  Studio is flagged as Most Popular per the audit (sits in the middle
 *  price point + unlocks the going-full-time features: Telegram, Deals Hub,
 *  topic hubs, video scripts, and weekly newsletter scheduling). Pro is the
 *  power tier (comparisons + buying guides + creator campaigns + multi-site +
 *  multi-channel + VA seats).
 *
 *  Prices + features mirror lib/tier.ts exactly so the page never drifts
 *  from the live system. The regularPrice strikethrough sells the
 *  founder-pricing window without making it feel like a permanent
 *  discount.
 */
/** Bundle math — the "one subscription replaces a whole stack" pitch, folded
 *  onto the main page (2026-08-13) so it's self-contained and nobody has to
 *  click through to /pricing to see the value. Studio + Pro stacks with real
 *  published competitor prices. Token-styled to match the landing. */
const BUNDLE_STUDIO: Array<[string, number]> = [
  ['Cuppa Solo (AI blog writer)', 99],
  ['Jungle Scout (product research)', 49],
  ['Keepa (price history & deal tracking)', 19],
  ['thumbnailcreator.com (Creator)', 41],
  ['OpusClip Pro (vertical clips)', 29],
  ['Beehiiv Grow (newsletter)', 43],
]
const BUNDLE_PRO: Array<[string, number]> = [
  ['Cuppa Studio (multi-niche AI writer)', 199],
  ['Jungle Scout + Helium 10 (research)', 128],
  ['Keepa (price history & deals)', 19],
  ['Frase (SEO briefs)', 97],
  ['thumbnailcreator.com (Creator)', 41],
  ['OpusClip Pro (vertical clips)', 29],
  ['Beehiiv Scale (newsletter)', 43],
  ['Lasso Pro (affiliate analytics)', 29],
]
function BundleCard({ plan, price, rows, best }: { plan: string; price: string; rows: Array<[string, number]>; best?: boolean }) {
  const total = rows.reduce((s, [, p]) => s + p, 0)
  const save = total - parseInt(price.replace(/\D/g, ''), 10)
  return (
    <div
      className="rounded-3xl border p-7 relative overflow-hidden"
      style={{ backgroundColor: 'var(--surface)', borderColor: best ? 'rgba(124,58,237,0.35)' : 'var(--border)', boxShadow: 'var(--card-shadow)' }}
    >
      {best && (
        <span className="absolute top-4 right-4 inline-flex items-center px-2.5 py-1 rounded-full text-white text-[10px] font-bold uppercase tracking-wider" style={{ background: 'linear-gradient(135deg, #7C3AED, #C026D3)' }}>Best deal</span>
      )}
      <p className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--accent-text)' }}>MVP {plan} · {price}/mo</p>
      <p className="text-[17px] font-bold mt-0.5 mb-5" style={{ color: 'var(--text)' }}>replaces this stack:</p>
      <ul className="flex flex-col gap-2.5 mb-5 text-[13.5px]">
        {rows.map(([tool, p]) => (
          <li key={tool} className="flex items-baseline justify-between border-b border-dashed pb-1.5" style={{ borderColor: 'var(--border)' }}>
            <span style={{ color: 'var(--text-muted)' }}>{tool}</span>
            <span className="font-mono" style={{ color: 'var(--text-faint)' }}>${p}/mo</span>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between text-[14px] font-semibold pt-1" style={{ color: 'var(--text)' }}>
        <span>Total replaced</span><span className="font-mono">${total}/mo</span>
      </div>
      <div className="mt-4 rounded-xl px-4 py-3 flex items-baseline justify-between" style={{ background: 'rgba(52,199,89,0.10)', border: '1px solid rgba(52,199,89,0.25)' }}>
        <span className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>You save</span>
        <span className="font-mono text-[18px] font-bold" style={{ color: '#34c759' }}>${save}/mo</span>
      </div>
    </div>
  )
}
function BundleMathSection() {
  return (
    <section id="bundle-math" className="px-6 lg:px-8 pt-4 pb-16 sm:pb-24 relative">
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-9">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.18em] mb-4" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)', border: '1px solid var(--border)' }}>
            <Coins size={11} /> The bundle math
          </span>
          <h2 className="text-[32px] sm:text-[44px] font-extrabold tracking-[-0.03em] leading-[1.03]" style={{ color: 'var(--text)' }}>
            One plan replaces the whole stack.
          </h2>
          <p className="mt-4 text-[15px] sm:text-[16px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
            Everyone else sells you one tool at a time. MVP runs the whole pipeline, from a video to a blog, thumbnails, clips, social and a newsletter, for less than the tools it replaces.
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <BundleCard plan="Studio" price="$99" rows={BUNDLE_STUDIO} />
          <BundleCard plan="Pro" price="$199" rows={BUNDLE_PRO} best />
        </div>
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
              Try MVP free. No card required.
            </p>
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
              Get 5 full posts on the house. Generate, publish, share, see if it fits your workflow before you pay a cent. No time limit on the trial.
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
            Gominplanet grew this affiliate business past $3M a year in revenue — and it&apos;s a big reason brands want to work with us. We built MVP to run it. Now it&apos;s yours.
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
            src="/png/44bf146a-8a53-461d-a77f-57c81e7ef03a.png"
            alt="MVP Affiliate — find products, create content, and publish everywhere from one dashboard"
            width={1717}
            height={916}
            priority
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
            The only tool that runs your whole Amazon affiliate business — and never uses your personal data.
          </p>

          {/* Sub */}
          <p
            className="mt-6 text-[16px] leading-relaxed max-w-xl"
            style={{ color: 'var(--text-soft)' }}
          >
            Connect your channel and MVP turns each video into a published, SEO- and AI-optimized review post — and finishes the upload for you: optimized description, tags, affiliate links and a CTR-tested thumbnail pushed back to the video. <span style={{ color: 'var(--text)' }}>No video? Just drop a product or service link</span> — any store, brand, or Amazon ASIN — and MVP writes the review, buying guides, comparisons and deal posts itself. Everything lands on a beautifully designed blog that&apos;s yours to keep — forever.
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

            {/* New-feature ribbon — vibrant strip that ties the hero to the
                flagship Deal Radar section below. */}
            <a
              href="#deal-radar"
              className="mt-6 inline-flex items-center gap-2.5 rounded-2xl px-4 py-3 text-[13px] font-medium transition-transform hover:-translate-y-0.5"
              style={{
                background: 'linear-gradient(135deg, rgba(249,115,22,0.14), rgba(192,38,211,0.14))',
                border: '1px solid rgba(249,115,22,0.3)',
                color: 'var(--text)',
              }}
            >
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0" style={{ background: 'linear-gradient(135deg, #F97316, #C026D3)', color: '#fff' }}>
                <Zap size={14} />
              </span>
              <span>
                <span className="font-semibold">New — Amazon Deal Radar.</span>{' '}
                <span style={{ color: 'var(--text-soft)' }}>Now MVP finds live, verified deals for you — and turns them into posts + a shoppable bio.</span>
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
  { src: '/png/TNsample01.jpg', w: 640, h: 360, alt: 'Amazon video-review thumbnail generated by MVP from a Borghese mask brush' },
  { src: '/png/TNsample02.jpg', w: 1280, h: 720, alt: 'Amazon video-review thumbnail generated by MVP from a juicer' },
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

/** Why MVP vs the others — punchy differentiator cards that lead the page's
 *  "why us" story before the detailed comparison table. Four sharp angles:
 *  privacy (the cheeky one), all-in-one, your-voice, you-own-it. logie5-clean:
 *  big type, one accent, lots of air. */
const WHY_MVP: Array<{ icon: React.ReactNode; title: string; body: string; tag: string }> = [
  {
    icon: <ShieldCheck size={20} />,
    tag: 'Your data stays yours',
    title: 'Your data isn\'t the product.',
    body: 'We don\'t sell, rent, or hand off your data — not your audience, not your earnings, not your content. Your accounts stay yours, and your site is yours to keep forever, even if you cancel.',
  },
  {
    icon: <LayoutTemplate size={20} />,
    tag: 'One tool, not four',
    title: 'The whole job, one subscription.',
    body: 'Research, write, design, thumbnail, publish, syndicate to every network, and get paid, all in one place. Everyone else makes you stitch together a stack and pay four bills to do what MVP does in one.',
  },
  {
    icon: <PenLine size={20} />,
    tag: 'It sounds like you',
    title: 'Your voice, not generic AI slop.',
    body: 'Every review, post, script and caption is written from your brand profile in your voice. Readers can\'t tell it\'s AI, because it reads like you wrote it, not like a template everyone else is also using.',
  },
  {
    icon: <Globe size={20} />,
    tag: 'You keep everything',
    title: 'Your site, your audience, forever.',
    body: 'Your blog lives on your own WordPress and your audience is yours. Cancel any time and you keep the site, the posts and the list. No rented reach, no walled garden, nothing held hostage.',
  },
]

function WhyMvpSection() {
  return (
    <section id="why-mvp" className="px-5 sm:px-8 pt-16 sm:pt-24 pb-6 relative">
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-11">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.18em] mb-5"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)', border: '1px solid var(--border)' }}
          >
            <Zap size={11} /> Why MVP, not the rest
          </span>
          <h2 className="text-[36px] sm:text-[52px] font-extrabold tracking-[-0.03em] leading-[1.0]" style={{ color: 'var(--text)' }}>
            Built different.<br />
            <span style={{ background: 'linear-gradient(120deg, #F97316 0%, #C026D3 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              On purpose.
            </span>
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
          {WHY_MVP.map((c) => (
            <div
              key={c.title}
              className="rounded-3xl border p-7 sm:p-8"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}
            >
              <div className="flex items-center gap-2.5 mb-4">
                <span className="w-11 h-11 rounded-2xl grid place-items-center flex-shrink-0 text-white" style={{ background: 'linear-gradient(135deg, #7C3AED, #C026D3)' }}>{c.icon}</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent-text)' }}>{c.tag}</span>
              </div>
              <h3 className="text-[21px] sm:text-[23px] font-bold tracking-tight mb-2" style={{ color: 'var(--text)' }}>{c.title}</h3>
              <p className="text-[14px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{c.body}</p>
            </div>
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

/** "Everything else in the box" — the capabilities that don't get their own
 *  section but round out the all-in-one story (and would each be a separate
 *  paid tool elsewhere). Clean light grid, one accent. */
const CAPABILITIES: Array<{ icon: React.ReactNode; title: string; body: string; badge?: string }> = [
  { icon: <Scissors size={18} />, title: 'Short-form video', badge: 'New', body: 'Clip Factory turns one long video into vertical Reels, TikToks and YouTube Shorts — hook, captions and vertical crop done for you. Post the same review as long-form and short-form.' },
  { icon: <Signpost size={18} />, title: 'Move over in an afternoon', body: 'Coming from Lasso or another tool? MVP fixes your existing site as you switch: 404 redirects, duplicate posts splitting your rankings, broken block formatting and leftover affiliate tags — cleaned automatically.' },
  { icon: <Megaphone size={18} />, title: 'Display-ad revenue', body: 'Layer AdSense and affiliate-banner placements onto your site for passive income on top of your affiliate links — set once, earns on every visit.' },
  { icon: <Sparkles size={18} />, title: 'MVP x LTK', body: 'Paste an LTK link and MVP writes a full SEO blog post with your LTK link as the call-to-action — your LTK picks, working for you on Google too.' },
  { icon: <Inbox size={18} />, title: 'Brand deals, inbound', body: 'A “Work with brands” banner on your blog collects paid-collaboration inquiries into one inbox — plus AI outreach drafts for the brands you want to pitch.' },
  { icon: <Users size={18} />, title: 'Hand it to your VA', body: 'Invite an assistant or teammate to run your account — research, generate and publish on your behalf, without sharing your logins.' },
]

function CapabilitiesSection() {
  return (
    <section id="more" className="px-6 lg:px-8 pt-16 sm:pt-24 pb-16 sm:pb-24 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.18em] mb-5"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)', border: '1px solid var(--border)' }}
          >
            <Sparkles size={11} /> All in one subscription
          </span>
          <h2 className="text-[36px] sm:text-[52px] font-extrabold tracking-[-0.03em] leading-[1.02] mb-5" style={{ color: 'var(--text)' }}>
            Everything else you&apos;d otherwise<br />
            <span style={{ background: 'linear-gradient(120deg, #F97316 0%, #C026D3 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              stitch together and pay for.
            </span>
          </h2>
          <p className="text-[16px] sm:text-[17px] leading-relaxed max-w-2xl mx-auto" style={{ color: 'var(--text-soft)' }}>
            The features that usually mean four more tabs and four more invoices — all in the same place, no compromise.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CAPABILITIES.map((c) => (
            <div key={c.title} className="rounded-2xl border p-6" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
              <div className="flex items-center gap-2.5 mb-3">
                <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
                  {c.icon}
                </span>
                {c.badge && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-white" style={{ background: 'linear-gradient(135deg, #F97316, #C026D3)' }}>
                    {c.badge}
                  </span>
                )}
              </div>
              <p className="text-[16px] font-bold mb-1.5" style={{ color: 'var(--text)' }}>{c.title}</p>
              <p className="text-[14px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{c.body}</p>
            </div>
          ))}
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

/** Before/After visual — sits between Workflow (Section 4) and Grounded
 *  (Section 5). Sells the "one subscription replaces a tool stack" pitch
 *  viscerally: a chaotic grid of generic tool boxes on the left, the
 *  single MVP hub on the right, an arrow between.
 *
 *  Why no competitor names: the user has flagged repeatedly never to
 *  name competitors in user-facing copy. So
 *  the "before" side uses generic role labels (Writing tool, Scheduler,
 *  Designer, Publisher, etc.) instead — readers fill in their own
 *  current stack.
 */
function BeforeAfterSection() {
  return (
    <section id="stack" className="px-6 lg:px-8 pt-12 pb-16 sm:pb-28 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{
              backgroundColor: 'rgba(124,58,237,0.12)',
              color: '#9D6BFF',
              border: '1px solid rgba(124,58,237,0.25)',
            }}
          >
            <Sparkles size={10} />
            One subscription replaces your stack
          </span>
          <h2
            className="text-[40px] sm:text-[54px] font-extrabold tracking-[-0.03em] leading-[1.02] mb-5"
            style={{ color: 'var(--text)' }}
          >
            Five tools and a tab tangle.{' '}
            <span
              style={{
                background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Or one hub.
            </span>
          </h2>
          <p
            className="text-[16px] sm:text-[17px] leading-relaxed max-w-2xl mx-auto"
            style={{ color: 'var(--text-soft)' }}
          >
            Stop paying for eight different subscriptions and stitching them together by hand.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] items-stretch gap-6 lg:gap-4">
          {/* BEFORE column — chaotic grid of greyed-out tool boxes. */}
          <div
            className="rounded-2xl border p-6 sm:p-7 relative"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <p className="text-[11px] uppercase tracking-[0.15em] mb-5" style={{ color: 'var(--text-faint)' }}>
              The old way
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {OLD_STACK.map(t => (
                <div
                  key={t}
                  className="rounded-lg border px-3 py-2.5 text-[12px] text-center relative overflow-hidden"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.02)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-subtle)',
                  }}
                >
                  <span className="line-through opacity-80">{t}</span>
                </div>
              ))}
            </div>
            <p className="mt-5 text-[12px] leading-relaxed" style={{ color: 'var(--text-subtle)' }}>
              Eight subscriptions. Eight tabs open. Copy-paste between them. Reformat for every platform. Forget what was where.
            </p>
            <p className="mt-3 text-[13px] font-semibold" style={{ color: 'var(--text-subtle)' }}>
              $500+/mo · hours per video
            </p>
          </div>

          {/* Arrow — horizontal on desktop, vertical on mobile/tablet. */}
          <div className="hidden lg:flex items-center justify-center">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #7C3AED, #C026D3)',
                boxShadow: '0 6px 20px rgba(124,58,237,0.35)',
              }}
            >
              <ArrowRight size={20} className="text-white" />
            </div>
          </div>
          <div className="lg:hidden flex items-center justify-center -my-2">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center rotate-90"
              style={{ background: 'linear-gradient(135deg, #7C3AED, #C026D3)' }}
            >
              <ArrowRight size={18} className="text-white" />
            </div>
          </div>

          {/* AFTER column — single MVP hub with a violet glow. */}
          <div
            className="rounded-2xl border p-6 sm:p-7 relative overflow-hidden"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'rgba(124,58,237,0.40)',
              boxShadow: '0 8px 32px rgba(124,58,237,0.15), inset 0 1px 0 rgba(255,255,255,0.06)',
            }}
          >
            <p className="text-[11px] uppercase tracking-[0.15em] mb-5" style={{ color: '#9D6BFF' }}>
              The MVP way
            </p>
            <div
              className="rounded-xl p-5 flex items-center gap-4 mb-4"
              style={{
                background: 'linear-gradient(135deg, rgba(124,58,237,0.18), rgba(192,38,211,0.14))',
                border: '1px solid rgba(124,58,237,0.30)',
              }}
            >
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #7C3AED, #C026D3)' }}
              >
                <Sparkles size={22} className="text-white" />
              </div>
              <div>
                <p className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
                  MVP Central Hub
                </p>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-soft)' }}>
                  Every role. One workflow.
                </p>
              </div>
            </div>
            <ul className="flex flex-col gap-2">
              {NEW_BENEFITS.map(b => (
                <li key={b} className="flex items-start gap-2 text-[12.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  <Check size={12} className="flex-shrink-0 mt-1 text-[#9D6BFF]" />
                  {b}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
              From <span style={{ color: '#9D6BFF' }}>$49/mo</span> · 4 minutes per video
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

const OLD_STACK = [
  'Writing tool',
  'Image / thumbnail tool',
  'Newsletter platform',
  'Social scheduler',
  'WordPress plugin',
  'SEO add-on',
  'Comparison generator',
  'Brand kit tool',
]

const NEW_BENEFITS = [
  'One subscription instead of eight.',
  'Every output ready in minutes, not hours.',
  'No copy-paste between platforms.',
  'Same voice across blog, email, and social.',
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

