/**
 * / — public-facing homepage (mvpaffiliate.io).
 *
 * Creator-Lens-style look (2026-10-19): warm cream background, a single teal
 * accent (#008080), soft lifted cards and the Plus Jakarta Sans font, matching
 * /features and /landing-preview. This was a visual retint only; the copy and
 * structure are pinned by the sales-page guards and were left unchanged.
 *
 * Still CSS-variable driven (LIGHT_VARS + GRAD below): change those to re-theme
 * most surfaces at once. Emphasis bands flip to light text via DARK_SECTION_VARS.
 *
 * Source of truth for tier copy: lib/tier.ts, READ from it below rather than
 * mirrored by hand. The hand-mirror had drifted: this page promised Studio 1,000
 * assistant messages and Pro 2,500 while the server cuts them off at 400 and 800,
 * promised Studio 15 headshots against an enforced 12, and sold LoRA retrains that
 * were retired in May. scripts/test-pricing-copy.ts now fails the build if an
 * advertised number stops matching the one the server enforces.
 * below and in app/pricing/page.tsx. If you change one, change all three.
 */
import PriceLockCountdown from '@/components/landing/PriceLockCountdown'
import { newPricesLive } from '@/lib/price-schedule'
import { TIERS } from '@/lib/tier'
import { MAX_ITEMS as BULK_UPLOAD_MAX_VIDEOS } from '@/lib/launch-batch'
import { SHORTS_MONTHLY_CAP } from '@/lib/usage-cap'
import { FREE_WEEK_LABEL, FREE_WEEK_SHORT, FREE_WEEK_SENTENCE, FREE_WEEK_CTA, FREE_WEEK_CTA_SHORT, freeWeekUnderButton } from '@/lib/guarantee'
import FreeWeekSteps from '@/components/landing/FreeWeekSteps'
import { TESTIMONIALS } from '@/lib/testimonials'
import { previewOpenToPro, type PreviewFeature } from '@/lib/labs-preview'
import {
  FileText, Calendar,
  Play, Sparkles, ArrowRight,
  Twitter, Cloud, Send, Linkedin, Facebook, Instagram, AtSign,
  Globe, TrendingUp, Wand2,
  ShieldCheck, Zap, Upload, X as XIcon, Check,
  Crown, Rocket,
  Pin,
  Store, Search,
  Radar, Scissors,
  CloudUpload, Handshake,
} from 'lucide-react'
import NextImage from 'next/image'
import { FAQSection, HeroVideo, SalesVideosSection, StickyBottomBar } from '@/components/landing/islands'

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
  ['--accent-soft' as string]: 'rgba(0,128,128,0.18)',
  ['--accent-text' as string]: '#7FD4D0',
}

// ── Sales-page config (edit these; each renders only when it has a real value,
//    so nothing fake ever ships) ──────────────────────────────────────────────
//
// GUARANTEE: the risk-reversal line near the CTAs and pricing.
//   It is no longer "awaiting the exact terms": the terms exist, in section 9
//   of /terms, and this reads the same constant they do. It was typed here,
//   typed again on /features, and typed twice more on each of the two ad
//   pages, while the Terms of Service said fees already paid are
//   non-refundable. Five promises against one refusal, and the refusal was
//   the document a buyer actually agrees to.
const GUARANTEE: string | null = FREE_WEEK_LABEL
//
// NO DEADLINE. There was one, set three months out, and it was removed on
//   request. A date that far away does not create urgency; it reads as a
//   deadline nobody means, on a page whose whole argument is that we tell
//   creators the truth about their own numbers. If a genuine dated offer ever
//   exists it goes back here and the countdown returns with it. An invented one
//   does not: scripts/test-sales-page fails the build on any countdown that is
//   not driven by a real date.
//

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
  ['--bg' as string]: '#FBF7F2',
  ['--surface' as string]: '#FFFFFF',
  ['--surface-bright' as string]: 'rgba(0,0,0,0.05)',
  ['--border' as string]: 'rgba(0,0,0,0.10)',
  ['--text' as string]: '#1C1917',
  ['--text-muted' as string]: 'rgba(0,0,0,0.82)',
  ['--text-soft' as string]: 'rgba(0,0,0,0.62)',
  ['--text-subtle' as string]: 'rgba(0,0,0,0.50)',
  ['--text-faint' as string]: 'rgba(0,0,0,0.40)',
  ['--card-shadow' as string]: '0 1px 3px rgba(28,25,23,0.04), 0 16px 38px -16px rgba(28,25,23,0.18)',
  ['--hero-opacity' as string]: '0.22',
  ['--line-color' as string]: 'rgba(0,128,128,0.55)',
  ['--line-glow' as string]: 'rgba(0,128,128,0.18)',
  ['--center-bg' as string]: 'linear-gradient(135deg, #008080, #2DD4BF)',
  ['--accent-soft' as string]: 'rgba(0,128,128,0.12)',
  ['--accent-text' as string]: '#0C6E6B',
}


// Re-rendered every 10 minutes so the January 1 price change shows without a deploy.
export const revalidate = 600

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
      className="min-h-screen font-[family-name:var(--font-jakarta)]"
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
      {/* THE FORK IS BACK, AND IT IS THE FIRST THING UNDER THE HERO (2026-09).
          We now run ads against two different promises, each with its own
          landing page, so the homepage has to offer the same two doors: a
          visitor who arrives here cold gets the choice the ad would have made
          for them. AudienceSplit deep-links to /run-your-storefront (Amazon)
          and /own-your-blog (Pro).

          It replaces AmazonRouter's slim strip, which said "not building a
          blog? see the Amazon plan" in one line. A one-line aside directly
          above a full two-panel "which one are you?" is the same question asked
          twice, and the quiet version wins the click it should have lost.
          AmazonRouter stays defined below, unrendered, like the other retired
          sections in this file. */}
      <Nav />
      <Hero />
      {/* ONE PLAN (Seb, 2026-10-18): the "which one are you?" fork offered
          the Amazon plan, which is no longer sold, so it is gone. */}
      <PlatformBar />
      <OldWayNewWay />
      {/* PROOF MOVES ITSELF. With a real wall of quotes, proof belongs high:
          cold traffic off an ad trusts nobody, and other creators are the
          shortest path to trusting us. With only one or two it belongs lower,
          where a thin wall reads as early rather than as all we have. So the
          slot is chosen by how many real quotes exist, and adding the fifth one
          promotes the section without anybody remembering to. */}
      {TESTIMONIALS.length >= 3 && <TestimonialsSection />}
      <HowItWorks />
      <FeaturesGridCondensed />
      {/* What MVP does for each job (Seb, 2026-10-18): Drop, TRYBE, Meta Hub
          and research had no word on the page. */}
      <RolesSection />
      {/* Watch it work (Seb, 2026-10-17): the walkthrough and one video per
          feature, so a visitor sees what they get. Click to play. */}
      <SalesVideosSection />
      {/* Flagship new work, shown with real product images. */}
      <FeatureSpotlights />
      <PassportSpotlight />
      {/* Real proof: actual thumbnails MVP made from one product photo. */}
      <ThumbnailShowcase />
      <ComparisonSection />
      <ProofSection />
      {TESTIMONIALS.length < 3 && <TestimonialsSection />}
      <CommunitySection />
      <FounderSection />
      <PricingSection />
      <FAQSection />
      <DarkBand bg="linear-gradient(160deg, #0A1A1A 0%, #0E2A28 55%, #10302E 100%)">
        <FinalCTASection />
      </DarkBand>
      <Footer />
      <StickyBottomBar />
    </div>
  )
}

/** Amazon-only router — the "no blog" buyer. Replaces the old
 *  pre-hero two-panel splitter with two light touchpoints: a slim strip under
 *  the hero, and a callout at the pricing decision point. Both deep-link to the
 *  Amazon plan's own sales page. */
function AmazonRouter({ variant }: { variant: 'strip' | 'callout' }) {
  if (variant === 'callout') {
    return (
      <section className="px-6 lg:px-8 pb-16 sm:pb-20 relative">
        <p className="max-w-3xl mx-auto text-center text-[14px]" style={{ color: 'var(--text-soft)' }}>
          Not building a blog? The{' '}
          <a href="/amazon-influencer" className="font-bold" style={{ color: '#008080' }}>Amazon storefront plan</a>{' '}
          covers thumbnails, designs, review videos, storefront and brand deals, from ${TIERS.amazon.price}/mo.
        </p>
      </section>
    )
  }
  return (
    <div style={{ background: 'linear-gradient(90deg, rgba(234,88,12,0.09), rgba(45,212,191,0.06))', borderBottom: '1px solid var(--border)' }}>
      <div className="max-w-6xl mx-auto px-6 lg:px-8 py-3.5 flex items-center justify-center gap-x-4 gap-y-1.5 flex-wrap text-center text-[13.5px]">
        <b style={{ color: 'var(--text)' }}>Not building a blog?</b>
        <span style={{ color: 'var(--text-soft)' }}>MVP has an Amazon storefront plan: thumbnails, designs, storefront and brand deals, from ${TIERS.amazon.price}/mo.</span>
        <a href="/amazon-influencer" className="font-bold whitespace-nowrap inline-flex items-center gap-1" style={{ color: '#008080' }}>
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
  { n: 'Find', d: 'Research all of Amazon, live Deal Radar and your partner programs for products worth promoting, find brands on TRYBE that pay for videos, or just paste any product link.' },
  { n: 'Create', d: 'MVP writes the review, comparisons and social posts in your real voice, and makes the thumbnail and the Shorts for you.' },
  { n: 'Publish', d: 'It all lands on a blog that stays yours, plus your socials and a shoppable bio, with affiliate links already in place.' },
  { n: 'Earn', d: 'Passport geo-links with no per-click fees and Creator Connections keep every shopper earning, with the commission going to you.' },
]
function HowItWorks() {
  return (
    <section id="how-it-works" className="px-6 lg:px-8 pt-16 sm:pt-24 pb-8 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#008080' }}>The MVP Loop</span>
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
                <div className="w-8 h-8 rounded-lg grid place-items-center text-white font-extrabold text-[15px]" style={{ background: 'linear-gradient(135deg,#008080,#2DD4BF)' }}>{i + 1}</div>
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
  { icon: <Globe size={19} />, title: 'Passport geo-links, no click fees', desc: 'Send every shopper to their own country’s Amazon and keep the commission, with no per-click fees. Included in Pro.', isNew: true },
  { icon: <Zap size={19} />, title: 'Amazon Deal Radar', desc: 'Live, price-history-verified deals, not fake “was” prices. MVP turns the real drops into posts and a shoppable bio.' },
  { icon: <FileText size={19} />, title: 'SEO & AI-optimized articles', desc: 'Reviews, comparisons, buying guides and researched articles built to rank on Google and get quoted by AI answers.' },
  { icon: <Search size={19} />, title: 'Product and campaign research', desc: 'Filter all of Amazon by category, price, rating, reviews and sales rank. Scout Levanta, PartnerBoost, Walmart and Wayward campaigns too.' },
  { icon: <Handshake size={19} />, title: 'Paid brand deals on TRYBE', desc: 'MVP finds the TRYBE brands that fit your channel, drafts your first message and plans the videos once a brand says yes.', isNew: true },
  { icon: <Store size={19} />, title: 'Your own blog, forever', desc: 'A beautifully designed WordPress site that stays yours, even if you leave. No walled garden, no lock-in.' },
  { icon: <ShieldCheck size={19} />, title: 'Your data stays yours', desc: 'MVP never uses or sells your personal data. It works from your content, nothing else.' },
]
function FeaturesGridCondensed() {
  return (
    <section id="features" className="px-6 lg:px-8 pt-12 pb-16 sm:pb-24 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#008080' }}>Everything in one place</span>
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
              <div className="w-10 h-10 rounded-xl grid place-items-center mb-3.5" style={{ background: 'rgba(0,128,128,0.1)', color: '#008080' }}>{f.icon}</div>
              <h3 className="text-[16.5px] font-bold mb-1.5 flex items-center gap-2 flex-wrap" style={{ color: 'var(--text)' }}>
                {f.title}
                {f.isNew && <span className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-white px-1.5 py-0.5 rounded-full" style={{ background: 'linear-gradient(135deg,#008080,#2DD4BF)' }}>New</span>}
              </h3>
              <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{f.desc}</p>
            </div>
          ))}
        </div>
        <div className="text-center mt-9">
          <a href="/features" className="inline-flex items-center gap-1.5 text-[14px] font-semibold" style={{ color: '#008080' }}>
            See every feature, by the MVP Loop <ArrowRight size={15} />
          </a>
        </div>
      </div>
    </section>
  )
}

/** WHAT MVP DOES FOR EACH JOB (Seb, 2026-10-18). Drop, the TRYBE integration,
 *  Meta Hub and the research tools had no word on the sales page. Each card is
 *  one job a creator would otherwise do by hand or hire for.
 *
 *  `gate` ties the badge to the feature's real switch in lib/labs-preview: a
 *  feature that is not open to Pro yet reads "Coming soon" rather than being
 *  sold as something a new member can use, and the label flips to "New" the
 *  day it opens, with no copy change. It is also why this section has the
 *  #roles id the nav (and the free guide's copy of it) already points at. */
const ROLES: { id: string; gate: PreviewFeature | null; icon: React.ReactNode; role: string; title: string; desc: string; points: string[]; note: string }[] = [
  {
    id: 'drop',
    gate: 'drop',
    icon: <CloudUpload size={20} />,
    role: 'Your upload team',
    title: 'Drop: film it, drop it, done',
    desc: `Drop up to ${BULK_UPLOAD_MAX_VIDEOS} videos at once and MVP sends each one everywhere it belongs. It tells your long reviews from your vertical videos by their shape, so there is nothing to sort.`,
    points: [
      'Long reviews go to YouTube and your Amazon storefront, with the title, description, thumbnail and links done',
      'Each one also becomes a blog post, a Pinterest pin, a Facebook Group post and three short clips',
      'Vertical videos go to TikTok, Instagram Reels, YouTube Shorts, Facebook Reels, Pinterest and your storefront',
      'Made a video for a TRYBE brand? Send it to that brand from the same screen',
      'Pick your posting days and times once, and every drop fills the next free slot',
    ],
    note: 'Amazon storefront uploads are for US storefronts.',
  },
  {
    id: 'trybe',
    gate: 'trybe_outreach',
    icon: <Handshake size={20} />,
    role: 'Your brand deal agent',
    title: 'Land paid brand deals on TRYBE',
    desc: 'TRYBE is the marketplace where brands pay creators to make videos. MVP finds the brands worth your time, writes your first message, and plans the videos once a brand says yes.',
    points: [
      'Every brand on TRYBE, sorted by best fit for your channel, fewest creators, total payouts or newest',
      'Your first message to each brand drafted in your words, and the requests sent for you a few at a time',
      'Your TRYBE inbox in one place, with a suggested reply on every conversation',
      'Ten shooting scripts per brand that follow its brief, each with several hooks to test',
      'What is working now: how the top videos open, the most active brands and the ads they run on Meta',
    ],
    note: 'Works with your own TRYBE account through the SCOUT Chrome extension. TRYBE is a separate service.',
  },
  {
    id: 'meta-hub',
    gate: 'facebook_setup',
    icon: <Facebook size={20} />,
    role: 'Your Facebook manager',
    title: 'Meta Hub: Facebook that actually sells',
    desc: 'Meta Hub sets up the Facebook system that works for affiliates: your Group holds the link, and your Page points people to it.',
    points: [
      'Niche Groups like Kitchen or Automotive, each holding its own product links',
      'SCOUT fills in every Group post for you, and you press Post',
      'Every review becomes a Group post plus a Page post that points to it',
      'Reels cut from your videos with Clip Factory, right inside the hub',
      'One queue for everything waiting to go to your Groups: reviews, clips, deals and Amazon videos',
    ],
    note: 'Group posts use the SCOUT Chrome extension.',
  },
  {
    id: 'research',
    gate: null,
    icon: <Radar size={20} />,
    role: 'Your researcher',
    title: 'Know what to film before you buy it',
    desc: 'Search all of Amazon and the partner programs you belong to, then turn the best finds into content in one click.',
    points: [
      'Filter the whole Amazon catalogue by category, price, rating, reviews and sales rank',
      'MVP picks: products with real demand, strong ratings and room for your video',
      'Deal Radar: live deals checked against price history, so no fake "was" prices',
      'When a product you already reviewed goes on sale, MVP tells you and updates your pinned comment',
      'Levanta brands ranked by commission and earnings per click, PartnerBoost by pay per sale, plus Walmart and Wayward',
    ],
    note: 'Partner programs use your own Levanta, PartnerBoost, Walmart or Wayward account.',
  },
]
function RolesSection() {
  return (
    <section id="roles" className="px-6 lg:px-8 pt-4 pb-16 sm:pb-24 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#008080' }}>Every job, covered</span>
          <h2 className="text-[32px] sm:text-[44px] font-extrabold tracking-[-0.03em] leading-[1.03] mt-3" style={{ color: 'var(--text)' }}>
            The team you would otherwise hire
          </h2>
          <p className="mt-4 text-[15.5px]" style={{ color: 'var(--text-soft)' }}>
            Uploading, brand deals, Facebook and research eat a creator&apos;s week. MVP does the heavy part of each, and you decide what goes out.
          </p>
        </div>
        <div className="grid lg:grid-cols-2 gap-5 mt-10">
          {ROLES.map((r) => {
            const live = r.gate === null || previewOpenToPro(r.gate)
            return (
              <article key={r.role} id={r.id} className="rounded-2xl border p-6 sm:p-7 flex flex-col scroll-mt-24" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="w-10 h-10 rounded-xl grid place-items-center text-white flex-shrink-0" style={{ background: 'linear-gradient(135deg,#008080,#2DD4BF)' }}>{r.icon}</div>
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-soft)' }}>{r.role}</span>
                  {r.gate !== null && (live
                    ? <span className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-white px-1.5 py-0.5 rounded-full" style={{ background: 'linear-gradient(135deg,#008080,#2DD4BF)' }}>New</span>
                    : <span className="text-[9px] font-extrabold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-full border" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>Coming soon</span>)}
                </div>
                <h3 className="text-[21px] sm:text-[23px] font-extrabold tracking-tight leading-tight mt-4" style={{ color: 'var(--text)' }}>{r.title}</h3>
                <p className="mt-2.5 text-[14.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{r.desc}</p>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {r.points.map((pt) => (
                    <li key={pt} className="flex gap-2.5 text-[14px] leading-snug" style={{ color: 'var(--text)' }}>
                      <Check size={16} className="mt-0.5 flex-shrink-0" style={{ color: '#008080' }} />
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-auto pt-5 text-[12.5px]" style={{ color: 'var(--text-faint)' }}>
                  {live ? r.note : `Coming soon to every Pro member. ${r.note}`}
                </p>
              </article>
            )
          })}
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
              <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white px-2 py-0.5 rounded-full" style={{ background: 'linear-gradient(135deg,#008080,#2DD4BF)' }}>{s.eyebrow}</span>
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
        style={{ background: 'radial-gradient(circle, rgba(0,128,128,0.22) 0%, rgba(45,212,191,0.10) 45%, transparent 70%)' }}
      />
      <div className="max-w-6xl mx-auto relative">
        {/* Prices go up for new members on January 1; the lock and countdown. */}
        {!newPricesLive() && <PriceLockCountdown tone="light" className="mb-10" />}
        <div className="text-center max-w-3xl mx-auto mb-10">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{
              backgroundColor: 'rgba(0,128,128,0.12)',
              color: '#0C6E6B',
              border: '1px solid rgba(0,128,128,0.25)',
            }}
          >
            <Sparkles size={10} />
            Pricing
          </span>
          <h2
            className="text-[40px] sm:text-[54px] font-extrabold tracking-[-0.03em] leading-[1.02] mb-5"
            style={{ color: 'var(--text)' }}
          >
            One plan.{' '}
            <span
              style={{
                background: 'linear-gradient(135deg, #008080 0%, #2DD4BF 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              All of MVP.
            </span>
          </h2>
          <p
            className="text-[16px] sm:text-[17px] leading-relaxed max-w-2xl mx-auto"
            style={{ color: 'var(--text-soft)' }}
          >
            Every feature opens the day you join. {FREE_WEEK_SENTENCE} Cancel anytime, and your WordPress site stays yours forever.
          </p>
          {/* Risk reversal + honest urgency. Each renders only when set in the
              sales-page config, so nothing unverified ships. */}
          <div className="mt-5 flex items-center justify-center gap-x-5 gap-y-2 flex-wrap">
            {GUARANTEE && (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: '#059669' }}>
                <ShieldCheck size={15} /> {GUARANTEE}
              </span>
            )}
          </div>
        </div>

        {/* The free trial banner that sat here is gone (2026-10-18): there is
            no trial. The free week line above replaces it. */}

        {/* THE COLUMN COUNT FOLLOWS THE PLANS, and the row narrows with it.
            This was lg:grid-cols-3 from when three plans were sold. The array
            above already says TWO PLANS in its own comment, so two cards landed
            in a three-column row and the empty third column read as a tier that
            had failed to load. Widening the pair also buys each card the room
            to carry more detail, which is the point of having only two. */}
        <div className={`grid gap-4 lg:gap-5 mx-auto ${LANDING_PLAN_GRID[PRICING_TIERS.length] ?? LANDING_PLAN_GRID[3]}`}>
          {PRICING_TIERS.map(tier => (
            <PricingCard key={tier.name} tier={tier} />
          ))}
        </div>

        {/* THE FREE WEEK, day by day, right under the price it leads to. */}
        <div className="mt-8 max-w-5xl mx-auto">
          <FreeWeekSteps />
        </div>

        {/* The Amazon band that used to sit here is gone. It pitched "No blog?
            No YouTube? Start here." and linked to /amazon-influencer, which
            made sense while the cards above were the blog ladder only. Amazon
            is one of the two cards now, so the band re-sold a plan the reader
            had just been shown and made the section look like it had a
            leftover. Its footnote went with it: it named Studio, a frozen tier
            nobody can buy. */}

        {/* Link to the full pricing page (bundle math + free-research breakdown). */}
        <div className="mt-6 text-center">
          <a href="/pricing" className="inline-flex items-center gap-1.5 text-[14px] font-semibold" style={{ color: '#0C6E6B' }}>
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
            <Check size={12} className="text-[#10B981]" /> {FREE_WEEK_LABEL}
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
/** Grid classes per plan count, written out in full because Tailwind scans for
 *  literal class names. The max-width tightens as the count drops so two cards
 *  sit as a centred pair rather than as three with one missing. */
const LANDING_PLAN_GRID: Record<number, string> = {
  1: 'grid-cols-1 max-w-md',
  2: 'grid-cols-1 lg:grid-cols-2 max-w-4xl',
  3: 'grid-cols-1 lg:grid-cols-3 max-w-6xl',
}

const PRICING_TIERS: PricingTier[] = [
  // ONE PLAN (Seb, 2026-10-18). Nobody was on the Amazon plan and every member
  // is on Pro, so Pro is the one plan sold, with the whole product on day one
  // and a 7-day refund in place of the free trial. Amazon, Creator and Studio
  // stay in lib/tier.ts for the accounts that have them; none is a card here.
  // The list is the whole plan, not "Everything in Amazon, plus": there is no
  // plan underneath it any more.
  {
    name: 'Pro',
    tagline: 'Everything MVP does, for creators who sell on Amazon, YouTube and their own blog.',
    price: TIERS.pro.price,
    regularPrice: TIERS.pro.regularPrice,
    highlight: true,
    icon: <Rocket size={16} />,
    logo: '/png/mvp-affiliate-pro.png',
    accent: {
      grad: 'linear-gradient(135deg, #008080 0%, #008080 100%)',
      solid: '#008080',
      tint: 'rgba(0,128,128,0.12)',
      ring: 'rgba(0,128,128,0.35)',
    },
    features: [
      `📝 Your blog: ${TIERS.pro.postsPerMonth} posts / month on your own WordPress, written in your real voice`,
      'Video-to-Blog + Blog-to-Social, Comparison posts + Buying Guides',
      `Bulk Amazon upload: up to ${BULK_UPLOAD_MAX_VIDEOS} review videos at once to YouTube and your Amazon storefront`,
      `YouTube Co-Pilot: ${TIERS.pro.metadataGensPerMonth} runs / month, plus pinned and On sale comments on your videos`,
      `🎬 Clip Factory: ${SHORTS_MONTHLY_CAP} clips / month to TikTok, Instagram, Facebook Reels and YouTube Shorts`,
      `${TIERS.pro.thumbnailsPerMonth} Art Director thumbnails / month, rendered at high quality`,
      `${TIERS.pro.pinsPerMonth} Pinterest & ${TIERS.pro.igPostsPerMonth} Instagram designs / month, posted to Facebook too`,
      'Auto-post to Pinterest, Instagram, Facebook, X, TikTok, LinkedIn, Threads, Bluesky & Telegram, with your link and #ad added for you',
      '⚡ Amazon Deal Radar + all-deals & full-catalogue research, with deal posts to your socials',
      '🤝 TRYBE brand deals: best-fit brands, first messages drafted, inbox replies and 10 shooting scripts per brand',
      'Brand deals: the Creator Connections finder + a daily picked-for-you digest',
      'Partner programs: Levanta, PartnerBoost, Wayward & LTK campaigns turned into posts',
      'Shoppable Link in Bio page + Passport geo-links, unlimited clicks',
      'Amazon Live prep and follow-up, with no monthly show limit',
      `${TIERS.pro.maxFaces} face models, ${TIERS.pro.photoboothPerMonth} Photobooth headshots: your face on every design`,
      `Up to ${TIERS.pro.sites} WordPress sites, ${TIERS.pro.youtubeChannels} YouTube channels + ${TIERS.pro.vaSeats} Team seats`,
      `${TIERS.pro.scriptsPerMonth} video scripts, ${TIERS.pro.collabsPerMonth} brand pitch emails drafted / month`,
      `Ask MVP: ${TIERS.pro.assistantMessagesPerMonth} messages / month`,
      'Priority generation queue + priority support',
    ],
    cta: FREE_WEEK_CTA,
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
          ★ Everything included
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
              // WHAT THE PLAN DOES NOT INCLUDE gets a cross, not a check. The
              // "No blog" line wore a green tick, which read as a feature.
              const excluded = f.startsWith('✕')
              return (
                <li key={i} className="flex items-start gap-2.5">
                  <span
                    className="inline-flex items-center justify-center w-4 h-4 rounded-full flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: excluded ? 'var(--surface-hover)' : a.tint }}
                  >
                    {excluded
                      ? <XIcon size={11} strokeWidth={3} style={{ color: 'var(--text-faint)' }} />
                      : <Check size={11} strokeWidth={3} style={{ color: a.solid }} />}
                  </span>
                  <span className="text-[13px] leading-relaxed" style={{ color: excluded ? 'var(--text-faint)' : 'var(--text-muted)' }}>
                    {excluded ? f.replace(/^✕\s*/, '') : f}
                  </span>
                </li>
              )
            })}
          </ul>

          {/* Price block — now at the BOTTOM, right above the CTA, so the eye
              lands on the value first and the price after. */}
          <div className="mt-auto pt-4" style={{ borderTop: '1px solid var(--border)' }}>
            {tier.regularPrice > tier.price && (
              <p className="text-[12px] mb-0.5" style={{ color: 'var(--text-faint)' }}>
                <span className="line-through">${tier.regularPrice}/month</span> from January 1
              </p>
            )}
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
              href={`/signup?tier=${tier.name.toLowerCase()}`}
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
 *  Backed only by numbers we can stand behind. No fabricated customer quotes.
 */
/** Founder section — a real face + the $3M story. Trust lever the competitors
 *  both use (logie5's "since day one", Oink's "I'm Rob"). Photo: sebmichelle. */
function FounderSection() {
  return (
    <section id="founder" className="px-6 lg:px-8 pt-12 pb-8 relative">
      <div className="max-w-5xl mx-auto">
        <div className="rounded-3xl border p-6 sm:p-10 grid md:grid-cols-[minmax(0,300px)_1fr] gap-8 items-center"
          style={{ background: 'linear-gradient(135deg, rgba(0,128,128,0.05), rgba(45,212,191,0.04))', borderColor: 'var(--border)' }}>
          <NextImage
            src="/png/sebmichelle.webp"
            alt="Seb and Michelle, the founders of MVP Affiliate"
            width={600}
            height={600}
            loading="lazy"
            className="w-full h-auto rounded-2xl border"
            style={{ borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}
          />
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#008080' }}>Built by creators, not a software company</span>
            <h2 className="text-[28px] sm:text-[38px] font-extrabold tracking-[-0.03em] leading-[1.05] mt-3" style={{ color: 'var(--text)' }}>
              We built MVP to run our own business.
            </h2>
            <p className="mt-4 text-[15.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
              We&apos;re Seb and Michelle. We grew Gominplanet past <span className="font-semibold" style={{ color: 'var(--text)' }}>$3M a year</span> in affiliate revenue, and we got tired of stitching together a stack of tools that each took a cut and none of which sounded like us. So we built the tool we wished existed and ran our whole business on it. Now it runs yours, in your voice.
            </p>
            <p className="mt-4 text-[13px] font-semibold" style={{ color: '#0C6E6B' }}>Seb and Michelle, Gominplanet</p>
          </div>
        </div>
      </div>
    </section>
  )
}

/** OLD WAY / NEW WAY — the transformation, not the checklist.
 *
 *  The page already has ComparisonSection, and it does a different job: a
 *  feature grid against named competitors, which converts somebody who has
 *  already decided they want a tool and is picking one. Cold traffic off an ad
 *  has not decided anything. It needs to recognise its own Tuesday in the left
 *  column before a feature list means anything, which is the move both
 *  reference pages make and this page was missing.
 *
 *  Every right-hand line is a thing the product actually does today. The left
 *  column is deliberately not a strawman: it is the real Amazon Influencer
 *  workflow, and most of it is work the creator is genuinely doing by hand.
 */
function OldWayNewWay() {
  const ROWS: { old: string; mvp: string }[] = [
    {
      old: 'Your whole business lives on a storefront Amazon owns and can change.',
      mvp: 'Everything also lands on a blog on your own domain, which is yours whatever Amazon does next.',
    },
    {
      // HALO SALES (Seb, 2026-10-15). Said as how Amazon pays, never as a source.
      old: 'A sale through your storefront video pays you on that one product.',
      mvp: 'A shopper who reaches Amazon from your blog, a pin or a video description can earn you on everything else they buy within 24 hours, not just the product you linked.',
    },
    {
      old: 'A video gets filmed, uploaded, and that is the end of its life.',
      mvp: 'One video becomes an article, a description, tags, a thumbnail, social posts and vertical clips.',
    },
    {
      // TRYBE (Seb, 2026-10-18: "it is exploding right now").
      old: 'Brand deals mean scrolling a marketplace, guessing which brands are worth it and writing every pitch from scratch.',
      mvp: 'MVP sorts every brand on TRYBE by fit for your channel, drafts your first message in your words, and writes the shooting scripts once a brand says yes.',
    },
    {
      old: 'Hours go into editing and planning each video, and the extra time never shows up in what you earn.',
      mvp: `Co-Pilot writes the title, description and tags in minutes, and Bulk Amazon upload sends up to ${BULK_UPLOAD_MAX_VIDEOS} videos to YouTube and your Amazon storefront in one press.`,
    },
    {
      old: 'Your thumbnail is a plain still that disappears on a crowded carousel.',
      mvp: 'One click makes a bright, clean thumbnail of you with the product that still looks like you.',
    },
    {
      old: 'A product you reviewed goes on sale and nobody watching your old video ever hears about it.',
      mvp: 'On sale comments spot the sale, pin a comment with your link on that video, and take the sale out when it ends.',
    },
    {
      old: 'Writing the review is the evening you did not want to spend.',
      mvp: 'It is written from your own transcript, in your voice, from what you actually said on camera.',
    },
    {
      old: 'Posting to Pinterest, Instagram and Facebook is another hour you skip.',
      mvp: 'The post goes out to every channel you connect, on a schedule, with the images made for you.',
    },
    {
      old: 'International clicks land on the wrong Amazon and earn you nothing.',
      mvp: 'Passport routes every shopper to their own country\u2019s Amazon. Unlimited, no cost per click.',
    },
    {
      old: 'A dead product link sits there for weeks before you notice.',
      mvp: 'Broken and off-style links are found, counted link by link, and repaired in one pass.',
    },
  ]
  return (
    <section id="old-new" className="px-6 lg:px-8 pt-16 sm:pt-20 pb-8 relative">
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#008080' }}>The difference</span>
          <h2 className="text-[32px] sm:text-[44px] font-extrabold tracking-[-0.03em] leading-[1.03] mt-3" style={{ color: 'var(--text)' }}>
            Same videos. Completely different business.
          </h2>
          <p className="mt-4 text-[15.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
            You are not short of effort. You are short of everything that effort should have turned into.
          </p>
        </div>

        <div className="mt-10 grid md:grid-cols-2 gap-4">
          {/* Old way */}
          <div className="rounded-2xl border p-5 sm:p-6" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] mb-4" style={{ color: 'var(--text-faint)' }}>Without MVP</p>
            <ul className="flex flex-col gap-3.5">
              {ROWS.map((r, i) => (
                <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
                  <XIcon size={15} className="mt-0.5 flex-shrink-0" style={{ color: '#ff3b30' }} />
                  <span>{r.old}</span>
                </li>
              ))}
            </ul>
          </div>
          {/* New way */}
          <div className="rounded-2xl border p-5 sm:p-6" style={{ background: 'linear-gradient(135deg, rgba(0,128,128,0.06), rgba(45,212,191,0.04))', borderColor: 'rgba(0,128,128,0.25)' }}>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] mb-4" style={{ color: '#008080' }}>With MVP</p>
            <ul className="flex flex-col gap-3.5">
              {ROWS.map((r, i) => (
                <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed" style={{ color: 'var(--text)' }}>
                  <Check size={15} className="mt-0.5 flex-shrink-0" style={{ color: '#34c759' }} />
                  <span>{r.mvp}</span>
                </li>
              ))}
            </ul>
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
          <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#008080' }}>Loved by creators</span>
          <h2 className="text-[32px] sm:text-[44px] font-extrabold tracking-[-0.03em] leading-[1.03] mt-3" style={{ color: 'var(--text)' }}>
            What creators say
          </h2>
          {/* The count, and only once it is worth stating. Three is the point at
              which "creators" stops being a stretch; below that the wall speaks
              for itself and a number would be padding. */}
          {TESTIMONIALS.length >= 3 && (
            <p className="mt-3 text-[14px]" style={{ color: 'var(--text-soft)' }}>
              <span style={{ color: '#F5A623' }}>★★★★★</span> from {TESTIMONIALS.length} Amazon Influencers running MVP on their own blogs.
            </p>
          )}
        </div>
        <div className={`mt-10 gap-4 ${TESTIMONIALS.length === 1 ? 'max-w-xl mx-auto' : TESTIMONIALS.length === 2 ? 'grid sm:grid-cols-2 max-w-3xl mx-auto' : 'grid sm:grid-cols-2 lg:grid-cols-3'}`}>
          {TESTIMONIALS.map((t, i) => (
            <figure key={i} className="rounded-2xl border p-5 flex flex-col" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="text-[13px] mb-2" style={{ color: '#F5A623' }}>★★★★★</div>
              {/* The RESULT above the quote, when the creator stated one. A
                  reader skimming three cards reads three bold outcomes and stops
                  at the one that sounds like their own month. Absent on a quote
                  that has no number, rather than invented for it. */}
              {t.result && (
                <p className="text-[15px] font-bold leading-snug mb-2.5" style={{ color: 'var(--text)' }}>{t.result}</p>
              )}
              <blockquote className="text-[14px] leading-relaxed flex-1" style={{ color: t.result ? 'var(--text-soft)' : 'var(--text)' }}>“{t.quote}”</blockquote>
              {/* Face, name, and what they do. A quote with a face outperforms the
                  same quote without one, which is the whole reason the reference
                  pages carry twenty-three headshots. The card lays out correctly
                  with no photo, so a quote goes up the day it arrives. */}
              <figcaption className="mt-4 flex items-center gap-3">
                {t.photo && (
                  <NextImage
                    src={t.photo}
                    alt={t.name}
                    width={80}
                    height={80}
                    loading="lazy"
                    className="w-10 h-10 rounded-full object-cover border flex-shrink-0"
                    style={{ borderColor: 'var(--border)' }}
                  />
                )}
                <span className="text-[12.5px] leading-tight">
                  <span className="font-semibold block" style={{ color: 'var(--text)' }}>{t.name}</span>
                  {(t.title || t.handle) && (
                    <span style={{ color: 'var(--text-faint)' }}>
                      {t.title}{t.title && t.handle ? ' · ' : ''}{t.handle}
                    </span>
                  )}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Passport spotlight — the pricing differentiator. Geo-routing itself isn't
 *  unique (Geniuslink and others do it), so we lead with what IS: no per-click
 *  fees, unlimited, included free on every paid plan. Comparison kept generic on
 *  purpose (we recommend Geniuslink elsewhere, so we don't name-and-shame it). */
function PassportSpotlight() {
  return (
    <section id="passport" className="px-6 lg:px-8 pt-12 pb-8 relative">
      <div className="max-w-5xl mx-auto rounded-3xl border p-6 sm:p-10"
        style={{ background: 'linear-gradient(135deg, rgba(0,128,128,0.06), rgba(52,199,89,0.05))', borderColor: 'rgba(0,128,128,0.25)' }}>
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.14em] text-white px-2.5 py-1 rounded-full" style={{ background: 'linear-gradient(135deg,#008080,#2DD4BF)' }}>
            <Globe size={12} /> A first of its kind
          </span>
          <h2 className="text-[28px] sm:text-[38px] font-extrabold tracking-[-0.03em] leading-[1.05] mt-4" style={{ color: 'var(--text)' }}>
            Geo-routing that&apos;s completely free. Never pay per click.
          </h2>
          <p className="mt-4 text-[15.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
            When a shopper from another country taps your link, Passport routes them to their own country&apos;s Amazon, so the sale counts and the commission is yours. Everyone else charges by the click for this, and the bill climbs as you grow. Passport is the first to make it completely free: included on every paid MVP plan, with <span className="font-semibold" style={{ color: 'var(--text)' }}>unlimited links and unlimited clicks, no matter how big you get.</span> No overage, ever.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 mt-7">
          <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-faint)' }}>Typical geo-link tool</p>
            <p className="text-[15px] font-semibold mt-2" style={{ color: 'var(--text)' }}>Monthly fee, then charged by the click.</p>
            <p className="text-[13px] mt-1.5" style={{ color: 'var(--text-soft)' }}>Your cost grows with your traffic. The more you scale, the more you pay.</p>
          </div>
          <div className="rounded-2xl border p-5" style={{ borderColor: 'rgba(0,128,128,0.4)', background: 'linear-gradient(135deg, rgba(0,128,128,0.1), rgba(52,199,89,0.06))' }}>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: '#008080' }}>Passport Links</p>
            <p className="text-[15px] font-semibold mt-2" style={{ color: 'var(--text)' }}>Free on your plan. Unlimited links and clicks.</p>
            <p className="text-[13px] mt-1.5" style={{ color: 'var(--text-soft)' }}>No per-click fees, no overage. The more you scale, the more you keep.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

/** Support & community — the "you're not doing this alone" section. Matches the
 *  education + community that logie5 and Oink lean on (tutorials, calls, group). */
const COMMUNITY: { Icon: typeof Play; title: string; desc: string; href?: string; cta?: string }[] = [
  { Icon: Play, title: 'Video tutorials', desc: 'Step-by-step tutorials for every feature on the MVP YouTube channel, so you are never stuck.', href: 'https://www.youtube.com/@MVPaffiliate', cta: 'Watch on YouTube' },
  { Icon: Calendar, title: 'Weekly live calls', desc: 'Jump on our weekly calls to get your questions answered and talk shop on affiliate marketing and everything online.' },
  { Icon: Facebook, title: 'A private community', desc: 'A Facebook group where creators share what is working, celebrate wins, and help shape what we build next.', href: 'https://www.facebook.com/groups/mvpaffiliate', cta: 'Join the group' },
]
function CommunitySection() {
  return (
    <section id="community" className="px-6 lg:px-8 pt-12 pb-8 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#008080' }}>You are not doing this alone</span>
          <h2 className="text-[32px] sm:text-[44px] font-extrabold tracking-[-0.03em] leading-[1.03] mt-3" style={{ color: 'var(--text)' }}>
            Support and a community behind you
          </h2>
        </div>
        <div className="grid sm:grid-cols-3 gap-4 mt-10">
          {COMMUNITY.map(({ Icon, title, desc, href, cta }) => {
            const inner = (
              <>
                <div className="w-11 h-11 rounded-xl grid place-items-center mx-auto mb-3.5" style={{ background: 'rgba(0,128,128,0.1)', color: '#008080' }}><Icon size={20} /></div>
                <h3 className="text-[16.5px] font-bold mb-1.5" style={{ color: 'var(--text)' }}>{title}</h3>
                <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{desc}</p>
                {href && cta && (
                  <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold mt-3" style={{ color: '#008080' }}>{cta} <ArrowRight size={12} /></span>
                )}
              </>
            )
            return href ? (
              <a key={title} href={href} target="_blank" rel="noopener noreferrer"
                className="rounded-2xl border p-6 text-center block transition-all hover:-translate-y-0.5"
                style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                {inner}
              </a>
            ) : (
              <div key={title} className="rounded-2xl border p-6 text-center" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                {inner}
              </div>
            )
          })}
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
              backgroundColor: 'rgba(0,128,128,0.12)',
              color: '#0C6E6B',
              border: '1px solid rgba(0,128,128,0.25)',
            }}
          >
            <TrendingUp size={10} />
            Proven, not projected
          </span>
          <h2
            className="text-[36px] sm:text-[46px] font-extrabold tracking-[-0.03em] leading-[1.05] mb-4"
            style={{ color: 'var(--text)' }}
          >
            Real revenue, not a pitch deck.
          </h2>
          <p
            className="text-[16px] leading-relaxed max-w-2xl mx-auto"
            style={{ color: 'var(--text-soft)' }}
          >
            Every part of MVP earns its place in a business that really runs on it, and that track record is a big reason brands want to work with the creators who use it.
          </p>
        </div>

        {/* The stat row: only numbers we can back up. */}
        <div className="grid grid-cols-1 gap-4 max-w-xs mx-auto">
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
  // "4 min", "9 outputs" and "0 fabricated claims" came out (Seb, 2026-10-07):
  // none of them could be checked against anything. Only numbers we can stand
  // behind go here.
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
          background: 'linear-gradient(135deg, #008080 0%, #2DD4BF 100%)',
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
            'radial-gradient(ellipse 70% 60% at 50% 30%, rgba(0,128,128,0.18), transparent 70%)',
        }}
        aria-hidden
      />

      <div className="max-w-4xl mx-auto text-center relative">
        <span
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-6"
          style={{
            backgroundColor: 'rgba(0,128,128,0.15)',
            color: '#7FD4D0',
            border: '1px solid rgba(0,128,128,0.30)',
          }}
        >
          Ready when you are
        </span>
        <h2
          className="text-[44px] sm:text-[64px] font-extrabold tracking-[-0.035em] leading-[1.0] mb-5"
          style={{ color: 'var(--text)' }}
        >
          {/* Not the hero's line again: the page has already made that promise,
              so the close turns it into the next step. */}
          One plan. Every platform.{' '}
          <span
            style={{
              background: 'linear-gradient(135deg, #008080 0%, #2DD4BF 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Start with your next video.
          </span>
        </h2>
        <p
          className="text-[17px] sm:text-[18px] leading-relaxed max-w-2xl mx-auto mb-8"
          style={{ color: 'var(--text-soft)' }}
        >
          Pro is ${TIERS.pro.price} a month with every feature open from day one. {FREE_WEEK_SENTENCE}
        </p>

        {/* Twin CTAs — primary action + lower-friction demo link. */}
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-center mb-8">
          <a
            href="/signup?tier=pro"
            className="px-7 py-3.5 rounded-xl text-[15px] font-semibold text-white inline-flex items-center gap-2 transition-all hover:scale-[1.02]"
            style={{
              background: 'linear-gradient(135deg, #008080 0%, #2DD4BF 100%)',
              boxShadow: '0 8px 28px rgba(0,128,128,0.40)',
            }}
          >
            {FREE_WEEK_CTA}
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
            <Check size={12} className="text-[#10B981]" /> {FREE_WEEK_LABEL}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check size={12} className="text-[#10B981]" /> Every feature from day one
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
        {/* Primary CTA, short enough to never crowd the wordmark on a phone. */}
        <a
          href="/signup?tier=pro"
          className="px-3.5 py-1.5 rounded-lg bg-[#008080] hover:bg-[#00706E] text-[13px] font-medium text-white transition-colors whitespace-nowrap"
        >
          {/* The whole offer from sm up; on a phone the short form keeps the
              wordmark clear. */}
          <span className="hidden sm:inline">{FREE_WEEK_CTA_SHORT}</span>
          <span className="sm:hidden">Try free</span>
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
  // The free Amazon Influencer guide. A lead magnet earns its place in the nav
  // ahead of the FAQ: it is the one link here that asks for nothing.
  { label: 'Free Guide', href: '/freeguide' },
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
          opacity: 0.12,
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
            radial-gradient(50% 70% at 25% 25%, rgba(0,128,128,0.55), transparent 60%),
            radial-gradient(45% 65% at 80% 20%, rgba(45,212,191,0.45), transparent 65%),
            radial-gradient(70% 50% at 60% 100%, rgba(45,212,191,0.28), transparent 70%)
          `,
        }}
      />

      <div className="relative max-w-7xl mx-auto px-5 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-28 grid lg:grid-cols-[1fr_minmax(0,560px)] gap-10 lg:gap-14 items-center">
        {/* ── Left: copy + CTAs ────────────────────────────────────── */}
        <div>
          {/* Pill */}
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10.5px] sm:text-[11px] uppercase tracking-[0.08em] sm:tracking-[0.16em] font-medium mb-4 whitespace-nowrap"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text-soft)',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#008080]" />
            For Amazon Influencers &amp; UGC creators
          </div>

          {/* Trust strip — lifted to live above the headline. Establishes
              credibility BEFORE the bold value claim, so the headline
              lands on a primed visitor. */}
          <p className="mb-6 text-[12px] font-medium" style={{ color: 'var(--text-subtle)' }}>
            Built by a <span style={{ color: 'var(--text-muted)' }}>$3M/yr affiliate creator</span>. {FREE_WEEK_SHORT} on the monthly plan, cancel anytime.
          </p>

          {/* Main + Secondary headlines — fat, tight, high-contrast (logie5-style).
              Leads with the positioning: one tool, every feature, no compromise. */}
          {/* THE HEADLINE NAMES THE READER AND THE THING THEY DO NOT OWN.
              The previous one, "Everything an Amazon affiliate needs. Zero
              compromise.", is a claim about the product. It reads as a boast to
              somebody who has never heard of us, and cold traffic from an ad has
              heard of nobody. This names the buyer, the asset, and the fear they
              already have, and it is the one promise the storefront tools cannot
              make: their whole product optimises a shopfront Amazon owns. */}
          {/* ONE HUB (Seb, 2026-10-18: "really be impactful and strongly push MVP
              as the one central hub tool that can do it all"). The headline is
              the whole promise in six words; the line under it lists the hub,
              so the claim is backed before the reader scrolls. Three fixed lines
              so "else." never ends up alone on a phone. */}
          <h1
            className="text-[38px] sm:text-[58px] lg:text-[70px] font-extrabold tracking-[-0.035em] leading-[0.98]"
            style={{ color: 'var(--text)' }}
          >
            <span className="block">Film it once.</span>
            <span className="block" style={{ background: 'linear-gradient(120deg, #2DD4BF 0%, #2DD4BF 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>MVP does</span>
            <span className="block" style={{ background: 'linear-gradient(120deg, #2DD4BF 0%, #008080 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>everything else.</span>
          </h1>
          <p
            className="mt-6 text-[18px] sm:text-[20px] font-semibold tracking-tight leading-snug max-w-2xl [text-wrap:pretty]"
            style={{ color: 'var(--text-muted)' }}
          >
            Drop in one video and MVP turns it into your YouTube upload, your Amazon storefront video, a blog post built to rank, Shorts and Reels, and posts on nine social networks, all in your voice. Then it finds the brands on TRYBE that will pay you for the next one.
          </p>

          {/* Sub */}
          <p
            className="mt-6 text-[16px] leading-relaxed max-w-xl"
            style={{ color: 'var(--text-soft)' }}
          >
            One login and one plan in place of a stack of tools: the uploads, the thumbnails, the clips, the posts, the brand deals and the research. Your blog sits on <span style={{ color: 'var(--text)' }}>your own domain</span> and stays yours forever. <span style={{ color: 'var(--text)' }}>No video yet? Paste any product link</span> and MVP writes the review itself.
          </p>

          {/* CTAs — primary button + its supporting reassurance live as
              separate elements so the button stays readable and the
              "yours forever" promise sits clearly below both CTAs. */}
          <div className="mt-8">
            <div className="flex flex-wrap items-center gap-3">
              <a
                href="/signup?tier=pro"
                className="px-5 py-3 rounded-xl bg-[#008080] hover:bg-[#00706E] text-[14px] font-semibold text-white inline-flex items-center gap-2 transition-colors shadow-[0_4px_16px_rgba(0,128,128,0.3)]"
              >
                {FREE_WEEK_CTA}
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
            {/* What the button costs, said beside it before anyone wonders. */}
            <p className="mt-3 text-[13px] font-medium" style={{ color: 'var(--text-soft)' }}>
              {freeWeekUnderButton(TIERS.pro.price)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px]" style={{ color: 'var(--text-faint)' }}>
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
              href="#trybe"
              className="mt-6 inline-flex items-center gap-2.5 rounded-2xl px-4 py-3 text-[13px] font-medium transition-transform hover:-translate-y-0.5"
              style={{
                background: 'linear-gradient(135deg, rgba(249,115,22,0.14), rgba(45,212,191,0.14))',
                border: '1px solid rgba(249,115,22,0.3)',
                color: 'var(--text)',
              }}
            >
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0" style={{ background: 'linear-gradient(135deg, #2DD4BF, #2DD4BF)', color: '#fff' }}>
                <Handshake size={14} />
              </span>
              <span>
                <span className="font-semibold">New: TRYBE brand deals.</span>{' '}
                <span style={{ color: 'var(--text-soft)' }}>MVP sorts every TRYBE brand by fit for your channel, drafts your pitch and writes the shooting scripts.</span>
              </span>
              <ArrowRight size={14} className="flex-shrink-0" style={{ color: '#2DD4BF' }} />
            </a>
          </div>
        </div>

        {/* ── Right: the full walkthrough, ready to play (Seb, 2026-10-18) ── */}
        <div className="w-full self-center">
          <HeroVideo />
        </div>
      </div>
    </section>
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
  { label: 'TRYBE brand deals: best-fit brands, pitches drafted, inbox replies and shooting scripts', mvp: true, others: 'no' },
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
            <span style={{ background: 'linear-gradient(120deg, #2DD4BF 0%, #2DD4BF 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Your data stays yours.
            </span>
          </h2>
          <p className="mt-5 text-[16px] sm:text-[17px] leading-relaxed max-w-2xl mx-auto" style={{ color: 'var(--text-soft)' }}>
            Other Amazon affiliate tools make you stitch together three or four services, and pay for it with your personal data. MVP does the whole job in one place, and never touches yours.
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
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-white" style={{ background: 'linear-gradient(135deg, #008080, #2DD4BF)' }}>
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
              We don&apos;t harvest, sell, or train on your personal data: not your audience, not your earnings, not your content. Your accounts stay connected to <span style={{ color: 'var(--text)' }}>you</span>, and your site is yours to keep forever.
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
          <span className="font-bold" style={{ color: '#008080' }}>{PLATFORMS.length} channels</span>.
          {' '}No copy-paste, no separate scheduler.
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
                style={{ background: 'linear-gradient(135deg, #008080, #2DD4BF)' }}
              >
                <Sparkles size={14} className="text-white" />
              </span>
              <span className="text-[16px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
                MVP Affiliate
              </span>
            </div>
            <p className="text-[13px] max-w-md leading-relaxed" style={{ color: 'var(--text-soft)' }}>
              Your central content hub. One review video, every output, your voice, grounded in what you actually said.
            </p>
          </div>
          <a
            href="/signup?tier=pro"
            className="px-4 py-2 rounded-lg text-[13px] font-medium text-white whitespace-nowrap"
            style={{ background: 'linear-gradient(135deg, #008080, #2DD4BF)' }}
          >
            {FREE_WEEK_CTA_SHORT} →
          </a>
        </div>

        {/* Link columns */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 py-10">
          <FooterCol
            title="Product"
            links={[
              { label: 'Roles', href: '#roles' },
              { label: 'TRYBE brand deals', href: '#trybe' },
              { label: 'Workflow', href: '#how-it-works' },
              { label: 'Videos', href: '#videos' },
              { label: 'Product tour', href: '/tour' },
              { label: 'Pricing', href: '/pricing' },
              { label: 'FAQ', href: '#faq' },
            ]}
          />
          {/* Public resources only — no member-only in-app tools here (WordPress
              setup / Connection Doctor live behind auth and would just bounce a
              logged-out visitor to /login). */}
          <FooterCol
            title="Resources"
            links={[
              { label: 'Free Guide', href: '/freeguide' },
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

