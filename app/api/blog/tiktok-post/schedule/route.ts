/**
 * POST /api/blog/tiktok-post/schedule
 *
 * Queue a vertical video post (TikTok and/or Instagram Reel) to fire at a future
 * time. Inserts one scheduled_posts row per platform; the process-scheduled cron
 * resolves the 9:16 render from blog_post_id and Direct-Posts it (see
 * lib/tiktok-publish.ts / lib/instagram-publish.ts). Per-platform settings ride
 * in the row's `options` JSONB (migration 137).
 *
 * Body: {
 *   blogPostId: string
 *   scheduledAt: string            // ISO 8601, ≥30s in the future
 *   caption: string
 *   tiktok?: { privacyLevel, disableComment?, disableDuet?, disableStitch?,
 *              brandContentToggle?, brandOrganicToggle? }   // present → schedule TikTok
 *   instagram?: { mode?: 'reel' | 'story' | 'both' }        // present → schedule IG
 * }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsSocial, type Tier } from '@/lib/tier'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json() as {
      blogPostId?: string
      videoId?: string
      scheduledAt?: string
      caption?: string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tiktok?: Record<string, any>
      instagram?: { mode?: 'reel' | 'story' | 'both' }
    }
    const blogPostId = (body.blogPostId || '').trim()
    const videoId = (body.videoId || '').trim()
    const caption = (body.caption || '').slice(0, 2200)
    if (!blogPostId && !videoId) return NextResponse.json({ error: 'blogPostId or videoId required' }, { status: 400 })
    if (!body.tiktok && !body.instagram) return NextResponse.json({ error: 'Pick at least one platform.' }, { status: 400 })
    if (body.tiktok && !body.tiktok.privacyLevel) return NextResponse.json({ error: 'Pick a TikTok privacy option before scheduling.' }, { status: 400 })

    const when = new Date(body.scheduledAt || '')
    if (isNaN(when.getTime())) return NextResponse.json({ error: 'scheduledAt is not a valid timestamp' }, { status: 400 })
    if (when.getTime() <= Date.now() + 30_000) return NextResponse.json({ error: 'Pick a time at least a minute from now.' }, { status: 400 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { data: tierRow } = await sb.from('integrations').select('tier').eq('user_id', user.id).single()
    const tier = (tierRow?.tier as Tier) ?? 'trial'

    // Target must exist, be owned, and have a 9:16 render to schedule. A Short
    // (videoId) keys directly on youtube_videos; a blog post resolves through it.
    if (videoId) {
      const { data: v } = await sb
        .from('youtube_videos').select('instagram_video_url').eq('id', videoId).eq('user_id', user.id).maybeSingle()
      if (!v) return NextResponse.json({ error: 'Video not found' }, { status: 404 })
      if (!v.instagram_video_url) return NextResponse.json({ error: 'Add a vertical video before scheduling.' }, { status: 400 })
    } else {
      const { data: post } = await sb
        .from('blog_posts').select('id,youtube_videos(instagram_video_url)').eq('id', blogPostId).eq('user_id', user.id).maybeSingle()
      if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
      const yt = post.youtube_videos
      const ytRow = Array.isArray(yt) ? yt[0] : yt
      if (!ytRow?.instagram_video_url) return NextResponse.json({ error: 'Add a vertical video to this post before scheduling.' }, { status: 400 })
    }
    const targetCols = videoId ? { video_id: videoId } : { blog_post_id: blogPostId }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = []
    if (body.tiktok) {
      if (!tierAllowsSocial(tier, 'tiktok')) return NextResponse.json({ error: 'TikTok auto-publish is a Pro feature.' }, { status: 403 })
      rows.push({
        user_id: user.id, ...targetCols, platform: 'tiktok',
        scheduled_at: when.toISOString(), body_text: caption, status: 'pending',
        options: {
          privacyLevel: body.tiktok.privacyLevel,
          disableComment: !!body.tiktok.disableComment,
          disableDuet: !!body.tiktok.disableDuet,
          disableStitch: !!body.tiktok.disableStitch,
          brandContentToggle: !!body.tiktok.brandContentToggle,
          brandOrganicToggle: !!body.tiktok.brandOrganicToggle,
        },
      })
    }
    if (body.instagram) {
      if (!tierAllowsSocial(tier, 'instagram')) return NextResponse.json({ error: 'Instagram auto-publish is a Pro feature.' }, { status: 403 })
      rows.push({
        user_id: user.id, ...targetCols, platform: 'instagram',
        scheduled_at: when.toISOString(), body_text: caption, status: 'pending',
        options: { mode: body.instagram.mode || 'reel' },
      })
    }

    const { data: inserted, error: insertErr } = await sb
      .from('scheduled_posts').insert(rows).select('id,platform,scheduled_at')
    if (insertErr) {
      // A failed insert on the platform check / missing options column means the
      // operator hasn't run migration 137 yet — surface that clearly.
      const hint = /options|video_id|check constraint|scheduled_posts_platform|scheduled_posts_target|null value/i.test(insertErr.message)
        ? ' (run migrations 137 + 138 in Supabase first)'
        : ''
      return NextResponse.json({ error: insertErr.message + hint }, { status: 500 })
    }

    return NextResponse.json({ ok: true, scheduled: inserted, scheduledAt: when.toISOString() })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
