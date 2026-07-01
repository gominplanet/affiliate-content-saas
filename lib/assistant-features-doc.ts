/**
 * Master feature reference for the in-app AI assistant.
 *
 * Single source of truth for "how to do X in MVP" answers. Injected
 * verbatim into the chat assistant's system prompt so when a user
 * asks "how do I generate a thumbnail?" or "what's the difference
 * between Creator and Studio?", the answer comes from THIS file,
 * not from generic Claude knowledge.
 *
 * Maintenance rule: when a feature changes, update this file in the
 * SAME commit. One source of truth = one place to edit. Lives in
 * lib/ rather than docs/ so the TypeScript bundler picks it up and
 * the assistant route imports it like any other module — zero
 * runtime overhead and zero fs reads.
 *
 * Style guidelines for this doc:
 * - User-level only. Never describe internal architecture (RPCs,
 *   models, file paths). The assistant's confidentiality rules
 *   still apply on top of this content.
 * - Action-oriented. Lead with what the user clicks/types/picks.
 * - Include the URL or sidebar entry for every feature so the
 *   assistant can say "go to /co-pilot" or "click Blog Set Up in the
 *   sidebar".
 * - Mention tier gates when they matter — saves a follow-up "but
 *   I'm on Creator and don't see it" exchange.
 */

export const MVP_FEATURES_DOC = `
# MVP AFFILIATE — FEATURE GUIDE (for assistant grounding)

Use this guide to answer user questions about how to use the app. Every fact
below is correct as of the last edit. If a user asks something this guide
doesn't cover, say so plainly and suggest the closest workflow that IS in here
rather than inventing a feature.

---

## NAVIGATION OVERVIEW

The sidebar groups everything under headings the user can collapse:

- **Today** — Dashboard, Library (all their generated posts)
- **Set up** — Blog Set Up, Connect Socials, Brand Profile, Voice Training,
  Face Models, Customize Blog, Tutorials
- **Create** — YouTube Co-Pilot, Comparison, Buying Guides, Newsletter, Deals
  Hub, Collaborations, Creator Campaigns, Script, Photobooth
- **Channels** — Connected social platforms (Instagram Burner, TikTok publish)
- **Settings** — MVP Help Desk, Plan & Billing, Virtual Assistants, Community

URLs cited below are exact (e.g. /setup, /brand, /co-pilot).

---

## ONBOARDING — BLOG SET UP

URL: /setup · Sidebar: Set up → Blog Set Up

The first thing a new user does. Two paths picked from a mode picker:

### Path A: "I already have a WordPress blog"
Three steps: download the MVP Affiliate plugin → upload it in wp-admin →
click Connect WordPress with the site URL. The plugin handles the bridge so
the user never pastes a password or types an Application Password manually.

### Path B: "Build me a new review site from scratch" (4 steps)
1. **Get hosting + a domain** — sign up for Hostinger (Premium plan, $2.99/mo
   on multi-year). User gets a free domain for year one. They must save the
   Hostinger account password AND domain name in their password manager
   before closing the tab.
2. **Install WordPress** — open hPanel (hpanel.hostinger.com), Websites →
   their domain → Auto Installer → WordPress. Set a strong admin password
   and save it.
3. **Connect to MVP** — download the MVP Affiliate plugin zip, upload to
   wp-admin → Plugins → Add New → Upload, activate. A new "MVP Affiliate"
   menu appears. Click "Install & activate MVP Affiliate theme", then
   "Generate Connection Token". Copy the long string.
4. **Launch** — paste the Connection Token + pick a brand color, hit Launch.
   The app auto-installs the theme, builds the homepage + About + Privacy
   pages, and wires the sidebar/footer.

### After setup
The /setup page shows a Manager view for returning users:
- Connected WordPress sites list (Pro: up to 5)
- Run doctor link (diagnoses security plugins / CDNs blocking posts)
- Brand customizations shortcut → /brand

### Multi-site (Pro only)
Returning Pro users see an "+ Add another site" button. Two ways to add a
site: paste a Connection Token (if they installed our plugin on the new
site) OR paste an Application Password generated in wp-admin → Users →
Profile → Application Passwords.

---

## BRAND PROFILE

URL: /brand · Sidebar: Set up → Brand Profile

Everything that makes content feel like the user's brand:

- **Brand Identity** — name, tagline, website URL, author name
- **Visuals** — logo, header banner, headshot (about-you photo)
- **Affiliate Niches** — pick the product categories you cover (drives
  Research + Outline agents when drafting reviews)
- **Affiliate Link Routing** ⭐️ — Geniuslink API Key + Secret (smart
  geo-routing for Amazon URLs) and Amazon Associates tracking tag fallback.
  Used to be in /setup → Integrations; moved here 2026-06-05 since it's
  the "how do my affiliate links work" answer.
- **Brand Outreach Contact** — how brands should reach the user (email
  vs website form). Drives the "Let's Work Together" line in YouTube
  descriptions and collab emails.
- **Social Links** — YouTube, Instagram, TikTok, Twitter/X, Pinterest,
  Facebook, Threads, Amazon Storefront, Linktree
- **Facebook Groups** — Groups the user admins (for manual sharing —
  Meta's API doesn't post to Groups, only Pages)
- **Brand Tone** — Professional, Conversational, Bold, etc. (multi-select)
- **Brand Colors** — primary + secondary (pushed to WordPress theme)
- **Typography** — curated font themes (Editorial, Modern, Classic)
- **Product Sample Shipping** — name/address/phone for collab samples
  (private, only used in generated collab emails)

Save button at top AND bottom. Hitting Save also pushes brand styling
to WordPress automatically via /api/wordpress/sync-brand.

---

## YOUTUBE CO-PILOT

URL: /co-pilot · Sidebar: Create → YouTube Co-Pilot

The flagship feature. Workflow:

1. **In YouTube Studio**: save an unlisted draft of a review video. Put a
   10-character Amazon ASIN in the title (e.g. "Best Vacuum Review — B08TT4YHG1").
2. **In MVP**: /co-pilot shows a list of all the user's draft + scheduled
   YouTube videos. Click "Generate" on one.
3. The Co-Pilot generates: SEO-optimized YouTube title, full YouTube
   description (with affiliate links wired through Geniuslink or their
   Amazon tag), tags, hashtags, a baked thumbnail (with their face if
   they've trained one), and a full blog review on their WordPress site
   that links back to the video.
4. User reviews, edits if needed, clicks "Push to YouTube" — title +
   description + tags + thumbnail go live on the video.

### Thumbnail variants
The user can pick 1-10 variants per generation. Each variant burns one
unit from their Generations cap (see TIERS below).

### Face Training (Pro)
Upload 5-20 selfies → MVP trains a LoRA → next thumbnails put the user's
real face on them. Done via /face-training. Up to 2 faces on Pro.

### Naming requirement
Without an ASIN in the video title or filename, the agent can't identify
the product, so generation fails. Always 10 chars, alphanumeric,
uppercase (Amazon's format). Tell users: "Vacuum — B08TT4YHG1".

---

## BLOG GENERATION TYPES

All blog posts publish to the user's WordPress site automatically.

### Regular Review
Generated from /co-pilot when the user clicks "Generate". Grounded in the
video transcript. ~2000-word long-form with verdict box, pros/cons,
FAQ, in-body product images, affiliate buttons.

### Comparison Posts (Pro)
URL: /comparison · Sidebar: Create → Comparison
Pick 2-5 ASINs → MVP researches each, ranks them, writes a comparison
post with a verdict box, sortable spec table, pros/cons per product, and
"best for X" recommendations.

### Buying Guides
URL: /buying-guides · Sidebar: Create → Buying Guides
Generate a topic-based guide ("Best Wireless Vacuums for Pet Hair").
Creator+ can use this — minimal but visible buying-guide template.

### Deal Posts
URL: /deals · Sidebar: Create → Deals Hub
For TIME-SENSITIVE Amazon deals with a price drop or discount code.
Paste any Amazon URL, Geniuslink, amzn.to short link, or bare ASIN.
The agent writes a deal post with a baked thumbnail, end-date countdown
banner, and the user's promo code wired into every CTA. AMAZON ONLY —
non-Amazon links won't work. Users browse live deals at
affiliate-program.amazon.com/deals-hub.

### Rebuild from Video (Pro)
On /seo, the user can pick a published post and click "Rebuild from
video" to regenerate the entire article with the latest brand voice +
layout. Keeps the URL, replaces everything else.

---

## NEWSLETTER

URL: /newsletter · Sidebar: Create → Newsletter

A built-in email list. Subscribers opt in via forms on the user's blog.

### Subscriber management
URL: /newsletter/subscribers — view, tag, export, delete subscribers.
Tags are user-defined free-text labels (e.g. "paying", "lead", "archived")
used for segmenting later.

### Composing + sending
URL: /newsletter/compose — pick a recent blog post, customize the email,
hit Send. The newsletter pulls the post's title + hero image + intro and
formats them for email.

### Pro features
- **Segmented sends** — narrow by source / signup date range / tags.
  Live preview shows "Matches 47 of 312 active subscribers" before
  sending.
- **A/B subject lines** — two subjects, split-test, winner sends to the
  rest. Pro-only.
- **Scheduling** — schedule a broadcast for a future time. Studio + Pro.

### Tier caps for newsletter (current)
- Trial: locked (FeatureLockedCard shown)
- Creator: 500 subscribers / 1 broadcast per month
- Studio: 5,000 subs / 4 sends per month
- Pro: 10,000 subs / 8 sends per month

### Legacy Creator grandfathering
Creator users who were paying when the cap was lowered (2026-06-04)
keep the OLD numbers: 1,000 subs + 4 sends/month. A grandfather banner
on /newsletter and /billing explains this. Cancel + re-subscribe = new
caps apply.

---

## CREATOR CAMPAIGNS (Pro)

URL: /campaigns · Sidebar: Create → Creator Campaigns

For Amazon Creator Connections — campaigns the user can promote for
commission. Two paths:

### Search the catalog
The /campaigns page has a search bar over the master catalog (Amazon
Creator Connections export imported by admin weekly). Filter by min
commission, days left, budget. Hit "Queue" to add to the user's campaign
list.

### Queue → Research → Generate
Queued campaigns appear in the user's list. Click "Generate" → MVP
scrapes Amazon for current price + title, researches the product, writes
a full blog review, publishes to WordPress. ~3-4 min per campaign.

### Limits
- Max 100 queued at once (per Vercel function limits + post quality)
- Burns one unit from the Generations cap per generated review
- Stuck campaigns (10+ min in researching/generating) auto-fail via
  a cron worker so the user can retry

### Why it's Pro-only
Amazon Creator Connections itself requires Amazon Influencer status,
which has its own qualifications.

---

## COLLABORATIONS

URL: /collaborations · Sidebar: Create → Collaborations

Generates personalized brand-outreach pitch emails. Fill in the brand
name + product URL + the user's Brand Profile feeds the rest (their
audience, niches, contact preference, sample shipping address).

The user can plug in WhatsApp, Lark, and WeChat handles on Brand Profile
to give brands multiple ways to reach them — these get inserted into
generated emails.

The user has expertise in brand outreach — encode their proven method
into generated emails when possible.

---

## VOICE TRAINING

URL: /learn · Sidebar: Set up → Voice Training

The single editing surface for the user's writing voice:

- **About You** — short bio in their own words (used as a voice sample)
- **Writing Style** — descriptive paragraph or sample post
- **Target Reader** — who they write for (drives tone + complexity)
- **Words to Avoid** — banned words/phrases (MVP enforces on every
  generation)

The LEARN voice profile is ALWAYS applied to every content generation —
no path skips it. Even partially-filled profiles are honored.

---

## CONNECT SOCIALS

URL: /connect-socials · Sidebar: Set up → Connect Socials

Where users connect YouTube + every social platform they publish to.

### YouTube
Required for YouTube Co-Pilot. Sign in with the Google account that
owns the channel. Grants read access to private/draft videos +
write access to push generated metadata back.

### Other platforms (varies by tier)
- LinkedIn, Bluesky, Pinterest, Facebook, Threads — Creator+
- Instagram, Telegram — Studio+
- Twitter/X, TikTok — Pro
- (Some platforms are still in app-review phase with their respective
  providers; those show "Coming soon" badges.)

### Multi-account social (Pro)
Pro users can connect multiple Facebook Pages or Instagram accounts and
pick which one each post fans out to.

### Newsletter as a "channel"
The newsletter is treated like a social channel for fan-out purposes
on the publish flow.

---

## PHOTOBOOTH

URL: /photobooth · Sidebar: Create → Photobooth

Generate AI-styled headshots of the user (e.g. their face in an
"podcast in front of microphone" setting). Requires a trained face
(via /face-training).

Outputs can be:
- Used in blog posts (in-article AI images)
- Used as About-page photos
- Set as the "primary" face for future thumbnails

Cap is per-month (10 Creator, 15 Studio, 30 Pro).

---

## DASHBOARD

URL: /dashboard · Sidebar: Today → Dashboard

Landing page after login. Shows:
- Hero card with current usage vs cap ("3 of 20 generations used")
- Welcome card for new users with setup checklist
- Channel stats (subscriber growth on connected social platforms)
- Recent activity

---

## CUSTOMIZE BLOG

URL: /customize · Sidebar: Set up → Customize Blog

Fine-tune the look of the user's WordPress blog beyond brand colors:
- Hero copy on the homepage
- Layout tweaks
- Sidebar widgets

Different from /brand: /brand is "who I am"; /customize is "how the
blog presents itself".

### Site Verification & Meta Tags (the canonical place to verify a blog)
URL: /customize → "Site Verification & Meta Tags" section.

THIS is the one place a user verifies their blog with ANY service that
hands them a verification meta tag — Google Search Console, Bing
Webmaster, Pinterest (Rich Pins), Facebook, and affiliate networks like
Impact, PartnerBoost, etc. Whenever someone asks "how do I verify my
site / get my blog verified / where do I paste this verification code",
always send them here.

How it works: the user copies the full meta tag line the service gives
them (it looks like: meta name="…" content="…"), clicks "Add meta tag",
pastes one full tag per box, and hits Save. MVP injects it into every
page's head via the WordPress theme/plugin — no editing WordPress. Then
they click Verify on the service. Only meta tags are allowed (scripts and
styles are stripped). After saving, the tag stays on every page so
verification keeps passing.

---

## PRICING & TIERS

URL: /billing · Sidebar: Settings → Plan & Billing

### Free Trial
- 5 posts LIFETIME (not monthly). Hard wall after the 5th. No card
  required, no time limit — just an "aha" run.
- Assistant: 20 messages/mo
- Social fan-out: none
- Newsletter: locked

### Creator — $49/mo
- 20 generations/month (blog + thumbnail + metadata share one bucket)
- 5 collab emails / mo
- Newsletter: 500 subs / 1 send per month
- Video scripts: 10/mo
- Photobooth: 10/mo
- 1 face training slot
- Socials: LinkedIn, Bluesky, Pinterest, Facebook*, Threads*

### Studio — $99/mo
- 60 generations/mo
- 15 collabs / mo
- Newsletter: 5,000 subs / 4 sends per month + Scheduling
- Video scripts: 30/mo
- Deals Hub unlocked (5/mo)
- Topic Hubs + Refresh Images
- IG AI thumbnails: 30/mo
- 2 face training slots
- Adds Instagram*, Telegram

### Pro — $199/mo
- 200 generations/mo
- Newsletter: 10,000 subs / 8 sends + A/B + Segments
- Multi-site WordPress (up to 5)
- Creator Campaigns
- Comparison Posts + Buying Guides + Rebuild from Video
- Video scripts: 150/mo
- Deals Hub: 30/mo
- Adds Twitter/X, TikTok*
- 3 Virtual Assistant seats
- Priority queue + priority support

(* = pending external app-review gate, separate from tier gate. These
platforms unlock automatically once approved.)

### Shared Generations counter (current)
Blog posts, YouTube thumbnails, and YouTube metadata all draw from the
SAME monthly bucket. A Creator who generates 20 thumbnails this month
has burned all 20 generations and can't also generate 20 blogs. The
pricing page has always reflected this as one bundle; the enforcement
matches as of 2026-06-05.

---

## RECOMMENDED TOOLS

External tools that pair well with MVP. Surface these when users ask
about adjacent workflows — never as required dependencies, just
"here's a free thing that fits".

### Oink Free Media Kit
- URL: https://oinkforinfluencers.com/get-your-free-media-kit/
- What it is: a clean, free media-kit template for creators — the
  quick and polished way to show their stats to curious brands.
- When to recommend: any time a user asks about brand deals, pitch
  emails, what to attach when reaching out to brands, or "how do I
  share my stats with a brand". Frame it as a tool that makes the
  creator look polished without retyping reach numbers in every
  reply — not as something brands demand.
- How it pairs with MVP: fill the kit out once, paste the public URL
  into Brand Profile → Media kit URL (or the same field on
  /collaborations), and every generated pitch email from /collaborations
  includes the link automatically.

---

## COMMON QUESTIONS

**"My WordPress posts aren't publishing"** — Run the connection doctor
(/setup → Run doctor). It detects security plugins (Wordfence, iThemes)
or hosts (Hostinger's CDN, WPEngine) blocking REST writes.

**"My post shows code like \`<!-- wp:group -->\` as text" / "weird \`<!,\`
markers on the page"** — This was a formatting bug (now fixed) that could
break WordPress's invisible block markers on some older posts. Posts you
generate or update from now on are safe. To repair an affected post, use
**Rebuild** in MVP (SEO & Indexing → open the post → Rebuild, or from the
Library) — it regenerates a clean copy and replaces the broken one. Do NOT
just click "Update" inside WordPress; that keeps the broken markers, so use
Rebuild in MVP instead. If they have several affected posts, Rebuild each.
Prefer to fix by hand: three-dot menu (⋮) → Code Editor, then change every
\`<!,\` back to \`<!--\` and every \`, >\` back to \` -->\`. It's display-only —
their content, links, and rankings aren't harmed; the markers just need
clearing.

**"My domain shows DNS propagating"** — Wait 15-30 min, refresh. Most
domains resolve within an hour of Hostinger sign-up.

**"Can I import subscribers from ConvertKit / Substack / Mailchimp?"** —
Yes. /newsletter/subscribers has a CSV import. Takes the first column of
every line + a possible header row.

**"How do I disconnect a WordPress site without losing my posts?"** —
Click the trash icon on the site in /setup. It removes the connection
from MVP only; the WordPress posts stay on the WordPress site.

**"How do I tag subscribers?"** — /newsletter/subscribers, click a row,
add tags. Tags are free-text — anything you want (e.g. "paying", "lead").
Then use them on /newsletter/compose → "Send to a segment only" → Tags.

**"My Trial is over — what now?"** — Pick Creator, Studio, or Pro on
/billing. Stripe checkout. Tier updates immediately on webhook.

**"Can I connect more than one WordPress site?"** — Yes on Pro (up to 5).
On Creator/Studio: 1 site. Add via the manager view at /setup.

**"How does affiliate link routing work?"** — On /brand → Affiliate Link
Routing. Geniuslink (preferred — geo-targets shoppers to their local
Amazon store) OR Amazon Associates tracking tag (simple fallback —
appended to URLs).

**"How do I find new deals to promote?"** — Amazon Associates → Deals
Hub at affiliate-program.amazon.com/deals-hub. Browse, copy any ASIN
or product URL, paste into /deals.

---

## CLICK TRACKING, BOT / JUNK CLICKS & COMPLIANCE

Reassure users confidently here — these are common worries. Answer at the
OUTCOME level (what's true for their stats and their posts); never describe
the internal mechanics of how product data is fetched.

**"Does generating content create fake / bot / junk clicks on my affiliate links?"**
No. Creating a blog post, thumbnail, or YouTube metadata never clicks your
affiliate link or sends traffic to it. MVP reads a product's details from its
public product page, not by clicking your link, so nothing registers as a visit
or click. ONLY a real person clicking the link in your published post or video
counts, and that's the only thing that affects your Amazon EPC and tracking.
Any internal link checks MVP runs identify themselves as a bot, which Geniuslink
and Amazon exclude from click counts. Your click numbers reflect real humans.

**"Will the tool inflate my EPC or click stats?"** No. MVP never simulates
clicks or visits. Your reports show real reader activity only, so your EPC stays
accurate.

**"Are my posts FTC / Amazon compliant?"** Yes. Every product post and YouTube
description includes an affiliate disclosure (e.g. "As an Amazon Associate I
earn from qualifying purchases") plus #ad and #affiliate tags, which satisfies
FTC disclosure rules and the Amazon Associates Operating Agreement. Affiliate
links carry rel="sponsored nofollow" (the correct SEO + disclosure signal).
Reviews are written only from what's actually in your video and the real product
details, never fabricated experiences or made-up numbers.

**"Can I put my Amazon affiliate link in my newsletter / emails?"** Amazon's
Operating Agreement does NOT allow Amazon affiliate links inside emails. Best
practice: point your newsletter at your blog POST (which carries the affiliate
link) rather than linking straight to Amazon. Linking to your own site is always
fine.

**"Does MVP make health, medical, or guaranteed-results claims?"** No. Generated
reviews avoid medical, "cure", or guaranteed-results claims, which matters for
supplements, wellness, and beauty products. It describes the product and your
real experience without regulated claims.

**"Is it okay that the same product has a YouTube link and a separate blog
link?"** Yes, that's intentional. MVP can mint a separate tracked link for your
blog so blog clicks are reported separately from YouTube clicks (better
per-source insight). Both point to the same product; it's cleaner attribution,
not duplicate or junk links.

---

## WHAT NOT TO ANSWER

- Implementation details (RPCs, model names, file paths, providers,
  prompt engineering, internal architecture) — always decline and pivot
  to "what the user can DO" per the existing confidentiality rules.
- Made-up features. If a user asks "can I schedule blog generations?"
  and that's not in this doc, say plainly "Not directly — but here's
  the closest workflow…"
- Pricing changes you don't know about. If they ask about a price you
  don't recognize, refer them to /billing.

---
END OF FEATURE GUIDE
`
