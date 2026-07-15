// Shared thumbnail-heal core — used by BOTH the self-serve endpoint
// (/api/blog/reattach-thumbnails) and the scheduled auto-heal cron
// (/api/cron/heal-thumbnails).
//
// Re-uploads the YouTube thumbnail (or the creator's custom blog hero) and
// sets it as the WP featured_media for any published post currently missing
// one — the recovery path for posts that published thumbnail-less because the
// host was rejecting media uploads (see support_thumbnail_upload_blocked).
//
// Idempotent + cheap: reads each post's live featured_media first and SKIPS any
// that already have one. Sets featured_media ONLY (never resends status/date/
// content), so it can't disturb scheduled posts. Includes a circuit breaker so
// a site that's STILL blocking uploads is only poked a few times, not hammered.

import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'

export interface ReattachResult {
  ok: boolean
  checked: number
  fixed: number
  alreadyOk: number
  stillBlocked: number
  failures: Array<{ wpPostId: number; title: string; reason: string }>
  error?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function reattachThumbnailsForOwner(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ownerId: string,
  opts: { siteId?: string | null; limit?: number } = {},
): Promise<ReattachResult> {
  const empty = (over: Partial<ReattachResult>): ReattachResult =>
    ({ ok: true, checked: 0, fixed: 0, alreadyOk: 0, stillBlocked: 0, failures: [], ...over })

  const siteId = opts.siteId ?? null
  const limit = Math.min(Math.max(Number(opts.limit) || 40, 1), 60)

  const site = await getWordPressCredentials(supabase, ownerId, siteId)
  if (!site) return empty({ ok: false, error: 'No WordPress site connected.' })
  const wpService = createWordPressService(
    site.wordpress_url,
    site.wordpress_username,
    site.wordpress_app_password,
    site.wordpress_api_token || undefined,
  )

  let q = supabase
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
  if (error) return empty({ ok: false, error: error.message })

  const base = site.wordpress_url.replace(/\/+$/, '')
  let checked = 0, fixed = 0, alreadyOk = 0, stillBlocked = 0
  const failures: ReattachResult['failures'] = []
  const nowFixedIds: number[] = []
  const stillBlockedIds: number[] = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of (posts ?? []) as any[]) {
    // Circuit breaker: if the first few uploads all failed and NOTHING has
    // landed, the host is still rejecting media — stop poking it this run.
    if (stillBlocked >= 3 && fixed === 0 && alreadyOk === 0) break

    const wpId = p.wordpress_post_id as number
    const ytId = (p.youtube_videos?.youtube_video_id as string) || ''
    const customThumb = (p.youtube_videos?.blog_thumbnail_url as string | null)?.trim() || null
    if (!wpId || (!ytId && !customThumb)) continue
    checked++
    try {
      const res = await fetch(`${base}/wp-json/wp/v2/posts/${wpId}?_fields=featured_media`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
      })
      if (res.ok) {
        const j = (await res.json()) as { featured_media?: number }
        if (j.featured_media && j.featured_media > 0) { alreadyOk++; nowFixedIds.push(wpId); continue }
      }
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

  // Keep the thumbnail_blocked marker (migration 177) honest. Best-effort +
  // column-drift-safe (177 may not be applied) — never fail the heal on it.
  if (nowFixedIds.length) {
    try { await supabase.from('blog_posts').update({ thumbnail_blocked: false }).eq('user_id', ownerId).in('wordpress_post_id', nowFixedIds) } catch { /* non-fatal */ }
  }
  if (stillBlockedIds.length) {
    try { await supabase.from('blog_posts').update({ thumbnail_blocked: true }).eq('user_id', ownerId).in('wordpress_post_id', stillBlockedIds) } catch { /* non-fatal */ }
  }

  return { ok: true, checked, fixed, alreadyOk, stillBlocked, failures }
}
