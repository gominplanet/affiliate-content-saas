// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/blog/reattach-thumbnails
//
// Heals published posts that ended up WITHOUT a featured image — re-uploads the
// YouTube thumbnail (or the creator's custom blog hero) and sets it as the WP
// featured_media. This is the recovery path for the case where a host WAF /
// security plugin was blocking /wp/v2/media uploads (or the connected WP user
// lost the upload_files capability) at generation time, so posts published
// thumbnail-less (see blog/generate → `thumbnailBlocked`). Once the host is
// unblocked, this backfills every gap in one pass.
//
// Idempotent + cheap: it first reads each post's live featured_media and SKIPS
// any that already have one, so it's safe to run repeatedly and does almost no
// work on a healthy site. Sets featured_media ONLY (never resends status/date/
// content), so it can't disturb scheduled ('future') posts.
//
// Body: { siteId?: string|null, limit?: number }  (limit default 40, max 60)
// Returns: { ok, checked, fixed, alreadyOk, stillBlocked, failures[] }
//   stillBlocked > 0 ⇒ the host is likely STILL rejecting media uploads; fix
//   the WAF/permission first, then re-run.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'

export const maxDuration = 300

export async function POST(req: Request) {
  const supabase = await createServerClient()
  // VA/agency-aware: resources belong to ownerId; the caller may be a VA.
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  let body: { siteId?: string | null; limit?: number } = {}
  try { body = await req.json() } catch { /* empty body is fine */ }
  const siteId = body.siteId ?? null
  const limit = Math.min(Math.max(Number(body.limit) || 40, 1), 60)

  const site = await getWordPressCredentials(supabase, ownerId, siteId)
  if (!site) return NextResponse.json({ error: 'No WordPress site connected.' }, { status: 400 })
  const wpService = createWordPressService(
    site.wordpress_url,
    site.wordpress_username,
    site.wordpress_app_password,
    site.wordpress_api_token || undefined,
  )

  // Recent published posts with a WP id + a source video (so there's a YT
  // thumbnail to attach). Scoped to the target site when multi-site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from('blog_posts')
    .select('id, title, wordpress_post_id, video_id, youtube_videos(youtube_video_id, blog_thumbnail_url)')
    .eq('user_id', ownerId)
    .eq('status', 'published')
    .not('wordpress_post_id', 'is', null)
    .not('video_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (siteId) q = q.eq('wordpress_site_id', siteId)
  const { data: posts, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const base = site.wordpress_url.replace(/\/+$/, '')
  let checked = 0, fixed = 0, alreadyOk = 0, stillBlocked = 0
  const failures: Array<{ wpPostId: number; title: string; reason: string }> = []
  // Keep the thumbnail_blocked marker (migration 177) honest so the SEO banner +
  // admin alert reflect reality: clear it on posts that now have a thumbnail,
  // set it on posts still being rejected.
  const nowFixedIds: number[] = []
  const stillBlockedIds: number[] = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of (posts ?? []) as any[]) {
    const wpId = p.wordpress_post_id as number
    const ytId = (p.youtube_videos?.youtube_video_id as string) || ''
    const customThumb = (p.youtube_videos?.blog_thumbnail_url as string | null)?.trim() || null
    if (!wpId || (!ytId && !customThumb)) continue
    checked++
    try {
      // Skip posts that already have a featured image — idempotent + cheap.
      const res = await fetch(`${base}/wp-json/wp/v2/posts/${wpId}?_fields=featured_media`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
      })
      if (res.ok) {
        const j = (await res.json()) as { featured_media?: number }
        if (j.featured_media && j.featured_media > 0) { alreadyOk++; nowFixedIds.push(wpId); continue }
      }
      // Upload the hero (custom blog thumb wins, else the YT thumb with a
      // maxres→hqdefault fallback), then attach it as featured_media ONLY.
      let media
      if (customThumb) {
        media = await wpService.uploadImageFromUrl(customThumb, `${ytId || wpId}-blogthumb.jpg`)
      } else {
        try {
          media = await wpService.uploadImageFromUrl(`https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`, `${ytId}.jpg`)
        } catch {
          media = await wpService.uploadImageFromUrl(`https://img.youtube.com/vi/${ytId}/hqdefault.jpg`, `${ytId}.jpg`)
        }
      }
      await wpService.updatePost(wpId, { featured_media: media.id })
      fixed++
      nowFixedIds.push(wpId)
    } catch (err) {
      // Almost always the host still blocking the media upload.
      stillBlocked++
      stillBlockedIds.push(wpId)
      if (failures.length < 10) {
        failures.push({
          wpPostId: wpId,
          title: String(p.title || '').slice(0, 60),
          reason: (err instanceof Error ? err.message : String(err)).slice(0, 160),
        })
      }
    }
  }

  // Sync the durable marker. Best-effort + column-drift-safe (177 may not be
  // applied yet) — never fail the heal on a marker write.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  if (nowFixedIds.length) {
    try { await sb.from('blog_posts').update({ thumbnail_blocked: false }).eq('user_id', ownerId).in('wordpress_post_id', nowFixedIds) } catch { /* non-fatal / column may not exist */ }
  }
  if (stillBlockedIds.length) {
    try { await sb.from('blog_posts').update({ thumbnail_blocked: true }).eq('user_id', ownerId).in('wordpress_post_id', stillBlockedIds) } catch { /* non-fatal */ }
  }

  return NextResponse.json({ ok: true, checked, fixed, alreadyOk, stillBlocked, failures })
}
