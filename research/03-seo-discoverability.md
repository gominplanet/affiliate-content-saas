# Research 03 — Search + AI-Answer-Engine Discoverability (2026)

**Scope:** Audit MVP Affiliate's existing SEO engine against 2026 search + AEO/GEO reality, and produce a prioritized, file-specific action plan.
**Date:** 2026-05-25
**Files audited:** `lib/seo-schema.ts`, `app/api/blog/generate/route.ts`, `services/claude/index.ts`, `wp-plugin/mvpaffiliate-platform/mvpaffiliate-platform.php`, `wp-plugin/mvp-affiliate-theme/single.php`.

---

## 0. TL;DR — what MVP already does well, and the one thing that just broke

MVP's SEO engine is genuinely strong for 2026. It ships a single, cross-referenced JSON-LD `@graph` (no competing top-level blocks), it has a correct self-serving-review guardrail, it builds a real `VideoObject` from the embedded review, it derives a transcript-grounded focus keyword + click-optimised meta description, and — most important of all — **every post is grounded in a first-hand video where the creator is on camera.** That is the single biggest structural advantage you can have under the March 2026 core update, which elevated *Experience* (the first "E" of E-E-A-T) above link equity and topical coverage ([digitalapplied](https://www.digitalapplied.com/blog/e-e-a-t-march-2026-google-rewards-experience-content-guide), [evertune](https://www.evertune.ai/resources/insights-on-ai/googles-march-2026-core-update-a-content-best-practices-guide-for-seo-and-ai-search)).

**The one urgent thing:** Google is fully killing **FAQ rich results**. As of **May 7, 2026** FAQ rich snippets no longer appear in Search; the report/Rich-Results-Test support is dropped in **June 2026**; Search Console API support ends **August 2026** ([Search Engine Land](https://searchengineland.com/google-to-no-longer-support-faq-rich-results-476957)). MVP currently invests heavily in `FAQPage` schema and an on-page FAQ specifically for that snippet. **Do not delete the FAQ** — pivot its justification. FAQ content remains one of the highest-leverage *AEO* assets (answer-first Q&A chunks are exactly what ChatGPT/Perplexity/AI Mode retrieve), and Google explicitly notes other engines/AI may still parse the markup. The code comment in `seo-schema.ts` calling FAQPage a "high-leverage AEO win" should be the new rationale; the *Google-rich-result* rationale is now obsolete.

---

## 1. Google 2026: AI Overviews / AI Mode + the March 2026 "Experience" core update

### What changed
The March 2026 core update (rollout Mar 27 → Apr 8) **rebalanced E-E-A-T so that first-hand Experience now outranks comprehensive-but-impersonal pages** ([clickrank](https://www.clickrank.ai/google-march-2026-core-update/), [digitalapplied](https://www.digitalapplied.com/blog/e-e-a-t-march-2026-google-rewards-experience-content-guide)). Reported signals:
- Sites publishing **original data / first-hand testing** saw ~22% average visibility gains (analysis of 600k+ pages).
- **73% of top-ranking pages in competitive verticals now show verifiable author credentials.** Adding structured author pages with credentials + consistent bylines produced ranking lifts within weeks.
- ~**76% of pages most frequently cited by ChatGPT had been substantively updated in the prior 30 days** — freshness is a confidence proxy ([ailabsaudit](https://ailabsaudit.com/blog/en/aeo-checklist-2026-actions)).
- Google's own new AI-search guidance says AEO/GEO is **"still SEO"** — same fundamentals, applied to answer surfaces ([Search Engine Journal](https://www.searchenginejournal.com/googles-new-ai-search-guide-calls-aeo-and-geo-still-seo/575026/)).

### Why MVP is structurally advantaged
MVP is video-grounded: the creator filmed themselves using the product, the transcript is the ground truth, and the prompt forces first-person, transcript-only claims with a fact-check pass that strips invented specs/prices. That is *exactly* the "original outcomes, specific details, verifiable first-hand experience" Google now rewards — and most affiliate competitors are AI-spun, experience-free content farms that this update punishes.

### Gaps blocking MVP from cashing in the advantage
1. **The embedded video is the proof, but the schema under-sells the experience.** `BlogPosting` references the `VideoObject` (good), but there's no signal tying the *author* to having performed the test. **Add `Person` as the video's `author`/`actor`, and consider `BlogPosting` → `about`/`mentions` the Product.** Also the article has no explicit experience markers in markup.
2. **No author authority surface.** The `Person` node (`seo-schema.ts` L186-190) carries only `name`, `url`, optional `sameAs` (YouTube). There is **no author archive page, no `description`/`jobTitle`/`knowsAbout`, no headshot `ImageObject`.** With 73% of winners now showing credentials, this is the cheapest available lift. The theme footer already collects `authorBio`/`headshotUrl` — surface it as a real, indexable author page and enrich the `Person` node.
3. **Freshness is set-and-forget.** `dateModified` is written once at publish (`route.ts` L804). Posts never get re-stamped. A periodic "refresh + re-publish `dateModified`" loop would directly exploit the 30-day-recency citation bias. The DB already stores `seo_keyword`/`meta_description` "for the re-optimise loop" (L757-768) but nothing consumes it yet.
4. **`headline` is truncated to 110 chars (`seo-schema.ts` L223) but the on-page `<title>`/H1 isn't keyword-led from `seoKeyword`.** The meta description leads with the keyword; the title tag does not provably do so.

---

## 2. AEO / GEO — getting cited by ChatGPT, Perplexity, Gemini, Google AI Mode

### How retrieval actually picks content (2026)
Answer engines run **RAG with query fan-out**: the model decomposes a query into sub-questions, retrieves **passages (50–100 words), not pages**, ranks them by **vector similarity to the sub-question**, and stitches an answer, citing the most specific/attributable extracts ([upGrowth](https://upgrowth.in/citation-algorithm-chatgpt-perplexity-gemini-ai-overviews-2026/), [Animalz](https://www.animalz.co/blog/ai-aeo-answer-engine-citation)). Practical implications:
- **Each section must lead with a direct, self-contained answer** in the first 1–2 sentences; the engine extracts the opener to decide relevance.
- **Quotable statistics, named entities, and attributed quotes raise citation odds** — quotation marks + attribution act as a credibility proxy; numbers signal factual density.
- **Entity clarity matters** — clean Product/Brand/Person entities with `sameAs` help knowledge-graph grounding.
- Citation overlap across engines is tiny (an analysis of 6.8M citations found **only 11% of domains are cited by both ChatGPT and Perplexity**) — breadth of well-structured content wins.
- **`llms.txt` has essentially no measured impact today** (Limey/OtterlyAI/SE Ranking studies) — low priority, ship it only as a cheap hedge.
- **Crawler access is the gate:** GPTBot, ClaudeBot, PerplexityBot, Google-Extended, Applebot-Extended, Bingbot must not be blocked.

### Audit vs MVP
- **Answer-first chunks — PARTIAL.** The post template (`services/claude/index.ts`) is strong narrative/first-person, but its body sections deliberately *avoid* the "lead with a summary sentence" pattern (it bans "every section ending with a neat summary"). That's great for human voice and Google-experience signals but **the opposite of what RAG wants.** The **FAQ section is the AEO workhorse** — keep and expand it. Consider also adding one machine-friendly answer-first lead line per H2/H3 (a "Quick answer:" sentence) that doesn't read as AI filler.
- **Quotable stats — WEAK by design.** Rule 9/10 ban invented specs and *all* prices, which is correct for trust but means posts rarely contain hard numbers AI loves to quote. The mitigation: **surface the real numbers the transcript/product research DO provide** (the prompt already says to quote real measurements when given) and lean on the `VideoObject` + verdict rating as the quotable, attributable artifact.
- **Entity clarity — GOOD, with gaps.** `Product` has `name`/`image`/`brand`; `Person` has `sameAs`. **Missing:** `Product.sku`/`gtin`/`mpn` or an `Organization.sameAs` for the publisher, and the `Person` lacks `knowsAbout`. Add what's cheaply available.
- **Crawler access — UNVERIFIED / RISK.** Nothing in MVP manages `robots.txt`. On Hostinger/Kadence the user's `robots.txt` is whatever WP/host ships, and AI-bot blocking is increasingly a host default. **MVP should verify (and ideally write) a creator's `robots.txt` to explicitly allow the six AI crawlers** — this is invisible-but-fatal if wrong.
- **`llms.txt` — ABSENT.** Low priority; ship a static one per connected site as a hedge.

---

## 3. Structured-data completeness audit (`lib/seo-schema.ts`)

| Node | Status | Finding |
|---|---|---|
| `@graph` single block | ✅ Correct | One graph, cross-referenced by `@id`. Best practice. |
| `BlogPosting` | ✅ Good | Has headline/description/dates/author/publisher/mainEntityOfPage/image/video. **Add `wordCount`, `articleSection` (category), and `inLanguage`.** |
| `Review` → `Product` | ✅ Correct guardrail | Self-serving guardrail (`thirdPartyProduct`) is right — Google suppresses self-reviews, and that policy was reinforced post-2019 ([Search Engine Land timeline](https://searchengineland.com/google-to-no-longer-support-faq-rich-results-476957) context). Review reached via `product.review` correctly omits `itemReviewed`. ✔ |
| `Product` | ⚠️ Thin | Has `name`/`image`/`brand`. **No `offers`, `sku`, `gtin`, `aggregateRating`, or `review.reviewBody`.** Note: a single first-party `review` (not `aggregateRating`) is the correct choice — good. Adding a short `reviewBody` (the Quick Verdict text) would strengthen it. **Do NOT add fake `offers`/price** (prices are deliberately omitted; a stale `price` in schema is a spam-policy risk). |
| `VideoObject` | ✅ Strong | name/description/uploadDate/thumbnail/contentUrl/embedUrl/duration. **Big AEO+video-result win.** Consider adding `hasPart` Clip/`Person` as `actor` to claim Key Moments + tie experience to the author. |
| `FAQPage` | 🔴 Re-justify | **Google FAQ rich results dead May 7 2026.** Keep the markup for AEO/Bing, **update the code comments** (L84, L272) so the rationale is AEO, not Google snippets. Don't expect SERP FAQ accordions anymore. |
| `BreadcrumbList` | ✅ Good | Home → Category → Post. Still a supported rich result. ✔ |
| `Person` (author) | ⚠️ Weak | Only name/url/sameAs. **Add `jobTitle`, `description`, `image`, `knowsAbout`** to feed the 2026 author-authority signal. |
| `Organization` (publisher) | ⚠️ Thin | name/url/logo. **Add `sameAs` (the brand's socials — already collected in the plugin profile).** |

**Rendering audit (`mvpaffiliate-platform.php` L439-471):** Clean. JSON-LD is decoded + re-encoded with `JSON_HEX_TAG | JSON_HEX_AMP` (safe against `</script>` breakout), printed only on single posts, with og:title/type/url/image + twitter card. Meta is registered for REST so the app can write it. **One gap: no `<link rel="canonical">` is emitted by the plugin** — it relies on WP core/Kadence to do it (it does, by default), but since the plugin overrides `<head>` SEO it should *verify* a canonical exists (especially given the known non-www canonical infra note in memory). **Also missing: `article:published_time` / `article:modified_time` OG tags and `og:site_name`.**

---

## 4. Technical SEO

- **XML sitemaps — DELEGATED.** MVP's Next app has no sitemap route (correct — the blog lives on the creator's WordPress). WP core auto-generates `wp-sitemap.xml`. **Action: verify it's not suppressed and submit it to Search Console during onboarding.** A video sitemap would help video results but WP doesn't emit one for embedded YouTube — low priority since `VideoObject` covers it.
- **Internal linking — PARTIAL.** The theme `single.php` (L72-93) renders a related-posts section, and the plugin has a random "You Might Also Like" (L174-201). But **related = random `orderby rand` / generic query, not topical.** 2026 guidance is **topic clusters with deliberate internal links** ([evertune](https://www.evertune.ai/resources/insights-on-ai/googles-march-2026-core-update-a-content-best-practices-guide-for-seo-and-ai-search)). **High-value action:** at generation time, query the user's existing posts in the same category and inject 2–3 contextual in-body links to them (and link new posts back). MVP already pulls the user's prior posts for voice anchoring (`route.ts` L475-493) — the same data can drive real internal links. This builds per-creator topical authority over time.
- **Canonical / duplication — LOW RISK but verify.** Single source (WP permalink). Memory note flags non-www canonical + per-provider redirect inconsistency — make sure the JSON-LD `pageUrl`/`mainEntityOfPage` and the WP canonical agree on www vs non-www, or you self-conflict.
- **Image alt / SEO — 🔴 WEAK.** This is a real miss. In-body images get alt text `"${generated.title} — ${i+1}"` (`route.ts` L873, L1008, L1026) — i.e. *"Kieba Neck Massager — 2"*. That's near-useless for image search and accessibility. The featured-image upload sets **no alt at all** (L673-681). The CTA card thumbnail has `alt=""` (prompt L406, L446). **Action: generate descriptive, keyword-bearing alt text per image** (the body-image prompt step already knows the scene + section heading — reuse it for alt). Set alt on featured media.
- **Core Web Vitals — MOSTLY GOOD, one risk.** CWV remains a confirmed ranking factor / tiebreaker; **INP < 200ms, LCP < 2.5s, CLS < 0.1, mobile-first** ([corewebvitals.io](https://www.corewebvitals.io/core-web-vitals), [ideafueled](https://ideafueled.com/blog/core-web-vitals-2026-explained/)). MVP's posts: YouTube iframe is `loading="lazy"` ✔, body images `loading="lazy"` ✔. **Risks:** (a) the hero/featured image and the **YouTube iframe can become the LCP element and hurt LCP** — consider a lightweight click-to-load facade for the embed; (b) the logo banner injected via JS at `body` open (plugin L240-261) can cause **CLS** — it inserts a DOM node after paint. Prefer the server-rendered banner path and reserve its height. (c) AuraSR hero upscale is good for quality but ensure the served hero is appropriately sized/`width`/`height` attributed to avoid CLS.
- **Mobile-first** — template is responsive (media queries in the prompt CSS) ✔.

---

## 5. Distribution beyond Google

- **YouTube ↔ blog loop — STRONG, under-exploited.** The blog embeds the source video (drives watch time + a backlink-like signal) and YouTube metadata is separately optimised. **The missing half of the loop: push viewers from the video TO the blog.** Action: have MVP auto-insert the published blog URL into the YouTube description (it already writes the description for Geniuslink). A blog post that ranks + a video that ranks for the same query is the affiliate double-dip, and embedding the video on a text page that earns dwell time is a known YouTube-SEO booster ([Marketer Milk](https://www.marketermilk.com/blog/seo-trends-2026)).
- **Pinterest — HIGH ROI, currently absent.** Pinterest is a top-2 affiliate traffic source and **video pins get ~3x the CTR of static pins**; Rich Pins auto-sync metadata ([Shopify](https://www.shopify.com/blog/pinterest-affiliate-marketing), [tagembed](https://tagembed.com/blog/affiliate-marketing-on-pinterest/)). MVP already generates a hero image + has Pinterest in the social bar. **Action: auto-generate a vertical (2:3) Pin image from the hero + verdict, and enable Rich Pins via the OG tags the plugin already emits.** This is a new traffic channel for near-zero marginal cost.
- **Multi-channel is the 2026 norm** — affiliates blend SEO, Pinterest, YouTube, Reddit, email ([Affiverse](https://www.affiversemedia.com/content-hub/top-10-seo-predictions-for-2026-what-affiliate-marketers-need-to-know/)). MVP's strength is it produces the canonical asset (the post) that all channels point back to.

---

## Prioritized action plan

### Quick wins (days, high ROI)
1. **Re-justify FAQ, don't remove it.** Update comments in `lib/seo-schema.ts` (L84, L272) and any docs: FAQPage is now an **AEO/Bing** asset, not a Google rich-result. Keep the on-page FAQ. *(File: `lib/seo-schema.ts`.)*
2. **Fix image alt text.** Generate descriptive, keyword-bearing alt for every body image (reuse the scene/heading context already computed in `generateBodyImagePrompts`), set alt on the featured media upload, and give the CTA thumbnail a real alt. *(Files: `app/api/blog/generate/route.ts` L673-681, L873, L1008, L1026; prompt thumb alt in `services/claude/index.ts` L406, L446.)*
3. **Enrich the `Person` + `Organization` nodes** with `jobTitle`/`description`/`image`/`knowsAbout` (author) and `sameAs` socials (publisher) — data the brand profile/plugin already holds. *(File: `lib/seo-schema.ts` L186-197; pass new fields from `route.ts` L806-807.)*
4. **Add OG/article tags + verify canonical** in the plugin head: `og:site_name`, `article:published_time`, `article:modified_time`, and ensure a single `<link rel="canonical">` consistent with the JSON-LD `pageUrl` (www vs non-www). *(File: `wp-plugin/mvpaffiliate-platform/mvpaffiliate-platform.php` L439-471.)*
5. **Verify AI-crawler + sitemap access at onboarding.** Check the creator's `robots.txt` allows GPTBot/ClaudeBot/PerplexityBot/Google-Extended/Applebot-Extended/Bingbot, and that `wp-sitemap.xml` is live + submitted. Optionally write a static `llms.txt` (low-impact hedge). *(New: a robots/sitemap check in the WP service or plugin.)*

### Strategic (weeks, compounding)
6. **Topical internal linking.** At generation, fetch the user's same-category posts and inject 2–3 contextual in-body links (and backlink new posts). Reuse the prior-posts query already in `route.ts` L475-493. Replace random "related" with category-aware. *(Files: `app/api/blog/generate/route.ts`; theme `single.php` L72-93; plugin L174-201.)*
7. **Author authority surface.** Generate an indexable author page (bio + headshot + `sameAs`) on the WP site and link it from every post byline; this is the 2026 credentials signal. *(Files: theme `single.php`/`author.php`; plugin; brand profile data.)*
8. **Freshness / re-optimise loop.** Build the loop the DB already anticipates (`route.ts` L757-768): periodically refresh top posts, bump `dateModified`, re-stamp schema. Exploits the 30-day recency citation bias. *(Files: `route.ts`; a new cron/route consuming `seo_keyword`/`meta_description`.)*
9. **AEO answer-first lead lines.** Add one concise "quick answer" sentence to each H2/H3 (without reintroducing banned AI filler) so RAG can extract a self-contained 50-100-word passage per facet. *(File: `services/claude/index.ts` prompt structure.)*
10. **Pinterest channel + video→blog backlink.** Auto-generate a 2:3 Pin from the hero+verdict and enable Rich Pins; auto-insert the blog URL into the YouTube description to close the loop. *(Files: image pipeline in `route.ts`; YouTube metadata writer; plugin OG tags already support Rich Pins.)*

---

## Sources
- [E-E-A-T in March 2026: Google Rewards Experience Content](https://www.digitalapplied.com/blog/e-e-a-t-march-2026-google-rewards-experience-content-guide)
- [Google March 2026 Core Update: What Changed & What To Do (ClickRank)](https://www.clickrank.ai/google-march-2026-core-update/)
- [Google's March 2026 Core Update — Best Practices for SEO and AI Search (Evertune)](https://www.evertune.ai/resources/insights-on-ai/googles-march-2026-core-update-a-content-best-practices-guide-for-seo-and-ai-search)
- [Content Quality Signals Core Updates Reward in 2026 (DigitalApplied)](https://www.digitalapplied.com/blog/content-quality-signals-core-updates-reward-2026)
- [AI Visibility Checklist 2026 (AI Labs Audit)](https://ailabsaudit.com/blog/en/aeo-checklist-2026-actions)
- [Google's New AI Search Guide Calls AEO/GEO 'Still SEO' (Search Engine Journal)](https://www.searchenginejournal.com/googles-new-ai-search-guide-calls-aeo-and-geo-still-seo/575026/)
- [AI Citation Algorithm: How LLMs Pick Sources 2026 (upGrowth)](https://upgrowth.in/citation-algorithm-chatgpt-perplexity-gemini-ai-overviews-2026/)
- [20 Techniques That Get You Cited in Answer Engines (Animalz)](https://www.animalz.co/blog/ai-aeo-answer-engine-citation)
- [Google to No Longer Support FAQ Rich Results (Search Engine Land)](https://searchengineland.com/google-to-no-longer-support-faq-rich-results-476957)
- [Mark Up FAQs with Structured Data (Google Search Central)](https://developers.google.com/search/docs/appearance/structured-data/faqpage)
- [General Structured Data Guidelines / Spam Policies (Google)](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- [What Are Core Web Vitals? LCP, INP & CLS (corewebvitals.io)](https://www.corewebvitals.io/core-web-vitals)
- [Core Web Vitals 2026: Fix Speed or Keep Losing Traffic (Ideafueled)](https://ideafueled.com/blog/core-web-vitals-2026-explained/)
- [Pinterest Affiliate Marketing 2026 (Shopify)](https://www.shopify.com/blog/pinterest-affiliate-marketing)
- [Pinterest Affiliate Marketing 101 (Tagembed)](https://tagembed.com/blog/affiliate-marketing-on-pinterest/)
- [8 Top SEO Trends in 2026 (Marketer Milk)](https://www.marketermilk.com/blog/seo-trends-2026)
- [Top 10 SEO Predictions for 2026 — Affiliate Marketers (Affiverse)](https://www.affiversemedia.com/content-hub/top-10-seo-predictions-for-2026-what-affiliate-marketers-need-to-know/)
