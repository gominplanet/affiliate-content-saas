/**
 * /features — the full product feature list (mvpaffiliate.io/features).
 *
 * The deep-dive companion to the homepage's condensed feature grid: every MVP
 * capability, organized by the MVP Loop (Find → Create → Publish → Earn) so the
 * page sells the workflow, not a pile of bullets. Server Component, same
 * CSS-variable theme + Inter font as the homepage, wired to the real /signup and
 * /pricing links. Linked from the homepage's features section.
 *
 * Source of truth for feature copy: keep this truthful to what ships. If a
 * capability changes, update this page too.
 */
import type { Metadata } from 'next'
import NextImage from 'next/image'
import {
  Search, Rocket, Globe, Radar, Sparkles, Store, Play,
  FileText, Zap, ShieldCheck, TrendingUp, ArrowRight, Check,
  Mail, LayoutGrid, MapPin, BarChart3, Users,
} from 'lucide-react'

export const metadata: Metadata = {
  title: 'Features — MVP Affiliate',
  description:
    'Every MVP Affiliate feature, organized by the loop that turns one product into offsite Amazon revenue: find paying brands, create in your voice, publish everywhere, and earn on every click.',
}

const LIGHT_VARS: React.CSSProperties = {
  ['--bg' as string]: '#FAFAF8',
  ['--surface' as string]: '#FFFFFF',
  ['--border' as string]: 'rgba(0,0,0,0.10)',
  ['--text' as string]: '#1D1D1F',
  ['--text-soft' as string]: 'rgba(0,0,0,0.62)',
  ['--text-faint' as string]: 'rgba(0,0,0,0.40)',
  ['--card-shadow' as string]: '0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.03)',
  ['--accent-soft' as string]: 'rgba(124,58,237,0.12)',
  ['--accent-text' as string]: '#7C3AED',
}

const GRAD = 'linear-gradient(115deg, #7C3AED 0%, #C026D3 100%)'

function Nav() {
  return (
    <nav className="sticky top-0 z-20 backdrop-blur-md px-4 sm:px-8 py-4 flex items-center justify-between"
      style={{ backgroundColor: 'rgba(250,250,248,0.75)', borderBottom: '1px solid var(--border)' }}>
      <a href="/" className="flex items-center gap-2">
        <NextImage src="/png/mvp-affiliate-trial.png" alt="MVP Affiliate" width={32} height={32} className="w-8 h-8 rounded-lg" />
        <span className="font-semibold text-[15px] tracking-tight" style={{ color: 'var(--text)' }}>MVP Affiliate</span>
      </a>
      <div className="hidden lg:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
        {[{ label: 'Tour', href: '/tour' }, { label: 'Pricing', href: '/pricing' }, { label: 'Affiliates', href: '/affiliates' }].map(a => (
          <a key={a.href} href={a.href} className="px-3 py-1.5 rounded-lg text-[13px] transition-colors hover:opacity-70" style={{ color: 'var(--text-soft)' }}>{a.label}</a>
        ))}
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <a href="/login" className="px-2.5 sm:px-3 py-1.5 rounded-lg text-[13px]" style={{ color: 'var(--text-soft)' }}>Sign in</a>
        <a href="/signup" className="px-3.5 py-1.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-[13px] font-medium text-white transition-colors whitespace-nowrap">Start free<span className="hidden sm:inline"> trial</span></a>
      </div>
    </nav>
  )
}

const LOOP = [
  { k: 'Find', d: 'Surface the live brand campaigns that actually pay, and the products worth reviewing.' },
  { k: 'Create', d: 'Write the review, comparisons and social posts in your real voice. Thumbnails and Shorts included.' },
  { k: 'Publish', d: 'Push it to YouTube, every Amazon storefront, your blog and your socials, localized for each.' },
  { k: 'Earn', d: "Route every click to the shopper's own store with your tag, and see what each channel makes." },
]

type Feat = { icon: React.ReactNode; title: string; desc: string; tag?: string; flagship?: boolean; wide?: boolean }

const GROUPS: { id: string; n: string; tag: string; head: string; intro: string; items: Feat[] }[] = [
  {
    id: 'find', n: '01', tag: 'Find the money', head: 'The paying opportunities, not a wall of products.',
    intro: "MVP reads Amazon's Creator Connections and deal feeds directly, so you spend time on brands that convert, not on scrolling.",
    items: [
      { icon: <Search size={20} />, wide: true, title: 'Creator Connections campaign finder', desc: "Every live campaign with the numbers that matter — commission, estimated dollars per sale, spots left, days remaining, and whether the brand actually pays out. Filter by commission, open spots, days left, or brands you've already joined." },
      { icon: <Mail size={20} />, flagship: true, title: 'Bulk brand outreach', desc: 'Tick up to 100 brands, and MVP joins each campaign and sends a message drafted from your profile, in the background, one at a time so the burst is never flagged. Same-brand duplicates fold into one thread; replies surface automatically.' },
      { icon: <Radar size={20} />, title: 'Amazon Deal Radar', desc: 'Live deals verified against real price history — no fake "was" prices, so a drop you post is a drop that happened. MVP turns the genuine ones into posts and a shoppable bio.' },
      { icon: <Users size={20} />, wide: true, title: "Brands you've worked with, remembered", desc: 'MVP keeps a portfolio of the content you made per brand — receipts you can hand a brand when you pitch the next collab — pulled from your storefront and posts, not manual logging.' },
    ],
  },
  {
    id: 'create', n: '02', tag: 'Create in your voice', head: 'It sounds like you, because it learned from you.',
    intro: 'MVP studies how you actually talk on camera and how you edit, then writes everything to match, and sharpens the more you use it.',
    items: [
      { icon: <Sparkles size={20} />, tag: 'Learns over time', title: 'Writes in your real voice', desc: 'A voice fingerprint learned from your own transcripts and edits feeds every post, per channel if you run more than one. Reviews read like you wrote them, not generic AI.' },
      { icon: <ImageThumb />, title: 'Thumbnails from real frames & your selfies', desc: "SCOUT grabs true frames from your video, and MVP composes a scroll-stopping thumbnail using your own product and, if you add a few selfies, your own face. Never a stranger's, and never guessed from someone else's clip." },
      { icon: <FileText size={20} />, title: 'Reviews, comparisons & Shorts', desc: 'A full review post, a head-to-head comparison, and vertical Shorts — all from one product and your transcript, grounded in what you actually said on camera.' },
    ],
  },
  {
    id: 'publish', n: '03', tag: 'Publish everywhere', head: 'One video, every surface it belongs on.',
    intro: 'The same review goes to YouTube, every Amazon marketplace, your blog and your socials — each one localized and formatted for where it lands.',
    items: [
      { icon: <Globe size={20} />, flagship: true, wide: true, title: 'Global Storefront Sync', desc: "Take one master video to every Amazon storefront you sell in. MVP matches the product's ASIN in each geo, writes the title in the local language, and dubs the video for non-English markets — in your own cloned voice — with a text-free thumbnail so no English sits on a French or German shopper's screen." },
      { icon: <Play size={20} />, title: 'YouTube Co-Pilot', desc: 'Titles that earn the click, an AI thumbnail, full metadata, and a real publish — with paid-promotion disclosure and monetization set for you, not left as homework.' },
      { icon: <Rocket size={20} />, tag: 'Pro', title: 'Launchpad', desc: "Start from a video that isn't on YouTube yet. Upload it once, add a CTA, and MVP takes it to YouTube with the full Co-Pilot finish, then straight to every Amazon geo." },
      { icon: <Store size={20} />, title: 'Blog & WordPress', desc: 'Publish the review to your own blog network — formatted, illustrated, and linked — so you own an asset that keeps earning past the feed.' },
      { icon: <LayoutGrid size={20} />, wide: true, title: 'Social Launch Kit, Clip Factory & Link in Bio', desc: 'Stand up a whole social presence in minutes, auto-post Shorts to TikTok and Instagram, and hand shoppers a Link-in-Bio storefront that fills itself from what you post.' },
    ],
  },
  {
    id: 'earn', n: '04', tag: 'Earn on every click', head: 'No wasted click, no wrong country.',
    intro: "A viewer in Berlin who lands on the US store rarely buys. MVP's links fix that, and show you exactly where the money comes from.",
    items: [
      { icon: <MapPin size={20} />, flagship: true, wide: true, title: 'Passport Links', desc: "One short link sends every shopper to their own country's Amazon store, with your tag for that country, at click time. It works for any affiliate link — not just Amazon — cloaks the destination, and lands each click in a per-channel group so you see what YouTube, Pinterest and your blog each earn." },
      { icon: <BarChart3 size={20} />, title: 'Earnings you can read', desc: 'Storefront and click earnings pulled together per period, so you can tell which products, posts and channels are actually paying, and do more of what works.' },
      { icon: <ShieldCheck size={20} />, tag: 'Yours', title: 'Your voice, your data', desc: 'MVP works from your content and nothing else. It never sells or reuses your personal data, and your cloned voice and face stay yours.' },
    ],
  },
]

function ImageThumb() {
  return <TrendingUp size={20} />
}

function TagPill({ children, flagship }: { children: React.ReactNode; flagship?: boolean }) {
  return (
    <span className="self-start text-[10.5px] font-bold uppercase tracking-wide px-2 py-[3px] rounded-full"
      style={flagship
        ? { background: 'rgba(14,159,110,0.14)', color: '#0E9F6E' }
        : { background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
      {children}
    </span>
  )
}

function Card({ f }: { f: Feat }) {
  return (
    <div className={`flex flex-col gap-2.5 rounded-2xl p-6 ${f.wide ? 'sm:col-span-2' : ''}`}
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--card-shadow)' }}>
      <div className="w-10 h-10 rounded-xl grid place-items-center mb-0.5" style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>{f.icon}</div>
      {(f.tag || f.flagship) && <TagPill flagship={f.flagship}>{f.flagship ? 'Flagship' : f.tag}</TagPill>}
      <h3 className="text-[19px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>{f.title}</h3>
      <p className="text-[15px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{f.desc}</p>
    </div>
  )
}

export default function FeaturesPage() {
  return (
    <div style={{ ...LIGHT_VARS, backgroundColor: 'var(--bg)', color: 'var(--text)' }} className="min-h-screen font-[Inter,system-ui,sans-serif]">
      <Nav />

      {/* Hero */}
      <header className="relative overflow-hidden" style={{ background: 'radial-gradient(120% 80% at 82% -10%, rgba(192,38,211,0.22), transparent 55%), radial-gradient(100% 90% at 8% 0%, rgba(124,58,237,0.24), transparent 50%), #0E0817', color: '#F6F2FF' }}>
        <div className="max-w-5xl mx-auto px-6 pt-20 pb-20 sm:pt-24 sm:pb-24">
          <span className="text-[12px] font-bold uppercase tracking-[0.18em]" style={{ color: '#C4B5FD' }}>Everything MVP does</span>
          <h1 className="text-[clamp(38px,6vw,68px)] font-extrabold tracking-[-0.03em] leading-[1.03] mt-4 max-w-[16ch]">
            One product in.{' '}
            <span style={{ background: GRAD, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Everywhere it earns</span> out.
          </h1>
          <p className="mt-6 text-[clamp(17px,2vw,21px)] leading-relaxed max-w-[54ch]" style={{ color: '#CFC4E4' }}>
            MVP is the workflow built for Amazon Influencers: find the brands that pay, make the review in your real voice, publish it to YouTube and every Amazon storefront on earth, and route every click to the right country&apos;s store with your tag.
          </p>
          <div className="flex flex-wrap gap-3.5 mt-9">
            <a href="/signup" className="inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-[16px] font-semibold text-white transition-transform hover:-translate-y-0.5" style={{ background: GRAD, boxShadow: '0 10px 30px -8px rgba(192,38,211,0.6)' }}>
              Start free trial <ArrowRight size={17} />
            </a>
            <a href="/pricing" className="inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-[16px] font-semibold transition-transform hover:-translate-y-0.5" style={{ color: '#F6F2FF', border: '1px solid rgba(246,242,255,0.28)' }}>See pricing</a>
          </div>
          <div className="flex flex-wrap gap-9 mt-14">
            {[['9', 'Amazon marketplaces, one upload'], ['100', 'brands messaged in one batch'], ['1', 'voice — yours, in every language']].map(([n, l]) => (
              <div key={l}>
                <div className="text-[30px] font-extrabold tabular-nums" style={{ color: '#F6F2FF' }}>{n}</div>
                <div className="text-[13.5px] mt-0.5" style={{ color: '#B4A7CC' }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* The Loop */}
      <section className="max-w-5xl mx-auto px-6 py-20 sm:py-24" id="loop">
        <span className="text-[12px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--accent-text)' }}>The MVP Loop</span>
        <h2 className="text-[clamp(28px,4vw,44px)] font-extrabold tracking-[-0.03em] mt-3 max-w-[24ch]">Four moves, one revenue engine.</h2>
        <p className="mt-4 text-[18px] leading-relaxed max-w-[56ch]" style={{ color: 'var(--text-soft)' }}>
          Every feature below sits on one of these four steps. That&apos;s the whole product: the loop a creator runs to turn a single product into offsite income, with the busywork removed at each stage.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mt-11">
          {LOOP.map((s, i) => (
            <div key={s.k} className="relative rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="text-[12px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--accent-text)' }}>{String(i + 1).padStart(2, '0')} · {s.k}</div>
              <h3 className="text-[22px] font-bold tracking-tight mt-2.5 mb-2" style={{ color: 'var(--text)' }}>{s.k}</h3>
              <p className="text-[14.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature groups */}
      {GROUPS.map(g => (
        <section key={g.id} id={g.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="max-w-5xl mx-auto px-6 py-16 sm:py-20">
            <div className="inline-flex items-center gap-2.5 text-[12px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--text-faint)' }}>
              <b style={{ color: 'var(--accent-text)' }}>{g.n}</b> {g.tag}
            </div>
            <h2 className="text-[clamp(26px,3.4vw,38px)] font-extrabold tracking-[-0.03em] mt-3.5 max-w-[22ch]">{g.head}</h2>
            <p className="mt-3.5 text-[17.5px] leading-relaxed max-w-[56ch]" style={{ color: 'var(--text-soft)' }}>{g.intro}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-10">
              {g.items.map(f => <Card key={f.title} f={f} />)}
            </div>
          </div>
        </section>
      ))}

      {/* SCOUT band */}
      <section id="scout" className="border-y" style={{ borderColor: 'var(--border)', background: '#F3F0F8' }}>
        <div className="max-w-5xl mx-auto px-6 py-16 grid lg:grid-cols-[1.1fr_1fr] gap-12 items-center">
          <div>
            <span className="text-[12px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--accent-text)' }}>The companion</span>
            <h2 className="text-[clamp(26px,3.4vw,38px)] font-extrabold tracking-[-0.03em] mt-3">SCOUT does the Amazon work, in the background.</h2>
            <p className="mt-4 text-[17px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
              SCOUT is MVP&apos;s browser companion. It works inside your own logged-in Amazon and YouTube, so there&apos;s no copy-pasting tokens and no leaving your account. It accepts campaigns, messages brands, uploads to storefronts and grabs real video frames — quietly, one step at a time.
            </p>
            <ul className="mt-6 grid gap-3">
              {[
                'Messages brands and joins campaigns without opening a single tab',
                'Uploads your video to every Amazon storefront from your own session',
                'Pulls sharp, real frames from your YouTube videos for thumbnails',
                'One-click install from the Chrome Web Store, auto-updates itself',
              ].map(t => (
                <li key={t} className="flex gap-3 text-[15.5px]" style={{ color: 'var(--text)' }}>
                  <Check size={18} className="flex-none mt-0.5" style={{ color: 'var(--accent-text)' }} /> <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl p-5 font-mono text-[13px]" style={{ background: '#0E0817', color: '#E9E1FA', border: '1px solid var(--border)', boxShadow: 'var(--card-shadow)' }}>
            {[['BEDLORE · joined + messaged', 'done', '#0E9F6E'], ['ABENE · joined + messaged', 'done', '#0E9F6E'], ['HISHEET · opening chat…', 'now', '#C026D3'], ['IMPROVIA · queued', '·', '#5b4a72'], ['TEANT · queued', '·', '#5b4a72']].map(([label, pct, color], i) => (
              <div key={i} className="flex items-center gap-2.5 py-2" style={{ borderBottom: '1px dashed rgba(233,225,250,0.13)' }}>
                <span className="w-2 h-2 rounded-full flex-none" style={{ background: color as string, boxShadow: color === '#5b4a72' ? 'none' : `0 0 8px ${color}` }} />
                <span>{label}</span>
                <span className="ml-auto" style={{ color: '#A99BC6' }}>{pct}</span>
              </div>
            ))}
            <div className="flex items-center gap-2.5 py-2 opacity-70">Sending 3 of 21 · paced to protect your account <span className="ml-auto" style={{ color: '#A99BC6' }}>14%</span></div>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="max-w-3xl mx-auto px-6 py-24 text-center">
        <h2 className="text-[clamp(30px,4.6vw,50px)] font-extrabold tracking-[-0.03em] max-w-[18ch] mx-auto">Run the loop once. Then watch it compound.</h2>
        <p className="mt-5 text-[18px] leading-relaxed max-w-[46ch] mx-auto" style={{ color: 'var(--text-soft)' }}>Find, create, publish, earn — MVP does the parts that don&apos;t need you, so you can film the next review.</p>
        <div className="flex flex-wrap gap-3.5 justify-center mt-9">
          <a href="/signup" className="inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-[16px] font-semibold text-white transition-transform hover:-translate-y-0.5" style={{ background: GRAD, boxShadow: '0 10px 30px -8px rgba(192,38,211,0.6)' }}>Start free trial <ArrowRight size={17} /></a>
          <a href="/tour" className="inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-[16px] font-semibold" style={{ color: 'var(--text)', border: '1px solid var(--border)' }}>Take the tour</a>
        </div>
        <p className="mt-6 text-[13.5px] inline-flex items-center gap-1.5" style={{ color: 'var(--text-faint)' }}><Zap size={13} /> 14-day money-back guarantee</p>
      </section>

      <footer className="border-t py-8 text-center text-[13.5px]" style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}>
        <a href="/" className="hover:opacity-70" style={{ color: 'var(--text-soft)' }}>← Back to home</a>
        <span className="mx-3">·</span>
        <a href="/pricing" className="hover:opacity-70" style={{ color: 'var(--text-soft)' }}>Pricing</a>
        <div className="mt-3">MVP Affiliate — the workflow for Amazon Influencers.</div>
      </footer>
    </div>
  )
}
