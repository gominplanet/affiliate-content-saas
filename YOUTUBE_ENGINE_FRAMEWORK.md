# MVP Affiliate Pro — The "YouTube → Everything" Engine
### Framework & Phased Roadmap

> Status: design doc (v1). Synthesized from a codebase audit + research on YouTube write-back/compliance and SEO/AEO/GEO + image-gen SOTA (May 2026). No code shipped yet — this is the plan to approve before building.

---

## 0. The Thesis (why this wins)

Every other tool goes **script → video**. MVP goes **video → everything**. Two consequences make this a moat, not a feature:

1. **The transcript is ground truth.** It's the source of every claim — which is exactly why MVP can be the *fact-grounded, no-fabrication* engine (a sellable differentiator). Specs, opinions, and experiences all trace back to what the creator actually said on camera.
2. **Video-first is now a structural SEO advantage.** Google's AI Overviews/AI Mode disproportionately cite YouTube + multimodal content, and the **March 2026 core update made first-hand "Experience" the dominant ranking signal** — affiliate sites *without* original testing were the biggest losers. MVP's creators already filmed themselves using the product. The embedded review video is simultaneously: (a) E-E-A-T Experience proof, (b) an AI-citation magnet, and (c) a dwell-time booster.

**The engine is a closed loop, not a one-shot generator:**

```
Creator uploads review to YouTube
        │
        ▼
  ┌─────────────────────────────────────────────┐
  │  CANONICAL ASSET  (1 per video)              │
  │  transcript · product · LEARN voice · own analytics │
  └─────────────────────────────────────────────┘
        │ fan-out
        ├──▶ YouTube write-back   (title/desc/tags/chapters/thumbnail/pinned comment)
        ├──▶ SEO/AEO/GEO blog     (schema @graph + answer-first + embedded video)
        ├──▶ Best-in-class images (key-frame-grounded, scored, A/B)
        └──▶ Social fan-out       (existing)
        │
        ▼
  MEASURE (internal pre-publish score + the creator's OWN YouTube Analytics + Geniuslink clicks)
        │
        └──▶ RE-OPTIMIZE  ⟲  (the loop nobody else closes)
```

---

## 1. Current State (from the audit) — what already exists

| Area | Built today | Verdict |
|---|---|---|
| Blog generation | Transcript → Claude (sonnet-4-6) → title/slug/excerpt/tags/category + Gutenberg HTML; LEARN voice; fact-check pass; WP publish | Strong core |
| In-body images | fal `flux-pro/kontext` (real product ref) → `flux-pro/v1.1` fallback; hero `aura-sr` 4× upscale | Good, underused |
| **YouTube write-back** | **Already real** — `youtube.force-ssl` scopes; `videos.update` (title/desc/tags), `thumbnails/set`, `videos.update?part=status`, playlists (`apply/route.ts`) | **Bigger than expected** |
| YT metadata gen | 5-agent swarm → title (+4 alts), description, 25 tags, hashtags, pinned comment | Strong, ungrounded |
| Thumbnails | gpt-image-1 face cut-out + Kontext product scene; client title overlay | Capped at 2 variants |
| Affiliate links | Geniuslink wrap + true-destination guardrail + click analytics | Solid, single-product |
| **SEO / structured data** | **Essentially nothing** — no JSON-LD, no meta description, no OG | **Biggest gap** |
| Optimization data | All gen is currently unscored LLM guesses | Fix *without* any external tool — internal scoring + the user's own analytics (Pillar D) |

---

## 2. The Four Pillars

### Pillar A — The YouTube Closed Loop (write-back + measurement)
The code exists; the loop is half-closed. Close it:
- **Post the pinned comment** (`commentThreads.insert`) — generated today but never posted.
- **Generate + write chapters/timestamps** from the transcript into the description (free watch-time + SEO).
- **Promote the AI hero** as the YouTube thumbnail (today it's the raw frame).
- **Internal score gate** on title + tags + thumbnail before write-back (Pillar D) — no external tools.
- **A/B**: push top thumbnail/title variants into YouTube's native Test & Compare.
- **Safety rails** (compliance, §4): every write-back is user-initiated, confirmed, audit-logged (before/after), undoable; never change privacy status without consent.

**Compliance reality (researched):** the write scope `youtube.force-ssl` is **"sensitive," NOT "restricted."** That means **no CASA security assessment / pen-test** ($540–$5k+) — verification is just **brand verification + public homepage + privacy policy disclosing YouTube use + an unlisted demo video**. Timeline ~2–6 weeks, cost ≈ $0. **Verdict: full write-back (incl. title + thumbnail) is realistically shippable for a small company.** The only real gotchas: (1) the channel must be **phone-verified** to set custom thumbnails — handle the error gracefully and prompt the creator; (2) default quota ≈ **100 full write-backs/day** (`videos.list`→`update`+`thumbnails.set` ≈ 101 units) — use ETags/caching, request an increase via the compliance audit when scaling.

### Pillar B — The SEO/AEO/GEO Blog Engine (biggest ROI)
Today: zero structured data. Build:
- **A single `@graph` JSON-LD** (NOT competing blocks — that hurts both):
  - `BlogPosting` (page node, author, dates)
  - `Review` → nested `Product` as `itemReviewed` + `reviewRating` (real, on-page)
  - `VideoObject` referenced via the Article's `video` property — the embedded YouTube review
  - `FAQPage` (easy, high-leverage AEO win — the FAQ prose already exists), `BreadcrumbList`
  - **Guardrail:** Google suppresses *self-serving* review stars. Our creators review **third-party** products, so stars are valid — but the review content must be genuinely visible on-page, and we must never mark up a review of the user's *own* product/org.
- **Answer-first templating** (wins both Google and AI citations — ~44% of citations come from the first 30% of a page; AI engines retrieve 80–200-token chunks): TL;DR/verdict box → question-style H2s with a 2–4 sentence direct answer each → key-specs table → comparison table (vs. alternatives) → pros/cons → "who it's for / who should skip" → FAQ → internal links.
- **Quotable signals**: bake in specific numbers/stats (+citation rate) and attributed first-hand detail per section (a measurement, a flaw found, a usage duration).
- **E-E-A-T**: embed the video above the fold; `Person` author schema with `sameAs` → channel; FTC disclosure near the top, before the first link.
- **meta description + OpenGraph** + a domain-root **`llms.txt`**.
- **Delivery mechanism**: `createPost` currently sends no `meta`. We emit JSON-LD + meta tags **via the MVP WordPress theme/plugin** (render `<script type="application/ld+json">` + meta in `head`), fed by fields we pass through. (One-time plugin change; the platform owns the theme.)

### Pillar C — Best-in-Class Image System (budget no object)
- **fal.ai model router by job** (swappable): Kontext / FLUX.2 [pro] / **Nano Banana Pro** for faces + product accuracy and identity consistency across a series; **Ideogram v3 / Nano Banana Pro** for legible in-image thumbnail text; Recraft for in-article graphics.
- **Key-frame grounding** (closes the thumbnailcreator.com gap, cheaply): pull real frames over plain HTTP — `img.youtube.com/vi/<id>/maxresdefault.jpg` + mid-video `1/2/3.jpg` (+ storyboard sprites), with `hq/sd` fallbacks — and feed them as **reference images** so thumbnails use the actual person + actual product. Also reinforces the Experience signal.
- **Variant generation (1–10) + internal CTR-predictive gate**: score each variant with a self-contained vision-LLM rubric (face presence/emotion, contrast, text legibility, focal clarity, low clutter) → 0–100, **block publish below threshold**, regenerate until one clears, then push top 1–3 to Test & Compare. No external scoring account required.
- **Promote the upscaled AI hero** as the WP featured image + OG image (today the featured image is the low-res raw frame).

### Pillar D — Self-Contained Optimization + Monetization Intelligence (no external tools)
MVP must work flawlessly with **zero third-party SEO/scoring accounts** — we will *not* depend on any external tool, or anything a user might not have. We ground and measure with assets every user already has:
- **Keyword/intent grounding (internal):** derive the target keyword + question-style H2s from the *transcript* (what the creator actually said on camera), the *product info* (Amazon title/bullets/category), and answer-intent patterns — via the LLM, not an external volume API. The transcript is richer ground truth than a generic keyword tool anyway.
- **Pre-publish scoring (internal):** a self-contained rubric scores titles (curiosity, clarity, keyword in the first ~40 chars) and thumbnails (vision-LLM: face/emotion, contrast, text legibility) — a publish gate with no external dependency.
- **Closed-loop measurement (the creator's OWN data):** read real performance from **YouTube Analytics** (the creator's own channel, via the OAuth we already hold) + **Geniuslink click data** (already integrated). Real CTR / retention / clicks on *their* video beats any generic third-party score — and it works for every user automatically.
- **Affiliate:** keep Geniuslink; add **multi-product / comparison** support (the comparison table needs N links), price/availability snapshotting, and link-health checks.

---

## 3. Data Model Additions (sketch)
- `blog_posts`: `schema_jsonld jsonb`, `meta_description text`, `og_image_url text`, `faq jsonb`, `comparison jsonb`, `seo_keyword text`, `seo_score int`.
- `youtube_videos`: `chapters jsonb`, `pinned_comment_posted bool`, `title_score int`, `thumbnail_score int`, `writeback_log jsonb` (audit: before/after, who, when), `thumbnail_variants jsonb`.
- New `writeback_audit` table (id, user, video_id, field, before, after, applied_at, undone_at) for compliance + undo.

---

## 4. Cross-Cutting: Compliance & Risk
- **YouTube**: `youtube.force-ssl` (least privilege); sensitive-scope verification (homepage + privacy policy + demo video, **no CASA**); user-initiated + confirmation UI + audit trail + undo; never change privacy without consent; ETag/quota hygiene.
- **Thumbnails**: surface the "channel not phone-verified" error gracefully.
- **FTC**: auto-insert affiliate disclosure near the top of blog + in the YouTube description (and the rule that the spoken disclosure should be in the video).
- **Schema**: self-serving-review guardrail; validate at validator.schema.org in CI.

---

## 5. Phased Roadmap

**Phase 1 — SEO foundation + quick wins (highest ROI, zero new scopes, ~low risk)**
- Single `@graph` JSON-LD (Article + Review/Product + VideoObject + FAQPage + BreadcrumbList) + meta description + OG, rendered via the WP theme.
- Answer-first blog template (TL;DR, question H2s, specs/comparison/pros-cons/FAQ blocks, FTC disclosure placement).
- Promote the AI hero to WP featured image + OG.
- Post the pinned comment + generate & inject chapters (uses existing write scopes).

**Phase 2 — Internal scoring + image system**
- ✅ **Track A (shipped)** — Internal keyword/intent grounding + scoring, no external accounts:
  - **Title auto-pick** — `scoreTitle` rates all 5 title candidates (best + 4 alts) in `generate-metadata`; the strongest is promoted *before* the description/pinned-comment agents run, so they build around the title that ships. Scores returned as `generated.title_scores`.
  - **Thumbnail publish gate** — `rankThumbnails` scores every generated variant in `generate-thumbnail` (all 3 paths), reorders best-first (so `thumbnailUrl` = top variant), returns `thumbnailScores`/`thumbnailScore`, and flags `belowThreshold` (<55) so the client can suggest regenerating. No server-side auto-regen (would burn the cap silently).
  - **Transcript-grounded keyword** — the blog generator now emits `seoKeyword` (the buyer's search phrase, from transcript + product) + a keyword-led `metaDescription` (≤155 chars); the meta description renders via WP post meta, and both persist to `blog_posts` (migration 065) for the re-optimise loop.
- ◻️ **Track B (next)** — Image router (Nano Banana Pro / FLUX.2 / Ideogram) + key-frame grounding (`lib/youtube-frames.ts`) + N-variant generation (raise the 2-variant cap).

**Phase 3 — Full YouTube write-back UX + verification**
- Confirmation UI + audit trail + undo for title/desc/tags/thumbnail write-back; graceful thumbnail-eligibility fallback.
- Google sensitive-scope verification (demo video + privacy policy) + Test & Compare export.

**Phase 4 — Close the loop**
- Read YouTube analytics + Geniuslink clicks at 24h/7d; auto-surface "re-optimize this title/thumbnail" suggestions; multi-product comparison + price/availability.

---

## 6. Decisions (locked)
1. **Schema delivery → via the MVP WordPress plugin/theme.** The app sends JSON-LD + meta description + OG as post meta; the plugin registers the meta and renders it in `<head>`. No dependency on the user having Yoast/RankMath.
2. **Write-back → review-then-apply.** Generated metadata/thumbnails are always presented for review; nothing is written to a live YouTube video without an explicit user click (aligns with the compliance "user-initiated" requirement).
3. **Phase order → Phase 1 (SEO) first** — biggest ROI, no new permissions while Meta/Google reviews are pending.
