# Shorts Studio — video ingestion service (the "no upload" path)

This is the small always-on service that lets Shorts Studio work like vidIQ:
**select a video → Get clips**, no upload. It downloads the video from YouTube
with `yt-dlp`, uploads the MP4 to your Supabase Storage, and returns the public
URL. The main app then runs Whisper (transcript) + Cloudinary (render) on it.

It lives in its own folder because it **cannot** run on Vercel — it needs a
normal IP, `yt-dlp`/`ffmpeg` binaries, and a few minutes per video. Deploy it on
Railway, Fly.io, Render, or any Docker host.

## Why a separate service?

YouTube blocks datacenter/serverless IPs and the Data API doesn't hand you the
video file. vidIQ solves this with dedicated download infra; this is our
equivalent. Ownership is confirmed in the app UI before anything is fetched.

## Deploy

1. Deploy this folder as a Docker service (it has a `Dockerfile`).
   - **Railway:** New Project → Deploy from repo → set root to `ingest-service/`.
   - **Fly.io:** `fly launch` in this folder.
   - **Render:** New Web Service → Docker → root `ingest-service/`.
2. Set env vars on the service:
   | var | value |
   |---|---|
   | `SUPABASE_URL` | your Supabase project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase **service role** key (server-only!) |
   | `SUPABASE_BUCKET` | `instagram-videos` (the existing public bucket) |
   | `INGEST_SECRET` | any long random string (shared with the app) |
   | `MAX_SECONDS` | optional, default `7200` (2h cap) |
3. Confirm it's up: `GET https://<your-service>/health` → `{ "ok": true }`.

## Wire it to the app

Set these on the **Vercel** project (Production + Preview):

| var | value |
|---|---|
| `YOUTUBE_INGEST_URL` | `https://<your-service>` (no trailing slash) |
| `YOUTUBE_INGEST_SECRET` | the same `INGEST_SECRET` |

That's it. With `YOUTUBE_INGEST_URL` set, Shorts Studio shows **“Fetch this
video automatically — no upload.”** Without it, the feature falls back to the
manual upload (nothing breaks either way).

## Contract

```
POST /ingest        header  x-ingest-secret: <INGEST_SECRET>
  body  { "videoId": "<11-char youtube id>", "userId": "<uuid, optional>" }
  200   { "url": "https://…/…​.mp4", "durationSeconds": 634 }
  4xx/5xx { "error": "…" }
```

## Notes

- Downloads best MP4 ≤1080p (Shorts are 9:16, so higher res is wasted bytes).
- Rejects videos longer than `MAX_SECONDS`.
- The app only calls this after the creator confirms ownership, and only for
  Pro accounts.
- ToS: downloading YouTube videos is the creator's responsibility (they confirm
  ownership). Keep this service private (the `INGEST_SECRET` gate).
