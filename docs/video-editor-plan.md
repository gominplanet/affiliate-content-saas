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

## Build on Descript's API, do not build an editor

Descript exposes an API that covers the entire editing half of this, and it is
better than anything we would write. Verified against their docs, September 2026:

| Endpoint | What it gives us |
|---|---|
| `POST /jobs/import/project_media` | Import from a URL or upload, transcribed automatically |
| `add_compositions` on that import | Multitrack sequences: several clips assembled into one timeline |
| `POST /jobs/agent` | Prompt-driven editing: remove filler words, cut a named range, add captions |
| `POST /jobs/publish` | Renders the composition and returns `share_url`, `download_url` (signed, time limited) and `download_url_expires_at` |
| `GET /jobs/{job_id}` | Poll a background job to completion |

That `download_url` is the piece that matters. It is a real rendered media file,
which means the finished video can be stored by MVP and handed to Launchpad
exactly like any other rendered video today.

**One contradiction worth recording.** Descript's marketing page still says
"direct media file exports are not supported yet. You'll need to do this manually
in Descript for now." Their API reference says publish returns a signed
`download_url`. The docs are the newer and more specific of the two, but this is
the single assumption the whole design rests on, so **verify it with one real
publish job before building anything on top of it.**

### What this changes

The two gaps in the previous version of this plan were a timeline renderer and
multi-file assembly. Descript supplies both. We do not build `/render-timeline`,
we do not maintain an FFmpeg filter graph for concat and overlays, and we do not
compete on cut quality with a company that has spent years on it.

### What stays ours

Everything Descript has no reason to know:

- **The product.** ASIN or link to title, image, price, and the commission data
  MVP already reads. Descript does not know what the video is selling.
- **Which B-roll goes where.** Descript can assemble a timeline we specify. It
  cannot know that the shot at 0:14 of the second file is the product close-up
  that belongs under the sentence about build quality. That needs the keyframe
  description pass, and it is the one piece of understanding still worth building.
- **The CTA and the thumbnail.** Already built, product-aware, ours.
- **Publishing.** Launchpad, YouTube, the storefront, Creator Connections. The
  reason a creator is here rather than in Descript alone.

### Pipeline

```
upload files + ASIN
      ↓
describe each file          (keyframes → what the shot contains)   ← ours
      ↓
plan the edit               (product + transcripts + descriptions)  ← ours
      ↓
import + compositions       (Descript)
      ↓
agent: cuts, filler, captions (Descript)
      ↓
publish → download_url      (Descript)
      ↓
store, CTA, thumbnail        ← ours
      ↓
download link + Launchpad    ← ours
```

### Risks to settle before committing

1. **The export.** Run one publish job end to end and confirm a real MP4 comes
   back. Everything depends on it, and their own marketing contradicts it.
2. **Whose account, and what it costs.** Usage draws from AI credits and media
   minutes on a Descript plan. Decide early whether MVP holds one account and
   absorbs per-minute cost, or each creator connects their own. This is a pricing
   decision, not a technical one, and it shapes the feature.
3. **Determinism.** `/jobs/agent` is prompt driven. Prompt-driven editing is
   convenient and it is not repeatable. Test whether the same input twice gives
   the same cut, and design the review step assuming it might not.
4. **Beta.** The API is in early access. Rate limits, stability and breaking
   changes are all live risks for something a paying creator depends on.

## Build order

**Phase 0: prove the export.** One import, one agent call, one publish, one MP4
downloaded. A day at most. Everything else is wasted if this does not work.

**Phase 1: cut a single talking head.** Upload one file plus the ASIN, import to
Descript, agent removes filler and flubs, publish, download link. No B-roll, no
titles. Ships on its own and is the hour creators want back.

**Phase 2: B-roll.** Multiple files, our keyframe description pass, our matching
of shot to sentence, assembled via `add_compositions`.

**Phase 3: titles and CTA.** Captions through the agent; the affiliate CTA end
card through `renderCta`, which is already product-aware and already ours.

**Phase 4: Launchpad handoff.** Small, and last: worthless until the output is
good.

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
