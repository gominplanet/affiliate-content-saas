/**
 * /features — the full product feature list (mvpaffiliate.io/features).
 *
 * The deep-dive companion to the homepage's condensed feature grid: every MVP
 * capability, organized by the MVP Loop (Find -> Create -> Publish -> Earn) so
 * the page sells the workflow, not a pile of bullets. Server Component.
 *
 * Look: the Creator-Lens-style system shared with /landing-preview. Warm cream
 * background with warm tonal bands, a teal accent (#008080), big bold headlines
 * in Plus Jakarta Sans (loaded as --font-jakarta), light eyebrow pills, pill
 * buttons with a soft glow, and soft white rounded cards.
 *
 * Source of truth for feature copy: keep this truthful to what ships. If a
 * capability changes, update this page too. Prices and the free week come from
 * TIERS / lib/guarantee at render time, never typed.
 *
 * GUARD: test-us-only-uploads requires this page never claim uploads reach
 * other countries, nor any form of video dubbing. Uploads are the US store
 * only, so keep the "US Amazon storefront" phrasing.
 */
import type { Metadata } from 'next'
import { FREE_WEEK_CTA, FREE_WEEK_CTA_SHORT, freeWeekUnderButton } from '@/lib/guarantee'
import { TIERS } from '@/lib/tier'
import { MAX_ITEMS as LIFTOFF_MAX_VIDEOS } from '@/lib/launch-batch'
import NextImage from 'next/image'
import {
  Search, Rocket, Radar, Sparkles, Store, Play,
  FileText, Zap, ShieldCheck, TrendingUp, ArrowRight, Check,
  Mail, LayoutGrid, MapPin, Users, Pin, Radio, Handshake,
} from 'lucide-react'

export const metadata: Metadata = {
  title: 'Features',
  description:
    'Every MVP Affiliate feature, organized by the loop that turns one product into offsite Amazon revenue: find paying brands, create in your voice, publish everywhere, and earn on every click.',
}

// ── Warm cream palette with a single teal accent. Shared with /landing-preview. ──
const C = {
  bg: '#FBF7F2', band: '#F6EDE4', card: '#FFFFFF',
  text: '#1C1917', muted: '#57534E', soft: '#78716C', faint: '#A8A29E',
  border: 'rgba(28,25,23,0.10)', borderSoft: 'rgba(28,25,23,0.07)',
  accent: '#008080', accentText: '#0C6E6B', accentSoft: 'rgba(0,128,128,0.10)',
  grad: 'linear-gradient(135deg, #2DD4BF 0%, #008080 100%)',
  cardShadow: '0 1px 3px rgba(28,25,23,0.04), 0 16px 38px -16px rgba(28,25,23,0.20)',
  glow: '0 10px 28px rgba(0,128,128,0.34)',
  ok: '#16A34A',
} as const
const DISPLAY = { fontFamily: 'var(--font-jakarta), var(--font-sans), system-ui, sans-serif' } as const

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-bold uppercase tracking-[0.14em]" style={{ backgroundColor: C.accentSoft, color: C.accentText }}>
      {children}
    </span>
  )
}

function Nav() {
  return (
    <nav className="sticky top-0 z-20 backdrop-blur-md px-5 sm:px-8 lg:px-12 py-4 flex items-center justify-between"
      style={{ backgroundColor: 'rgba(251,247,242,0.82)', borderBottom: `1px solid ${C.borderSoft}` }}>
      <a href="/" className="flex items-center gap-2.5">
        <NextImage src="/png/mvp-affiliate-trial.png" alt="MVP Affiliate" width={32} height={32} className="w-8 h-8 rounded-lg" />
        <span className="text-[17px] font-extrabold tracking-tight" style={{ ...DISPLAY, color: C.text }}>MVP Affiliate</span>
      </a>
      <div className="hidden lg:flex items-center gap-3 absolute left-1/2 -translate-x-1/2">
        {[{ label: 'Tour', href: '/tour' }, { label: 'Pricing', href: '/pricing' }, { label: 'Affiliates', href: '/affiliates' }].map(a => (
          <a key={a.href} href={a.href} className="px-3 py-2 rounded-lg text-[15px] font-medium transition-colors hover:opacity-70" style={{ color: C.muted }}>{a.label}</a>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <a href="/login" className="hidden sm:inline px-3 py-2 text-[15px] font-medium transition-colors hover:opacity-70" style={{ color: C.muted }}>Sign in</a>
        <a href="/signup?tier=pro" className="px-5 py-2.5 rounded-full text-[15px] font-bold text-white transition-transform hover:-translate-y-px whitespace-nowrap" style={{ backgroundColor: C.accent, boxShadow: C.glow }}>
          <span className="hidden sm:inline">{FREE_WEEK_CTA_SHORT}</span><span className="sm:hidden">Try free</span>
        </a>
      </div>
    </nav>
  )
}

const LOOP = [
  { k: 'Find', d: 'Surface the live brand campaigns that actually pay, and the products worth reviewing.' },
  { k: 'Create', d: 'Write the review, comparisons and social posts in your real voice. Thumbnails and Shorts included.' },
  { k: 'Publish', d: 'Push it to YouTube, your Amazon storefront, your blog and your socials.' },
  { k: 'Earn', d: "Route every click to the shopper's own store with your tag, and see which channel sends them." },
]

type Feat = { icon: React.ReactNode; title: string; desc: string; tag?: string; flagship?: boolean; wide?: boolean }

const GROUPS: { id: string; n: string; tag: string; head: string; intro: string; items: Feat[] }[] = [
  {
    id: 'find', n: '01', tag: 'Find the money', head: 'The paying opportunities, not a wall of products.',
    intro: "MVP reads Amazon's Creator Connections, TRYBE and the deal feeds directly, so you spend time on brands that convert, not on scrolling.",
    items: [
      { icon: <Search size={20} />, wide: true, title: 'Creator Connections campaign finder', desc: "Every live campaign with the numbers that matter: commission, dollars per sale, spots left, days remaining, and whether the brand actually pays out. Filter by any of them, or by brands you have already joined." },
      { icon: <Mail size={20} />, flagship: true, title: 'Bulk brand outreach', desc: 'Tick up to 100 brands and MVP joins each campaign and sends a message drafted from your profile, in the background, one at a time so the burst is never flagged. Replies surface automatically.' },
      { icon: <Handshake size={20} />, flagship: true, title: 'TRYBE brand deals', desc: 'Every TRYBE brand sorted by fit for your channel, your first message drafted in your words, a suggested reply on every conversation, and ten shooting scripts per brand from its brief.' },
      { icon: <Radar size={20} />, title: 'Amazon Deal Radar', desc: 'Live deals verified against real price history, with no fake "was" prices, so a drop you post is a drop that happened. MVP turns the genuine ones into posts and a shoppable bio.' },
      { icon: <Users size={20} />, wide: true, title: 'Every brand you have worked with, remembered', desc: 'A portfolio of the content you made per brand, pulled from your storefront and posts, not manual logging, so you have receipts ready the next time you pitch a collab.' },
    ],
  },
  {
    id: 'create', n: '02', tag: 'Create in your voice', head: 'It sounds like you, because it learned from you.',
    intro: 'MVP studies how you talk on camera and how you edit, then writes everything to match, and sharpens the more you use it.',
    items: [
      { icon: <Sparkles size={20} />, tag: 'Learns over time', title: 'Writes in your real voice', desc: 'A voice fingerprint learned from your own transcripts and edits feeds every post, per channel if you run more than one. Reviews read like you wrote them.' },
      { icon: <TrendingUp size={20} />, title: 'Thumbnails from real frames and your selfies', desc: "SCOUT grabs true frames from your video, and MVP builds a scroll-stopping thumbnail from your own product and, if you add a few selfies, your own face. Never a stranger's." },
      { icon: <FileText size={20} />, title: 'Reviews, comparisons and Shorts', desc: 'A full review post, a head-to-head comparison, and vertical Shorts, all from one product and your transcript, grounded in what you actually said on camera.' },
    ],
  },
  {
    id: 'publish', n: '03', tag: 'Publish everywhere', head: 'One video, every surface it belongs on.',
    intro: 'The same review goes to YouTube, your Amazon storefront, your blog and your socials, each one formatted for where it lands.',
    items: [
      { icon: <Play size={20} />, title: 'YouTube Co-Pilot', desc: 'Titles that earn the click, an AI thumbnail, full metadata, and a real publish, with paid-promotion disclosure and monetization set for you, not left as homework.' },
      { icon: <Rocket size={20} />, title: 'Bulk Amazon upload', desc: `Up to ${LIFTOFF_MAX_VIDEOS} videos, one press. Choose your CTA and thumbnail look once, then press Launch. MVP schedules every video on YouTube with its disclosures set, then sends each one to your US Amazon storefront, with a report of where each landed.` },
      { icon: <Pin size={20} />, title: 'Pinned and On sale comments', desc: 'A pinned comment with your product link under each YouTube video. When a product you reviewed goes on sale, the comment says so, and the sale comes out again when it ends.' },
      { icon: <Radio size={20} />, title: 'Amazon Live prep and follow-up', desc: 'The lineup and talking points ready before you go live, then clips and a roundup post drafted from the replay after the show.' },
      { icon: <Store size={20} />, title: 'Blog and WordPress', desc: 'Publish the review to your own blog network, formatted, illustrated and linked, so you own an asset that keeps earning past the feed.' },
      { icon: <LayoutGrid size={20} />, wide: true, title: 'Social Launch Kit, Clip Factory and Link in Bio', desc: 'Stand up a whole social presence in minutes, post Shorts to Instagram, Facebook Reels, TikTok and YouTube Shorts, and hand shoppers a Link in Bio storefront that fills itself from what you post. Every post carries #ad #sponsored and labels where its links go.' },
    ],
  },
  {
    id: 'earn', n: '04', tag: 'Earn on every click', head: 'No wasted click, no wrong country.',
    intro: "A viewer in Berlin who lands on the US store rarely buys. MVP's links fix that, and show you exactly where the money comes from.",
    items: [
      { icon: <MapPin size={20} />, flagship: true, wide: true, title: 'Passport Links', desc: "One short link sends every shopper to their own country's Amazon store, with your tag for that country, at click time. It works for any affiliate link, cloaks the destination, and groups each click by channel so you see how many YouTube, Pinterest and your blog each send." },
      { icon: <ShieldCheck size={20} />, tag: 'Yours', title: 'Your voice, your data', desc: 'MVP works from your content and nothing else. It never sells or reuses your personal data, and your face, from Photobooth, stays yours.' },
    ],
  },
]

function TagPill({ children, flagship }: { children: React.ReactNode; flagship?: boolean }) {
  return (
    <span className="self-start text-[10.5px] font-bold uppercase tracking-wide px-2.5 py-[3px] rounded-full"
      style={flagship
        ? { background: C.accentSoft, color: C.accentText }
        : { background: 'rgba(28,25,23,0.06)', color: C.soft }}>
      {children}
    </span>
  )
}

function Card({ f }: { f: Feat }) {
  return (
    <div className={`flex flex-col gap-2.5 rounded-3xl p-7 ${f.wide ? 'sm:col-span-2' : ''}`}
      style={{ background: C.card, boxShadow: C.cardShadow }}>
      <div className="w-12 h-12 rounded-2xl grid place-items-center mb-0.5" style={{ background: C.accentSoft, color: C.accentText }}>{f.icon}</div>
      {(f.tag || f.flagship) && <TagPill flagship={f.flagship}>{f.flagship ? 'Flagship' : f.tag}</TagPill>}
      <h3 className="text-[19px] font-extrabold tracking-tight" style={{ ...DISPLAY, color: C.text }}>{f.title}</h3>
      <p className="text-[15px] leading-relaxed" style={{ color: C.soft }}>{f.desc}</p>
    </div>
  )
}

export default function FeaturesPage() {
  return (
    <div style={{ backgroundColor: C.bg, color: C.text }} className="min-h-screen antialiased font-[family-name:var(--font-sans)]">
      <Nav />

      {/* Hero */}
      <header className="px-5 sm:px-8 lg:px-12 pt-20 sm:pt-28 pb-16 sm:pb-20">
        <div className="max-w-4xl mx-auto text-center">
          <Eyebrow>Everything MVP does</Eyebrow>
          <h1 className="text-[46px] sm:text-[66px] lg:text-[78px] font-extrabold tracking-[-0.03em] leading-[1.0] mt-8" style={{ ...DISPLAY, color: C.text }}>
            One product in.{' '}
            <span style={{ background: C.grad, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Everywhere it earns</span> out.
          </h1>
          <p className="mt-7 text-[18px] sm:text-[21px] leading-relaxed max-w-2xl mx-auto" style={{ color: C.muted }}>
            The workflow built for Amazon influencers: find the brands that pay, make the review in your real voice, publish it to YouTube and your Amazon storefront, and route every click to the right country.
          </p>
          <div className="flex flex-wrap gap-3.5 justify-center mt-10">
            <a href="/signup?tier=pro" className="inline-flex items-center gap-2 rounded-full px-8 py-4 text-[17px] font-bold text-white transition-transform hover:-translate-y-px" style={{ backgroundColor: C.accent, boxShadow: C.glow }}>
              {FREE_WEEK_CTA} <ArrowRight size={18} />
            </a>
            <a href="/pricing" className="inline-flex items-center gap-2 rounded-full px-8 py-4 text-[17px] font-bold transition-transform hover:-translate-y-px" style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, color: C.text }}>See pricing</a>
          </div>
          <p className="mt-6 text-[14px]" style={{ color: C.faint }}>{freeWeekUnderButton(TIERS.pro.price)}</p>
          <div className="flex flex-wrap justify-center gap-10 sm:gap-14 mt-16">
            {[[String(LIFTOFF_MAX_VIDEOS), 'videos in one bulk upload'], ['100', 'brands messaged in one batch'], ['1', 'press from YouTube to your storefront']].map(([n, l]) => (
              <div key={l} className="text-center">
                <div className="text-[36px] font-extrabold tabular-nums" style={{ ...DISPLAY, color: C.text }}>{n}</div>
                <div className="text-[14px] mt-1" style={{ color: C.soft }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* The Loop */}
      <section className="px-5 sm:px-8 lg:px-12 py-20 sm:py-28" id="loop" style={{ backgroundColor: C.band, borderTop: `1px solid ${C.borderSoft}`, borderBottom: `1px solid ${C.borderSoft}` }}>
        <div className="max-w-6xl mx-auto">
          <div className="max-w-2xl">
            <Eyebrow>The MVP Loop</Eyebrow>
            <h2 className="text-[34px] sm:text-[48px] lg:text-[54px] font-extrabold tracking-[-0.03em] leading-[1.02] mt-6" style={{ ...DISPLAY, color: C.text }}>Four moves, one revenue engine.</h2>
            <p className="mt-5 text-[18px] leading-relaxed" style={{ color: C.muted }}>
              Every feature below sits on one of these four steps. That is the whole product: the loop a creator runs to turn a single product into offsite income, with the busywork removed at each stage.
            </p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mt-12">
            {LOOP.map((s, i) => (
              <div key={s.k} className="relative rounded-3xl p-7" style={{ background: C.card, boxShadow: C.cardShadow }}>
                <div className="flex items-center gap-3 mb-4">
                  <span className="w-10 h-10 rounded-full grid place-items-center text-[16px] font-extrabold text-white" style={{ background: C.grad }}>{i + 1}</span>
                  <span className="text-[12.5px] font-bold uppercase tracking-[0.12em]" style={{ color: C.accentText }}>{s.k}</span>
                </div>
                <p className="text-[15px] leading-relaxed" style={{ color: C.soft }}>{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature groups */}
      {GROUPS.map((g, gi) => (
        <section key={g.id} id={g.id} style={{ backgroundColor: gi % 2 ? C.band : C.bg, borderTop: `1px solid ${C.borderSoft}` }}>
          <div className="max-w-6xl mx-auto px-5 sm:px-8 lg:px-12 py-20 sm:py-28">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2.5 text-[12.5px] font-bold uppercase tracking-[0.14em]" style={{ color: C.faint }}>
                <b style={{ color: C.accentText }}>{g.n}</b> {g.tag}
              </div>
              <h2 className="text-[30px] sm:text-[42px] font-extrabold tracking-[-0.03em] leading-[1.03] mt-4" style={{ ...DISPLAY, color: C.text }}>{g.head}</h2>
              <p className="mt-4 text-[18px] leading-relaxed" style={{ color: C.muted }}>{g.intro}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-12">
              {g.items.map(f => <Card key={f.title} f={f} />)}
            </div>
          </div>
        </section>
      ))}

      {/* SCOUT band */}
      <section id="scout" style={{ borderTop: `1px solid ${C.borderSoft}`, background: C.bg }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 lg:px-12 py-20 sm:py-28 grid lg:grid-cols-[1.1fr_1fr] gap-12 items-center">
          <div>
            <Eyebrow>The companion</Eyebrow>
            <h2 className="text-[30px] sm:text-[42px] font-extrabold tracking-[-0.03em] leading-[1.03] mt-5" style={{ ...DISPLAY, color: C.text }}>SCOUT does the Amazon work, in the background.</h2>
            <p className="mt-5 text-[17px] leading-relaxed" style={{ color: C.muted }}>
              SCOUT is MVP&apos;s browser companion. It works inside your own logged-in Amazon and YouTube, so there is no copy-pasting tokens and no leaving your account. It accepts campaigns, messages brands, uploads to storefronts and grabs real video frames, quietly, one step at a time.
            </p>
            <ul className="mt-7 grid gap-3.5">
              {[
                'Messages brands and joins campaigns without opening a single tab',
                'Uploads your video to your US Amazon storefront from your own session',
                'Pulls sharp, real frames from your YouTube videos for thumbnails',
                'One-click install from the Chrome Web Store, auto-updates itself',
              ].map(t => (
                <li key={t} className="flex gap-3 text-[16px]" style={{ color: C.text }}>
                  <Check size={19} className="flex-none mt-0.5" style={{ color: C.accentText }} /> <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl p-6 font-mono text-[13px]" style={{ background: '#13201F', color: '#D6EEEC', boxShadow: C.cardShadow }}>
            {[['BEDLORE · joined + messaged', 'done', C.ok], ['ABENE · joined + messaged', 'done', C.ok], ['HISHEET · opening chat…', 'now', '#2DD4BF'], ['IMPROVIA · queued', '·', '#5f7c79'], ['TEANT · queued', '·', '#5f7c79']].map(([label, pct, color], i) => (
              <div key={i} className="flex items-center gap-2.5 py-2" style={{ borderBottom: '1px dashed rgba(214,238,236,0.14)' }}>
                <span className="w-2 h-2 rounded-full flex-none" style={{ background: color as string, boxShadow: color === '#5f7c79' ? 'none' : `0 0 8px ${color}` }} />
                <span>{label}</span>
                <span className="ml-auto" style={{ color: '#8FB3B0' }}>{pct}</span>
              </div>
            ))}
            <div className="flex items-center gap-2.5 py-2 opacity-70">Sending 3 of 21 · paced to protect your account <span className="ml-auto" style={{ color: '#8FB3B0' }}>14%</span></div>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="px-5 sm:px-8 lg:px-12 py-20 sm:py-28 text-center" style={{ backgroundColor: C.band, borderTop: `1px solid ${C.borderSoft}` }}>
        <h2 className="text-[36px] sm:text-[52px] font-extrabold tracking-[-0.03em] leading-[1.02] max-w-[18ch] mx-auto" style={{ ...DISPLAY, color: C.text }}>Run the loop once. Then watch it compound.</h2>
        <p className="mt-5 text-[18px] leading-relaxed max-w-[46ch] mx-auto" style={{ color: C.muted }}>Find, create, publish, earn. MVP does the parts that do not need you, so you can film the next review.</p>
        <div className="flex flex-wrap gap-3.5 justify-center mt-9">
          <a href="/signup?tier=pro" className="inline-flex items-center gap-2 rounded-full px-8 py-4 text-[17px] font-bold text-white transition-transform hover:-translate-y-px" style={{ backgroundColor: C.accent, boxShadow: C.glow }}>{FREE_WEEK_CTA} <ArrowRight size={18} /></a>
          <a href="/tour" className="inline-flex items-center gap-2 rounded-full px-8 py-4 text-[17px] font-bold" style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, color: C.text }}>Take the tour</a>
        </div>
        <p className="mt-6 text-[14px] inline-flex items-center gap-1.5" style={{ color: C.faint }}><Zap size={14} /> {freeWeekUnderButton(TIERS.pro.price)}</p>
      </section>

      <footer className="py-10 text-center text-[13.5px]" style={{ borderTop: `1px solid ${C.borderSoft}`, color: C.faint, background: C.bg }}>
        <a href="/" className="hover:opacity-70" style={{ color: C.soft }}>Back to home</a>
        <span className="mx-3">·</span>
        <a href="/pricing" className="hover:opacity-70" style={{ color: C.soft }}>Pricing</a>
        <div className="mt-3">MVP Affiliate: the workflow for Amazon influencers.</div>
      </footer>
    </div>
  )
}
