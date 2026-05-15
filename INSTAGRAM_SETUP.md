# Instagram fan-out setup

Instagram auto-publish is a **Pro plan** feature. Each user connects their
own Instagram Business or Creator account via OAuth (Instagram Login —
the newer 2024+ flow, not the old Facebook-Login-with-Pages path).

For each review, the user uploads a vertical 9:16 MP4 (stored in
Supabase Storage). MVP then publishes it as a **Reel** (auto-generated
SEO caption + 15-25 hashtags), a **Story** (video only — link sticker
added manually after, since Instagram doesn't expose link stickers via
API), or both.

---

## One-time platform setup (you do this once)

### 1. Meta app

You already have one: **MVP AFFILIATE** (App ID `1865193290845262`)
with the **Instagram API use case** added.

Inside Meta dashboard → MVP AFFILIATE → **Instagram** product, you'll
find your Instagram-specific app credentials:

- **Instagram app ID** — `1501578474956807` (this is `INSTAGRAM_APP_ID`)
- **Instagram app secret** — click **Show** to reveal (this is `INSTAGRAM_APP_SECRET`)

These are different from the parent Meta app id/secret.

### 2. OAuth redirect URI

In your Meta dashboard → Instagram → API setup with Instagram login →
**Step 4 (Set up Instagram business login)** → click **Set up**.

Add this redirect URI:
```
https://www.mvpaffiliate.io/api/auth/instagram/callback
```

Save.

### 3. Required permissions

Confirmed at **Standard Access**:
- `instagram_business_basic`
- `instagram_business_content_publish`

(Standard Access works for the app owner + Instagram Testers in
development mode. For production use on non-tester accounts, you need
**App Review** for `instagram_business_content_publish`.)

### 4. Add env vars

In Vercel → Settings → Environment Variables:

| Key | Value | Sensitive |
|---|---|---|
| `INSTAGRAM_APP_ID` | `1501578474956807` | OFF |
| `INSTAGRAM_APP_SECRET` | (from Meta dashboard, click Show) | ON |

In `.env.local` for local dev — same values.

### 5. Run the migration

In Supabase dashboard → SQL Editor, paste contents of:
`supabase/migrations/015_instagram_integration.sql`

That adds:
- `integrations.instagram_user_id`
- `integrations.instagram_username`
- `integrations.instagram_access_token`
- `integrations.instagram_token_expiry`
- `youtube_videos.instagram_video_url`
- `blog_posts.instagram_reel_id`
- `blog_posts.instagram_story_id`

### 6. Create the Supabase Storage bucket

In Supabase dashboard → **Storage** → **New bucket**:
- Name: `instagram-videos`
- Public bucket: **ON** (Instagram's CDN needs to fetch the video URL)
- File size limit: leave default

Or run the SQL directly in the SQL Editor:
```sql
insert into storage.buckets (id, name, public)
  values ('instagram-videos', 'instagram-videos', true)
  on conflict (id) do nothing;
```

### 7. Add the IG account you'll test with as an Instagram Tester

For development-mode testing (before App Review):

1. Meta dashboard → MVP AFFILIATE → **App Roles → Roles → Instagram Testers** → click Add
2. Paste the IG handle (e.g. `@gominplanet`)
3. On phone: open Instagram → Settings → Apps and Websites → Tester Invitations → Accept

The tester's IG account must be Business or Creator (not Personal).

### 8. RapidAPI (for "Fetch from YouTube" path)

The IG modal lets users either upload a vertical MP4 manually OR paste
a YouTube URL and we fetch the MP4 for them. The fetch path uses
RapidAPI because YouTube's official Data API never returns file bytes.

1. Sign up at https://rapidapi.com (free)
2. Subscribe to **youtube-media-downloader** by DataFanatic:
   https://rapidapi.com/DataFanatic/api/youtube-media-downloader
   - Basic plan (~$5/mo for 10k requests) is plenty
3. Copy the `X-RapidAPI-Key` from the playground
4. Vercel → Environment Variables → add:
   - Key: `RAPIDAPI_KEY` · Value: your key · Sensitive: ON · Production + Preview
5. Redeploy

ToS note: YouTube technically prohibits programmatic downloads, even of
your own content. RapidAPI providers operate in this gray area at their
own risk. We surface a confirmation checkbox in the UI ("I confirm this
is my own content") to put the legal responsibility on the user. If
Meta or YouTube ever flags it, removing the feature is a one-commit revert.

### 9. App Review (for production)

When you're ready to let non-tester users connect:
- Meta dashboard → MVP AFFILIATE → **Review** → submit `instagram_business_content_publish` for Advanced Access
- Required: screencast of the full flow, privacy policy URL, business verification (which you should already have from Facebook publishing)

---

## How users use it

The flow in MVP:

1. **Connect Instagram** (one-time per user) — in `/setup?tab=integrations` they click Connect Instagram → OAuth flow → return with their account linked
2. **Generate a review** in Studio (creates a blog post + WordPress publish)
3. **In `/content`**, click the **Instagram pill** on the review card
4. **Modal opens**:
   - Step 1: upload vertical 9:16 MP4 (we cap at 100MB)
   - Step 2: pick mode — Reel, Story, or Both
   - Step 3: click Publish
5. **Reels publish silently** with the generated caption + hashtags
6. **Stories publish** but Instagram doesn't expose the link sticker API,
   so MVP surfaces a post-publish prompt with the Geniuslink affiliate
   URL + a "Copy" button. User opens IG on phone → their Story →
   sticker icon → Link sticker → paste → done (5 seconds).

---

## Architecture notes (for future maintenance)

- **Token lifecycle**: Instagram long-lived tokens last 60 days. The
  publish route in `app/api/blog/instagram-post/route.ts` proactively
  refreshes any token within 7 days of expiry. If a user's token
  expires entirely, they have to re-authorize.
- **Caption generation**: uses `claude-haiku-4-5-20251001` with brand
  voice + product context. Strips URLs from Reel captions defensively
  (since they're not clickable and just clutter the post).
- **Story link**: re-extracts ASIN from YouTube title at publish time
  and re-wraps with Geniuslink. So affiliate link is always fresh, even
  if user later changes their Geniuslink API key.
- **Video storage**: public bucket `instagram-videos`, path
  `{user_id}/{video_db_id}.{ext}`. Public access is required because
  Instagram fetches the URL during the create-container step. Bucket
  rows are user-owned content (their own MP4s) so privacy concerns are
  minimal.
- **Why no Publish All integration**: Instagram requires per-post setup
  (video upload + Reel/Story choice) that doesn't fit the "click once,
  fan out everywhere" pattern. Users trigger it explicitly via the pill.

---

## Troubleshooting

- **"Insufficient developer role"** during OAuth → user isn't added as
  Instagram Tester, OR they didn't accept the invite in the IG app.
- **"Invalid platform app"** → user tried the wrong OAuth flow (likely
  clicked Generate Instagram Access Token in Graph API Explorer instead
  of going through the proper /api/auth/instagram redirect).
- **Container processing hangs** → Instagram is rate-limiting OR the
  video URL isn't publicly fetchable. Check the Supabase bucket is
  Public.
- **"Video aspect ratio not supported"** → vertical 9:16 required. User
  needs to re-export their MP4 at 1080x1920 (or any 9:16 dimensions).
- **Caption hashtags don't appear** → Instagram silently strips
  hashtags if >30. We cap at 25 to be safe.
- **Token refresh fails** → user's token already expired (more than 60
  days since last login). They have to reconnect via /setup.
