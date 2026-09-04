# Auto Edit: raw footage in, finished video out

Planning doc. Nothing here is built yet.

## The product, as specified

1. The creator shoots a talking-head video and maybe some B-roll, then uploads
   every file to MVP in one go.
2. They paste the ASIN or product link the video is about.
3. MVP ingests the files. An agent cuts them: removes the mistakes, drops B-roll
   in where it fits the words being said, adds titles if the creator wants them.
4. The creator gets a download link, and the same video can be pushed straight
   into Launchpad.

Everything below serves that, in that order.

## What already exists

This is an assembly step on top of production machinery, not a new stack.

| Piece | Where | What it does today |
|---|---|---|
| Render service | `lib/youtube-ingest.ts` → self-hosted FFmpeg + libass | `/render-short` (trim, reframe, burn word captions), `/render-cta`, `/render-dub`, `/clip`, `/audio` |
| Transcription | `lib/shorts-transcribe.ts`, `ingestAudio` | Whisper, **word-level timestamps**, cached |
| Clip planning | `lib/shorts-planner.ts` | Haiku hotspot pass on long input, then Sonnet picks windows |
| Overlays | `renderCta` | Text or designed PNG, timed, positioned anywhere in the frame |
| Product lookup | `services/amazon`, `lib/asin.ts` | ASIN or link to title, image, price |
| Job queue | `ig_burn_jobs` + `/api/cron/process-burn-jobs` | One job per tick, status on the row, UI polls |
| Launchpad handoff | `app/(dashboard)/launchpad/page.tsx` | Already keyed on `renderedUrl` + `asin` + `durationSec` + title |

Two gaps, and only two. Every render is **one source in, one file out**, so there
is no way to join clips. And nothing looks at a video that has no speech, so
silent B-roll is invisible to any planner.

## Pipeline

```
upload files + ASIN
      ↓
understand each file        (per file, cached)
      ↓
agent writes an EDL         (one JSON document)
      ↓
creator adjusts             (titles, keep/cut, CTA)
      ↓
render                      (one FFmpeg pass)
      ↓
download link + Launchpad
```

### Understand

Per file, once, cached on the row.

**Files with speech.** Whisper with word-level timestamps, which MVP already
produces. That transcript is what makes cutting mistakes possible.

**Files without speech, and B-roll generally.** A handful of keyframes through a
vision model, returning one sentence of what the shot contains, whether the
product is on screen, and whether it is usable (not a black frame, not a shaky
pan). This is the step MVP has never had, and it is what makes "insert B-roll
that makes sense in context" a real feature rather than random insertion.

**The product.** ASIN or link resolves to title, image and price, and that goes
into the agent's context. It is what lets a title card name the product properly
and the agent recognise when the speaker is talking about a specific feature.

### The agent

Input: every transcript with timings, every B-roll description, the product.
Output: an **edit decision list**, one JSON document. Ordered segments with the
source file and in/out points, plus overlays with their own time windows.

What it decides:

**Cuts.** Retakes are the valuable one and they are findable: the same sentence
said twice in a row means the second is the keeper. Also false starts, long
silences, and filler runs. All of these fall out of a word-level transcript, so
the agent is reasoning over text, not video, which keeps it cheap and reviewable.

**B-roll placement.** Match a B-roll description to the moment the words are about
that thing, and cut to it for a few seconds. The transcript gives the moment, the
vision description gives the match.

**Titles.** Optional, off by default. A title card at the opening and a lower
third when a new point starts, worded from the transcript and the product name.

Everything it proposes is in a document the creator reads before a frame is
rendered. That is deliberate: it is what stops an "AI editor" from being a black
box that either delights or ruins, with no middle.

### Render

Add `/render-timeline` to the ingest service, taking the EDL. It already has
FFmpeg and libass, which covers concat, overlays and an audio bed. One endpoint,
one pass. Chaining a render per overlay would multiply both cost and time.

This will not fit in a 300s serverless function, so it needs the `ig_burn_jobs`
pattern: a jobs table, a cron worker claiming one row per tick, progress on the
row, the UI polling. That pattern is proven here and the storefront progress bars
already show the right UX for a long job.

### Output

A download link, and a **Send to Launchpad** button. Launchpad is already keyed on
a video URL plus ASIN, duration and title, all of which this pipeline has by the
time it finishes, so the handoff is a seam that already exists rather than new
integration work.

## Build order

**Phase 1: cut the mistakes.** One talking-head file, no B-roll. Upload,
transcribe, agent proposes cuts, creator sees the list and toggles any of them,
render the joined result. This alone is the thing creators hate doing, it needs
only `/render-timeline` plus the agent, and it is worth shipping on its own.

**Phase 2: B-roll.** Multiple files, the vision pass, contextual insertion.

**Phase 3: titles and CTA.** Title card, lower thirds, the affiliate CTA end card
burned from the product. Most of this already exists in `renderCta` and mainly
needs wiring into the EDL.

**Phase 4: Launchpad handoff.** Small, and deliberately last: it is worthless
until the output is good.

## Honest limits, to state in the product

- **A first draft is a draft.** It will be assembled competently and it will not
  have taste. Say so, and make the adjust step fast.
- **Minutes, not seconds.** A single 60s vertical clip takes 30 to 90 seconds
  today. A multi-clip assembly will be several minutes. Show real progress, not a
  spinner.
- **Cuts are proposals.** Show the creator what is being removed and let them put
  any of it back. An editor that silently deletes a good take is worse than no
  editor.

## Open questions

- Upload size and retention. `purge-shorts-sources` exists for Shorts sources and
  this needs the same policy decided up front, not after the storage bill.
- Music licensing. A bed makes assembled video noticeably better and cannot be
  arbitrary audio.
- Does the render box scale horizontally? A queue makes the answer visible fast.
- Vertical, horizontal, or both? Launchpad wants vertical, a download link
  probably wants whatever they shot. Cheap to support both, worth deciding early
  since it affects the EDL.
