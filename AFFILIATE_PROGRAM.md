# Affiliate program copy for Rewardful

Canonical copy for the "Friends of MVP Affiliate" program. Paste these
verbatim into the Rewardful dashboard fields.

Program URL: https://rewardful.com (your Rewardful dashboard)

> **This file is a promise about a system this repo cannot read.** Nothing
> here is enforced by code. Rewardful shows whatever was last typed into it,
> so when a number below changes, it has to be changed in the Rewardful
> dashboard by hand on the same day. This file going stale is not cosmetic:
> it advertised plans that do not exist for months (see the history note at
> the bottom).

## Where every number comes from

Do not type a number into this file. Read it from the code, so the copy an
affiliate reads and the figure the server charges cannot drift apart:

| What | Source of truth |
| --- | --- |
| Commission, cookie, payout terms | `lib/affiliate-campaign.ts` → `AFFILIATE_CAMPAIGN` |
| Plan prices, and the November 1 change | `lib/price-schedule.ts` |
| Which plans are sellable | `lib/tier.ts` → `SELLABLE_TIERS` |
| What the free trial includes | `lib/free-trial.ts` → `freeTrialHighlights()` |
| What the free trial excludes | `lib/free-trial.ts` → `freeTrialExclusions()` |

## The terms, as they stand

- **Commission:** 10% recurring, for as long as the referral stays subscribed.
  Not a one-time bounty.
- **Cookie:** 60 days.
- **Payout:** monthly via Stripe, once the balance clears $50.
- **Clearance:** commission is held 60 days before it can be paid out.
- **The referred customer also gets:** 20% off their first 3 months.
- **Plans MVP sells:** Amazon and Pro. There is no Starter, Growth, Creator or
  Studio plan to quote. Those names survive in `lib/tier.ts` only for legacy
  accounts.

### Prices, and the November 1 change

`lib/price-schedule.ts` flips these by date, at 2026-11-01T07:00:00Z:

| Plan | Joining before the change | Joining after |
| --- | --- | --- |
| Amazon | $99/month, $999/year | $159/month, $1,590/year |
| Pro | $199/month, $1,999/year | $299/month, $2,990/year |

Anyone who joins before the change keeps their price for as long as they stay
subscribed, on whichever of the two plans they move to.

**What that means for an affiliate's commission, at 10%:**

| Plan | Before the change | After |
| --- | --- | --- |
| Amazon | $9.90/month | $15.90/month |
| Pro | $19.90/month | $29.90/month |

**Swap the Rewardful copy on November 1.** Until then, the deadline is the
single best thing an affiliate has to push, so it is written into the copy
below. Delete those sentences once the date passes, or the program is
advertising a lock nobody can still get.

---

## Welcome text (shown to potential affiliates during sign-up)

```
Promote MVP Affiliate, the platform that takes one video and produces
everything around it: a written review on the creator's own blog, an
optimized YouTube title, description and thumbnail, vertical clips for
Reels and TikTok, social posts across every connected channel, and a
shoppable link-in-bio page that fills itself from what they post.

It handles the money side too. It surfaces the live Amazon Creator
Connections campaigns worth pitching, sends those pitches in bulk, and
routes every affiliate click to the shopper's own country store with the
creator's tag for that country.

Your audience starts free for 30 days, no card. You earn 10% commission
on every paying customer you refer, and you keep earning it every month
for as long as they stay subscribed. Real recurring income, not a
one-time bounty.

Right now there is a deadline worth leading with: MVP's prices rise on
November 1, and anyone who joins before then keeps the lower price for
life. That is the strongest reason your audience has to act this month.

Best fit: Amazon Influencers, YouTube reviewers, affiliate-marketing
creators, and anyone with an audience of solo creators or affiliate
publishers.
```

---

## Affiliate dashboard text (shown to affiliates after they log in)

```
Welcome to the Friends of MVP Affiliate program.

Your job: send creators to mvpaffiliate.io. They get 30 days free, no
card, and anyone who signs up through your link also gets 20% off their
first 3 months. You earn 10% the moment they upgrade to a paid plan,
Amazon or Pro, and you keep earning it every month they stay
subscribed. For life. Not a one-time bounty.

That is the part most programs do not offer. Refer 20 creators who
stick around and you have built yourself a real monthly income stream.

Paid monthly via Stripe once your balance clears $50. Commission is
held 60 days before payout, and the referral cookie lasts 60 days, so a
slow decision still earns.

THIS MONTH'S ANGLE
MVP's prices rise on November 1. Anyone who joins before then keeps the
lower price for as long as they stay subscribed. A real deadline beats
any pitch you could write, so lead with it while it is true.

Best-converting pitch angles:
• "Stop writing descriptions, blog posts and pitches by hand. One video
  in, the whole package out."
• "Every affiliate click lands on the shopper's own country store, with
  your tag for that country. Nobody in Berlin lands on the US store and
  buys nothing."
• "Tick up to 100 Amazon brands and pitch them in one go, from your own
  profile, without accepting anything you did not read."

Need logos, screenshots, demo videos, or want a custom angle for your
audience? Email team@mvpaffiliate.io and we will set you up fast.
```

---

## Code integration (Step 1 + Step 2 from Rewardful's Next.js docs)

Both steps are wired:

1. **Tracking script** loaded in [app/layout.tsx](app/layout.tsx) inside
   `<body>`, behind a check for `NEXT_PUBLIC_REWARDFUL_KEY`. The script
   only renders when that env var is set, so dev/local stays clean
   unless you opt in.
2. **Referral capture + Stripe attribution** in [app/pricing/page.tsx](app/pricing/page.tsx),
   which listens for the `rewardful('ready')` event, stores `Rewardful.referral`,
   and POSTs it alongside `tier` to `/api/stripe/checkout`. The checkout
   route forwards the referral as `client_reference_id` on the Stripe
   Checkout Session, and Rewardful's webhook reads that field to attribute
   the conversion.

### Required env vars

Add to **Vercel** (Production + Preview at minimum, Sensitive OFF
because this is a public-by-design tracking key):

```
NEXT_PUBLIC_REWARDFUL_KEY=<your-key-from-rewardful-dashboard>
```

And to local `.env.local` for testing referral flows in dev:

```
NEXT_PUBLIC_REWARDFUL_KEY=<your-key-from-rewardful-dashboard>
```

You can find the key in the Rewardful dashboard. It is the
`data-rewardful` value Rewardful shows in the Next.js integration docs
(a 6-character lowercase alphanumeric string).

### Smoke test

1. Get any affiliate's referral link from Rewardful (or use your own):
   `https://mvpaffiliate.io/?via=<affiliate-id>`
2. Open it in incognito, land on the site, navigate to pricing, and
   upgrade with a test card.
3. In Rewardful, Conversions tab, the test transaction should appear
   attributed to that affiliate.

---

## Key talking points to keep consistent across the program

1. **Lifetime recurring commission**, paid for as long as the referred
   customer stays subscribed. Not a one-time bounty. This is the biggest
   differentiator against most SaaS affiliate programs.
2. **The November 1 deadline.** Prices rise, and joining before then locks
   the lower price for life. Retire this point once the date passes.
3. **Free entry for the referred customer**, 30 days with no card, plus 20%
   off their first 3 months through a referral link. Low-friction CTA.
4. **Amazon-first positioning.** The audience the ads buy is Amazon
   Influencers, not YouTubers in general. The free trial is built around one
   Amazon loop: a product, a finished design with their own face on it,
   downloaded. Pitch that, not a blog workflow.
5. **Passport Links are the earnings argument.** Geo-routed affiliate links
   with per-channel click reporting, on any affiliate link rather than Amazon
   only.
6. **Contact**: team@mvpaffiliate.io for assets, custom angles, or anything
   else.

---

## History: why this file now points at code instead of quoting numbers

Until this rewrite, the copy above advertised a **Starter plan at $49**, a
**Growth plan at $99**, and **"15 reviews free, no credit card"**. None of
those existed. MVP sells Amazon and Pro, and the free entry is a 30-day
trial built around designs rather than reviews. Every affiliate who read the
Rewardful sign-up page was quoted a plan ladder and a free offer that would
not match what their audience found on the pricing page.

The live `/affiliates` page never had this problem, because it reads
`AFFILIATE_CAMPAIGN`, `TIERS` and `FREE_TRIAL` instead of restating them.
This file now names those same sources at the top so the next price change
has one obvious place to start.
