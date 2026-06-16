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

import type { Metadata } from 'next'
import { CheckCircle, Zap } from 'lucide-react'
import { SALES_PAUSED, SALES_PAUSED_MESSAGE } from '@/lib/sales-paused'
import { CheckoutButton } from './CheckoutButton'

export const metadata: Metadata = { title: 'Pricing · MVP Affiliate' }

type Plan = {
  tier: 'trial' | 'creator' | 'studio' | 'pro'
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
const plans: PlanExt[] = [
  {
    tier: 'trial',
    label: 'Free Trial',
    price: 0,
    regularPrice: 0,
    limit: '5 posts, no card',
    description: 'A real trial, not a teaser. Run the full YouTube workflow on 5 real reviews before paying a cent. No card, no time limit.',
    features: [
      '5 full reviews (lifetime, no time limit)',
      'YouTube Co-Pilot: description, tags, hashtags & thumbnail pushed back to YouTube',
      'Branded WordPress review site (theme + plugin auto-installed)',
      'One-click publish to your site',
      'Full AI agent pipeline (research, outline, draft, verdict, SEO)',
      'Geniuslink affiliate-link wrapping',
      'MVP Help Desk: 20 messages / month',
    ],
    highlight: false,
    ctaLabel: 'Start free',
  },
  {
    tier: 'creator',
    label: 'Creator',
    price: 49,
    regularPrice: 99,
    limit: '20 posts / month',
    description: 'For creators shipping a few reviews a week across the lower-friction socials, with a taste of the Pro brand-pitch workflow.',
    features: [
      '20 full reviews per month (blog + thumbnail + metadata bundle)',
      'Auto-post to Facebook, Threads, LinkedIn & Bluesky',
      'In-body AI product images (up to 3 per post)',
      'Your Face in AI thumbnails (1 face, 1 LoRA retrain / month)',
      'Photobooth headshots (10 / month)',
      'Video Script & Shot List (10 / month)',
      '5 brand-collab pitch emails / month (taster)',
      'Newsletter taster: 500 subscribers, 1 broadcast / month',
      'MVP Help Desk: 200 messages / month',
      'Monthly caps reset on your billing date. No rollover',
    ],
    highlight: false,
    ctaLabel: 'Get Creator',
  },
  {
    tier: 'studio',
    label: 'Studio',
    price: 99,
    regularPrice: 199,
    limit: '45 posts / month',
    description: 'For the solo creator going full-time — everything in Creator plus the tools that turn a blog into a real publication: Deals Hub, topic hubs, video scripts, and a weekly newsletter on schedule.',
    features: [
      '45 full reviews per month (blog + thumbnail + metadata bundle)',
      'Adds Pinterest, Instagram & Telegram auto-post on top of Creator',
      'Deals Hub: 5 deal posts / month with countdown banners + Amazon CSV bulk import',
      'Refresh Images on any published post (re-renders the in-body shots)',
      'Topic hubs auto-aggregate your reviews into category pages (built-in WP plugin)',
      '2 saved faces + 3 LoRA retrains / month',
      'Photobooth headshots (15 / month)',
      'Video Script & Shot List (30 / month)',
      '15 brand-collab pitch emails / month',
      'Newsletter: 5,000 subscribers, 4 broadcasts / month (weekly) + scheduling',
      'MVP Help Desk: 1,000 messages / month',
      'Priority generation queue + priority support',
    ],
    highlight: true,
    ctaLabel: 'Get Studio',
  },
  {
    tier: 'pro',
    label: 'Pro',
    price: 199,
    regularPrice: 499,
    limit: '100 posts / month',
    description: 'Become the creator brands want. Comparisons, Buying Guides, Rebuild-from-video, multi-account social, VA seats, and 10 WordPress sites.',
    features: [
      '100 full reviews per month (blog + thumbnail + metadata bundle)',
      'Adds X (Twitter) auto-post on top of Studio',
      'Comparison posts: head-to-head ranked review with a named winner',
      'Buying Guides: "Best [topic] for 2026" round-ups (auto-curate or pick-your-own)',
      'Rebuild-from-video: re-write any legacy WordPress post from its source video',
      'Multi-account social: choose which connected account each post publishes to',
      'Up to 10 WordPress sites on one subscription',
      'Multiple YouTube channels — set a default channel per blog, or pull from any channel onto any blog',
      'Up to 3 Virtual Assistant seats with per-VA permissions',
      'Deals Hub: 30 deal posts / month with countdown banners + Amazon CSV bulk import',
      '3 LoRA retrains / month, Photobooth 20 / month',
      'Video Script & Shot List (150 / month)',
      '100 brand-collab pitch emails / month',
      'Newsletter: 10,000 subscribers, 4 broadcasts / month (weekly) + A/B subject lines + segmented sends',
      'One-click Publish All: site + every connected social in one shot',
      'MVP Help Desk: 2,500 messages / month',
      'Priority generation queue + priority support',
    ],
    highlight: false,
    ctaLabel: 'Get Pro',
  },
]

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0A0A0B] flex flex-col items-center px-4 py-16">
      <div className="text-center mb-12 max-w-3xl">
        <p className="text-xs font-semibold text-[#7C3AED] uppercase tracking-widest mb-3">
          Stop paying for 6 tools
        </p>
        <h1 className="text-4xl sm:text-5xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4 tracking-tight leading-[1.05]">
          One co-pilot for the entire<br className="hidden sm:block" />
          <span className="bg-gradient-to-br from-[#7C3AED] to-[#C026D3] bg-clip-text text-transparent">YouTube affiliate workflow</span>
        </h1>
        <p className="text-lg text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
          Paste a YouTube link. Get a published, SEO-tuned blog post — plus comparison
          and buying-guide articles, a thumbnail, a newsletter, and a script for your
          next video. All in your voice, all from one tool. Start free, no card.
        </p>
        <p className="mt-3 text-sm font-semibold text-[#34c759]">
          🔒 Early access pricing, locked in for life on the tier you subscribe to.
        </p>
      </div>

      {SALES_PAUSED && (
        <div className="w-full max-w-3xl mb-8 rounded-2xl bg-[#ff9500]/10 border border-[#ff9500]/30 p-5 text-center">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Sign-ups & purchases temporarily paused</p>
          <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">{SALES_PAUSED_MESSAGE}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 w-full max-w-6xl">
        {plans.map((plan) => (
          <div
            key={plan.tier}
            className={`rounded-2xl p-6 lg:p-7 flex flex-col ${
              plan.highlight
                ? 'bg-[#7C3AED] text-white shadow-2xl lg:scale-105 ring-1 ring-[#7C3AED]/40'
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
            <p className={`text-sm font-semibold mb-1 ${plan.highlight ? 'text-blue-100' : 'text-[#86868b] dark:text-[#8e8e93]'}`}>{plan.label}</p>
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
                  Save ${plan.regularPrice - plan.price}
                </span>
              </p>
            )}
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
              highlight={plan.highlight}
              salesPaused={SALES_PAUSED}
              ctaLabel={plan.ctaLabel}
            />
          </div>
        ))}
      </div>

      <p className="mt-10 text-sm text-[#86868b] dark:text-[#8e8e93] max-w-2xl text-center px-4">
        Auto-posting live today: your WordPress site, X, LinkedIn, Facebook, Instagram, Threads, Bluesky,
        Telegram, and Pinterest. TikTok is built and switches on automatically, at no extra cost, once it
        completes its platform review.
      </p>

      {/* ───────────────────────────────────────────────────────────────────
          Bundle math — the killer pitch. Show prospects exactly what MVP
          replaces and what they save. Direct competitive numbers (real
          published prices from research, not "premium tool"-style fluff).
          Two rows: Studio + Pro. Trial / Creator users don't get bundle
          math because their tier doesn't replace enough tools to be
          meaningful — it's an honest framing, not a manipulative one.
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
            Other tools each do one thing. MVP does the whole pipeline from one YouTube video to
            a blog, thumbnails, scripts, social posts, and a newsletter, all in your voice.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Studio bundle */}
          <div className="rounded-2xl bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 shadow-sm p-7">
            <div className="flex items-baseline justify-between mb-5">
              <div>
                <p className="text-xs font-semibold text-[#7C3AED] uppercase tracking-wide">MVP Studio · $99 / mo</p>
                <p className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mt-0.5">replaces this stack:</p>
              </div>
            </div>
            <ul className="flex flex-col gap-2.5 mb-5 text-sm">
              {[
                ['Cuppa Solo (AI blog writer)',           99],
                ['thumbnailcreator.com (Creator)',         41],
                ['OpusClip Pro (vertical clips)',          29],
                ['Beehiiv Grow (newsletter)',              43],
                ['Lasso Free (affiliate links)',            0],
              ].map(([tool, price]) => (
                <li key={tool as string} className="flex items-baseline justify-between border-b border-dashed border-gray-200 dark:border-white/10 pb-1.5">
                  <span className="text-[#3a3a3c] dark:text-[#ebebf0]">{tool}</span>
                  <span className="font-mono text-[#86868b] dark:text-[#8e8e93]">${price}/mo</span>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between text-sm font-semibold pt-1">
              <span className="text-[#1d1d1f] dark:text-[#f5f5f7]">Total replaced</span>
              <span className="font-mono text-[#1d1d1f] dark:text-[#f5f5f7]">$212/mo</span>
            </div>
            <div className="mt-4 rounded-xl bg-[#34c759]/10 border border-[#34c759]/25 px-4 py-3 flex items-baseline justify-between">
              <span className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">You save</span>
              <span className="font-mono text-lg font-bold text-[#34c759]">$113/mo</span>
            </div>
          </div>

          {/* Pro bundle — the bigger number */}
          <div className="rounded-2xl bg-gradient-to-br from-[#7C3AED]/[0.06] to-[#C026D3]/[0.04] dark:from-[#7C3AED]/15 dark:to-[#C026D3]/10 border border-[#7C3AED]/30 shadow-md p-7 relative overflow-hidden">
            <div className="absolute top-3 right-3">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#7C3AED] text-white text-[10px] font-bold uppercase tracking-wider">
                Best deal
              </span>
            </div>
            <div className="flex items-baseline justify-between mb-5">
              <div>
                <p className="text-xs font-semibold text-[#7C3AED] uppercase tracking-wide">MVP Pro · $199 / mo</p>
                <p className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mt-0.5">replaces this stack:</p>
              </div>
            </div>
            <ul className="flex flex-col gap-2.5 mb-5 text-sm">
              {[
                ['Cuppa Studio (multi-niche AI writer)',  199],
                ['Frase (SEO research + content briefs)',  97],
                ['thumbnailcreator.com (Creator)',         41],
                ['OpusClip Pro (vertical clips)',          29],
                ['Beehiiv Scale (newsletter)',             43],
                ['Lasso Pro (affiliate analytics)',        29],
              ].map(([tool, price]) => (
                <li key={tool as string} className="flex items-baseline justify-between border-b border-dashed border-[#7C3AED]/15 pb-1.5">
                  <span className="text-[#3a3a3c] dark:text-[#ebebf0]">{tool}</span>
                  <span className="font-mono text-[#86868b] dark:text-[#8e8e93]">${price}/mo</span>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between text-sm font-semibold pt-1">
              <span className="text-[#1d1d1f] dark:text-[#f5f5f7]">Total replaced</span>
              <span className="font-mono text-[#1d1d1f] dark:text-[#f5f5f7]">$438/mo</span>
            </div>
            <div className="mt-4 rounded-xl bg-[#34c759]/15 border border-[#34c759]/30 px-4 py-3 flex items-baseline justify-between">
              <span className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">You save</span>
              <span className="font-mono text-lg font-bold text-[#34c759]">$239/mo</span>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-[#86868b] dark:text-[#8e8e93] mt-5 max-w-3xl mx-auto">
          Pricing shown from each tool&apos;s public pricing page at the equivalent feature tier as of 2026. MVP also handles parts none of these do: fact-grounded blog, comparison &amp; buying-guide content built to rank, brand-pitch emails, a newsletter with list management, and the YouTube Co-Pilot metadata sync.
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
              body: 'Paste a YouTube link. Get back a published, SEO-tuned blog post, a comparison or buying guide, a thumbnail, a newsletter draft, a script for the next video, and native posts to your connected social channels &mdash; LinkedIn, Facebook, Instagram, Threads, Bluesky, Telegram, Pinterest and X (channels vary by plan). End-to-end, in one run.',
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
          keep your plan, even if we raise prices later. Your rate only changes if you choose to upgrade
          or downgrade tiers.
        </p>
      </div>
      <p className="mt-6 text-sm text-[#86868b] dark:text-[#8e8e93]">
        Cancel anytime. No contracts. Billed monthly via Stripe.
      </p>
    </div>
  )
}
