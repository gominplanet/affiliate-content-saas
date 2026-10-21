/**
 * Public pricing page. Converted to a Server Component (#47) — the entire
 * static layout (hero, three plan cards, feature lists, price-lock callout,
 * footer) ships as RSC HTML. Only the Stripe-checkout CTA hydrates as a
 * tiny client island (`./CheckoutButton`). The Rewardful effect, the loading
 * state and the signed-in-or-not bounce live inside that island so they
 * stay client-side without dragging the whole page bundle along.
 *
 * Net effect: substantially smaller per-page JS for a route that drives
 * conversions — better LCP, better Lighthouse on mobile, no behaviour
 * change from the user's side.
 */

import PriceLockCountdown from '@/components/landing/PriceLockCountdown'
import { newPricesLive } from '@/lib/price-schedule'
import type { Metadata } from 'next'
import { GUARANTEE_LABEL, GUARANTEE_SENTENCE } from '@/lib/guarantee'
import { TRIAL_SHORT, trialLabel, trialSentence, TRIAL_ALLOWANCE_NOTE } from '@/lib/trial'
import { CheckCircle, Zap } from 'lucide-react'
import { SALES_PAUSED, SALES_PAUSED_MESSAGE } from '@/lib/sales-paused'
import NextImage from 'next/image'
import { CheckoutButton } from './CheckoutButton'
import { annualOfferFor } from '@/lib/stripe'
import MetaTrack from '@/components/analytics/MetaTrack'
import { TIERS, SELLABLE_TIERS, type Tier } from '@/lib/tier'
import { MAX_ITEMS as BULK_UPLOAD_MAX_VIDEOS } from '@/lib/launch-batch'
import { SHORTS_MONTHLY_CAP } from '@/lib/usage-cap'

// The layout's title template appends "· MVP Affiliate"; spelling it here too
// printed it twice in the tab and in search results.
export const metadata: Metadata = {
  title: 'Pricing',
  description: `One plan, Pro: every feature MVP has, from the day you join. ${trialLabel()}.`,
}

type Plan = {
  tier: 'trial' | 'creator' | 'studio' | 'pro' | 'amazon'
  label: string
  price: number
  regularPrice: number
  limit: string
  description: string
  features: string[]
  highlight: boolean
  ctaLabel: string
}

type PlanExt = Plan & { bonus?: string; badge?: string }

// Caps + feature flags rewritten 2026-06-04 to match the new tier matrix
// (see lib/tier.ts). Source of truth lives in tier.ts; this list is the
// marketing surface that mirrors it. If you change tier.ts, change this.
/** Grid classes per plan count. Written out in full because Tailwind scans for
 *  literal class names and would purge anything assembled from a variable. The
 *  max-width narrows with the count so two cards read as a deliberate pair
 *  rather than as four cards with two missing. */
const PLAN_GRID: Record<number, string> = {
  1: 'grid-cols-1 max-w-md',
  2: 'grid-cols-1 sm:grid-cols-2 max-w-4xl',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 max-w-6xl',
}

// ── what each plan replaces ────────────────────────────────────────────────
//
// Keyed by tier and filtered through SELLABLE_TIERS, so a frozen plan cannot
// keep a bundle card after its buy button is gone. That is exactly what
// happened to Studio: its card disappeared from the grid above on
// 2026-09-15 and its bundle card stayed, pricing a plan checkout refuses.
//
// Prices are each tool's own published price at the equivalent feature tier,
// which is why they are literals here and nowhere else on this page: they are
// somebody else's numbers and nothing in this repo can derive them. Ours are
// read from TIERS, and both the total and the saving are summed at render.
const BUNDLE_STACKS: Partial<Record<Tier, [string, number][]>> = {
  // The storefront stack. No AI writer and no SEO tool, because this plan
  // does not write blog posts (postsPerMonth is 0), so it does not replace them.
  amazon: [
    ['thumbnailcreator.com (Creator)', 41],
    ['Jungle Scout (product research)', 49],
    ['Price history & deal tracking', 19],
    // Clip Factory joined the Amazon plan on 2026-10-05 (lib/amazon-plan).
    ['OpusClip Pro (vertical clips)', 29],
    ['Lasso Pro (affiliate analytics)', 29],
  ],
  pro: [
    ['Cuppa Studio (multi-niche AI writer)', 199],
    ['Jungle Scout (product research)', 49],
    ['Helium 10 (product + keyword research)', 79],
    ['Price history & deal tracking', 19],
    ['Frase (SEO research + content briefs)', 97],
    ['thumbnailcreator.com (Creator)', 41],
    ['OpusClip Pro (vertical clips)', 29],
    // No newsletter tool: the member newsletter is retired (lib/feature-flags
    // NEWSLETTER_FOR_MEMBERS), so MVP does not replace one.
    ['Lasso Pro (affiliate analytics)', 29],
  ],
}

const BUNDLES = SELLABLE_TIERS
  .filter((t) => BUNDLE_STACKS[t])
  .map((t) => ({
    tier: t,
    stack: BUNDLE_STACKS[t] as [string, number][],
    // The louder card is the one with the biggest real saving, rather than a
    // plan named in a style attribute and left there through a repricing.
    best: false,
  }))
  .map((b, _i, all) => ({
    ...b,
    best: b.tier === all.reduce((win, x) => {
      const save = (y: typeof x) => y.stack.reduce((n, [, u]) => n + u, 0) - TIERS[y.tier].price
      return save(x) > save(win) ? x : win
    }, all[0]).tier,
  }))

const plans: PlanExt[] = [
  // ONE PLAN (Seb, 2026-10-18): no free trial and no Amazon plan. Every new
  // member starts on Pro with a 7-day refund (lib/guarantee).
  // Creator and Studio are FROZEN (2026-09-15): the five existing subscribers
  // keep their plan, their price and their allowances, and nobody new can buy
  // one. Their cards are gone from here and from app/page.tsx, and checkout
  // refuses them outright, because removing the card alone leaves a bookmarked
  // /signup?plan=studio able to create a sixth account on a plan we decided not
  // to support.
  {
    tier: 'pro',
    label: 'Pro',
    price: TIERS.pro.price,
    regularPrice: TIERS.pro.regularPrice,
    limit: `${TIERS.pro.postsPerMonth} reviews / month`,
    description: `Everything MVP does, open the day you join: your blog, your YouTube uploads, your Amazon storefront and every social network, all in your voice. ${trialSentence()}`,
    features: [
      `${TIERS.pro.pinsPerMonth} ready-to-post pins & ${TIERS.pro.igPostsPerMonth} Instagram designs / month (posted to Facebook too), ${TIERS.pro.thumbnailsPerMonth} Art Director thumbnails / month at high quality, Creator Connections brand deals`,
      'Amazon Product Research across the whole catalogue, live Deal Radar, and your Levanta and PartnerBoost campaigns',
      'TRYBE brand deals: every brand sorted by fit for your channel, first messages drafted in your words, inbox replies and 10 shooting scripts per brand',
      `${TIERS.pro.postsPerMonth} full reviews per month (blog + thumbnail + metadata bundle)`,
      '⚡ Publish from Deal Radar to your blog too: deal posts, roundups & the weekly digest, plus the shoppable Link-in-Bio page and auto Instagram Stories',
      // TikTok is live (lib/feature-flags LIVE_SOCIAL), not waiting on a review.
      'Auto-post to Pinterest, Instagram, Facebook, X (Twitter), TikTok, Threads, LinkedIn, Bluesky and Telegram',
      `Video tools: Bulk Amazon upload, YouTube Co-Pilot (${TIERS.pro.metadataGensPerMonth} runs / month), Clip Factory (${SHORTS_MONTHLY_CAP} clips / month, to TikTok and YouTube Shorts too), Pinned and On sale comments, and Amazon Live prep and follow-up with no monthly limit`,
      // /levanta, /partnerboost and /wayward are walled off for the Amazon plan.
      'Partner programs: turn any Levanta, PartnerBoost, Wayward or LTK campaign into a commissionable post',
      'Comparison posts: head-to-head ranked review with a named winner',
      'Buying Guides: "Best [topic]" round-ups (auto-curate or pick-your-own)',
      'Rebuild-from-video: re-write any legacy WordPress post from its source video',
      'Multi-account social: choose which connected account each post publishes to',
      `Up to ${TIERS.pro.sites} WordPress sites on one subscription`,
      `Up to ${TIERS.pro.youtubeChannels} YouTube channels: set a default channel per blog, or pull from any channel onto any blog`,
      `Up to ${TIERS.pro.vaSeats} Team seats for your VAs, each with its own permissions`,
      'Deals Hub: deal posts draw from your monthly generations, with countdown banners + Amazon CSV bulk import',
      `${TIERS.pro.maxFaces} saved faces, Photobooth ${TIERS.pro.photoboothPerMonth} / month`,
      `Scriptwriter: video script & shot list (${TIERS.pro.scriptsPerMonth} / month)`,
      `Brand pitches: ${TIERS.pro.collabsPerMonth} long-form outreach emails drafted / month (Creator Connections messages are unlimited)`,
      'One-click Publish All: site + every connected social in one shot',
      `Ask MVP: ${TIERS.pro.assistantMessagesPerMonth} messages / month`,
      'Priority generation queue + priority support',
    ],
    highlight: false,
    // The badge, not `highlight`. The highlight branch paints the whole card
    // purple, which reads well on a short card and not on this one: Pro carries
    // twenty-two bullets and a solid block that tall shouts over the page it is
    // meant to lead. The badge plus a ring distinguishes it and stays quiet.
    badge: 'Everything included',
    ctaLabel: 'Start Pro',
  },
]

/** MONTHLY IS THE DEFAULT, AND THE CHOICE LIVES IN THE URL.
 *
 *  This page is a Server Component on purpose: the whole grid ships as HTML and
 *  only the checkout button hydrates. A React toggle would have dragged the
 *  grid back into the client bundle on the one route that drives conversions.
 *
 *  So the toggle is two links and the server renders the chosen view. It costs
 *  no JavaScript, it works before hydration, and /pricing?billing=annual is a
 *  real address an ad can point at. */
export default async function PricingPage({
  searchParams,
}: {
  searchParams?: Promise<{ billing?: string }>
}) {
  const sp = (await searchParams) ?? {}
  // Anything other than the exact string means monthly, so a mangled or
  // truncated URL shows the safer of the two rather than a year up front.
  const annual = sp.billing === 'annual'
  return (
    <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0A0A0B] flex flex-col items-center px-4 py-16">
      {/* Reaching pricing is the first real buying signal on the site, and it
          happens far more often than a sale. Without it the funnel jumps
          straight from an undifferentiated PageView to CompleteRegistration,
          so there was no way to tell an ad that drives interest from one that
          drives nothing. No onceKey: a repeat pricing visit is itself signal. */}
      <MetaTrack event="ViewContent" params={{ content_name: 'Pricing', content_category: 'pricing' }} />
      <div className="text-center mb-12 max-w-3xl">
        <p className="text-xs font-semibold text-[#7C3AED] uppercase tracking-widest mb-3">
          One plan · every feature · {trialLabel()}
        </p>
        <h1 className="text-4xl sm:text-5xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4 tracking-tight leading-[1.05]">
          One plan.<br className="hidden sm:block" />{' '}
          <span className="bg-gradient-to-br from-[#7C3AED] to-[#C026D3] bg-clip-text text-transparent">Everything MVP does.</span>
        </h1>
        <p className="text-lg text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
          Pro opens every feature the day you join: the research, the thumbnails and designs, your
          YouTube uploads and Amazon storefront, your blog, and posting to every network. The first
          week is free, and it is the whole product, not a cut-down version of it. {trialSentence()}
        </p>
        <p className="mt-3 text-sm font-semibold text-[#34c759]">
          🔒 Early access pricing, locked in for as long as you stay subscribed.
        </p>
      </div>

      {SALES_PAUSED && (
        <div className="w-full max-w-3xl mb-8 rounded-2xl bg-[#ff9500]/10 border border-[#ff9500]/30 p-5 text-center">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Sign-ups & purchases temporarily paused</p>
          <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">{SALES_PAUSED_MESSAGE}</p>
        </div>
      )}

      {/* THE COLUMN COUNT FOLLOWS THE NUMBER OF PLANS.
          This was a fixed lg:grid-cols-4 from when four plans were sold. Creator
          and Studio are frozen legacy tiers now, so two cards rendered into a
          four-column row: both squeezed to a quarter width, packed to the left,
          with the right half of the section empty. The text wrapped every three
          words and the page looked broken on the one screen that has to sell.
          Driving it off plans.length means freezing or adding a plan lays itself
          out instead of needing this line remembered. */}
      {/* ── MONTHLY / YEARLY ───────────────────────────────────────────────
          Two links, not a React toggle, so the grid below stays server
          rendered and this costs no JavaScript on the page that sells.

          It renders only when a yearly price is genuinely sellable: an amount
          in lib/tier AND a Stripe id in the env. A toggle that appears before
          the env var is set would show $999 on a card whose button charges $99
          a month, which is the worst of both. Nothing to hide, nothing to
          explain: without the env var the page is exactly what it was. */}
      {(() => {
        const sellable = plans.filter((p) => annualOfferFor(p.tier))
        if (sellable.length === 0) return null
        // The biggest saving on offer, so the label promises what at least one
        // plan actually delivers rather than an average nobody can buy.
        const best = Math.max(...sellable.map((p) => annualOfferFor(p.tier)!.savingUsd))
        const base = 'px-4 py-2 rounded-lg text-sm font-semibold transition-colors'
        return (
          <div className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-1 p-1 rounded-xl border bg-white dark:bg-[#1c1c1e] border-gray-200 dark:border-white/10">
              <a
                href="/pricing#plans"
                aria-current={!annual ? 'page' : undefined}
                className={`${base} ${!annual ? 'bg-[#7C3AED] text-white' : 'text-[#6e6e73] dark:text-[#ebebf0] hover:text-[#1d1d1f] dark:hover:text-white'}`}
              >
                Monthly
              </a>
              <a
                href="/pricing?billing=annual#plans"
                aria-current={annual ? 'page' : undefined}
                className={`${base} inline-flex items-center gap-2 ${annual ? 'bg-[#7C3AED] text-white' : 'text-[#6e6e73] dark:text-[#ebebf0] hover:text-[#1d1d1f] dark:hover:text-white'}`}
              >
                Yearly
                <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${annual ? 'bg-white/20 text-white' : 'bg-[#34c759]/12 text-[#248a3d]'}`}>
                  Save up to ${best}
                </span>
              </a>
            </div>
          </div>
        )
      })()}

      {/* Prices go up for new members on January 1; the lock and countdown. */}
      {!newPricesLive() && <PriceLockCountdown className="mb-8" />}

      <div id="plans" className={`grid gap-5 w-full mx-auto scroll-mt-8 items-start ${PLAN_GRID[plans.length] ?? PLAN_GRID[4]}`}>
        {plans.map((plan) => (
          <div
            key={plan.tier}
            className={`rounded-2xl p-6 lg:p-7 flex flex-col ${
              plan.highlight
                ? 'bg-[#7C3AED] text-white shadow-2xl lg:scale-105 ring-1 ring-[#7C3AED]/40'
                : plan.badge
                  ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-lg border-2 border-[#7C3AED]/60'
                  : 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-sm border border-gray-200 dark:border-white/10'
            }`}
          >
            {plan.highlight && (
              <div className="flex items-center gap-1.5 mb-4">
                <Zap size={14} className="text-yellow-300" />
                <span className="text-xs font-semibold text-yellow-300 uppercase tracking-wide">Most Popular</span>
              </div>
            )}
            {!plan.highlight && plan.badge && (
              <div className="flex items-center gap-1.5 mb-4">
                <Zap size={14} className="text-[#7C3AED]" />
                <span className="text-xs font-semibold text-[#7C3AED] uppercase tracking-wide">{plan.badge}</span>
              </div>
            )}
            {/* The same row, reserved and invisible, on a card with no badge.
                Without it the badged card's title, price and "/month" all sit a
                row lower than its neighbour's, so two cards meant to be compared
                side by side have their prices at different heights. Built from
                the identical markup rather than a guessed height, so it stays
                aligned if the badge's type size ever changes. Hidden below sm,
                where the cards stack and there is nothing to line up with: an
                invisible row there is only wasted height on a phone. */}
            {!plan.highlight && !plan.badge && (
              <div className="hidden sm:flex items-center gap-1.5 mb-4 invisible" aria-hidden="true">
                <Zap size={14} />
                <span className="text-xs font-semibold uppercase tracking-wide">&nbsp;</span>
              </div>
            )}
            <p className={`text-sm font-semibold mb-1 ${plan.highlight ? 'text-blue-100' : 'text-[#86868b] dark:text-[#8e8e93]'}`}>{plan.label}</p>
            {(() => {
              // The yearly offer for THIS plan, or null when it has no annual
              // price or no Stripe id for one. Asked per card rather than once
              // for the page, so a tier without a yearly price keeps showing its
              // monthly one instead of a blank.
              const offer = annual ? annualOfferFor(plan.tier) : null
              return offer ? (
                <>
                  <div className="flex items-end gap-1.5 mb-1">
                    <span className="text-4xl font-bold tracking-tight">${offer.annualPrice}</span>
                    <span className={`text-sm mb-1.5 ${plan.highlight ? 'text-blue-100' : 'text-[#86868b] dark:text-[#8e8e93]'}`}>/year</span>
                  </div>
                  <p className={`text-xs mb-1 ${plan.highlight ? 'text-blue-100' : 'text-[#86868b] dark:text-[#8e8e93]'}`}>
                    <span className="line-through">${offer.monthlyPrice * 12}/year</span>{' '}
                    <span className={plan.highlight ? 'text-yellow-300 font-semibold' : 'text-[#34c759] font-semibold'}>
                      Save ${offer.savingUsd}
                    </span>
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-end gap-1.5 mb-1">
                    <span className="text-4xl font-bold tracking-tight">${plan.price}</span>
                    {plan.price > 0 && (
                      <span className={`text-sm mb-1.5 ${plan.highlight ? 'text-blue-100' : 'text-[#86868b] dark:text-[#8e8e93]'}`}>/month</span>
                    )}
                  </div>
                  {plan.regularPrice > plan.price && (
                    <p className={`text-xs mb-1 ${plan.highlight ? 'text-blue-100' : 'text-[#86868b] dark:text-[#8e8e93]'}`}>
                      <span className="line-through">${plan.regularPrice}/month</span>{' '}
                      <span className={plan.highlight ? 'text-yellow-300 font-semibold' : 'text-[#34c759] font-semibold'}>
                        Save ${plan.regularPrice - plan.price} a month, locked in
                      </span>
                    </p>
                  )}
                </>
              )
            })()}
            <p className={`text-sm mb-2 font-medium ${plan.highlight ? 'text-blue-100' : 'text-[#7C3AED]'}`}>{plan.limit}</p>
            <p className={`text-sm mb-6 ${plan.highlight ? 'text-blue-100' : 'text-[#6e6e73] dark:text-[#ebebf0]'}`}>{plan.description}</p>

            <ul className="flex flex-col gap-3 mb-8 flex-1">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <CheckCircle size={15} className={`mt-0.5 flex-shrink-0 ${plan.highlight ? 'text-blue-200' : 'text-[#34c759]'}`} />
                  <span className={plan.highlight ? 'text-blue-50' : 'text-[#1d1d1f] dark:text-[#f5f5f7]'}>{f}</span>
                </li>
              ))}
            </ul>

            {/* The only client island on this page — keeps Rewardful + the
                signed-in check + Stripe redirect on the client, while the
                card around it stays server-rendered. */}
            <CheckoutButton
              tier={plan.tier}
              interval={annual ? 'year' : 'month'}
              highlight={plan.highlight}
              salesPaused={SALES_PAUSED}
              ctaLabel={plan.ctaLabel}
            />
          </div>
        ))}
      </div>

      <p className="mt-10 text-sm text-[#86868b] dark:text-[#8e8e93] max-w-2xl text-center px-4">
        Auto-posting live today: your WordPress site, X, LinkedIn, Facebook, Instagram, Threads, Bluesky,
        Telegram, Pinterest and TikTok. Pro posts to all of them.
      </p>

      {/* The Amazon plan's section and the two-plan table that sat here are
          gone (2026-10-18): Pro is the one plan sold. */}

      {/* ───────────────────────────────────────────────────────────────────
          Bundle math — what each plan replaces, in tools with published
          prices, so a prospect can check it rather than take it.

          THE CARDS ARE THE PLANS WE SELL. This was Studio + Pro. Studio has
          been frozen since 2026-09-15: checkout calls isSellableTier and
          refuses it, its card was pulled from the grid above, and this
          section was the last screen on the site still pricing it. A bundle
          argument for a plan nobody can buy is worse than no bundle argument,
          because the reader who is convinced by it then cannot act on it.

          So the stacks are keyed by tier and built from SELLABLE_TIERS, and
          both totals are SUMMED rather than typed. The old ones were typed
          ($280 / $181 and $585 / $386, all four correct on the day) which is
          the same arrangement that had /amazon-influencer advertising $79
          against a $99 charge: right until something moves, silent after.

          THE AMAZON STACK IS DELIBERATELY SHORT. That plan does not write
          blog posts (postsPerMonth is 0), so it does not replace an AI
          writer or an SEO tool, and padding it
          with them would be the manipulative version of this section. Five
          real tools (OpusClip since Clip Factory joined the plan) is a weaker
          pitch than Pro's, and it is the true one. Every tool and price here already appeared in the Pro
          stack below; nothing was invented to fill the card out.
          ─────────────────────────────────────────────────────────────── */}
      <section className="mt-16 w-full max-w-5xl">
        <div className="text-center mb-8">
          <p className="text-xs font-semibold text-[#7C3AED] uppercase tracking-widest mb-2">
            The bundle math
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">
            One MVP plan replaces an entire stack
          </h2>
          <p className="mt-3 text-sm text-[#6e6e73] dark:text-[#ebebf0] max-w-xl mx-auto">
            Other tools each do one thing. Pro replaces the stack a storefront runs on, plus the
            whole pipeline from one video to a blog, scripts and social posts, all in your voice.
          </p>
        </div>

        <div className={`grid grid-cols-1 gap-5 mx-auto ${BUNDLES.length > 1 ? 'lg:grid-cols-2' : 'max-w-xl'}`}>
          {BUNDLES.map(({ tier, stack, best }) => {
            const replaced = stack.reduce((n, [, usd]) => n + usd, 0)
            const saving = replaced - TIERS[tier].price
            return (
              <div
                key={tier}
                className={best
                  ? 'rounded-2xl bg-gradient-to-br from-[#7C3AED]/[0.06] to-[#C026D3]/[0.04] dark:from-[#7C3AED]/15 dark:to-[#C026D3]/10 border border-[#7C3AED]/30 shadow-md p-7 relative overflow-hidden'
                  : 'rounded-2xl bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 shadow-sm p-7'}
              >
                {best && (
                  <div className="absolute top-3 right-3">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#7C3AED] text-white text-[10px] font-bold uppercase tracking-wider">
                      Best deal
                    </span>
                  </div>
                )}
                <div className="flex items-baseline justify-between mb-5">
                  <div>
                    <p className="text-xs font-semibold text-[#7C3AED] uppercase tracking-wide">
                      MVP {TIERS[tier].label} · ${TIERS[tier].price} / mo
                    </p>
                    <p className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mt-0.5">replaces this stack:</p>
                  </div>
                </div>
                <ul className="flex flex-col gap-2.5 mb-5 text-sm">
                  {stack.map(([tool, usd]) => (
                    <li
                      key={tool}
                      className={`flex items-baseline justify-between border-b border-dashed pb-1.5 ${best ? 'border-[#7C3AED]/15' : 'border-gray-200 dark:border-white/10'}`}
                    >
                      <span className="text-[#3a3a3c] dark:text-[#ebebf0]">{tool}</span>
                      <span className="font-mono text-[#86868b] dark:text-[#8e8e93]">${usd}/mo</span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-baseline justify-between text-sm font-semibold pt-1">
                  <span className="text-[#1d1d1f] dark:text-[#f5f5f7]">Total replaced</span>
                  <span className="font-mono text-[#1d1d1f] dark:text-[#f5f5f7]">${replaced}/mo</span>
                </div>
                <div className={`mt-4 rounded-xl px-4 py-3 flex items-baseline justify-between ${best ? 'bg-[#34c759]/15 border border-[#34c759]/30' : 'bg-[#34c759]/10 border border-[#34c759]/25'}`}>
                  <span className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">You save</span>
                  <span className="font-mono text-lg font-bold text-[#34c759]">${saving}/mo</span>
                </div>
              </div>
            )
          })}
        </div>

        <p className="text-center text-xs text-[#86868b] dark:text-[#8e8e93] mt-5 max-w-3xl mx-auto">
          Each tool&apos;s own published price at the equivalent feature tier, so you can check every line. MVP also handles parts none of these do: fact-grounded blog, comparison &amp; buying-guide content built to rank, brand-pitch emails, and the YouTube Co-Pilot metadata sync.
        </p>
      </section>

      {/* ───────────────────────────────────────────────────────────────────
          Why MVP — three differentiators competitors can't claim. Anchored
          in real product capabilities (fact-grounded outputs, end-to-end
          pipeline, your-voice training) per the LEARN profile rule.
          ─────────────────────────────────────────────────────────────── */}
      <section className="mt-16 w-full max-w-5xl">
        <div className="text-center mb-8">
          <p className="text-xs font-semibold text-[#7C3AED] uppercase tracking-widest mb-2">
            Why MVP wins
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">
            Three things no other tool in this stack does
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            {
              title: 'Fact-grounded, never invented',
              body: 'Every spec, every quote, every &quot;I tested it for X days&quot; pulls from your real YouTube transcript + the actual product page. No hallucinated stories, no fake reviewer names, no fabricated experiences.',
            },
            {
              title: 'One video → nine outputs',
              body: 'Paste a YouTube link. Get back a published, SEO-tuned blog post, a comparison or buying guide, a thumbnail, a script for the next video, and native posts to your connected social channels: LinkedIn, Facebook, Instagram, Threads, Bluesky, Telegram, Pinterest and X (Pro posts to all of them). End-to-end, in one run.',
            },
            {
              title: 'Trained on YOUR voice, not a generic AI voice',
              body: 'The LEARN profile reads how you write + revises every output toward you. The longer you use MVP, the more your blog reads like you wrote it. Other writers default to a generic SEO voice that all sound the same.',
            },
          ].map((card) => (
            <div key={card.title} className="rounded-2xl bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 shadow-sm p-6">
              <p className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">{card.title}</p>
              <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed" dangerouslySetInnerHTML={{ __html: card.body }} />
            </div>
          ))}
        </div>
      </section>

      <div className="mt-16 max-w-2xl rounded-2xl bg-gradient-to-br from-[#7C3AED]/[0.06] to-[#C026D3]/[0.04] border border-[#7C3AED]/25 p-5">
        <p className="text-center text-sm font-semibold text-[#7C3AED] mb-1.5">🔒 Price-lock guarantee</p>
        <p className="text-center text-sm text-[#3a3a3c] dark:text-[#ebebf0] leading-relaxed">
          When you subscribe at these Early Access rates, your price stays locked in for as long as you
          stay subscribed, even if we raise prices later.
        </p>
      </div>
      <p className="mt-6 text-sm text-[#86868b] dark:text-[#8e8e93]">
        {TRIAL_SHORT}, then billed monthly. {GUARANTEE_LABEL}. Cancel anytime. No contracts. Billed through Stripe.
      </p>
      {/* THE CAP A FREE WEEK HITS, SAID BEFORE IT IS HIT. intro-allowance holds
          the first 7 days to a quarter of each monthly allowance, which is the
          free week exactly. Somebody who runs into that on day three without
          having read this concludes the product is broken, not that they are
          on a trial. */}
      <p className="mt-2 text-sm text-[#86868b] dark:text-[#8e8e93] max-w-xl">
        {TRIAL_ALLOWANCE_NOTE}
      </p>
    </div>
  )
}
