# Thumbnail Engine: OpenAI Image API vs Nano Banana — Research Report

**Date:** 9 Aug 2026
**Question:** Can we move MVP's thumbnail generation to OpenAI's ChatGPT-style image API (accurate products, faces, text) instead of Nano Banana + Haiku QC? Is it better and cheaper? What about Logie?
**Short answer:** Better — yes, clearly, for product+face accuracy and reliability. Cheaper — only modestly, and not from the per-image price; the savings come from cutting the retry/QC overhead. And the biggest surprise: **we already run OpenAI's image model in production**, so this is a routing + tuning job, not a build-from-scratch research project.

---

## 1. The finding that changes the whole picture

We are **already generating thumbnails with OpenAI's image model in production, today.**

- `services/openai/index.ts` is a complete, working `gpt-image` wrapper: it calls the `/v1/images/edits` endpoint with **multiple reference images** (creator face photos + the product photo), at `1536x1024`, with quality tiers, organization-verification handling (`OPENAI_ORG_ID`), and automatic PNG normalization so user uploads don't get rejected. It's env-swappable to a newer model via `OPENAI_IMAGE_MODEL`.
- Our **"graphic" thumbnail mode already routes through it** (`route.ts:1215`, `openaiGfx.generateWithReferences(... quality:'medium', size:'1536x1024')`). That's the exact "put THIS product + THIS face + THIS headline into one image" flow you've been impressed by in ChatGPT. We ship it on that path right now.
- Our **face-cutout portrait** step and the **photobooth** and **social-launch-kit banner** features also call the same OpenAI wrapper.

Why this matters for doability and risk:

1. **Our OpenAI org is already verified for image generation.** gpt-image is gated behind OpenAI's mandatory Organization Verification (a hard 403 otherwise). Since the graphic path works in prod, that gate is already cleared and the billing/plumbing is proven. That removes the single most annoying setup blocker.
2. **The integration surface already exists.** We don't need a new service, SDK, or endpoint. We need to point the *default* path at it and tune.

The default path (what most generations hit) currently uses **Nano Banana Pro** (Google Gemini 3 Pro Image, via fal.ai) instead. So the real question isn't "can we use OpenAI" — it's "should OpenAI's model be the primary engine for *all* thumbnails, and at what quality tier."

---

## 2. Reframing what you actually want (important)

You praised ChatGPT for accurate **products, faces, and especially text**. Two of those three are exactly right; the text one needs a correction that actually works in our favor.

- **Products + faces from a reference photo → this is gpt-image's real strength.** One shot, both preserved. This is the win.
- **Text → do NOT rely on the model to bake it in.** Even OpenAI's own docs say the model "can still struggle with precise text placement and clarity," with no exact-spelling guarantee (numerals and symbols like "$8" are where it slips). Here's the thing: **our default "clean" path already overlays the headline ourselves with razor-sharp vector typography** (`lib/thumbnail-simple-bake.ts` — opentype.js glyph paths rendered by Resvg). That canvas text is *more* reliable than any model's baked text, it's pixel-perfect every time, and it's free to re-edit without re-generating.

So the correct architecture is not "let gpt-image do everything." It's:

> **gpt-image draws the product+face scene → we overlay the exact headline with our own canvas.**

That's the same shape as our current clean path, just swapping Nano Banana for gpt-image as the scene engine. The ChatGPT "wow, the text is perfect" feeling is best reproduced by *our overlay*, not the model.

---

## 3. Which OpenAI model (gpt-image-1 is being retired)

You said gpt-image-1. As of now that model is **scheduled for retirement around late October 2026** (confirm on OpenAI's deprecations page). The current lineup:

| Model | Status | Notes for us |
|---|---|---|
| **gpt-image-2** | Current flagship | Best fidelity. **Always** processes reference images at high fidelity (no `input_fidelity` knob — it's automatic). Only model with **true 16:9** native (2048×1152). |
| **gpt-image-1.5** | Current | Cheaper than v2, **has the `input_fidelity` control**, max size 1536×1024 (3:2, needs crop for 16:9). |
| **gpt-image-1** | Retiring ~Oct 2026 | What our GFX path pins today. We must migrate off it regardless. |
| **gpt-image-1-mini** | Current, cheapest | Weaker face/product fidelity. Budget lane. |

**We are forced to migrate the existing GFX path off gpt-image-1 anyway.** That deadline is a convenient forcing function to do this properly on gpt-image-2.

One thing we're leaving on the table today: **we never pass `input_fidelity: 'high'`** anywhere. On gpt-image-1/1.5 that's *the* lever for locking an exact face and exact product. (On gpt-image-2 it's automatic, so it's moot there.) If we stayed on 1.5, turning that on is a one-line fidelity upgrade.

---

## 4. The honest cost math

Image generation on OpenAI is **priced per token, not a flat fee.** Output-image tokens dominate, and **each high-fidelity reference image you pass adds a real chunk of input-token cost** (~$0.035 per reference at high fidelity on v2/1.5). Passing a product photo **and** a face photo = ~$0.07 of references on top of the output image, per call.

Per-image, landscape (1536×1024), from OpenAI's published tables (v2 landscape figures flagged as not fully confirmed — verify on their live calculator):

| | Output only | + 2 hi-fi refs (product+face) |
|---|---|---|
| gpt-image-2, high | ~$0.165 | **~$0.235** |
| gpt-image-1.5, medium | ~$0.05 | **~$0.12** |
| gpt-image-1.5, high | ~$0.20 | ~$0.27 |
| gpt-image-1-mini, high | ~$0.052 | ~$0.074 |
| **Nano Banana Pro (current, via fal)** | **$0.13–0.15 flat** | included (fal caps refs at 2) |

Now the **per-generation** picture (we default to ~1–2 variants; cost scales linearly with variant count):

| Path (2 variants) | Images | QC + retry tax | Planning (Claude) | **Typical total** | Worst case (retry fires) |
|---|---|---|---|---|---|
| **Current (Nano Banana Pro)** | 2 × ~$0.13 = $0.26 | Haiku QC ~$0.035; retry regenerates 2 imgs = +$0.26 | ~$0.03 | **~$0.32** | **~$0.60** |
| **gpt-image-2 high** | 2 × $0.235 = $0.47 | little/no QC needed | ~$0.03 | **~$0.50** | lower variance |
| **gpt-image-1.5 medium + input_fidelity** | 2 × $0.12 = $0.24 | little QC | ~$0.03 | **~$0.27** | lower variance |
| **gpt-image-1-mini high** | 2 × $0.074 = $0.15 | some QC | ~$0.03 | **~$0.18** | lower variance |

**Read this carefully, because it corrects the "cheaper" assumption:**

- **gpt-image-2 at the quality that wows you is NOT cheaper per image** — it's ~$0.47 vs $0.26 for the images alone. It gets to rough parity *only* because it's reliable enough to kill the QC fan-out and the $0.26 retry event that Nano Banana triggers when it draws the wrong product.
- **gpt-image-1.5 medium (~$0.27)** lands at genuine cost parity with Nano Banana **and** should be more reliable — likely the sweet spot.
- **gpt-image-1-mini (~$0.18)** is the only clearly-cheaper OpenAI option, but you trade away face/product fidelity — probably not worth it for the hero use case.

**Where the real savings actually live** (independent of which model):
1. **Killing the retry.** Nano Banana's "all variants failed QC → regenerate" is a $0.26 event. A more reliable one-shot engine makes it rare. That's the biggest single line.
2. **Shrinking the Haiku QC fan-out.** We run ~9N+4 vision checks because Nano Banana is unreliable. A reliable engine needs far fewer (maybe one product-match check, or none). Saves $0.03–0.06 and a lot of latency.
3. **Fewer variants.** If hit-rate per variant goes up, 1 good variant beats 2 mediocre ones.

**Bottom line on cost:** this is roughly **cost-neutral, not a big cut** — unless you go to gpt-image-1.5 medium or accept mini. The honest pitch is *"same money, materially better and more reliable output, less wasted spend on retries."* If pure cost reduction is the goal, see the two cheaper non-OpenAI levers in §6.

---

## 5. Doability & effort

**High. Most of it is already built.** Concretely, to make gpt-image the primary engine:

1. Set `OPENAI_IMAGE_MODEL=gpt-image-2` (and migrate the GFX path pin off gpt-image-1 — required anyway). ~trivial.
2. Route the default `clean`/`baked` path from `composeWithNanoBananaPro(...)` to `openaiGfx.generateWithReferences(...)`. The function signature and reference-image plumbing already exist. ~half day.
3. Generate at **2048×1152** (true 16:9 on v2) → downscale to 1280×720. Keep our **canvas headline overlay** for text. ~small.
4. Turn the QC fan-out down to a single product-match check (or off) and remove the auto-retry once we trust the engine. ~half day, measure before/after.
5. Keep **Nano Banana Pro as the fallback** on an OpenAI refusal or timeout. We already have the fallback ladder (Nano Banana → Ideogram → Flux); just re-order it. ~small.

Estimated: **~1–2 focused days to wire + A/B**, not a research project. The genuine unknowns are quality-on-our-real-inputs and latency, which only a bench answers.

---

## 6. Two cheaper levers the research surfaced (worth testing in parallel)

These aren't OpenAI, but they directly serve "better and cheaper" and are cheap to try:

1. **Move our existing Nano Banana Pro off fal.ai to Google direct (Vertex / AI Studio).**
   - Google-direct price is **~$0.134** vs fal's **~$0.15** → ~10–15% off the model we already use.
   - Bigger deal: **fal caps Nano Banana Pro at 2 reference images. Google-direct allows up to ~14** (up to 5 faces + many objects). Our product+face+frame case is exactly what benefits. This could improve our *current* output for free, today, with no model change.
2. **Bench ByteDance Seedream 4.5 (~$0.04/image, up to 10 refs).**
   - ~70% cheaper than Nano Banana Pro, strong multi-reference product/face fidelity, decent text. If it holds up on our real thumbnails, it's the cost play. Text is a touch below Ideogram/Nano-Banana-Pro tier, but we overlay text ourselves anyway, so that weakness barely matters to us.

Quality ceiling option (if we ever want the absolute best): composite the scene on gpt-image-2 or Nano Banana Pro, then run a text pass on **Ideogram 4.0** or **Recraft V3** — but since our canvas overlay already produces perfect text, this is redundant for us. Skip it.

---

## 7. Logie / "Logie5" — resolved, and it's a dead end for the pipeline

**logie.ai is not an AI image model and has no image-generation API.** It's a social-commerce / influencer-matching platform: brands connect their Amazon/Shopify catalog and Logie's AI matches products to **human creators** who shoot real UGC photos and video. The "incredible images" it markets are **creator-made, not model-generated.** Its pricing is a brand subscription ($297–$997/mo for a number of creator videos), and its "API" is for Amazon product/creator-earnings data, not image synthesis.

I found **no product, model, or version called "Logie5"** anywhere in image generation. Most likely you saw human-creator UGC on logie.ai and assumed a model produced it, or "Logie5" is a mix-up with a different tool. **Verdict: not a model to copy, not an API to integrate.** If you can point me at exactly where you saw "Logie5," I'll identify the actual underlying tool — but for our thumbnail engine, it's not relevant.

---

## 8. Risks (ranked)

1. **Likeness / consent policy — the one to design for.** OpenAI's policy: you may not reproduce a real person's likeness without their consent and rights. **Our case is in the allowed lane** — creators putting *their own* face (uploaded creator photos / SCOUT frames of themselves) on *their own* thumbnails. But because we let users upload a face, we should add a **consent attestation** (a checkbox: "this is me or I have rights to this likeness") and keep a moderation/fallback path, because output moderation will occasionally refuse even legitimate self-likeness. Low-medium risk, manageable.
2. **Latency.** gpt-image-2 high at landscape is **30–60s+ per image** (occasionally worse), synchronous API. We already run `maxDuration=300` and parallelize variants, so it's tolerable, but it's **slower than Nano Banana.** Users will feel it. Keep generation async/queued (we already do) and set expectations in the UI.
3. **Rate limits.** OpenAI caps images/min by usage tier: **5/min at Tier 1, 20 at Tier 2, 50 at Tier 3.** For real SaaS volume we need **Tier 3+**. Action: confirm our current OpenAI tier and monthly spend before flipping the default — this is a hard throughput gate. (Our GFX path already runs on OpenAI, so check where we sit.)
4. **Moderation refusals on commercial content.** Set `moderation: "low"` (exists, loosens category filtering) and keep the Nano Banana fallback for the occasional refusal. Low risk.
5. **gpt-image-1 retirement (~Oct 2026).** Forces us off the model our GFX path pins. This is a *reason to act*, not a blocker.

---

## 9. Probability of success

| Goal | Probability | Why |
|---|---|---|
| **Better product + face accuracy than Nano Banana** | **High (~85%)** | It's gpt-image's core strength; you've already seen it; our GFX path already demonstrates it in prod. |
| **Perfect text** | **Very high (~95%)** — but via our canvas overlay, not the model | We already do razor-sharp vector text; keep it. |
| **More reliable (kills the "50% of the time" problem)** | **High (~80%)** | One-shot fidelity + fewer moving parts than the Nano Banana → QC → retry → fallback chain. Needs the bench to confirm on our real inputs. |
| **Cheaper** | **Medium (~50%)** | Only at gpt-image-1.5 medium / mini, or via the net savings from dropping retries/QC. At gpt-image-2 high it's ~cost-neutral, not cheaper. |
| **Ships without a major rebuild** | **Very high (~90%)** | Integration already exists; this is routing + tuning. |

---

## 10. Recommended plan

**Phase 0 — verify the gates (fast, do first):**
- Confirm our OpenAI **org verification** status (almost certainly already done — GFX path works) and our **usage tier / images-per-minute limit** and current spend. This decides whether we can even serve the volume. *(I can't read the OpenAI dashboard from here — this one's yours, or point me at where the key/limits live.)*

**Phase 1 — bench, don't guess (~half day of my time):**
- Generate **20–30 real thumbnails** through three engines side by side on identical inputs: (a) current Nano Banana Pro, (b) **gpt-image-2 high** (product+face refs, our canvas text, 2048×1152→720), (c) **gpt-image-1.5 medium + input_fidelity:high**. Measure quality, product/face accuracy, latency, and exact cost per generation. Include a couple of **Seedream 4.5** and **Nano-Banana-direct** runs as the cheap challengers.

**Phase 2 — flip behind a flag (if the bench wins):**
- Route the default path to gpt-image-2 (or 1.5 medium if cost matters more), keep Nano Banana as the **refusal/timeout fallback**, migrate the GFX pin off gpt-image-1, add the **consent checkbox**.

**Phase 3 — harvest the savings:**
- Trim the Haiku QC fan-out to a single product-match check (or none), remove the auto-retry, re-measure net cost/generation. This is where the real money comes back.

**Decisions I need from you (for the morning):**
1. Priority: **best quality (gpt-image-2 high, ~cost-neutral)** or **cost parity with a reliability bump (gpt-image-1.5 medium)**? My rec: bench both, default to **1.5 medium + input_fidelity** unless the v2 output is visibly better on our inputs.
2. OK to add a **"this is me / I have rights to this face" consent checkbox** to the thumbnail flow? (Needed to stay clean on OpenAI's likeness policy.)
3. Want me to also bench the two cheap non-OpenAI levers (**Nano Banana via Google-direct** for the free ref-count + price win, and **Seedream 4.5** for the ~70% cost cut), or focus only on OpenAI?

---

### Appendix: what's already in our codebase

- `services/openai/index.ts` — `generateWithReferences()` (images.edit, multi-ref, size/quality, org verification, `normalizeToPng`). Env-swappable via `OPENAI_IMAGE_MODEL`.
- `app/api/youtube/generate-thumbnail/route.ts:1215` — GFX/graphic path already on gpt-image-1 (`quality:'medium'`, `1536x1024`, face+product refs, baked text + composited badge).
- `route.ts` default `clean`/`baked` path — Nano Banana Pro (`composeWithNanoBananaPro`) → fallback Nano Banana → Ideogram → Flux, wrapped in the Haiku QC fan-out (`verifyFaceIdentity` / `verifyNoBrandLeak` / `verifyBakedText` / `verifyProductMatch`) + one regenerate-and-recheck retry.
- `lib/thumbnail-simple-bake.ts` — the canvas text engine (opentype.js → Resvg vector glyphs) that already gives us pixel-perfect headlines. **Keep this; it beats model-baked text.**
- Not currently used anywhere: `input_fidelity`. Untapped fidelity lever on 1.x models.
