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
import { asinFromAmazonUrl } from '@/lib/product-link'
import { isValidAsin } from '@/services/amazon'
import { resolveAffiliateUrl, resolveTrueDestination } from '@/lib/affiliate-resolve'

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

    const { dryRun = false } = await request.json().catch(() => ({}))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: integration } = await (supabase as any)
      .from('integrations')
      .select('wordpress_url,wordpress_username,wordpress_app_password,wordpress_api_token,tier,amazon_associates_tag,geniuslink_api_key,geniuslink_api_secret')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wp = integration as Record<string, any> | null
    if (!wp?.wordpress_url || !wp?.wordpress_username || !wp?.wordpress_app_password) {
      return NextResponse.json({ error: 'WordPress not connected.' }, { status: 400 })
    }
    const wpService = createWordPressService(
      wp.wordpress_url, wp.wordpress_username, wp.wordpress_app_password, wp.wordpress_api_token || undefined,
    )

    // ── Load published posts that have a body + a WP id ──────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: posts } = await (supabase as any)
      .from('blog_posts')
      .select('id,video_id,title,slug,content,wordpress_post_id')
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
      let { data } = await (supabase as any)
        .from('youtube_videos').select('id,title,description,product_url')
        .eq('user_id', user.id).eq('id', videoId).maybeSingle()
      if (!data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = await (supabase as any)
          .from('youtube_videos').select('id,title,description,product_url')
          .eq('user_id', user.id).eq('youtube_video_id', videoId).maybeSingle()
        data = r.data
      }
      return data as { id: string; title: string; description: string; product_url: string | null } | null
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
          const { affiliateUrl } = await resolveAffiliateUrl({
            title: video.title || post.title || '',
            description: video.description || '',
            ownSite: wp.wordpress_url,
            userId: user.id,
            tier: wp.tier,
            amazonTag: wp.amazon_associates_tag,
            geniuslinkApiKey: wp.geniuslink_api_key,
            geniuslinkApiSecret: wp.geniuslink_api_secret,
            unwrapSourceLinks: true,
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

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        total: rows.length,
        toFix: candidates.length,
        unresolved: unresolved.length,
        preview: candidates.map((c) => ({
          title: (c.post.title || c.post.slug || '').replace(/<[^>]+>/g, ''),
          oldUrl: c.oldUrl,
          newUrl: c.newUrl,
        })),
      })
    }

    // ── Apply: swap the old link for the new one in body + WP + DB ───────────
    let fixed = 0
    for (const c of candidates) {
      try {
        const original = c.post.content || ''
        // Replace the exact old link everywhere, plus any direct dead
        // amazon.com/dp/<junk> occurrences that share the same product id.
        let updated = original.split(c.oldUrl).join(c.newUrl)
        updated = updated.replace(
          /href="https?:\/\/(?:www\.)?amazon\.[a-z.]+\/(?:dp|gp\/product)\/[A-Z0-9]{10}[^"]*"/gi,
          (href) => (badAmazonAsin(href) ? `href="${c.newUrl}"` : href),
        )
        if (updated === original) { unresolved.push(c.post.title || c.post.id); continue }

        if (c.post.wordpress_post_id) {
          await wpService.updatePost(c.post.wordpress_post_id, { content: updated } as never)
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from('blog_posts').update({ content: updated }).eq('id', c.post.id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from('youtube_videos').update({ product_url: c.newUrl }).eq('id', c.video.id)
        fixed++
      } catch (err) {
        errors.push(`${c.post.title || c.post.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return NextResponse.json({
      success: true,
      total: rows.length,
      fixed,
      attempted: candidates.length,
      unresolved: unresolved.length,
      errors: errors.slice(0, 10),
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
