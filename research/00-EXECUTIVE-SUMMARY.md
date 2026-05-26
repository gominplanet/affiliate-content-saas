# MVP Affiliate — Overnight Research: Executive Summary & Action Plan

**Date:** 2026-05-25 (overnight) · **Author:** Claude (autonomous research)
**Goal:** Make MVP a high-quality partner for affiliates & content creators — across thumbnails, search discoverability, site speed, and competitive standing.

This is the synthesis. Four deep reports back it:
- `01-competitive-landscape.md` — who we're up against, what they cost, what they run, where we win/lose
- `02-thumbnail-quality.md` — why our thumbnails trail vidIQ + the creator's own, with file-level fixes
- `03-seo-discoverability.md` — 2026 search/AEO/GEO audit of our SEO engine
- `04-performance.md` — Next.js/Supabase/Vercel + WordPress speed audit

---

## 1. The one strategic read

**MVP already owns a position no competitor holds: the only *experience-grounded fan-out engine*.** Every output is built from the creator's real video — real transcript (claims) + real frames (visuals) — and fanned out to blog + YouTube metadata + thumbnail + social. The **March 2026 Google core update made first-hand "Experience" the dominant ranking signal**, and AI answer engines disproportionately cite video/multimodal sources. Every content competitor (Koala, Byword, Cuppa, Surfer) is keyword/SERP-spun — structurally on the *wrong* side of this shift. vidIQ matches our thumbnail *engine* but grounds in a single frame and does no blog/affiliate fan-out.

**So the moat is real — but three things blunt it right now:**
1. **The moat isn't fully *surfacing*** — SEO gaps (useless image alt, thin author/entity schema, random internal links, no freshness loop) mean Google/AI can't fully "see" the experience advantage. *This is the highest-ROI area: it converts an advantage we already have into rankings.*
2. **Thumbnail polish trails the bar** — text-on-face collisions, captured-frame artifacts (the blue endscreen box), soft screengrabs. Fixable with small, targeted changes; the *engine* is already at parity with vidIQ.
3. **The app carries speed/correctness debt** — ~19/22 dashboard pages are client components with auth→fetch waterfalls; `ignoreBuildErrors` masks bugs. Slows the product and hides regressions.

**The throughline of the plan: ship the cheap things that let the moat surface, match table-stakes polish, and pay down the debt that slows everything.** Most of the highest-impact items are quick wins that compound.

---

## 2. Single highest-leverage move per area

| Area | The one move | Why |
|---|---|---|
| **SEO** | Ship the schema/answer-first enrichments **+ fix image alt text + topical internal linking** | Turns the experience moat into actual rankings + AI citations. We're already 80% there; the gaps are cheap. |
| **Thumbnails** | **Endscreen-safe HD capture + smart text-zone placement** (Haiku vision returns a safe text box + subject side) | Kills the two visible bugs (blue box, text-on-face) and closes the quality gap to the creator's own thumbnails. |
| **Performance** | **`optimizePackageImports` + `loading.tsx` + move read pages to Server Components** | Removes the biggest structural drag (client-everything + auth waterfalls); first two are near-zero-risk. |
| **Competitive** | **Surface the moat in product + marketing** — "fact-grounded, no fabrication" line, multi-variant A/B "Test & Compare kit", saved styles | We win on substance; we under-sell it and miss a few table-stakes features. |

---

## 3. Unified prioritized roadmap (cross-cutting)

### 🟢 P0 — Quick wins (hours–days, low risk, high impact) — *ship first*
| # | Action | Area | Files |
|---|---|---|---|
| 1 | **Endscreen fix**: clamp seek to `duration − 25s`; fractions → `[0.2,0.35,0.5,0.65]` | Thumb | `extension/background.js`, `lib/extension-frame.ts` |
| 2 | **Force/verify HD capture** (`&vq=hd1080`, wait `videoWidth≥1280`, reject sub-720p, 3% edge-crop) | Thumb | `extension/background.js` |
| 3 | **Add UI/endscreen removal** to the Nano Banana prompt | Thumb | `route.ts` `styleClause` |
| 4 | **Fix image alt text** (descriptive + keyword-bearing; set featured-media alt) | SEO | `blog/generate/route.ts`, `services/claude/index.ts` |
| 5 | **Enrich `Person`/`Organization`/`BlogPosting` schema** (jobTitle, description, image, knowsAbout, sameAs, wordCount, articleSection, inLanguage) | SEO | `lib/seo-schema.ts` |
| 6 | **Re-justify FAQ as AEO** (Google FAQ rich results die May 7 2026 — keep markup, update rationale) | SEO | `lib/seo-schema.ts` comments |
| 7 | **OG/article tags + verify canonical** (og:site_name, article:published/modified_time) | SEO | WP plugin head |
| 8 | **`optimizePackageImports: ['lucide-react']`** | Perf | `next.config.ts` |
| 9 | **Add `loading.tsx`** to heavy dashboard routes | Perf | `(dashboard)/*/loading.tsx` |
| 10 | **`next/image` + whitelist fal/replicate hosts** for dashboard images | Perf | `next.config.ts`, dashboard pages |
| 11 | **Longer `proxy-image` cache** (1yr immutable), off the display path | Perf | `api/proxy-image/route.ts` |
| 12 | **Verify AI-crawler + sitemap access** at onboarding (GPTBot/ClaudeBot/PerplexityBot/Google-Extended/Bingbot; `wp-sitemap.xml`) | SEO | WP service/onboarding |

### 🟡 P1 — Close the gap (days–weeks)
| # | Action | Area |
|---|---|---|
| 13 | **Smart text-zone** (`lib/thumbnail-textzone.ts`: Haiku returns `{textZone, subjectSide, faceBox}`; MediaPipe fallback) → wire into `drawHeadline` + baked prompt | Thumb |
| 14 | **Upgrade to Nano Banana Pro** (`fal-ai/gemini-3-pro-image-preview/edit`, 2K, reliable baked text) | Thumb |
| 15 | **Topical internal linking** at generation (same-category posts, 2–3 contextual links) — replace random "related" | SEO |
| 16 | **Author authority page** (bio + headshot + sameAs, linked from byline) | SEO |
| 17 | **Convert read pages → Server Components** (analytics, billing, collaborations, content read views); collapse auth waterfall | Perf |
| 18 | **`next/dynamic` heavy modals/canvas** (currently zero usage) | Perf |
| 19 | **Index + RLS audit** (user_id-leading composite indexes; `(select auth.uid())` in policies) | Perf |
| 20 | **Multi-variant default (2–3) + "Test & Compare kit"** (top variants + upload instructions; no public A/B API) | Thumb / Competitive |
| 21 | **Pinterest channel + video→blog backlink** (2:3 Pin from hero+verdict; insert blog URL into YT description) | SEO / Competitive |

### 🔵 P2 — Strategic / compounding (weeks)
| # | Action | Area |
|---|---|---|
| 22 | **Freshness / re-optimise loop** (periodic `dateModified` refresh — exploits the 30-day citation-recency bias; DB already stores `seo_keyword`/`meta_description` for it) | SEO |
| 23 | **AEO answer-first lead lines** (one "quick answer" sentence per H2 without banned filler) | SEO |
| 24 | **Saved styles / brand profile + identity consistency** (Nano Banana reference-image persistence) | Thumb / Competitive |
| 25 | **Multi-product / comparison support** (N products, N Geniuslink, comparison schema) — neutralizes Koala roundups with *real* comparison | Competitive |
| 26 | **AuraSR upscale pass** for soft Kontext/Flux/low-res outputs | Thumb |
| 27 | **Free top-of-funnel hook** (score-your-thumbnail / paste-video→free SEO preview) | Competitive |
| 28 | **Fix Supabase types → drop `ignoreBuildErrors`** (re-enable compile-time bug detection) | Perf |
| 29 | **PPR on marketing pages** + `unstable_cache` for shared reads | Perf |
| 30 | **Make "fact-grounded, no fabrication" a front-and-center claim** (the deferred trust line) | Competitive |

### Reader-side WordPress (affects rankings + conversions)
- LiteSpeed **Guest Mode + Guest Optimization** + QUIC.cloud CDN; **WebP**; **exclude LCP hero from lazy-load**; "add missing width/height" (CLS). Request the right `mvp-card` image size, not full-res.

---

## 4. If we only do five things this week
1. **Thumbnail P0 (#1–3)** — endscreen + HD + UI-strip. Kills the visible quality bugs you flagged tonight.
2. **Smart text-zone (#13)** — the single biggest leap toward the creator's-own-thumbnail bar.
3. **SEO alt text + schema enrichment + internal linking (#4, #5, #15)** — surfaces the moat.
4. **`optimizePackageImports` + `loading.tsx` + dashboard `next/image` (#8–10)** — instant felt speed, near-zero risk.
5. **Surface the differentiator (#20, #30)** — "Test & Compare kit" + the no-fabrication trust line.

---

## 5. Competitive scorecard (where we stand)
- **We win:** experience-grounding (the moat), no-fabrication trust, full video→blog→YT→social fan-out, multi-frame real-product thumbnails (more rigorous than vidIQ's single frame), affiliate-native (Geniuslink + click loop), closed measurement loop on the creator's own data.
- **We're behind:** SEO surfacing (the gating gap), live A/B testing, saved styles/identity consistency, multi-product comparisons, viral-pattern CTR data narrative, a free acquisition hook, raw speed/UX polish.
- **Pricing landscape:** suites $9–39 (vidIQ/TubeBuddy), thumbnail tools $20–69, content tools $9–99. Our wedge is "one tool that replaces 3–4" + the only one Google's 2026 update structurally favors.

---

## 6. How this makes MVP a high-quality partner for *all* affiliates/creators
- **It ranks** (SEO moat surfaces) → creators get traffic, not just content.
- **It looks pro** (thumbnails match their own bar) → they're proud to publish it.
- **It's fast and trustworthy** (speed + no-fabrication) → daily-driver, not a gamble.
- **It's the whole loop** (video → everything, measured by their own data) → replaces a stack of tools.

The work is mostly *finishing* and *surfacing* an advantage we already have — not inventing a new one.

---

## 7. Status & next step
All four detail reports are written in `research/`. **None of these recommendations have been implemented yet** — this is the researched plan you asked for. I deliberately did **not** push code overnight (untested prod changes are exactly what's burned us this week). On your go-ahead I can execute the P0 quick wins fast — they're low-risk, typecheck-able, and several are one-line config changes. Say the word and I'll start at the top of the P0 list.
