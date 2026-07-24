# Shorts Studio — long video → captioned vertical Shorts

The blog generator turns a video into an article. **Shorts Studio** turns the
same long-form video into a set of 15–30s vertical Shorts with burned-in
subtitles. It's the "video → everything" engine applied to short-form.

## Two stages (plan, then render)

1. **Plan — the brain (no video file needed).** Reads the video's *timestamped*
   transcript and has Claude pick the strongest self-contained moments. For each
   it returns a hook, a caption, hashtags, a virality score, and the **verbatim**
   subtitle timeline. Runs on the transcript alone, so it works for any synced
   video instantly. → `POST /api/youtube/shorts/plan`

2. **Render — the factory.** For a picked clip, Cloudinary trims the window,
   reframes it to 1080×1920 (content-aware crop), and burns the subtitles as
   time-boxed text layers. → `POST /api/youtube/shorts/render`

Subtitles are lifted **word-for-word from the transcript** (never written by the
LLM) — the same no-fabrication guarantee the blog engine is built on. A Short can
only ever say what the creator actually said on camera.

## The video-file rule

We **never** server-pull the raw video from YouTube (YouTube ToS) — the same
rule the Instagram burner follows. The source MP4 is uploaded once by the creator
(browser → Supabase Storage `instagram-videos` bucket) and stored on
`youtube_videos.source_video_url`, kept separate from `instagram_video_url` (a
finished vertical Short). The one-time Cloudinary upload of that source is cached
on `youtube_videos.cloudinary_source_id` so rendering N clips only uploads once.

Planning needs no file; rendering prompts for the upload if it's missing.

## Code map

| Piece | File |
|---|---|
| Shared types | `lib/shorts-types.ts` |
| Timestamped transcript (+ ms/seconds unit detection) | `lib/shorts-transcript.ts` |
| Clip planner (Claude) | `lib/shorts-planner.ts` |
| Caption math (clip-relative chunks / SRT) | `lib/shorts-captions.ts` |
| DB-row → client mapper | `lib/shorts-row.ts` |
| Cloudinary render | `services/cloudinary/index.ts` → `renderVerticalShort()` |
| API | `app/api/youtube/shorts/{plan,render}/route.ts`, `.../shorts/route.ts` |
| UI | `components/content/ShortsStudioModal.tsx` (opened from "Make Shorts" on the Content page) |
| Upload | `components/ShortVideoUpload.tsx` (generalised with `targetColumn`) |
| Schema | `supabase/migrations/178_youtube_shorts.sql` |
| Tests | `scripts/test-shorts-captions.ts` (`npm run test:shorts`, wired into build) |

## Gating

Pro-only (video-processing feature, matches the Instagram burner). Planning's AI
cost is bounded by the per-account monthly spend ceiling (`spendGate`); rendering
is pure Cloudinary (off the AI quota).

## Known follow-up

`renderVerticalShort` assumes Cloudinary overlay `start_offset`/`end_offset` are
relative to the *trimmed* clip (standard chained-transform behaviour). Validate
with one real render; subtitle drift there is the only place to check. A future
upgrade path is word-level karaoke captions (Cloudinary `l_subtitles` or an SRT
raw asset) instead of the current phrase-level time-boxed text layers.
