import { NextResponse } from 'next/server'
import { ImageResponse } from 'next/og'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tierAllowsSocial, type Tier } from '@/lib/tier'

/**
 * Compose a 1080×1350 (4:5) Instagram image from a horizontal YouTube
 * video's thumbnail + brand assets. We render it server-side with
 * @vercel/og's ImageResponse, upload the PNG to Supabase Storage's
 * `instagram-images` bucket, and persist the public URL on
 * `youtube_videos.instagram_image_url` so the publish route can fetch
 * it via Instagram's Content Publishing API.
 *
 * Design:
 *   - Background: brand primary_color, slight bottom gradient for contrast
 *   - Top strip: author_name (and logo when set)
 *   - Center: YouTube thumbnail at 960×540 with rounded corners
 *   - Below: video title in large bold white (clamped to 3 lines)
 *   - Bottom: "Watch the full review on YouTube →" CTA
 *
 * Pro-tier gated (matches the rest of the Instagram surface).
 */
export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Pro gate — tier lives on the integrations row in this codebase
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations').select('tier').eq('user_id', user.id).single()
  const tier = (intRow?.tier as Tier) ?? 'trial'
  if (!tierAllowsSocial(tier, 'instagram')) {
    return NextResponse.json({ error: 'Instagram image posts are a Pro feature.' }, { status: 403 })
  }

  const { videoDbId } = await request.json().catch(() => ({})) as { videoDbId?: string }
  if (!videoDbId) return NextResponse.json({ error: 'Missing videoDbId' }, { status: 400 })

  // Pull the YouTube video row (thumbnail + title)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: video, error: videoErr } = await (supabase as any)
    .from('youtube_videos')
    .select('id,youtube_video_id,title,thumbnail_url')
    .eq('id', videoDbId)
    .eq('user_id', user.id)
    .single()
  if (videoErr || !video) return NextResponse.json({ error: 'Video not found' }, { status: 404 })

  // Pull the blog post's title + excerpt for the composite. We prefer the
  // blog post's polished title over the raw YouTube title (which often
  // contains the ASIN, brand tag, etc) and use the post's excerpt as the
  // tagline below the thumbnail.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: blogPost } = await (supabase as any)
    .from('blog_posts')
    .select('title,excerpt')
    .eq('video_id', videoDbId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Brand assets
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brand } = await (supabase as any)
    .from('brand_profiles')
    .select('author_name,logo_url,primary_color,secondary_color')
    .eq('user_id', user.id)
    .single()

  const primaryColor: string = brand?.primary_color || '#0071e3'
  const authorName: string = brand?.author_name || ''
  const logoUrl: string | null = brand?.logo_url || null
  const title: string = (blogPost?.title as string) || video.title || ''
  // Trim excerpt to one phrase: first sentence, capped at ~110 chars
  const rawExcerpt: string = (blogPost?.excerpt as string) || ''
  const excerpt: string = trimToOnePhrase(rawExcerpt, 110)
  const thumbnailUrl: string = video.thumbnail_url || ''

  if (!thumbnailUrl) {
    return NextResponse.json({ error: 'Video has no thumbnail to compose from' }, { status: 400 })
  }

  // Pick the best available thumbnail size. maxresdefault is true 16:9
  // 1280×720 but doesn't exist for every video — YouTube serves a generic
  // placeholder when it's missing. HEAD-check it, fall back to whatever
  // the DB already has (typically mqdefault 320×180, also 16:9). hqdefault
  // and sddefault are 4:3 so we explicitly avoid them.
  const youtubeVideoId = (video.youtube_video_id as string) || ''
  const candidate = youtubeVideoId ? `https://i.ytimg.com/vi/${youtubeVideoId}/maxresdefault.jpg` : ''
  let thumbToUse = thumbnailUrl
  if (candidate) {
    try {
      const head = await fetch(candidate, { method: 'HEAD' })
      // Real thumbs are usually 30-200kb. YouTube's "missing" placeholder
      // is < 2kb. Filter out the placeholder via Content-Length.
      const len = parseInt(head.headers.get('content-length') ?? '0', 10)
      if (head.ok && len > 5000) thumbToUse = candidate
    } catch { /* keep DB url */ }
  }

  // Title font size adapts to length to keep things proportional
  const titleSize = title.length > 90 ? 56 : title.length > 60 ? 64 : 72

  const designProps = { title, titleSize, excerpt, thumbToUse, primaryColor, authorName, logoUrl }

  let feedImage: ImageResponse
  let storyImage: ImageResponse
  try {
    feedImage = new ImageResponse(<Composite {...designProps} format="feed" />, { width: 1080, height: 1350 })
    storyImage = new ImageResponse(<Composite {...designProps} format="story" />, { width: 1080, height: 1920 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'render failed'
    return NextResponse.json({ error: `Image render failed: ${msg}` }, { status: 500 })
  }

  const [feedBytes, storyBytes] = await Promise.all([
    feedImage.arrayBuffer().then(b => new Uint8Array(b)),
    storyImage.arrayBuffer().then(b => new Uint8Array(b)),
  ])

  // Upload both to the public instagram-images bucket via admin client
  const admin = createAdminClient()
  const feedPath = `${user.id}/${videoDbId}.png`
  const storyPath = `${user.id}/${videoDbId}-story.png`

  const uploads = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.storage as any).from('instagram-images').upload(feedPath, feedBytes, {
      contentType: 'image/png', cacheControl: '3600', upsert: true,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.storage as any).from('instagram-images').upload(storyPath, storyBytes, {
      contentType: 'image/png', cacheControl: '3600', upsert: true,
    }),
  ])
  const upErr = uploads.find(u => u.error)?.error
  if (upErr) {
    return NextResponse.json({ error: `Storage upload failed: ${upErr.message}` }, { status: 500 })
  }

  const feedUrl = admin.storage.from('instagram-images').getPublicUrl(feedPath).data.publicUrl
  const storyUrl = admin.storage.from('instagram-images').getPublicUrl(storyPath).data.publicUrl

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (supabase as any)
    .from('youtube_videos')
    .update({ instagram_image_url: feedUrl, instagram_story_image_url: storyUrl })
    .eq('id', videoDbId)
  if (updateErr) {
    return NextResponse.json({ error: `DB update failed: ${updateErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, instagramImageUrl: feedUrl, instagramStoryImageUrl: storyUrl })
}

/**
 * Shared layout for both the 4:5 feed image (1080×1350) and the 9:16
 * story image (1080×1920). The Story variant has more vertical room and
 * heavier top/bottom padding to clear Instagram's UI overlays:
 *
 *   ┌─────────────────┐
 *   │ IG header area  │  ~210px overlay
 *   ├─────────────────┤
 *   │   TITLE         │
 *   │                 │
 *   │   [THUMBNAIL]   │
 *   │                 │
 *   │   EXCERPT       │
 *   │                 │
 *   │ AUTHOR ─ FULL → │
 *   ├─────────────────┤
 *   │ IG bottom UI    │  ~250px overlay (reply, sticker zone)
 *   └─────────────────┘
 */
function Composite(props: {
  title: string
  titleSize: number
  excerpt: string
  thumbToUse: string
  primaryColor: string
  authorName: string
  logoUrl: string | null
  format: 'feed' | 'story'
}) {
  const { title, titleSize, excerpt, thumbToUse, primaryColor, authorName, logoUrl, format } = props
  const isStory = format === 'story'
  const canvasHeight = isStory ? 1920 : 1350
  const paddingTop = isStory ? 240 : 70   // story: clear IG header
  const paddingBottom = isStory ? 280 : 60  // story: clear IG reply/sticker zone
  const horizontalPadding = 70

  return (
    <div
      style={{
        width: '1080px',
        height: `${canvasHeight}px`,
        display: 'flex',
        flexDirection: 'column',
        background: `linear-gradient(180deg, ${primaryColor} 0%, ${primaryColor} 70%, ${darken(primaryColor, 0.35)} 100%)`,
        fontFamily: 'sans-serif',
        color: 'white',
        padding: `${paddingTop}px ${horizontalPadding}px ${paddingBottom}px ${horizontalPadding}px`,
      }}
    >
      {/* TITLE */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        flex: '0 0 auto',
        minHeight: '220px',
      }}>
        <span style={{
          fontSize: `${titleSize}px`,
          fontWeight: 800,
          lineHeight: 1.08,
          letterSpacing: '-1.5px',
          color: 'white',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>{title}</span>
      </div>

      {/* THUMBNAIL */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        margin: `${isStory ? 60 : 40}px 0`,
      }}>
        <div style={{
          width: '940px',
          height: '529px',
          borderRadius: '24px',
          overflow: 'hidden',
          display: 'flex',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbToUse} alt="" width={940} height={529} style={{ width: '940px', height: '529px', objectFit: 'cover' }} />
        </div>
      </div>

      {/* EXCERPT */}
      {excerpt ? (
        <div style={{ display: 'flex', flex: 1, alignItems: 'flex-start' }}>
          <span style={{
            fontSize: isStory ? '38px' : '32px',
            fontWeight: 500,
            lineHeight: 1.35,
            color: 'rgba(255,255,255,0.92)',
            fontStyle: 'italic',
            display: '-webkit-box',
            WebkitLineClamp: isStory ? 4 : 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>{excerpt}</span>
        </div>
      ) : <div style={{ display: 'flex', flex: 1 }} />}

      {/* AUTHOR / FULL REVIEW STRIP */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: '30px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" width={56} height={56} style={{ borderRadius: '10px', objectFit: 'contain' }} />
          ) : null}
          {authorName ? (
            <span style={{ fontSize: '26px', fontWeight: 700, color: 'white' }}>{authorName}</span>
          ) : null}
        </div>
        <span style={{
          fontSize: '22px',
          fontWeight: 700,
          padding: '10px 22px',
          borderRadius: '999px',
          background: 'rgba(255,255,255,0.18)',
          color: 'white',
          letterSpacing: '0.5px',
        }}>FULL REVIEW →</span>
      </div>
    </div>
  )
}

/**
 * Trim a blog excerpt down to a single tagline.
 * - Strips HTML
 * - Takes the first sentence (split on '.', '!', '?')
 * - Truncates to `maxChars` at the last word boundary
 */
function trimToOnePhrase(raw: string, maxChars: number): string {
  if (!raw) return ''
  const stripped = raw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  // First sentence end (with min length to skip false-positive periods like "U.S.")
  const match = stripped.match(/^([^.!?]{15,}?[.!?])/)
  let phrase = match ? match[1].trim() : stripped
  if (phrase.length > maxChars) {
    const cut = phrase.slice(0, maxChars)
    const lastSpace = cut.lastIndexOf(' ')
    phrase = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut) + '…'
  }
  return phrase
}

/** Darken a hex color by `amount` (0–1). Returns hex. */
function darken(hex: string, amount: number): string {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) return hex
  const r = Math.max(0, Math.floor(parseInt(m[1], 16) * (1 - amount)))
  const g = Math.max(0, Math.floor(parseInt(m[2], 16) * (1 - amount)))
  const b = Math.max(0, Math.floor(parseInt(m[3], 16) * (1 - amount)))
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')
}
