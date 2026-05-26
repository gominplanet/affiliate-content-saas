# Research 02 — Best-in-Class AI YouTube Thumbnails (MVP Affiliate)

**Date:** 2026-05-25
**Scope:** Make MVP Affiliate's generated thumbnails match (and beat) the creator's own existing thumbnails — real person + product, bold ALL-CAPS dual-tone text, well-composed with the subject on one side and text in the clear space. Audit of the current pipeline + concrete, file-level action plan.

---

## 0. Audit — what the current pipeline does (and where it breaks)

**Files in scope**

| File | Role |
|---|---|
| `app/api/youtube/generate-thumbnail/route.ts` | Main route. Path order: **NB** (Nano Banana enhance real frame) → **U** (uploaded photo Kontext) → **A** (Kontext product) → **I** (Ideogram) → **C** (Flux Pro). Vision scoring + ranking at the end of each path. |
| `lib/thumbnail-generators.ts` | fal model calls: `fal-ai/nano-banana/edit`, `fal-ai/ideogram/v3`, `rehostToFal`. |
| `lib/thumbnail-overlay.ts` | Client canvas text overlay. **All 5 presets hard-coded `position: 'top-left'`.** Used by `content/page.tsx` (IG 1080×1350). |
| `app/(dashboard)/studio/page.tsx` | The YouTube studio overlay path (lines ~700–863). Has **smart cut-out bbox detection** (finds the widest non-empty column band of the person cut-out and anchors it bottom-right) but the **text** is still drawn via `drawHeadline(...)` at the preset's hard-coded top-left. |
| `lib/thumbnail-score.ts` | Claude Haiku vision scoring (`scoreThumbnail`, `rankThumbnails`), best-frame picker (`pickBestFrame`), title scoring. |
| `lib/youtube-frames.ts` | HTTP frame fallback (`maxresdefault`→`hqdefault`, mid-frames `1/2/3.jpg`). |
| `lib/extension-frame.ts` | Client bridge → extension. Capture fractions default **`[0.2, 0.4, 0.6, 0.8]`**. |
| `extension/background.js` | MV3 worker. Opens the watch page foreground, seeks to each fraction, draws `<video>` → 1280×720 canvas at JPEG 0.9. |

**Confirmed root causes of the four stated problems**

- **(a) Text collides with subject.** `OVERLAY_STYLES` are *all* `position: 'top-left'` (`thumbnail-overlay.ts:51,66,81,98,113`). `drawHeadline` honors a fixed `ZONE_W = width*0.55` on the left. Meanwhile the studio composites the person cut-out **bottom-right** — so for *clean*-mode images that's fine, but for **baked** Nano Banana output the headline is asked for "upper-LEFT" (`route.ts:660`) with **no knowledge of where the real person actually is in the captured frame.** If the creator is camera-left in their video, the baked text lands on their face.
- **(b) Endscreen/player-UI artifacts.** Capture fraction **`0.8`** is the culprit. Endscreen cards render in the **last 5–20 seconds** of any video ([YouTube Help](https://support.google.com/youtube/answer/6388789)). 0.8 of a 90-second short = 18s from the end = **inside the endscreen zone** → the stray blue card box. (0.8 of a 10-min video is safe, so it's intermittent — exactly the reported symptom.) The capture also does not strip the player chrome/scrubber if it's visible.
- **(c) Enhanced frames still look like screengrabs.** The capture canvas is fixed 1280×720 but **the source `<video>` is whatever quality YouTube auto-selected** — frequently 360p/480p in a freshly-opened background-ish tab. `setPlaybackQuality` is now a **no-op** in the IFrame API ([Google IFrame API ref](https://developers.google.com/youtube/iframe_api_reference)), so quality must be forced another way. Nano Banana (Gemini 2.5 Flash Image / `nano-banana/edit`) outputs ~1024px and is told to "retouch," but a soft 480p input limits the ceiling and it sometimes passes the frame through nearly unchanged.
- **(d) Text placement not coordinated with content.** No saliency/face step feeds the overlay. The studio's smart-bbox logic finds the *cut-out's* box but never computes a *safe text zone* (the empty region) and never overrides the preset position.

---

## 1. Thumbnail CTR design best practices (2026)

Consensus from 2026 guides ([ampifire](https://ampifire.com/blog/best-youtube-thumbnail-guide-examples-best-practices-2026-for-high-ctr/), [1of10](https://1of10.com/blog/youtube-thumbnail-design/), [thumbmagic](https://www.thumbmagic.co/blog/thumbnail-design-principles), [awisee](https://awisee.com/blog/youtube-thumbnail-best-practices/)):

- **Faces + emotion: +20–30% CTR**, but match intensity to niche. Product-review audiences (tech/home) react better to *genuine intrigue/surprise* than cartoonish shock. **This validates the MVP MEMORY note** (`feedback_thumbnail_calibration.md`): natural-portrait faces, not exaggerated. Expression should *react to the product*, not float in a vacuum.
- **Contrast stops the scroll.** Subject vs. background separation via a subtle rim light/outline, not heavy halos. Complementary colors (opposite hue, far-apart brightness).
- **Text ≤ 3–5 words, bold sans-serif, legible at ~10% scale** (mobile list view). **70%+ of views are mobile.** MVP's 3–5-word hooks (`generateHook`) are correctly scoped.
- **Negative space: leave 30–40% of the frame uncluttered** around the subject — this is the text zone. One dominant subject, 2–3 colors.
- **Consistency = +15–20% CTR from subscribers.** MVP already analyzes channel style (`analyzeChannelStyle`) — keep and strengthen this.
- **Rule of thirds / subject-on-one-side.** The creator's own bar: subject one side, text in the clear space. MVP must *detect* which side and place text on the opposite side.

**Implication:** the design rules are already mostly encoded in prompts and scoring. The gap is **execution**: (i) coordinate text with the real subject position, (ii) raise input/output fidelity, (iii) kill artifacts.

---

## 2. SMART text placement (the highest-leverage fix)

Goal: place the canvas overlay (or instruct baked text) in the **empty region opposite the subject**, never on the face/product.

**Approaches, cheapest → most robust, all fitting Next.js/fal.ai:**

### Option A — Vision-LLM returns a safe-text-zone bbox (recommended, lowest effort, highest fit)
MVP already calls Claude Haiku vision for scoring and frame-picking. Add **one** call (or fold into `scoreThumbnail`) that returns a normalized safe-text-zone box. This is the patented industrial pattern: saliency mask → candidate non-salient regions → score by size + distance from salient objects → place + scale text ([USPTO 11270485](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11270485)). A vision LLM does all of that in one shot.

Prompt sketch (returns JSON):
```
Return the largest rectangular region containing NO face and NO product —
where bold headline text can be overlaid. Also return which third the main
subject occupies.
JSON: {"textZone":{"x":0-1,"y":0-1,"w":0-1,"h":0-1},
       "subjectSide":"left|right|center","faceBox":{...}|null}
```
Feed `textZone` into `drawHeadline` (replace the hard-coded `MARGIN_X`/`ZONE_W`/`startY`). For **baked** Nano Banana output, inject `subjectSide` into the prompt: "headline in the upper-{opposite side} over the clear area." Cost ≈ $0.003–0.005/image on Haiku, runs in parallel with scoring — near-zero added latency.

### Option B — MediaPipe Face Detector in the browser (deterministic, free, client-side)
`@mediapipe/tasks-vision` Face Detector returns normalized bbox + 6 keypoints, runs in the browser (WASM) ([MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector)). In the studio canvas step, detect the face, then pick the text zone as the horizontal half *without* the face, vertically toward the top. Pairs well with the existing alpha-bbox cut-out logic. Use as a **fast deterministic fallback** when the vision call fails. Limitation: faces only (not product), no general saliency.

### Option C — Saliency model on fal / classic OpenCV saliency
A spectral-residual / fine-grained saliency map → invert → largest empty rectangle. More infra than A or B for the same outcome; only worth it if you want a fully offline server path. Not recommended for MVP given A is cheaper and already in the stack.

**Recommendation:** **A as primary** (one Haiku call, returns `textZone` + `subjectSide`), **B as deterministic fallback**. Make `OverlayStyle.position` accept a dynamic `{x,y,w,h}` zone; default to the preset only when detection fails.

---

## 3. Image polish / enhancement without losing identity

**Model landscape (fal.ai, mid-2026):**

- **Person+product compose/enhance:** **Nano Banana Pro** = *Gemini 3 Pro Image* (`fal-ai/gemini-3-pro-image-preview` and `/edit`). Native **up to 4K (4096²)**, **94%+ text accuracy**, **multi-reference edit (up to 2 images)**, **$0.15/image at 1K-2K, $0.30 at 4K** ([Google blog](https://blog.google/innovation-and-ai/products/nano-banana-pro/), [fal](https://fal.ai/nano-banana-pro), [fal edit model](https://fal.ai/models/fal-ai/gemini-3-pro-image-preview/edit)). This is a **drop-in upgrade** for the current `fal-ai/nano-banana/edit` (Gemini 2.5 Flash Image): identity preservation is at least as good, output is far sharper, and **baked text becomes reliable** (closing the gap with Ideogram). Recommended primary for both the enhance path and baked text.
- **Legible baked text (specialist):** **Ideogram v3** still the English-typography leader (~90% accuracy) ([nanobananaimages comparison](https://www.nanobananaimages.com/blog/nano-banana-vs-ideogram)). Keep as the text-forward fallback (already wired, Path I).
- **Upscaling (post-process to crisp 1280×720+):**
  - **`fal-ai/aura-sr`** — GAN 4× super-res, preserves content, cheap/fast ([fal AuraSR](https://fal.ai/models/fal-ai/aura-sr)). **Best default** — fast, identity-safe, no hallucination.
  - **`fal-ai/clarity-upscaler`** — sharpen + clean, high color fidelity ([fal Clarity](https://fal.ai/models/fal-ai/clarity-upscaler)). Good for "make it pop"; can drift detail — keep `creativity`/denoise **low** to protect identity.
  - **`fal-ai/creative-upscaler`** — adds depth/texture; **avoid for faces** (alters likeness).

**Polish chain recommendation:**
1. Generate with **Nano Banana Pro** at 2K (or 4K for the chosen winner only, to control cost).
2. If a path still returns a soft image (Kontext/Flux/low-res frame), run **AuraSR 4×** then downscale to 1280×720 with sharp.
3. Light color-grade/sharpen is already requested in `styleClause` — keep, but stop relying on the generator alone; a dedicated upscale pass is more consistent.
4. **Identity guardrail:** never run creative/high-denoise upscalers on the face path; AuraSR or low-creativity Clarity only. The MEMORY calibration (natural portrait, LoRA scale 1.0) stays.

---

## 4. Removing captured-frame artifacts (extension)

**Three concrete fixes in `extension/background.js` + `lib/extension-frame.ts`:**

1. **Avoid the endscreen zone (fixes the blue card box).** Endscreens occupy the **last 5–20s** ([YouTube Help](https://support.google.com/youtube/answer/6388789)). Don't seek by fraction near the end — **clamp the seek target to leave ≥ 25s of tail**:
   ```js
   const tail = 25; // seconds of safety from the end
   const safeMax = Math.max(1, video.duration - tail);
   const target = Math.min(safeMax, Math.max(1, f * video.duration));
   ```
   And change default fractions in `lib/extension-frame.ts` from `[0.2,0.4,0.6,0.8]` → **`[0.2,0.35,0.5,0.65]`** (front/mid-weighted, never near the tail). This alone removes most endscreen captures.

2. **Force HD before capture.** `setPlaybackQuality` is a **no-op** now, so instead:
   - Open the watch page with **`&vq=hd1080`** in the URL, and/or click the gear → Quality → 1080p via injected script, and **wait for `video.videoWidth >= 1280`** before drawing (poll up to the existing deadline). Skip/penalize a capture if `videoWidth < 1280`.
   - In `captureNow()`, **reject low-res frames**: if `video.videoWidth < 1280`, retry after a short wait; only accept ≥720p.

3. **Strip player chrome.** The scrubber/controls/title bar can bleed in. Two defenses: (i) ensure controls are hidden — capture during steady playback after a `mousemove`-idle so the auto-hide kicks in, or add the `ytp-autohide` class wait; (ii) **center-crop a few % off all edges** before the 16:9 fit so any residual control bar/letterbox is removed. Endscreen suppression also helps — during a *card* the title/controls differ, so mid-video front-weighted capture is cleanest.

4. **Belt-and-suspenders at the model step.** The Nano Banana `styleClause` already says "REMOVE any burned-in on-screen text, captions, lower-thirds… watermarks or graphics." Add **"and any video-player UI, progress bar, timestamps, or end-screen cards/boxes."** Upgrading to Nano Banana Pro improves its ability to actually honor this.

---

## 5. Multi-variant generation + scoring + native A/B

- **Generation:** Already fires `variantCount` parallel single-image composes and ranks with `rankThumbnails` (Haiku vision). **Keep.** Improve the scoring rubric to add a **`textZoneClear`** factor (was the safe zone actually empty?) and a **`subjectSidePop`** factor, and weight `faceEmotion` + `contrast` + `focalClarity` as today.
- **Pick-the-best loop:** Generate **2–3 variants by default** (current default is 1), rank, surface the winner + the runner-ups. The `belowThreshold` (<55) flag → suggest regenerate (already implemented, keep — don't auto-burn cap).
- **Native A/B = YouTube "Test & Compare".** Upload **up to 3** thumbnails per video; YouTube serves them and after ≤2 weeks promotes the **highest watch-time** variant ([YouTube Help](https://support.google.com/youtube/answer/16391400), [tubeanalytics](https://www.tubeanalytics.net/blog/ab-testing-youtube-titles-thumbnails)). **Caveats:** Studio/desktop + advanced features only; **no documented public API** as of 2026 — it's a Studio UI feature. So MVP can't push the A/B test automatically; instead **deliver the top 2–3 ranked variants as a downloadable set + a one-line "upload these 3 to YouTube → ⋮ → Test & Compare" instruction.** This turns MVP's multi-variant output into a native A/B kit — a real differentiator.

---

## Prioritized, MVP-specific action plan

**P0 — kills the visible bugs, small surface area**
1. **Endscreen fix.** `extension/background.js`: clamp seek to `duration - 25s`. `lib/extension-frame.ts`: change default fractions to `[0.2,0.35,0.5,0.65]`. *(removes the stray blue card)*
2. **Force/verify HD capture.** `extension/background.js`: open with `&vq=hd1080`, wait for `video.videoWidth >= 1280`, reject sub-720p frames; center-crop ~3% to drop residual chrome. *(fixes screengrab softness at the source)*
3. **Add UI/endscreen removal to the NB prompt** (`route.ts:658` `styleClause`): "remove any video-player UI, progress bar, end-screen cards/boxes." *(belt-and-suspenders)*

**P1 — closes the quality gap to the creator's own thumbnails**
4. **Smart text zone.** New `lib/thumbnail-textzone.ts`: Haiku vision returns `{textZone, subjectSide, faceBox}`. Wire into `drawHeadline` (`thumbnail-overlay.ts`) — replace hard-coded `MARGIN_X/ZONE_W/startY` with the detected zone; add MediaPipe (`@mediapipe/tasks-vision`) as deterministic fallback in `studio/page.tsx`. For **baked** output, inject `subjectSide` into `bakedPrompt` (`route.ts:660`) so text goes opposite the person. *(fixes text-on-face collisions)*
5. **Upgrade to Nano Banana Pro** (`lib/thumbnail-generators.ts`): switch `NANO_BANANA_EDIT` to `fal-ai/gemini-3-pro-image-preview/edit`, request 2K, 16:9. Update `NANO_BANANA_COST_MODEL` + cost table ($0.15/1-2K, $0.30/4K). *(sharper output + reliable baked text)*

**P2 — polish + measurable lift**
6. **Upscale pass.** New `upscaleToHd()` using `fal-ai/aura-sr` (4×→downscale 1280×720) for any soft Kontext/Flux/low-res-frame output; low-creativity only on face paths. *(consistent crispness)*
7. **Default to 2–3 variants + rank**, expose top 3 as a **"Test & Compare kit"** with upload instructions. Add `textZoneClear` + `subjectSidePop` to `scoreThumbnail` rubric (`thumbnail-score.ts`). *(native A/B differentiator)*
8. **Strengthen channel-consistency** — already analyzed; feed `channelStyle` into the NB enhance prompt too (currently only the product/Flux paths use it).

**Guardrails (respect existing MEMORY):** never the word "HONEST" anywhere; first-person, never fabricated; natural-portrait faces (no cartoon exaggeration), dual-tone high-contrast banner text, LoRA scale 1.0; no invented product specs.

---

## Sources
- [Best YouTube Thumbnail Guide 2026 (ampifire)](https://ampifire.com/blog/best-youtube-thumbnail-guide-examples-best-practices-2026-for-high-ctr/)
- [YouTube Thumbnail Best Practices (awisee)](https://awisee.com/blog/youtube-thumbnail-best-practices/)
- [Thumbnail Design Principles 2026 (thumbmagic)](https://www.thumbmagic.co/blog/thumbnail-design-principles)
- [9 Tips for High-CTR Thumbnails (1of10)](https://1of10.com/blog/youtube-thumbnail-design/)
- [Automatic positioning of textual content within images — USPTO 11270485](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11270485)
- [MediaPipe Face Detector](https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector)
- [Nano Banana Pro / Gemini 3 Pro Image — Google](https://blog.google/innovation-and-ai/products/nano-banana-pro/)
- [Nano Banana Pro on fal.ai](https://fal.ai/nano-banana-pro)
- [Nano Banana Pro Edit model — fal](https://fal.ai/models/fal-ai/gemini-3-pro-image-preview/edit)
- [Nano Banana vs Ideogram (2026)](https://www.nanobananaimages.com/blog/nano-banana-vs-ideogram)
- [fal AuraSR](https://fal.ai/models/fal-ai/aura-sr)
- [fal Clarity Upscaler](https://fal.ai/models/fal-ai/clarity-upscaler)
- [YouTube IFrame Player API (setPlaybackQuality no-op)](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube end screens (last 5–20s)](https://support.google.com/youtube/answer/6388789)
- [YouTube A/B test titles & thumbnails (Test & Compare)](https://support.google.com/youtube/answer/16391400)
- [A/B Testing YouTube Titles & Thumbnails guide (tubeanalytics)](https://www.tubeanalytics.net/blog/ab-testing-youtube-titles-thumbnails)
