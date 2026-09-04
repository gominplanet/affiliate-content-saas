# Video editing: what MVP could do with raw footage

Planning doc. Nothing here is built yet. Written while the Amazon Earnings page
was being tested, so it is research and a recommendation, not a commitment.

The ask: a creator hands MVP one or more video files, MVP works out what they
are, and renders a finished video. The creator keeps control over CTA burns,
titles and similar.

## 1. The useful surprise: most of the machinery exists

This is not a new product. It is an assembly step on top of parts that already
run in production.

| Piece | Where | What it does today |
|---|---|---|
| Render service | `lib/youtube-ingest.ts` → self-hosted FFmpeg + libass | `/render-short` (trim, reframe to 9:16, burn word-by-word captions), `/render-cta`, `/render-dub`, `/clip`, `/audio` |
| CTA burn | `renderCta` | Lower third or end card, plain text or a designed PNG, timed to a window, free x/y placement as a fraction of the frame |
| Reframe | `/api/clip-factory/reframe` | Horizontal to vertical, centre crop or top/bottom split, creator picks |
| Transcription | `lib/shorts-transcribe.ts`, `ingestAudio` | Whisper with word-level timestamps, cached on the video row |
| Clip planning | `lib/shorts-planner.ts` | Haiku hotspot pass on long videos, then Sonnet picks the windows |
| Captions | `lib/shorts-captions.ts` | Verbatim word chunks, power-word emphasis, several styles. Pure functions, no LLM cost |
| Dubbing | `renderDub` | Replaces the audio track, time-stretched to match |
| Image compositing | `services/cloudinary` | Deal cards, story images, caption overlay on video |
| Queue pattern | `ig_burn_jobs` + `/api/cron/process-burn-jobs` | One job per tick, 300s budget, status on the row |
| Publish | TikTok, Instagram, YouTube | Direct post already wired |

So the honest position is that MVP can already trim, reframe, caption, dub,
burn a CTA and publish. What it cannot do is put more than one piece of footage
together.

## 2. The actual gap

Every render in the codebase is **one source in, one file out**. There is no
concept of a timeline. That single fact is what stops "here are my clips, make
me a video".

Missing, in order of difficulty:

1. **Assembly.** No concat, no transitions, no music bed, no title cards as
   segments. The render service takes one `videoUrl`.
2. **A shared plan object.** The planner returns clip windows for one video. A
   multi-file edit needs an edit decision list that both Claude and the creator
   can read and change.
3. **Multi-file understanding.** Transcription is per video and keyed to a
   YouTube row. Nothing reads keyframes, so a silent B-roll shot of a product is
   invisible to the planner today.
4. **A job model that survives.** Renders run inside a 300s serverless function.
   A three minute assembly with music and titles will not reliably fit.

## 3. Recommendation: an edit decision list, not an editor

Do not build a timeline UI. Creators who want one already have CapCut, and
competing there is a losing fight. The thing they cannot get elsewhere is a
first draft that already knows what the product is, what the hook should be, and
where the affiliate CTA belongs.

The shape:

```
files → per-file understanding → EDL (JSON) → creator adjusts → render → publish
```

**EDL as the contract.** One JSON document describing the finished video:
ordered segments with source file, in and out points, plus overlays (title,
caption, CTA, sticker) with their own time windows. Claude writes the first
draft. The creator edits a handful of fields. The renderer executes it. Both
sides read the same document, which is what keeps the AI honest: anything it
proposes is visible and editable before a frame is rendered.

**Understanding pass, per file.** Whisper for anything with speech, and a small
number of keyframes through a vision model for anything without. That yields, per
file, a sentence of description, a usable range, whether a person is speaking,
and whether the product is on screen. Cheap and cached. This is the step that
makes silent B-roll usable instead of ignored.

**Render.** Extend the existing ingest service with `/render-timeline` taking the
EDL. It already has FFmpeg and libass, which is everything needed for concat,
overlays and an audio bed. This is far cheaper than adopting Remotion, and it
keeps one render path rather than two.

**Queue.** Copy the `ig_burn_jobs` pattern exactly: a jobs table, a cron worker
claiming one row per tick, status and progress on the row, the UI polling. That
pattern is proven here and the storefront progress bars already show the UX.

## 4. Phasing

**Phase 1, template assembly.** Fixed structures, not free-form editing. Hook,
three product beats, CTA end card. The creator uploads footage, MVP transcribes
and describes, Claude fills the template, the creator adjusts titles and the CTA,
render. This is the version that ships and is genuinely useful, because an
affiliate review video is a solved format and the template can be a good one.

**Phase 2, control.** Per-segment reorder and trim, swap a clip, choose a music
bed, brand the titles from Brand Profile. Still the EDL, just more of it exposed.

**Phase 3, understanding.** Multi-file B-roll placement suggested from the
keyframe descriptions, silence and filler-word trimming, auto-hook selection from
the transcript. This is where it starts to feel like an editor rather than a
template filler.

## 5. What to be honest with users about

The category oversells badly. Two things worth saying plainly in the product:

- A first draft is a draft. It will be assembled competently and it will not have
  taste. Say so, and make adjusting it fast.
- Render takes minutes, not seconds. A single 60s vertical clip already takes 30
  to 90 seconds today. An assembled two minute video with music and titles will
  be several minutes. Show real progress, the way the storefront upload does now,
  rather than a spinner that looks stuck.

## 6. Cost notes

Transcription is per audio-minute and cached. The vision pass is a handful of
frames per file, so it is small. The planner input is the thing that grows: a
multi-file EDL prompt carries every file's transcript, which is the same problem
`clip-factory-plan.md` already identified and solved with a Haiku pre-pass. Reuse
that approach rather than rediscovering it.

Render compute is the real cost and it scales with output length and how many
overlay passes the filter graph needs. Doing the whole EDL in one FFmpeg pass,
rather than chaining one render per overlay, matters more than any model choice.

## 7. Open questions

- Where do uploads land, and what is the retention rule? `purge-shorts-sources`
  already exists for Shorts sources, and this needs the same policy decided up
  front rather than after storage costs appear.
- Music licensing. A bed makes assembled video far better and it cannot be
  arbitrary audio. Either a licensed pack or nothing.
- Does the render service scale horizontally today, or is it one box? A queue
  makes that visible fast.
