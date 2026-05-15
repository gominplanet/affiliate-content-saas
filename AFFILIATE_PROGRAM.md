# Affiliate program copy — Rewardful

Canonical copy for the "Friends of MVP Affiliate" program. Paste these
verbatim into the Rewardful dashboard fields. Keep this file as the
source of truth — if you update Rewardful, update here too.

Program URL: https://rewardful.com (your Rewardful dashboard)

---

## Welcome text (shown to potential affiliates during sign-up)

```
Promote MVP Affiliate — the platform that turns one unlisted YouTube
draft into a full SEO-optimized review site, an optimized YouTube
package (description, tags, hashtags, thumbnail), and auto-posts across
Facebook, Threads, LinkedIn, Pinterest, X, Bluesky and Telegram.

Your audience gets 15 reviews free — no credit card. You earn
commission on every paying customer you refer — and you keep earning it
for as long as they stay subscribed. Real recurring income, not a
one-time bounty.

Best fit: YouTube reviewers, affiliate-marketing creators, SaaS
curators, and anyone with an audience of solo creators or affiliate
publishers.
```

---

## Affiliate dashboard text (shown to affiliates after they log in)

```
Welcome to the Friends of MVP Affiliate program.

Your job: send creators to mvpaffiliate.io. They get 15 reviews free to
test the full workflow. You earn commission the moment they upgrade to
a paid plan — Starter ($49/mo), Growth ($99/mo), or Pro ($199/mo) — and
you keep earning every month they stay subscribed. For life. Not a
one-time bounty.

That's the part most programs don't offer. Refer 20 creators who stick
around, and you've built yourself a real monthly income stream.

Best-converting pitch angles:
• "Stop writing YouTube descriptions and blog posts manually — turn one
  draft into both, in two clicks."
• "An entire affiliate engine out of one YouTube upload."
• "Pro plan one-click YouTube Studio batch settings — playlist,
  schedule, paid-promotion disclosure, made-for-kids — plus Telegram
  channel auto-post, all from MVP."

Need logos, screenshots, demo videos, or want to discuss a custom angle
for your audience? Email team@mvpaffiliate.io and we'll set you up fast.
```

---

## Code integration (Step 1 + Step 2 from Rewardful's Next.js docs)

Both steps are wired:

1. **Tracking script** — loaded in [app/layout.tsx](app/layout.tsx) inside
   `<body>`, behind a check for `NEXT_PUBLIC_REWARDFUL_KEY`. The script
   only renders when that env var is set, so dev/local stays clean
   unless you opt in.
2. **Referral capture + Stripe attribution** — [app/pricing/page.tsx](app/pricing/page.tsx)
   listens for the `rewardful('ready')` event, stores `Rewardful.referral`,
   and POSTs it alongside `tier` to `/api/stripe/checkout`. The checkout
   route forwards the referral as `client_reference_id` on the Stripe
   Checkout Session — Rewardful's webhook reads that field to attribute
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

You can find the key in the Rewardful dashboard — it's the
`data-rewardful` value Rewardful shows in the Next.js integration docs
(a 6-character lowercase alphanumeric string).

### Smoke test

1. Get any affiliate's referral link from Rewardful (or use your own):
   `https://mvpaffiliate.io/?via=<affiliate-id>`
2. Open it in incognito → land on the site → navigate to pricing →
   upgrade with a test card.
3. In Rewardful → Conversions tab, the test transaction should appear
   attributed to that affiliate.

---

## Key talking points to keep consistent across the program

1. **Lifetime recurring commission** — paid for as long as the referred
   customer stays subscribed. Not a one-time bounty. This is the
   biggest differentiator vs. most SaaS affiliate programs.
2. **Free entry for the referred customer** — 15 reviews free, no card.
   Low-friction CTA for the affiliate to push.
3. **YouTube-first positioning** — one draft → full review site + YT
   package + 6-platform social fan-out. Two clicks, ~2 hours saved per
   video.
4. **Pro is the headline** — one-click Apply to YouTube with full
   Studio batch settings is the feature no competitor has.
5. **Contact**: team@mvpaffiliate.io for assets, custom angles, or
   anything else.
