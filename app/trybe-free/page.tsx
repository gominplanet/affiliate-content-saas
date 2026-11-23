/**
 * /trybe-free — public landing page for the free TRYBE feature on MVP Affiliate
 * (mvpaffiliate.io/trybe-free).
 *
 * The acquisition door for the TRYBE crowd: a creator with no plan and no card
 * can use MVP Affiliate's TRYBE feature for free (lib/trybe-free), and this page
 * sells exactly that, then sends them to the no-card sign-up (/signup?for=trybe).
 *
 * IMPORTANT framing (Seb, 2026-11-23): the free thing is MVP Affiliate's TRYBE
 * FEATURE, not the TRYBE marketplace (which MVP does not own). So every headline
 * ties "free" to MVP, never to TRYBE itself. TRYBE is a separate service the
 * creator brings their own account to, through the free SCOUT Chrome extension.
 *
 * Caps (20 requests a day, 3 script sets a month) are READ from lib/trybe-free,
 * never typed, so the page can never drift from what the server enforces.
 *
 * Look: the warm-cream / single-teal Creator-Lens system shared with /features
 * and the homepage. Server Component. Public (whitelisted in middleware.ts).
 */
import type { Metadata } from 'next'
import { TRYBE_FREE_SIGNUP, FREE_DAILY_SENDS, FREE_SCRIPTS_MONTHLY } from '@/lib/trybe-free'
import NextImage from 'next/image'
import {
  Search, Trophy, Send, Video, Inbox, Clapperboard, Wallet,
  ArrowRight, Check, Handshake, ShieldCheck, Sparkles,
} from 'lucide-react'

export const revalidate = 600

export const metadata: Metadata = {
  title: 'TRYBE Free: brand deals, free on MVP Affiliate',
  description:
    "MVP Affiliate's TRYBE feature is free for every creator: find the brands that pay, message them in your own words, attach your intro video, and track every dollar. No credit card.",
}

// ── Warm cream palette with a single teal accent. Shared with /features. ──
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

function Nav() {
  return (
    <nav className="sticky top-0 z-20 backdrop-blur-md px-5 sm:px-8 lg:px-12 py-4 flex items-center justify-between"
      style={{ backgroundColor: 'rgba(251,247,242,0.82)', borderBottom: `1px solid ${C.borderSoft}` }}>
      <a href="/" className="flex items-center gap-2.5">
        <NextImage src="/png/mvp-affiliate-trial.png" alt="MVP Affiliate" width={32} height={32} className="w-8 h-8 rounded-lg" />
        <span className="text-[17px] font-extrabold tracking-tight" style={{ ...DISPLAY, color: C.text }}>MVP Affiliate</span>
      </a>
      <div className="hidden lg:flex items-center gap-3 absolute left-1/2 -translate-x-1/2">
        {[{ label: 'Features', href: '/features' }, { label: 'Pricing', href: '/pricing' }, { label: 'Affiliates', href: '/affiliates' }].map(a => (
          <a key={a.href} href={a.href} className="px-3 py-2 rounded-lg text-[15px] font-medium transition-colors hover:opacity-70" style={{ color: C.muted }}>{a.label}</a>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <a href="/login" className="hidden sm:inline px-3 py-2 text-[15px] font-medium transition-colors hover:opacity-70" style={{ color: C.muted }}>Sign in</a>
        <a href={TRYBE_FREE_SIGNUP} className="px-5 py-2.5 rounded-full text-[15px] font-bold text-white transition-transform hover:-translate-y-px whitespace-nowrap" style={{ backgroundColor: C.accent, boxShadow: C.glow }}>Start free on MVP</a>
      </div>
    </nav>
  )
}

const CHIPS = [
  { icon: <Search size={16} />, t: 'Find brands that pay' },
  { icon: <Send size={16} />, t: `Ask ${FREE_DAILY_SENDS} brands a day` },
  { icon: <Trophy size={16} />, t: 'Top 100 winning hooks' },
  { icon: <Video size={16} />, t: 'Attach your intro video' },
]

const BENEFITS: { icon: React.ReactNode; title: string; desc: string }[] = [
  { icon: <Search size={20} />, title: 'See which brands actually pay', desc: 'Browse every TRYBE brand ranked by real payouts, how few creators are already on it, and what people actually earn, so you spend time on the deals worth chasing. Add your channel later and MVP tailors the picks to you.' },
  { icon: <Trophy size={20} />, title: "See what's winning right now", desc: 'The Top 100 board shows the top-performing videos and the exact hooks behind them, so you know how to open yours before you hit record.' },
  { icon: <Send size={20} />, title: `Ask ${FREE_DAILY_SENDS} brands a day, in your words`, desc: `Write your outreach message once and SCOUT sends it for you, up to ${FREE_DAILY_SENDS} brands a day. It is your words, not a generic AI blast.` },
  { icon: <Video size={20} />, title: 'Put your face on every pitch', desc: 'MVP can attach your introduction video to each outgoing request, so a brand meets you before it even replies. It is the fastest way to stand out in a crowded inbox.' },
  { icon: <Inbox size={20} />, title: 'Never miss a yes', desc: 'Every brand conversation sits in one inbox inside MVP, so a reply never gets buried and a deal never slips because you missed the message.' },
  { icon: <Clapperboard size={20} />, title: 'Film what is waiting', desc: `Track your samples, upload your finished video straight to TRYBE from MVP, and get ${FREE_SCRIPTS_MONTHLY} sets of AI brand scripts a month to shape what you shoot.` },
  { icon: <Wallet size={20} />, title: 'Know who pays you', desc: 'See your earnings by brand, which submissions were approved, and whether a bonus challenge is still in reach, all in one place.' },
]

const STEPS = [
  { n: '01', t: 'Sign up free', d: 'Create your MVP account with no plan and no card, then connect your own TRYBE account through the free SCOUT Chrome extension.' },
  { n: '02', t: 'Find and ask', d: `Pick the brands that pay and send your request in your own words, with your intro video attached, up to ${FREE_DAILY_SENDS} a day.` },
  { n: '03', t: 'Film and get paid', d: 'Upload your finished videos to TRYBE from MVP, keep every conversation in one inbox, and track your approvals and earnings.' },
]

const PRO_ADDS = [
  'A different message written for each brand, in your voice',
  '20 best-fit brands found and written for you every day',
  'A suggested reply on every conversation in your inbox',
  'Batches, the planner, Star brands and Match my TikTok',
  'The rest of MVP: Review Editor, your blog, YouTube, Shorts, Deal Radar and more',
]

export default function TrybeFreePage() {
  return (
    <div style={{ backgroundColor: C.bg, color: C.text }} className="min-h-screen antialiased font-[family-name:var(--font-sans)]">
      <Nav />

      {/* Hero */}
      <header className="px-5 sm:px-8 lg:px-12 pt-16 sm:pt-24 pb-14 sm:pb-20">
        <div className="max-w-4xl mx-auto text-center">
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12.5px] font-extrabold uppercase tracking-[0.14em] text-white" style={{ background: C.grad, boxShadow: C.glow }}>
            <span className="w-2 h-2 rounded-full bg-white" /> Free forever · No card needed
          </span>
          <h1 className="text-[42px] sm:text-[64px] lg:text-[74px] font-extrabold tracking-[-0.035em] leading-[1.02] mt-7" style={{ ...DISPLAY, color: C.text }}>
            Land brand deals on TRYBE.<br />
            <span style={{ background: C.grad, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Free, only on MVP.</span>
          </h1>
          <p className="mt-6 text-[18px] sm:text-[21px] leading-relaxed max-w-2xl mx-auto" style={{ color: C.muted }}>
            <b style={{ color: C.text }}>MVP Affiliate&apos;s TRYBE feature</b> finds the brands that pay, messages them in your own words, and tracks every dollar. Free for every creator, no credit card.
          </p>
          <div className="flex flex-wrap gap-3.5 justify-center mt-9">
            <a href={TRYBE_FREE_SIGNUP} className="inline-flex items-center gap-2 rounded-full px-8 py-4 text-[17px] font-bold text-white transition-transform hover:-translate-y-px" style={{ backgroundColor: C.accent, boxShadow: C.glow }}>Start free on MVP <ArrowRight size={18} /></a>
            <a href="#whats-free" className="inline-flex items-center gap-2 rounded-full px-8 py-4 text-[17px] font-bold transition-transform hover:-translate-y-px" style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, color: C.text }}>See what is included</a>
          </div>
          <p className="mt-6 text-[14px] inline-flex items-center gap-1.5" style={{ color: C.faint }}><ShieldCheck size={14} /> No credit card. Move up to Pro whenever you want.</p>
          <div className="flex flex-wrap gap-2.5 justify-center mt-9">
            {CHIPS.map(c => (
              <span key={c.t} className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[14.5px] font-bold" style={{ background: C.card, border: `1px solid ${C.accentSoft === 'rgba(0,128,128,0.10)' ? 'rgba(0,128,128,0.22)' : C.border}`, color: C.text }}>
                <span style={{ color: C.accentText }}>{c.icon}</span>{c.t}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* What you get, free */}
      <section id="whats-free" className="px-5 sm:px-8 lg:px-12 py-18 sm:py-24" style={{ backgroundColor: C.band, borderTop: `1px solid ${C.borderSoft}`, borderBottom: `1px solid ${C.borderSoft}` }}>
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-2xl mx-auto">
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-bold uppercase tracking-[0.14em]" style={{ backgroundColor: C.accentSoft, color: C.accentText }}>Everything free</span>
            <h2 className="text-[32px] sm:text-[46px] font-extrabold tracking-[-0.03em] leading-[1.03] mt-5" style={{ ...DISPLAY, color: C.text }}>The whole brand-deal workflow, for free</h2>
            <p className="mt-4 text-[17px] leading-relaxed" style={{ color: C.muted }}>Finding good brands and keeping up with the inbox is the hard part. MVP does the heavy lifting on TRYBE, and this part costs nothing.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-11">
            {BENEFITS.map(b => (
              <div key={b.title} className="rounded-3xl p-7 flex flex-col gap-3" style={{ background: C.card, boxShadow: C.cardShadow }}>
                <div className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: C.accentSoft, color: C.accentText }}>{b.icon}</div>
                <h3 className="text-[19px] font-extrabold tracking-tight" style={{ ...DISPLAY, color: C.text }}>{b.title}</h3>
                <p className="text-[15px] leading-relaxed" style={{ color: C.soft }}>{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-5 sm:px-8 lg:px-12 py-18 sm:py-24" style={{ background: C.bg }}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center max-w-2xl mx-auto">
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-bold uppercase tracking-[0.14em]" style={{ backgroundColor: C.accentSoft, color: C.accentText }}>Three steps</span>
            <h2 className="text-[32px] sm:text-[46px] font-extrabold tracking-[-0.03em] leading-[1.03] mt-5" style={{ ...DISPLAY, color: C.text }}>Up and running in minutes</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5 mt-11">
            {STEPS.map(s => (
              <div key={s.n} className="rounded-3xl p-7" style={{ background: C.card, boxShadow: C.cardShadow }}>
                <span className="w-10 h-10 rounded-full grid place-items-center text-[16px] font-extrabold text-white" style={{ background: C.grad }}>{s.n.replace('0', '')}</span>
                <h3 className="text-[19px] font-extrabold tracking-tight mt-4" style={{ ...DISPLAY, color: C.text }}>{s.t}</h3>
                <p className="text-[15px] leading-relaxed mt-2" style={{ color: C.soft }}>{s.d}</p>
              </div>
            ))}
          </div>
          <p className="text-center mt-8 text-[14px]" style={{ color: C.faint }}>Works with your own TRYBE account through the free SCOUT Chrome extension. TRYBE is a separate service.</p>
        </div>
      </section>

      {/* Free vs Pro */}
      <section className="px-5 sm:px-8 lg:px-12 py-18 sm:py-24" style={{ backgroundColor: C.band, borderTop: `1px solid ${C.borderSoft}`, borderBottom: `1px solid ${C.borderSoft}` }}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center max-w-2xl mx-auto">
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-bold uppercase tracking-[0.14em]" style={{ backgroundColor: C.accentSoft, color: C.accentText }}>The one free part of MVP</span>
            <h2 className="text-[32px] sm:text-[46px] font-extrabold tracking-[-0.03em] leading-[1.03] mt-5" style={{ ...DISPLAY, color: C.text }}>Start free. Grow into the rest.</h2>
            <p className="mt-4 text-[17px] leading-relaxed" style={{ color: C.muted }}>TRYBE is the free way in. When you want MVP to do even more of the work, Pro is the whole machine.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-5 mt-11">
            <div className="rounded-3xl p-8" style={{ background: C.card, boxShadow: C.cardShadow, border: `2px solid ${C.accent}` }}>
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl grid place-items-center text-white" style={{ background: C.grad }}><Handshake size={18} /></span>
                <span className="text-[13px] font-extrabold uppercase tracking-[0.12em]" style={{ color: C.accentText }}>Free forever</span>
              </div>
              <h3 className="text-[22px] font-extrabold tracking-tight mt-4" style={{ ...DISPLAY, color: C.text }}>MVP&apos;s TRYBE feature</h3>
              <ul className="mt-5 grid gap-3">
                {['Find brands sorted by payouts and competition', 'Top 100 board of winning videos and hooks', `Send ${FREE_DAILY_SENDS} requests a day in your own words`, 'Attach your intro video to every request', 'Every conversation in one inbox', 'Upload to TRYBE, track samples and earnings', `${FREE_SCRIPTS_MONTHLY} sets of AI brand scripts a month`].map(t => (
                  <li key={t} className="flex gap-2.5 text-[15px]" style={{ color: C.text }}><Check size={18} className="flex-none mt-0.5" style={{ color: C.accentText }} /><span>{t}</span></li>
                ))}
              </ul>
            </div>
            <div className="rounded-3xl p-8" style={{ background: C.card, boxShadow: C.cardShadow }}>
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl grid place-items-center" style={{ background: C.accentSoft, color: C.accentText }}><Sparkles size={18} /></span>
                <span className="text-[13px] font-extrabold uppercase tracking-[0.12em]" style={{ color: C.soft }}>Pro adds</span>
              </div>
              <h3 className="text-[22px] font-extrabold tracking-tight mt-4" style={{ ...DISPLAY, color: C.text }}>When you want more done for you</h3>
              <ul className="mt-5 grid gap-3">
                {PRO_ADDS.map(t => (
                  <li key={t} className="flex gap-2.5 text-[15px]" style={{ color: C.muted }}><Check size={18} className="flex-none mt-0.5" style={{ color: C.faint }} /><span>{t}</span></li>
                ))}
              </ul>
              <a href="/pricing" className="inline-flex items-center gap-1.5 mt-6 text-[15px] font-bold" style={{ color: C.accentText }}>See what Pro costs <ArrowRight size={15} /></a>
            </div>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="px-5 sm:px-8 lg:px-12 py-20 sm:py-28 text-center" style={{ background: C.bg }}>
        <h2 className="text-[36px] sm:text-[52px] font-extrabold tracking-[-0.03em] leading-[1.02] max-w-[20ch] mx-auto" style={{ ...DISPLAY, color: C.text }}>Start landing brand deals today.</h2>
        <p className="mt-5 text-[18px] leading-relaxed max-w-[48ch] mx-auto" style={{ color: C.muted }}>Free for every creator, no credit card. Find the brands that pay, pitch them in your own words, and track every dollar.</p>
        <div className="flex flex-wrap gap-3.5 justify-center mt-9">
          <a href={TRYBE_FREE_SIGNUP} className="inline-flex items-center gap-2 rounded-full px-9 py-4 text-[18px] font-bold text-white transition-transform hover:-translate-y-px" style={{ backgroundColor: C.accent, boxShadow: C.glow }}>Start free on MVP <ArrowRight size={18} /></a>
        </div>
        <p className="mt-6 text-[14px]" style={{ color: C.faint }}>No credit card. Takes a minute.</p>
      </section>

      <footer className="py-10 text-center text-[13.5px]" style={{ borderTop: `1px solid ${C.borderSoft}`, color: C.faint, background: C.bg }}>
        <a href="/" className="hover:opacity-70" style={{ color: C.soft }}>Back to home</a>
        <span className="mx-3">·</span>
        <a href="/features" className="hover:opacity-70" style={{ color: C.soft }}>Features</a>
        <span className="mx-3">·</span>
        <a href="/pricing" className="hover:opacity-70" style={{ color: C.soft }}>Pricing</a>
        <div className="mt-3">MVP Affiliate: the workflow for Amazon influencers.</div>
      </footer>
    </div>
  )
}
