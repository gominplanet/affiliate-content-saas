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

import { credsForPost } from '@/lib/post-site'
import { createWordPressService } from '@/services/wordpress'
import { uploadVideoThumbnail } from '@/lib/video-thumbnail-upload'

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
  /** onlyKnownMissing: kept for callers. Every mode now uploads only where
   *  WordPress SAID the post has no image. */
  opts: { siteId?: string | null; limit?: number; onlyKnownMissing?: boolean } = {},
): Promise<ReattachResult> {
  const empty = (over: Partial<ReattachResult>): ReattachResult =>
    ({ ok: true, checked: 0, fixed: 0, alreadyOk: 0, stillBlocked: 0, failures: [], ...over })

  const siteId = opts.siteId ?? null
  const limit = Math.min(Math.max(Number(opts.limit) || 40, 1), 60)

  // THE POSTS: every one still flagged first, then the newest. The newest
  // forty alone could leave an older flagged post out of reach for good.
  const base = () => {
    let q = supabase
      .from('blog_posts')
      // select('*') for the post's own columns, NOT a named list. hero_source_url
      // arrives in migration 336 and PostgREST rejects the WHOLE statement when
      // one named column is missing, so naming it would turn "336 not applied
      // yet" into "the heal stops running for everybody".
      .select('*, youtube_videos(youtube_video_id, blog_thumbnail_url, thumbnail_url)')
      .eq('user_id', ownerId)
      .eq('status', 'published')
      .not('wordpress_post_id', 'is', null)
    if (siteId) q = q.eq('wordpress_site_id', siteId)
    return q
  }
  const [flagged, recent] = await Promise.all([
    base().eq('thumbnail_blocked', true).order('created_at', { ascending: false }).limit(limit),
    base().order('created_at', { ascending: false }).limit(limit),
  ])
  if (recent.error) return empty({ ok: false, error: recent.error.message })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const posts: any[] = []
  const seenPost = new Set<string>()
  for (const p of [...(flagged.error ? [] : flagged.data ?? []), ...(recent.data ?? [])]) {
    if (seenPost.has(p.id) || posts.length >= limit) continue
    seenPost.add(p.id); posts.push(p)
  }

  // EACH POST ON ITS OWN SITE. This used to take the default site's login for
  // every post, so a post on a creator's second site was read and written by
  // its number on the first one: usually a 404, and an image uploaded for
  // nothing, but post #1355 existed on both, and only the broken probe kept
  // it from getting another site's thumbnail. credsForPost picks the site by
  // the post's own address; a post whose site cannot be named is skipped.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groups = new Map<string, { site: any; posts: any[] }>()
  let anySite = false
  for (const p of posts) {
    const site = await credsForPost(supabase, ownerId, p).catch(() => null)
    if (!site) continue
    anySite = true
    const key = site.wordpress_url
    if (!groups.has(key)) groups.set(key, { site, posts: [] })
    groups.get(key)!.posts.push(p)
  }
  if (!anySite && posts.length) return empty({ ok: false, error: 'No WordPress site connected.' })

  let checked = 0, fixed = 0, alreadyOk = 0, stillBlocked = 0
  const failures: ReattachResult['failures'] = []
  const nowFixedIds: string[] = []
  const stillBlockedIds: string[] = []

  for (const { site, posts: sitePosts } of groups.values()) {
    const wpService = createWordPressService(
      site.wordpress_url,
      site.wordpress_username,
      site.wordpress_app_password,
      site.wordpress_api_token || undefined,
    )
    // Which posts already have a featured image, in one LOGGED-IN read per
    // site (wpService.getFeaturedMediaMany).
    //
    // THIS WAS A LOGGED-OUT FETCH WITH status=any, which WordPress refuses
    // (400 rest_forbidden_status). Every post came back "unknown", unknown fell
    // through to an upload, and the cron re-uploaded the thumbnail of the newest
    // forty posts every six hours whether or not they had one: a single YouTube
    // thumbnail was in one creator's media library 65 times, about two thousand
    // copies in all. The same failure made the "recent posts" sweep heal
    // nothing, because it skips unknowns, so a post that really had no image
    // stayed that way until the flagged sweep happened to re-upload it.
    //
    // NOW: a post WordPress did not answer for is skipped, in every mode. Not
    // knowing is never a reason to upload.
    const wpIds = sitePosts.map(p => p.wordpress_post_id).filter((n): n is number => typeof n === 'number' && n > 0)
    const featuredById = wpIds.length ? await wpService.getFeaturedMediaMany(wpIds) : new Map<number, number>()
    let siteFixed = 0, siteOk = 0, siteBlocked = 0

    for (const p of sitePosts) {
      // Circuit breaker, per site: if the first few uploads all failed and
      // NOTHING has landed, this host is still rejecting media.
      if (siteBlocked >= 3 && siteFixed === 0 && siteOk === 0) break

      const wpId = p.wordpress_post_id as number
      const ytId = (p.youtube_videos?.youtube_video_id as string) || ''
      const customThumb = (p.youtube_videos?.blog_thumbnail_url as string | null)?.trim() || null
      // The third source (migration 336). Both of the others come from a source
      // VIDEO, so a post written from a link had neither and was skipped here
      // forever — which would have turned the flag into a number that only ever
      // goes up.
      const heroSource = (p.hero_source_url as string | null)?.trim() || null
      if (!wpId || (!ytId && !customThumb && !heroSource)) continue
      checked++
      try {
        // Already has a featured image: nothing to do. Not read (post gone, or
        // WordPress did not answer): skipped, never uploaded over.
        const existingMedia = featuredById.get(wpId)
        if (existingMedia && existingMedia > 0) { alreadyOk++; siteOk++; nowFixedIds.push(p.id); continue }
        if (existingMedia === undefined) { checked--; continue }
        let media
        if (!ytId && customThumb) {
          media = await wpService.uploadImageFromUrl(customThumb, `${wpId}-blogthumb.jpg`)
        } else if (!ytId && heroSource) {
          // A link-written post. Its product photo is the only image it ever had.
          media = await wpService.uploadImageFromUrl(heroSource, `${wpId}-product.jpg`)
        } else {
          // Same order as the post writer, including MVP's own copy for a video
          // YouTube has no public thumbnail for yet.
          media = await uploadVideoThumbnail(wpService, { youtubeVideoId: ytId, customUrl: customThumb, storedUrl: (p.youtube_videos?.thumbnail_url as string | null) ?? null })
        }
        await wpService.updatePost(wpId, { featured_media: media.id })
        fixed++; siteFixed++
        nowFixedIds.push(p.id)
      } catch (err) {
        stillBlocked++; siteBlocked++
        stillBlockedIds.push(p.id)
        if (failures.length < 10) {
          failures.push({
            wpPostId: wpId,
            title: String(p.title || '').slice(0, 60),
            reason: (err instanceof Error ? err.message : String(err)).slice(0, 160),
          })
        }
      }
    }
  }

  // Keep the thumbnail_blocked marker (migration 177) honest, by MVP's own
  // post id: WordPress numbers repeat across sites. Best-effort +
  // column-drift-safe (177 may not be applied) — never fail the heal on it.
  if (nowFixedIds.length) {
    try { await supabase.from('blog_posts').update({ thumbnail_blocked: false }).eq('user_id', ownerId).in('id', nowFixedIds) } catch { /* non-fatal */ }
  }
  if (stillBlockedIds.length) {
    try { await supabase.from('blog_posts').update({ thumbnail_blocked: true }).eq('user_id', ownerId).in('id', stillBlockedIds) } catch { /* non-fatal */ }
  }

  return { ok: true, checked, fixed, alreadyOk, stillBlocked, failures }
}
