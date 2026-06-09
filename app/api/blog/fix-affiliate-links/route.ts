/**
 * POST /api/blog/fix-affiliate-links
 *
 * Scans the user's published posts for BROKEN affiliate links and repairs
 * them. The classic failure: a 10-letter title word (e.g. "UNDERWATER") was
 * mistaken for an Amazon ASIN, so the post links to a dead
 * amazon.com/dp/UNDERWATER (often hidden behind the creator's Geniuslink).
 *
 * For each post we resolve the CURRENT affiliate link to its true destination;
 * if it lands on an Amazon page with a junk ASIN, we re-resolve the right
 * product from the source video (hardened ASIN matcher + Amazon discovery) and
 * rebuild the user's OWN affiliate link (their Geniuslink or Associates tag),
 * then swap it everywhere in the post body + WordPress.
 *
 * Body: { dryRun?: boolean } — dryRun returns a preview without writing.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { asinFromAmazonUrl } from '@/lib/product-link'
import { isValidAsin } from '@/services/amazon'
import { resolveAffiliateUrl, resolveTrueDestination } from '@/lib/affiliate-resolve'
import { resolveGeniuslinkGroupId } from '@/lib/geniuslink-group'

export const maxDuration = 300

const GENIUSLINK = /(?:geni\.us|\bgnz\.)/i
const SHORTENERS = /(?:amzn\.to|a\.co|bit\.ly|tinyurl\.com|rebrand\.ly)/i
const AFFILIATE_HREF = /href="(https?:\/\/[^"]*(?:geni\.us|gnz\.|amzn\.to|a\.co|amazon\.[a-z.]+)[^"]*)"/i

/** An Amazon /dp/ URL whose product id isn't a real ASIN (e.g. dp/UNDERWATER). */
function badAmazonAsin(url: string): boolean {
  const a = asinFromAmazonUrl(url)
  return !!a && !isValidAsin(a)
}

type PostRow = {
  id: string
  video_id: string | null
  title: string | null
  slug: string | null
  content: string | null
  wordpress_post_id: number | null
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as {
      dryRun?: boolean
      fixes?: { postId: string; oldUrl: string; newUrl: string }[]
    }
    const dryRun = body.dryRun === true
    const selectedFixes = Array.isArray(body.fixes) ? body.fixes : null

    // Per-user settings (tier, Amazon tag, Geniuslink keys). WP credentials
    // are resolved per-post below — multi-site users have posts on different
    // sites and we need the SAME site's WP API for each write.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: integration } = await supabase
      .from('integrations')
      .select('tier,amazon_associates_tag,geniuslink_api_key,geniuslink_api_secret')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wp = integration as Record<string, any> | null

    // Per-site service cache so we resolve credentials + build wpService once
    // per site, not once per post (could be hundreds in a bulk fix).
    // user.id captured here to avoid TS losing narrowing inside the closure.
    const userId = user.id
    const siteCache = new Map<string, { wpService: ReturnType<typeof createWordPressService>; ownSite: string; siteId: string | null } | null>()
    async function siteFor(postSiteId: string | null | undefined) {
      const key = postSiteId ?? '__default__'
      if (siteCache.has(key)) return siteCache.get(key)!
      const s = await getWordPressCredentials(supabase, userId, postSiteId ?? null)
      if (!s) { siteCache.set(key, null); return null }
      const svc = createWordPressService(s.wordpress_url, s.wordpress_username, s.wordpress_app_password, s.wordpress_api_token || undefined)
      // site_id === 'legacy' means the user has not been migrated to
      // wordpress_sites yet — no group cache row exists, so skip the
      // Geniuslink group lookup for this post.
      const entry = { wpService: svc, ownSite: s.wordpress_url, siteId: s.site_id === 'legacy' ? null : s.site_id }
      siteCache.set(key, entry)
      return entry
    }
    // Validate that at least the default site is reachable so we fail fast
    // when WP is fully unconnected (vs the per-post failure mode below).
    const defaultEntry = await siteFor(null)
    if (!defaultEntry) {
      return NextResponse.json({ error: 'WordPress not connected.' }, { status: 400 })
    }

    // ── Targeted apply ───────────────────────────────────────────────────────
    // The client sends back ONLY the previewed fixes the user kept checked
    // (postId + old→new). We swap those exact links — no re-scan, no
    // re-resolution — so deselected posts are untouched and we don't mint
    // duplicate Geniuslinks. The post is re-loaded server-side by id (RLS) so
    // we never trust client-supplied content/WP ids.
    if (!dryRun && selectedFixes) {
      let fixed = 0
      const errs: string[] = []
      for (const f of selectedFixes) {
        try {
          if (!f?.postId || !f?.oldUrl || !/^https?:\/\//i.test(f?.newUrl || '')) continue
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: row } = await supabase
            .from('blog_posts').select('id,content,wordpress_post_id,video_id,wordpress_site_id')
            .eq('user_id', user.id).eq('id', f.postId).maybeSingle()
          if (!row?.content) continue
          const original = row.content as string
          let updated = original.split(f.oldUrl).join(f.newUrl)
          updated = updated.replace(
            /href="https?:\/\/(?:www\.)?amazon\.[a-z.]+\/(?:dp|gp\/product)\/[A-Z0-9]{10}[^"]*"/gi,
            (href) => (badAmazonAsin(href) ? `href="${f.newUrl}"` : href),
          )
          if (updated === original) continue
          if (row.wordpress_post_id) {
            // Push the update to the SAME site this post lives on (multi-site).
            const ctx = await siteFor((row as { wordpress_site_id?: string | null }).wordpress_site_id)
            if (ctx) await ctx.wpService.updatePost(row.wordpress_post_id, { content: updated } as never)
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await supabase.from('blog_posts').update({ content: updated }).eq('id', row.id)
          fixed++
          // Best-effort: refresh the video's stored product link (single reviews
          // store the UUID in video_id; comparison posts store a youtube id and
          // simply won't match — harmless).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          try { if (row.video_id) await supabase.from('youtube_videos').update({ product_url: f.newUrl }).eq('user_id', user.id).eq('id', row.video_id) } catch { /* non-fatal */ }
        } catch (err) {
          errs.push(`${f.postId}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      return NextResponse.json({ success: true, fixed, attempted: selectedFixes.length, errors: errs.slice(0, 10) })
    }

    // ── Load published posts that have a body + a WP id ──────────────────────
    // wordpress_site_id is pulled so each post resolves its OWN ownSite below
    // (multi-site users have posts on different sites — self-link filtering
    // must compare against the post's actual site, not the user's default).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: posts } = await supabase
      .from('blog_posts')
      .select('id,video_id,title,slug,content,wordpress_post_id,wordpress_site_id')
      .eq('user_id', user.id)
      .not('wordpress_post_id', 'is', null)
      .not('content', 'is', null)
      .order('created_at', { ascending: false })
    const rows = (posts as PostRow[] | null) ?? []
    if (rows.length === 0) return NextResponse.json({ fixed: 0, total: 0, preview: [], message: 'No published posts found.' })

    // ── Resolve the source video + the current affiliate link for each post ─
    const resolveVideo = async (videoId: string | null) => {
      if (!videoId) return null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let { data } = await supabase
        .from('youtube_videos').select('id,title,description,product_url,youtube_video_id')
        .eq('user_id', user.id).eq('id', videoId).maybeSingle()
      if (!data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = await supabase
          .from('youtube_videos').select('id,title,description,product_url,youtube_video_id')
          .eq('user_id', user.id).eq('youtube_video_id', videoId).maybeSingle()
        data = r.data
      }
      return data as { id: string; title: string; description: string; product_url: string | null; youtube_video_id: string | null } | null
    }

    // The link currently used by the post (stored on the video, else first
    // affiliate href in the body).
    const currentLinkFor = (vidUrl: string | null, content: string): string | null => {
      if (vidUrl && (GENIUSLINK.test(vidUrl) || SHORTENERS.test(vidUrl) || /amazon\.[a-z.]+/i.test(vidUrl))) return vidUrl
      const m = content.match(AFFILIATE_HREF)
      return m ? m[1] : vidUrl || null
    }

    // ── Detect broken links (bounded concurrency on the network resolve) ─────
    type Candidate = { post: PostRow; video: NonNullable<Awaited<ReturnType<typeof resolveVideo>>>; oldUrl: string; newUrl: string }
    const candidates: Candidate[] = []
    const errors: string[] = []
    const unresolved: string[] = []

    const CHUNK = 6
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      await Promise.all(chunk.map(async (post) => {
        try {
          const video = await resolveVideo(post.video_id)
          if (!video) return
          const content = post.content || ''
          const oldUrl = currentLinkFor(video.product_url, content)
          if (!oldUrl) return

          // Is the current link broken? Direct bad /dp/ ASIN, or a
          // geni.us/short link that resolves to one.
          let broken = badAmazonAsin(oldUrl)
          if (!broken && (GENIUSLINK.test(oldUrl) || SHORTENERS.test(oldUrl))) {
            const finalUrl = await resolveTrueDestination(oldUrl)
            broken = badAmazonAsin(finalUrl)
          }
          if (!broken) return

          // Re-resolve the RIGHT product + the user's own affiliate link.
          // ownSite = THIS post's site (multi-site self-link filter). Fall
          // back to the default site when wordpress_site_id is null (legacy
          // pre-Phase-3 row).
          const postSite = await siteFor((post as PostRow & { wordpress_site_id?: string | null }).wordpress_site_id)
          // 2026-06-09: pass videoId (ascsubtag) + per-site group context so
          // the repaired link inherits the same per-blog + per-video tracking
          // a fresh generation gets.
          const { affiliateUrl } = await resolveAffiliateUrl({
            title: video.title || post.title || '',
            description: video.description || '',
            ownSite: postSite?.ownSite ?? defaultEntry.ownSite,
            userId: user.id,
            tier: wp?.tier,
            amazonTag: wp?.amazon_associates_tag,
            geniuslinkApiKey: wp?.geniuslink_api_key,
            geniuslinkApiSecret: wp?.geniuslink_api_secret,
            unwrapSourceLinks: true,
            videoId: video.youtube_video_id,
            geniuslinkGroupId: postSite?.siteId
              ? await resolveGeniuslinkGroupId({
                  supabase,
                  siteId: postSite.siteId,
                  siteUrl: postSite.ownSite,
                  apiKey: wp?.geniuslink_api_key,
                  apiSecret: wp?.geniuslink_api_secret,
                })
              : null,
          })
          if (!affiliateUrl || affiliateUrl === oldUrl || badAmazonAsin(affiliateUrl)) {
            unresolved.push(post.title || post.slug || post.id)
            return
          }
          candidates.push({ post, video, oldUrl, newUrl: affiliateUrl })
        } catch (err) {
          errors.push(`${post.title || post.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }))
    }

    // Scan path = preview. Applying is always done via the targeted branch
    // above (the client posts back only the fixes the user kept selected), so
    // a non-dryRun call with no fixes has nothing to do.
    if (!dryRun) {
      return NextResponse.json({ error: 'No fixes selected.' }, { status: 400 })
    }
    void errors
    return NextResponse.json({
      dryRun: true,
      total: rows.length,
      toFix: candidates.length,
      unresolved: unresolved.length,
      preview: candidates.map((c) => ({
        postId: c.post.id,
        title: (c.post.title || c.post.slug || '').replace(/<[^>]+>/g, ''),
        oldUrl: c.oldUrl,
        newUrl: c.newUrl,
      })),
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
