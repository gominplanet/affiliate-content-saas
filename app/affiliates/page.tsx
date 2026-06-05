/**
 * /affiliates — public affiliate-program signup page.
 *
 * Structurally modeled on Oink's "Become an Oink affiliate" page
 * (oinkforinfluencers.com/become-an-oink-affiliate) which the user
 * flagged as the right shape: hero -> numbered process -> audience
 * incentive -> numbers table -> payout mechanics -> per-channel
 * codes -> FAQ -> final CTA. Clean, scannable, every section answers
 * one question.
 *
 * All terms below mirror the live Rewardful campaign "MVP Affiliate
 * Rep" (signup at https://mvp-affiliate.getrewardful.com/signup):
 *
 *   Commission:        10% of every sale, recurring while customer
 *                      stays subscribed.
 *   Audience discount: 20% off the first 3 months (Rewardful
 *                      double-sided incentive — promo code yUrNXwso
 *                      gets applied automatically via the referral
 *                      link, OR the affiliate can share the code
 *                      directly).
 *   Cookie window:     60 days.
 *   Min payout:        $50.
 *   Payout method:     PayPal, monthly cadence after the 60-day
 *                      clearance window.
 *
 * If any of those terms change in Rewardful, update CAMPAIGN below.
 * Theme system mirrors app/page.tsx (DARK_VARS/LIGHT_VARS) so the
 * sun/moon toggle on the homepage and here keep their state in
 * localStorage and feel like one site.
 */
'use client'

import { useState, useEffect } from 'react'
import {
  Sun, Moon, Sparkles, ArrowRight, Check, Plus, Minus,
  Wallet, Calendar, TagIcon, Percent, Users, Link as LinkIcon,
} from 'lucide-react'

// ─── Campaign terms — single source of truth ─────────────────────────────────
// Mirror of the Rewardful campaign settings. If you change a number here,
// also change it in Rewardful (or vice versa) — the page is the public
// promise.
const CAMPAIGN = {
  commissionPct: 10,
  audienceDiscount: '20% off the first 3 months',
  cookieDays: 60,
  payoutThreshold: 50,
  payoutCurrency: 'USD',
  payoutMethod: 'PayPal',
  clearanceDays: 60,
  signupUrl: 'https://mvp-affiliate.getrewardful.com/signup',
  loginUrl: 'https://mvp-affiliate.getrewardful.com/login',
  promoCode: 'yUrNXwso',
} as const

// ─── Theme tokens (mirrored from app/page.tsx) ───────────────────────────────
const DARK_VARS: React.CSSProperties = {
  ['--bg' as string]: '#0E0E11',
  ['--surface' as string]: 'rgba(255,255,255,0.04)',
  ['--surface-bright' as string]: 'rgba(255,255,255,0.08)',
  ['--border' as string]: 'rgba(255,255,255,0.08)',
  ['--text' as string]: '#F5F5F7',
  ['--text-muted' as string]: 'rgba(255,255,255,0.85)',
  ['--text-soft' as string]: 'rgba(255,255,255,0.65)',
  ['--text-subtle' as string]: 'rgba(255,255,255,0.50)',
  ['--text-faint' as string]: 'rgba(255,255,255,0.38)',
  ['--card-shadow' as string]: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.3)',
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
}

export default function AffiliatesPage() {
  // Theme is persisted under the same key as the homepage so the toggle
  // state survives navigation between / and /affiliates.
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('mvp-theme') : null
    if (saved === 'light' || saved === 'dark') setTheme(saved)
  }, [])
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('mvp-theme', theme)
  }, [theme])

  const themeVars = theme === 'dark' ? DARK_VARS : LIGHT_VARS

  return (
    <div style={{ ...themeVars, backgroundColor: 'var(--bg)', color: 'var(--text)' }}>
      <Nav theme={theme} onToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
      <Hero />
      <HowItWorks />
      <AudienceSaves />
      <Numbers />
      <PayoutMechanics />
      <MultipleCodes />
      <WhoCanApply />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  )
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
function Nav({ theme, onToggle }: { theme: 'dark' | 'light'; onToggle: () => void }) {
  return (
    <nav
      className="sticky top-0 z-20 backdrop-blur-md px-6 lg:px-8 py-4 flex items-center justify-between"
      style={{
        backgroundColor: theme === 'dark' ? 'rgba(14,14,17,0.7)' : 'rgba(250,250,248,0.7)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <a href="/" className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#7C3AED] to-[#C026D3] flex items-center justify-center font-semibold text-white text-[14px]">M</span>
        <span className="font-semibold text-[15px] tracking-tight" style={{ color: 'var(--text)' }}>
          MVP Affiliate
        </span>
      </a>
      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          className="p-2 rounded-lg transition-colors"
          style={{ color: 'var(--text-soft)' }}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <a
          href={CAMPAIGN.loginUrl}
          target="_blank"
          rel="noopener"
          className="px-3 py-1.5 rounded-lg text-[13px] transition-colors hidden sm:inline-block"
          style={{ color: 'var(--text-soft)' }}
        >
          Affiliate login
        </a>
        <a
          href={CAMPAIGN.signupUrl}
          target="_blank"
          rel="noopener"
          className="px-3.5 py-1.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-[13px] font-medium text-white transition-colors"
        >
          Apply
        </a>
      </div>
    </nav>
  )
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="px-6 lg:px-8 pt-20 pb-16 lg:pt-28 lg:pb-20">
      <div className="max-w-4xl mx-auto text-center">
        <div
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider mb-6"
          style={{
            background: 'rgba(124,58,237,0.12)',
            color: '#A78BFA',
            border: '1px solid rgba(124,58,237,0.25)',
          }}
        >
          <Sparkles size={12} /> MVP Affiliate Program
        </div>
        <h1
          className="text-[44px] sm:text-[56px] lg:text-[68px] font-semibold tracking-tight leading-[1.05] mb-6"
          style={{ color: 'var(--text)' }}
        >
          Earn {CAMPAIGN.commissionPct}% on every MVP&nbsp;Affiliate subscription you refer.
        </h1>
        <p
          className="text-[17px] sm:text-[18px] leading-relaxed max-w-2xl mx-auto mb-10"
          style={{ color: 'var(--text-soft)' }}
        >
          Love MVP Affiliate and want to share it with other creators? Join the program and earn a {CAMPAIGN.commissionPct}% commission on every payment, for as long as your referral stays subscribed. Your audience gets {CAMPAIGN.audienceDiscount} when they sign up through your link.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <a
            href={CAMPAIGN.signupUrl}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-[15px] font-semibold transition-colors"
          >
            Apply to become an affiliate <ArrowRight size={16} />
          </a>
          <a
            href="#how-it-works"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-[15px] font-medium transition-colors"
            style={{
              color: 'var(--text)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
          >
            See how it works
          </a>
        </div>
        <p className="mt-6 text-[12px]" style={{ color: 'var(--text-faint)' }}>
          Recurring commissions · {CAMPAIGN.cookieDays}-day cookie · Powered by Rewardful
        </p>
      </div>
    </section>
  )
}

// ─── How it works ─────────────────────────────────────────────────────────────
function HowItWorks() {
  const steps = [
    {
      title: 'Apply for the program',
      body: `Submit a quick form with your name, email, and where you plan to share MVP Affiliate. We review every application personally. Most decisions come back within 48 hours.`,
    },
    {
      title: 'Get your link and promo code',
      body: `Once you're approved, your dashboard gives you a unique referral link plus a personal promo code. Both track conversions back to you for the full ${CAMPAIGN.cookieDays}-day window.`,
    },
    {
      title: 'Share it however you create',
      body: `Drop the link in your YouTube descriptions, post the code in your community, mention it in your newsletter, pin it on socials. You don't have to "perform". Just share it where you'd naturally talk about creator tools.`,
    },
    {
      title: 'Earn while they stay subscribed',
      body: `Every payment your referral makes pays you ${CAMPAIGN.commissionPct}%, month one and every month after. Stripe processes the sale, Rewardful tracks the attribution, you watch the balance grow.`,
    },
    {
      title: 'Get paid via PayPal',
      body: `Once you've earned at least $${CAMPAIGN.payoutThreshold} ${CAMPAIGN.payoutCurrency} and the commissions have cleared the ${CAMPAIGN.clearanceDays}-day refund window, payout is initiated at the start of the next month and lands in your PayPal about a week later.`,
    },
  ]
  return (
    <section id="how-it-works" className="px-6 lg:px-8 py-16 lg:py-24" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="max-w-4xl mx-auto">
        <SectionHeading
          eyebrow="The process"
          title="How it works"
          subtitle={`Five steps from "Apply" to "Money in PayPal." No call required, no minimum audience, no quotas.`}
        />
        <ol className="mt-12 space-y-6">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="flex items-start gap-5 rounded-2xl p-6"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--card-shadow)',
              }}
            >
              <div
                className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-semibold text-[15px]"
                style={{
                  background: 'linear-gradient(135deg, #7C3AED, #C026D3)',
                  color: '#fff',
                }}
              >
                {i + 1}
              </div>
              <div>
                <h3 className="text-[18px] font-semibold mb-2" style={{ color: 'var(--text)' }}>
                  {s.title}
                </h3>
                <p className="text-[14px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
                  {s.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

// ─── Audience saves too ───────────────────────────────────────────────────────
function AudienceSaves() {
  return (
    <section className="px-6 lg:px-8 py-16 lg:py-24" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="max-w-4xl mx-auto">
        <SectionHeading
          eyebrow="Double-sided incentive"
          title="Your audience saves too"
          subtitle="When someone signs up through your link or code, they get the same deal you'd give a friend."
        />
        <div className="mt-12 grid sm:grid-cols-2 gap-4">
          <Card
            icon={<LinkIcon size={18} className="text-[#A78BFA]" />}
            heading="Your referral link"
            body={`Auto-applies the ${CAMPAIGN.audienceDiscount} for whoever clicks it. They sign up, the discount lands at checkout, the commission attributes to you. Best for YouTube descriptions, blog posts, link-in-bio.`}
          />
          <Card
            icon={<TagIcon size={18} className="text-[#A78BFA]" />}
            heading="Your promo code"
            body={`Same ${CAMPAIGN.audienceDiscount} for the customer, same ${CAMPAIGN.commissionPct}% for you, but they type the code at checkout. Best for shoutouts in videos, Discord pins, podcast read-outs, anywhere a link doesn't fit.`}
          />
        </div>
        <div
          className="mt-8 p-5 rounded-xl text-[14px] leading-relaxed flex items-start gap-3"
          style={{
            background: 'rgba(124,58,237,0.06)',
            border: '1px solid rgba(124,58,237,0.20)',
            color: 'var(--text-muted)',
          }}
        >
          <Sparkles size={16} className="text-[#A78BFA] flex-shrink-0 mt-0.5" />
          <p>
            <strong style={{ color: 'var(--text)' }}>Both work for you.</strong> The discount is the same either way. Pick the format that fits where you're posting. The link is easier; the code feels more personal.
          </p>
        </div>
      </div>
    </section>
  )
}

// ─── Numbers (quick reference table) ──────────────────────────────────────────
function Numbers() {
  const rows = [
    { label: 'Commission', value: `${CAMPAIGN.commissionPct}% of every payment, recurring`, icon: <Percent size={16} /> },
    { label: 'Your audience saves', value: CAMPAIGN.audienceDiscount, icon: <TagIcon size={16} /> },
    { label: 'Cookie window', value: `${CAMPAIGN.cookieDays} days`, icon: <Calendar size={16} /> },
    { label: 'Minimum payout', value: `$${CAMPAIGN.payoutThreshold} ${CAMPAIGN.payoutCurrency}`, icon: <Wallet size={16} /> },
    { label: 'Payment method', value: CAMPAIGN.payoutMethod, icon: <Wallet size={16} /> },
    { label: 'Payment cadence', value: 'Monthly, after a 60-day clearance', icon: <Calendar size={16} /> },
  ]
  return (
    <section className="px-6 lg:px-8 py-16 lg:py-24" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="max-w-4xl mx-auto">
        <SectionHeading
          eyebrow="At a glance"
          title="The numbers"
          subtitle="Everything you need to know on one screen. No fine print, no surprises."
        />
        <div
          className="mt-12 rounded-2xl overflow-hidden"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          {rows.map((r, i) => (
            <div
              key={r.label}
              className="flex items-center justify-between gap-4 px-6 py-4"
              style={{
                borderTop: i === 0 ? 'none' : '1px solid var(--border)',
              }}
            >
              <div className="flex items-center gap-3">
                <span style={{ color: '#A78BFA' }}>{r.icon}</span>
                <span className="text-[14px] font-medium" style={{ color: 'var(--text-soft)' }}>
                  {r.label}
                </span>
              </div>
              <span className="text-[14px] sm:text-[15px] font-semibold text-right" style={{ color: 'var(--text)' }}>
                {r.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Payout mechanics ─────────────────────────────────────────────────────────
function PayoutMechanics() {
  return (
    <section className="px-6 lg:px-8 py-16 lg:py-24" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="max-w-4xl mx-auto">
        <SectionHeading
          eyebrow="When you get paid"
          title="How payouts work"
          subtitle="Two thresholds, one cadence, zero guesswork."
        />
        <div className="mt-12 grid sm:grid-cols-2 gap-4">
          <Card
            icon={<Wallet size={18} className="text-[#A78BFA]" />}
            heading={`$${CAMPAIGN.payoutThreshold} minimum`}
            body={`Your balance has to hit at least $${CAMPAIGN.payoutThreshold} ${CAMPAIGN.payoutCurrency} before we initiate a payout. Below that, commissions roll forward to next month. Most active affiliates clear this in their first or second month.`}
          />
          <Card
            icon={<Calendar size={18} className="text-[#A78BFA]" />}
            heading={`${CAMPAIGN.clearanceDays}-day clearance`}
            body={`A commission becomes payable ${CAMPAIGN.clearanceDays} days after the sale clears, to protect against refunds and chargebacks. Anything refunded inside that window doesn't pay out.`}
          />
        </div>
        <div className="mt-6 grid sm:grid-cols-2 gap-4">
          <Card
            icon={<ArrowRight size={18} className="text-[#A78BFA]" />}
            heading="Monthly cadence"
            body={`Once you've cleared both thresholds, your payout is initiated at the start of the next calendar month. Money lands in your PayPal about a week later. You can watch the running balance in your Rewardful dashboard any time.`}
          />
          <Card
            icon={<Wallet size={18} className="text-[#A78BFA]" />}
            heading="PayPal only (for now)"
            body={`Payouts go to the PayPal address you set up in your Rewardful account. We'll add direct bank options as soon as Rewardful supports them for our region. Until then, PayPal is the fastest way to receive funds globally.`}
          />
        </div>
      </div>
    </section>
  )
}

// ─── Multiple codes ───────────────────────────────────────────────────────────
function MultipleCodes() {
  return (
    <section className="px-6 lg:px-8 py-16 lg:py-24" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="max-w-4xl mx-auto">
        <SectionHeading
          eyebrow="Track every channel"
          title="One affiliate. Many codes."
          subtitle="If you post to YouTube, your newsletter, a Discord, and a Facebook group, you can mint a unique code per channel and see exactly which one is converting."
        />
        <div
          className="mt-12 rounded-2xl p-6 sm:p-8"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <div className="flex items-start gap-4 mb-6">
            <div
              className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(124,58,237,0.12)' }}
            >
              <Users size={18} className="text-[#A78BFA]" />
            </div>
            <div>
              <p className="text-[15px] font-semibold mb-1" style={{ color: 'var(--text)' }}>
                Example: one creator, four codes
              </p>
              <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
                Mint a separate code for each surface you post on. Same commission, same audience discount, just different attribution.
              </p>
            </div>
          </div>
          <ul className="space-y-3">
            {[
              { tag: 'MVP-YT', surface: 'YouTube channel description', who: 'Cold viewers discovering you via search' },
              { tag: 'MVP-LIST', surface: 'Your email newsletter', who: 'Warm subscribers who already trust you' },
              { tag: 'MVP-DC', surface: 'Discord community', who: 'Your highest-intent crowd' },
              { tag: 'MVP-IG', surface: 'Instagram link in bio', who: 'Mobile-first short-form traffic' },
            ].map(row => (
              <li key={row.tag} className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 p-3 sm:p-4 rounded-lg" style={{ background: 'var(--surface-bright)' }}>
                <code className="text-[13px] font-mono font-semibold" style={{ color: '#A78BFA' }}>{row.tag}</code>
                <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{row.surface}</span>
                <span className="text-[12px]" style={{ color: 'var(--text-soft)' }}>{row.who}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
            Codes are minted in your Rewardful dashboard in seconds. Each one carries the same {CAMPAIGN.commissionPct}% commission for you and {CAMPAIGN.audienceDiscount} for the customer.
          </p>
        </div>
      </div>
    </section>
  )
}

// ─── Who can apply ────────────────────────────────────────────────────────────
function WhoCanApply() {
  return (
    <section className="px-6 lg:px-8 py-16 lg:py-24" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="max-w-4xl mx-auto">
        <SectionHeading
          eyebrow="Who we approve"
          title="Built for creators who get it"
          subtitle="No minimum follower count. No traffic quota. We approve based on fit, not numbers."
        />
        <div className="mt-12 grid sm:grid-cols-2 gap-4">
          <Card
            icon={<Check size={18} className="text-[#34C759]" />}
            heading="Great fit"
            body={
              <ul className="space-y-2 mt-1">
                {[
                  'You make content about Amazon affiliate marketing, YouTube reviewing, creator tools, or solo-creator workflows',
                  'You run a newsletter, podcast, Discord, or community of working creators',
                  'You publish on WordPress, write product reviews, or coach influencers',
                  'You actually use MVP Affiliate (we let you join free, then you can speak from experience)',
                ].map(s => (
                  <li key={s} className="flex items-start gap-2 text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    <Check size={14} className="text-[#34C759] flex-shrink-0 mt-0.5" /> {s}
                  </li>
                ))}
              </ul>
            }
          />
          <Card
            icon={<Minus size={18} className="text-[#FF453A]" />}
            heading="Not a fit"
            body={
              <ul className="space-y-2 mt-1">
                {[
                  'Coupon, deal, or cashback sites that don\'t bring us new creators, they cannibalize organic signups',
                  'Bidding on our brand keywords in paid search',
                  'Spamming forums, Reddit, comments, or DMs with your link',
                  'Misleading claims about earnings, results, or what MVP can do',
                ].map(s => (
                  <li key={s} className="flex items-start gap-2 text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    <Minus size={14} className="text-[#FF453A] flex-shrink-0 mt-0.5" /> {s}
                  </li>
                ))}
              </ul>
            }
          />
        </div>
      </div>
    </section>
  )
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────
function FAQ() {
  const items = [
    {
      q: `Is the ${CAMPAIGN.commissionPct}% commission recurring?`,
      a: `Yes. You earn ${CAMPAIGN.commissionPct}% on every payment that referral makes, for as long as they stay subscribed. Annual plan? You earn ${CAMPAIGN.commissionPct}% every year they renew. One referral can pay you for years.`,
    },
    {
      q: 'Do I have to be a paying MVP Affiliate customer to join?',
      a: `No. You can apply to the program without being on a paid plan. That said, the affiliates who convert the highest are the ones using the product themselves. The trial is free, so it costs nothing to try first.`,
    },
    {
      q: 'How long until I see commissions?',
      a: `Attribution is real-time. The moment someone subscribes through your link or code, you see the commission in your Rewardful dashboard. It moves from "pending" to "approved" after the ${CAMPAIGN.clearanceDays}-day refund-protection window.`,
    },
    {
      q: 'What if my referral cancels?',
      a: `You earn on every payment they made up to that point. The recurring stream stops when they stop subscribing, but anything already earned (and past the clearance window) is yours.`,
    },
    {
      q: 'Can I run paid ads to my affiliate link?',
      a: `Yes, with one rule: don't bid on "MVP Affiliate" or close variants of our brand in paid search. Anything outside that (Meta, YouTube, TikTok, Reddit, your own retargeting) is fair game.`,
    },
    {
      q: 'How long is the cookie window?',
      a: `${CAMPAIGN.cookieDays} days. Someone can click your link today, sign up two months later, and the commission still tracks to you. Most affiliate programs cap at 30 days. We doubled it because creator decisions usually take a beat.`,
    },
    {
      q: 'Can I get a custom promo code?',
      a: `Yes. Once you're approved, you can mint as many codes as you want from your Rewardful dashboard. One per channel, named however you like (e.g. "ALEX-YT", "ALEX-IG"). Same terms on every code.`,
    },
    {
      q: 'How are payouts taxed?',
      a: `You're paid as an independent contractor. Taxes are your responsibility in whatever country you live. US affiliates earning over $600 in a year get a 1099 from us. International affiliates get a clean PayPal statement to hand to their accountant.`,
    },
  ]
  return (
    <section className="px-6 lg:px-8 py-16 lg:py-24" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="max-w-3xl mx-auto">
        <SectionHeading
          eyebrow="FAQ"
          title="Common questions"
          subtitle="Quick answers to what most affiliates ask before applying."
        />
        <div className="mt-12 space-y-3">
          {items.map((it, i) => <FAQItem key={it.q} item={it} index={i} />)}
        </div>
      </div>
    </section>
  )
}

function FAQItem({ item, index }: { item: { q: string; a: string }; index: number }) {
  const [open, setOpen] = useState(index === 0)
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <span className="text-[15px] font-medium" style={{ color: 'var(--text)' }}>{item.q}</span>
        <span
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
          style={{ background: 'var(--surface-bright)', color: 'var(--text-soft)' }}
        >
          {open ? <Minus size={14} /> : <Plus size={14} />}
        </span>
      </button>
      {open && (
        <div className="px-5 pb-5 text-[14px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
          {item.a}
        </div>
      )}
    </div>
  )
}

// ─── Final CTA ────────────────────────────────────────────────────────────────
function FinalCTA() {
  return (
    <section className="px-6 lg:px-8 py-20 lg:py-28" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="max-w-3xl mx-auto text-center">
        <h2
          className="text-[36px] sm:text-[48px] font-semibold tracking-tight leading-[1.1] mb-5"
          style={{ color: 'var(--text)' }}
        >
          Ready to start earning?
        </h2>
        <p className="text-[16px] leading-relaxed mb-10 max-w-xl mx-auto" style={{ color: 'var(--text-soft)' }}>
          One application, no quotas, no commitments. The fastest-moving affiliates clear their first ${CAMPAIGN.payoutThreshold} payout inside their first 60 days.
        </p>
        <a
          href={CAMPAIGN.signupUrl}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-[16px] font-semibold transition-colors"
        >
          Apply to become an affiliate <ArrowRight size={16} />
        </a>
        <p className="mt-6 text-[12px]" style={{ color: 'var(--text-faint)' }}>
          Already approved? <a href={CAMPAIGN.loginUrl} target="_blank" rel="noopener" className="underline hover:text-[#A78BFA]" style={{ color: 'var(--text-soft)' }}>Log in to your Rewardful dashboard →</a>
        </p>
      </div>
    </section>
  )
}

// ─── Reusable bits ────────────────────────────────────────────────────────────
function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div className="text-center max-w-2xl mx-auto">
      <p className="text-[12px] uppercase tracking-[0.15em] font-semibold mb-3" style={{ color: '#A78BFA' }}>
        {eyebrow}
      </p>
      <h2
        className="text-[30px] sm:text-[38px] font-semibold tracking-tight leading-[1.15] mb-4"
        style={{ color: 'var(--text)' }}
      >
        {title}
      </h2>
      <p className="text-[15px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
        {subtitle}
      </p>
    </div>
  )
}

function Card({ icon, heading, body }: { icon: React.ReactNode; heading: string; body: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl p-6"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ background: 'rgba(124,58,237,0.12)' }}
        >
          {icon}
        </div>
        <h3 className="text-[16px] font-semibold" style={{ color: 'var(--text)' }}>{heading}</h3>
      </div>
      <div className="text-[14px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
        {body}
      </div>
    </div>
  )
}

function Footer() {
  return (
    <footer className="px-6 lg:px-8 py-10 mt-8" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#7C3AED] to-[#C026D3] flex items-center justify-center font-semibold text-white text-[12px]">M</span>
          <span className="font-semibold text-[14px] tracking-tight" style={{ color: 'var(--text)' }}>
            MVP Affiliate
          </span>
        </div>
        <div className="flex items-center gap-5 text-[12px]" style={{ color: 'var(--text-faint)' }}>
          <a href="/" className="hover:opacity-100" style={{ color: 'var(--text-soft)' }}>Home</a>
          <a href="/pricing" className="hover:opacity-100" style={{ color: 'var(--text-soft)' }}>Pricing</a>
          <a href="/contact" className="hover:opacity-100" style={{ color: 'var(--text-soft)' }}>Contact</a>
          <span>© {new Date().getFullYear()} MVP Affiliate</span>
        </div>
      </div>
    </footer>
  )
}
