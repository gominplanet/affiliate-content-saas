# Clip Factory — fast, cheap, quality plan

Goal: turn one long video into strong vertical Shorts at the lowest cost and
latency **without dropping quality**. This maps the current pipeline, ranks the
cost/speed levers, and lays out a phased plan. Planning doc — nothing here is
built yet.

---

## 1. Current pipeline (as built)

| Stage | Where | Engine / model | Cost driver | Latency driver |
|---|---|---|---|---|
| Transcribe | `lib/shorts-transcribe.ts`, `lib/youtube-ingest.ts` (`ingestAudio`) | Whisper (word-level), audio-only download | per audio-minute | audio length + download |
| Plan (pick clips) | `lib/shorts-planner.ts` | Claude Sonnet, `max_tokens: 2000` | **full timestamped transcript in the prompt** + output | one LLM call |
| Captions | `lib/shorts-captions.ts` | pure functions | free | free |
| Render | `app/api/youtube/shorts/render/route.ts` → ingest `/render-short` (FFmpeg + libass); Cloudinary fallback | compute per clip (trim + 9:16 + burn captions) | download + encode per clip |
| Publish | TikTok Direct Post / IG / YT | platform APIs | negligible | API round-trip |

Key facts that already help:
- Transcript is cached on `youtube_videos.transcript` (no re-transcribe on re-plan).
- Planning is **free to the user and cheap** relative to render; render is **opt-in per clip** (we don't render everything).
- Segment render (`renderShortSegment`) pulls only the clip window from YouTube, not the whole video.
- Captions are verbatim word-level (fact-grounded, zero LLM cost).

---

## 2. Cost, ranked (biggest first)

1. **Planner input tokens.** The whole timestamped transcript goes into one Sonnet call. A 45–60 min video is a large prompt, and it's paid on every "Find Shorts" (and every "Find more"). This is the #1 recurring LLM spend.
2. **Render compute.** FFmpeg encode + (future) face-tracking per clip. Scales with clips rendered × clip length. Bounded today because render is opt-in.
3. **Transcription.** Whisper per audio-minute. One-time per video (cached), so amortized low, but long back-catalogs add up.
4. **Publish** — negligible.

## 3. Speed, ranked (worst first)

1. **Render latency** (30–90s+ per clip: download window + encode + caption burn). The thing users feel most.
2. **Planner latency** on long videos (large prompt → slower first token).
3. **Transcription** on first run for a long video.

---

## 4. The plan — per stage, with quality guardrails

> STATUS: A + B shipped in `lib/shorts-planner.ts` (hotspot Haiku pass on videos
> > 8 min, top-window selection feeding Sonnet) and the plan route now passes
> already-rendered clip windows as `excludeRanges` so re-plans never repropose a
> finished Short. Persisting hotspot scores across runs (pure caching) is the
> remaining smaller optimization.

### A. Planner: two-pass, chunked (biggest cost win)
Problem: feeding the entire transcript to Sonnet every time.
Plan:
1. **Cheap hotspot pass (Haiku):** split the transcript into ~3–5 min windows, have Haiku score each window 0–100 for "has a standalone moment" (hook, number, story, hot take). Tiny output. Cheap.
2. **Sonnet only on the top hotspots:** feed Sonnet just the top-K windows (+ small context padding), not the whole transcript. It does the real clip selection + hook/caption/hashtags on a fraction of the input.
- Quality guard: keep Sonnet as the final selector/writer (its judgment is what makes clips good). Only the *input* shrinks. For short videos (< ~8 min) skip the hotspot pass and feed the whole transcript directly — no quality/latency reason to chunk.
- Expected: large input-token cut on long videos; equal or better clips (Sonnet focuses on the strong parts).

### B. Planner: cache + dedupe re-runs
- "Find more Shorts" should exclude already-surfaced windows and reuse the hotspot scores from the first run (store them on the video row), so a second pass is cheap and never re-proposes the same moment.

### C. Transcription: keep audio-only, add a cheaper provider option
- Already audio-only (good). Evaluate a faster/cheaper Whisper host (e.g. Groq Whisper / Deepgram) behind a flag; word-level timing is the hard requirement (captions depend on it). One-time per video, so this is a lower priority than the planner.

### D. Render: the latency + compute battleground
1. **Render on demand only** (already true) — never pre-render all clips.
2. **Concurrency-bounded batch:** when a user renders several, run them in parallel with a small cap so wall-clock ≈ one clip, not the sum.
3. **Cache the trimmed source once:** if a user renders 3 clips from the same uploaded video, download/prepare the source once and cut all clips from it (avoid N downloads). For the YouTube-segment path, each clip window is small already.
4. **Cheap reframe now, smart reframe later:** static center/safe-crop 9:16 is cheap and fine for talking-head + product shots. Active-speaker face-tracking (the Opus-style feature) is the expensive add — plan it as: detect faces once per clip, cache the crop path, reuse on re-render. Gate it as a toggle so users only pay the compute when they want it.
5. **Caption burn is already one FFmpeg pass** (good). The power-word coloring (see `docs/clip-factory-caption-service.md`) is a styling tweak, not extra passes.

### E. Publish: already lean
- AI caption is produced in the plan step (no extra call at publish). Keep it. Reuse the same caption across platforms with per-platform trims rather than regenerating.

---

## 5. Target architecture (phased)

**Phase 1 — planner cost (highest ROI, lowest risk).**
- Hotspot pre-pass (Haiku) + Sonnet-on-top-K. Short-video bypass. Persist hotspot scores for cheap "Find more".
- Deliverable: big input-token reduction on long videos, same clip quality.

**Phase 2 — render throughput.**
- Parallel bounded render for multi-clip; single source-prep reuse; render-status UX so the user isn't blocked.
- Deliverable: multi-clip render feels near-instant relative to today.

**Phase 3 — smart reframe (quality lift, gated).**
- Active-speaker face-tracking crop in the ingest service, computed once + cached per clip, behind a toggle. Power-word caption coloring (already plumbed from our side; needs the service change in `docs/clip-factory-caption-service.md`).
- Deliverable: Opus-grade look, cost only when opted in.

**Phase 4 — transcription cost (optional).**
- Cheaper/faster word-level transcription provider behind a flag, only if back-catalog volume justifies it.

---

## 6. Guardrails so "cheap" never means "worse"
- Sonnet stays the final clip picker + copywriter. Only its input is trimmed.
- Captions stay verbatim word-level (never LLM-rewritten — that's the fact-grounding).
- Reframe/face-tracking is additive and gated, never forced.
- Every cost cut ships with a before/after check on a couple of real long videos (clip count, clip quality, token spend, wall-clock).

## 7. First concrete steps (when we resume)
1. Instrument the planner: log input tokens + latency per "Find Shorts" so we can measure the Phase 1 win.
2. Build the Haiku hotspot pass + Sonnet-on-top-K in `lib/shorts-planner.ts`, with the short-video bypass.
3. Persist hotspot scores + surfaced windows on the video row for cheap "Find more".
4. Then Phase 2 render throughput.
