/**
 * POST /api/blog/fix-affiliate-links
 *
 * Scans the user's published posts for buy links that are wrong, and repairs
 * them. Two different kinds of wrong:
 *
 * BROKEN. The classic failure: a 10-letter title word (e.g. "UNDERWATER") was
 * mistaken for an Amazon ASIN, so the post links to a dead
 * amazon.com/dp/UNDERWATER (often hidden behind the creator's Geniuslink).
 *
 * OFF-STYLE. The link works, and it is not the one the creator asked for. A
 * creator with Geniuslink selected in Brand Profile whose posts carry plain
 * tagged amazon.com/dp/ links still earns, so nothing looks broken, and he
 * loses the geo-routing and the click data he pays Geniuslink for. This was
 * invisible for a long time and the tool made it worse: it only ever looked for
 * broken links, so the scan came back "no broken affiliate links found" and
 * read as a clean bill of health.
 *
 * For each candidate we resolve the CURRENT affiliate link to its true
 * destination, re-resolve the right product from the source video (hardened
 * ASIN matcher + Amazon discovery), rebuild the user's OWN affiliate link
 * through the ONE style they chose, then swap it everywhere in the post body +
 * WordPress.
 *
 * Body: { dryRun?: boolean, mode?: 'broken' | 'regroup' | 'restyle' | 'all' }
 * dryRun returns a preview without writing.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier } from '@/lib/tier'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { isValidAsin } from '@/services/amazon'
import { resolveAffiliateUrl, resolveTrueDestination } from '@/lib/affiliate-resolve'
import { resolveGeniuslinkGroupId } from '@/lib/geniuslink-group'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { getLinkStyle } from '@/lib/link-cloak'
import { styleOfUrl, type LinkStyle } from '@/lib/link-style'
import { asinFromAmazonUrl, amazonProductUrlRegex, asinPathRegex, isAmazonProductUrl } from '@/lib/asin'

export const maxDuration = 300

const GENIUSLINK = /(?:geni\.us|\bgnz\.)/i
// Passport used to be matched here by its own regex, to allow geni.us →
// Passport as an upgrade. lib/link-style's styleOfUrl now names every style
// including Passport, and the downgrade guard reads styles rather than domains,
// so the special case is gone with it.
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
      /** 'broken': only repair dead/junk-ASIN links — the original use case.
       *  'regroup': also re-wrap WORKING geni.us links, used when the per-site
       *  Geniuslink group rule was added and existing posts carry links that
       *  landed in MVP-YOUTUBE before the routing fix. In regroup mode every
       *  blog post with a geni.us link gets a fresh shortcode in the per-site
       *  group, even if the old one resolves cleanly. 2026-06-09.
       *  'restyle': repoint links that work but are not the style the creator
       *  chose. 'all' (default) is broken + restyle in one pass, because those
       *  are the two questions a creator is actually asking when they click a
       *  button called Fix Affiliate Links, and making them pick a mode first
       *  is asking them to already know which fault they have. */
      mode?: 'broken' | 'regroup' | 'restyle' | 'all'
    }
    const dryRun = body.dryRun === true

    // ── Admin preview of ANOTHER creator's posts ────────────────────────────
    //
    // READ-ONLY BY CONSTRUCTION. Refused unless dryRun, so the apply branch
    // below is unreachable from this path and an operator cannot edit a
    // customer's live website from here even by accident. Seeing what WOULD
    // change is a support question; changing it is the creator's decision.
    //
    // The service role is used for the reads, and only because RLS scopes the
    // session client to the operator: it would return zero of the other
    // creator's posts and the preview would read as "nothing to fix" rather
    // than as "you cannot see this", which is the worse of the two failures.
    const asUserId = String((body as { asUserId?: string }).asUserId || '').trim()
    let actingUserId = user.id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let db: any = supabase
    if (asUserId && asUserId !== user.id) {
      if (!dryRun) {
        return NextResponse.json({
          error: 'Previewing another creator is read-only. They apply the fix from their own account.',
          code: 'preview_only',
        }, { status: 403 })
      }
      const { data: me } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
      if (normalizeTier(me?.tier as string | null) !== 'admin') {
        return NextResponse.json({ error: 'Admin only.' }, { status: 403 })
      }
      actingUserId = asUserId
      db = createAdminClient()
      // Reading another person's content leaves a trace, always.
      console.warn('[fix-affiliate-links] admin preview', { operator: user.id, subject: asUserId })
    }
    const selectedFixes = Array.isArray(body.fixes) ? body.fixes : null
    const MODES = ['broken', 'regroup', 'restyle', 'all'] as const
    type Mode = (typeof MODES)[number]
    const mode: Mode = (MODES as readonly string[]).includes(body.mode || '') ? (body.mode as Mode) : 'all'

    // Per-user settings (tier, Amazon tag, Geniuslink keys). WP credentials
    // are resolved per-post below — multi-site users have posts on different
    // sites and we need the SAME site's WP API for each write.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: integrationRaw } = await db
      .from('integrations')
      .select('tier,amazon_associates_tag,geniuslink_api_key,geniuslink_api_secret')
      .eq('user_id', actingUserId)
      .single()
    // Secret columns on this row are encrypted at rest. Decrypt before use:
    // handing the stored ciphertext to the provider as a key fails as
    // "my links stopped working", with nothing near the cause.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const integration = decryptIntegrationRow(integrationRaw as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wp = integration as Record<string, any> | null

    // The ONE style this creator picked, read through the same function every
    // generator uses. Named here rather than inferred per post so the answer in
    // the preview is the same answer the next generation will produce.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chosenStyle: LinkStyle = (await getLinkStyle(db as any, actingUserId)).style
    const STYLE_LABEL: Record<LinkStyle, string> = {
      passport: 'Passport links', geniuslink: 'Geniuslink', bitly: 'Bitly', direct: 'plain Amazon links',
    }

    // Per-site service cache so we resolve credentials + build wpService once
    // per site, not once per post (could be hundreds in a bulk fix).
    // actingUserId captured here to avoid TS losing narrowing inside the closure.
    const userId = actingUserId
    const siteCache = new Map<string, { wpService: ReturnType<typeof createWordPressService>; ownSite: string; siteId: string | null } | null>()
    async function siteFor(postSiteId: string | null | undefined) {
      const key = postSiteId ?? '__default__'
      if (siteCache.has(key)) return siteCache.get(key)!
      const s = await getWordPressCredentials(db, userId, postSiteId ?? null)
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

    // ── Shared resolution helpers ───────────────────────────────────────────
    // Defined ABOVE the apply branch because both branches need them now. The
    // apply step rebuilds a restyle link itself rather than trusting one the
    // client was handed at preview time, and it needs the same video lookup and
    // the same idea of "the link a reader clicks" that the scan used.
    const resolveVideo = async (videoId: string | null) => {
      if (!videoId) return null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let { data } = await db
        .from('youtube_videos').select('*')
        .eq('user_id', actingUserId).eq('id', videoId).maybeSingle()
      if (!data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = await db
          .from('youtube_videos').select('*')
          .eq('user_id', actingUserId).eq('youtube_video_id', videoId).maybeSingle()
        data = r.data
      }
      return data as unknown as { id: string; title: string; description: string; product_url: string | null; youtube_video_id: string | null; asin?: string | null } | null
    }

    // The link currently used by the post (stored on the video, else first
    // affiliate href in the body).
    const currentLinkFor = (vidUrl: string | null, content: string): string | null => {
      if (vidUrl && (GENIUSLINK.test(vidUrl) || SHORTENERS.test(vidUrl) || /amazon\.[a-z.]+/i.test(vidUrl))) return vidUrl
      const m = content.match(AFFILIATE_HREF)
      return m ? m[1] : vidUrl || null
    }

    /** The link a READER actually clicks: the first affiliate href in the post
     *  body. currentLinkFor prefers the URL stored on the video row, which is
     *  the right answer for finding a dead product but the wrong one for asking
     *  "is what is published the style this creator chose". The two can differ,
     *  and when they do it is the page that is wrong or right, not the row. It
     *  also has to be the string that gets swapped, because a replace of a URL
     *  that is not in the body changes nothing and would be counted as a fix. */
    const bodyLinkOf = (content: string): string | null => bodyLinksOf(content)[0] ?? null

    /** EVERY affiliate href in the post, best buy-link first.
     *
     *  Taking the first match in document order was wrong, and the post that
     *  exposed it carries three `amazon.com/s?k=…&tag=…` SEARCH links in a
     *  comparison block plus one geni.us buy button. The search link came first
     *  in the HTML, so the tool read the post's style off a search page and then
     *  tried to resolve a product id out of it. There was never one there.
     *
     *  Order: a cloaked link (geni.us, Passport, a shortener) is what the buy
     *  button uses, so it wins. Then a real Amazon /dp/ product. Search and
     *  storefront URLs are dropped entirely: they are navigation, not a buy
     *  link, and nothing here should reason about them. */
    const bodyLinksOf = (content: string): string[] => {
      const hrefs = (content.match(new RegExp(AFFILIATE_HREF.source, 'gi')) || [])
        .map((h) => h.match(/href="([^"]+)"/i)?.[1] || '')
        .filter(Boolean)
      const seen = new Set<string>()
      const uniq = hrefs.filter((u) => (seen.has(u) ? false : (seen.add(u), true)))
      const rank = (u: string): number => {
        if (GENIUSLINK.test(u) || SHORTENERS.test(u) || styleOfUrl(u) === 'passport') return 0
        if (isAmazonProductUrl(u)) return 1
        return 2 // a search or storefront URL — kept last, and filtered below
      }
      return uniq.filter((u) => rank(u) < 2).sort((a, b) => rank(a) - rank(b))
    }

    /** Which product this post is about, WITHOUT rediscovering it.
     *
     *  A published post already links to its product. Re-pointing it is not the
     *  same problem as writing a new one, and treating it as such is what broke
     *  the first real run: the generic resolver re-derives the product from the
     *  video's title and description, which for a geni.us post means following
     *  the geni.us link in the DESCRIPTION. A creator migrating off Geniuslink
     *  was therefore blocked by Geniuslink, and got "could not resolve a product
     *  for this post" on a post whose product was sitting in its own href.
     *
     *  Cheapest first, and the network only as a last resort:
     *    1. an Amazon /dp/ link already in the post body
     *    2. the ASIN stored on the video row (migration 204)
     *    3. the video's stored product_url
     *    4. follow the post's OWN current link, which is the one that works
     *
     *  Step 4 is the creator's own description of the fix: the geni.us link
     *  still points at a real product, so resolve it and cloak that. */
    async function asinForRestyle(
      content: string,
      video: { product_url?: string | null; asin?: string | null },
      currentUrl: string,
      extraLinks: string[] = [],
    ): Promise<string | null> {
      const ok = (a: string | null | undefined) => {
        const v = (a || '').trim().toUpperCase()
        return v && isValidAsin(v) ? v : null
      }
      // Cheapest source first: a full Amazon product URL already in the body,
      // then a bare /dp/-style path anywhere in it. Both go through the shared
      // parser, so /clp/ counts here exactly as it does everywhere else.
      const inBody = content.match(amazonProductUrlRegex('i'))?.[0]
        ?? content.match(asinPathRegex('i'))?.[0]
        ?? ''
      const bodyAsin = asinFromAmazonUrl(inBody)
      const fromBody = ok(bodyAsin)
      if (fromBody) return fromBody
      const stored = ok(video.asin)
      if (stored) return stored
      const fromProductUrl = ok(asinFromAmazonUrl(String(video.product_url || '')))
      if (fromProductUrl) return fromProductUrl
      // Follow the post's own links until one yields a product. Plural on
      // purpose: a post can carry several, and giving up after the first is how
      // a post with a perfectly good geni.us button reported that nobody could
      // tell what it was about.
      for (const candidate of [currentUrl, ...extraLinks].filter(Boolean)) {
        try {
          const finalUrl = await resolveTrueDestination(candidate)
          const found = ok(asinFromAmazonUrl(finalUrl))
          if (found) return found
        } catch { /* try the next one */ }
      }
      return null
    }

    /** Build this post's correct affiliate link, in the creator's chosen style.
     *
     *  THIS MINTS. For a Geniuslink creator it creates a real shortcode; for a
     *  Passport creator it is a get-or-create against their own link table. That
     *  is why it now runs at APPLY time and not during a preview: a scan of 267
     *  off-style posts used to mint 267 links before the creator had agreed to
     *  anything, and every row they unticked left an orphan behind. */
    async function buildLinkFor(
      post: { id: string; title?: string | null; slug?: string | null; video_id: string | null; wordpress_site_id?: string | null },
      video: { title: string; description: string; youtube_video_id: string | null },
      knownAsin?: string | null,
    ): Promise<string | null> {
      const postSite = await siteFor(post.wordpress_site_id ?? null)
      const { affiliateUrl } = await resolveAffiliateUrl({
        title: video.title || post.title || '',
        description: video.description || '',
        ownSite: postSite?.ownSite ?? defaultEntry!.ownSite,
        userId: user!.id,
        tier: wp?.tier,
        amazonTag: wp?.amazon_associates_tag,
        geniuslinkApiKey: wp?.geniuslink_api_key,
        geniuslinkApiSecret: wp?.geniuslink_api_secret,
        unwrapSourceLinks: true,
        knownAsin: knownAsin ?? null,
        videoId: video.youtube_video_id,
        geniuslinkGroupId: postSite?.siteId
          ? await resolveGeniuslinkGroupId({
              supabase: db,
              siteId: postSite.siteId,
              siteUrl: postSite.ownSite,
              apiKey: wp?.geniuslink_api_key,
              apiSecret: wp?.geniuslink_api_secret,
            })
          : null,
      })
      return affiliateUrl || null
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
      // Posts that were written and STILL carry a link in some other style.
      // The swap replaces one exact URL; a roundup with five products, or a
      // post whose sticky bar and hero button were built at different times,
      // holds more than one. Counting a post as fixed while a reader can still
      // click the wrong kind of link is the same lie in a smaller place, so it
      // is checked after the write and reported.
      const partiallyFixed: string[] = []
      for (const f of selectedFixes) {
        try {
          if (!f?.postId || !f?.oldUrl) continue
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: row } = await db
            .from('blog_posts').select('id,title,slug,content,wordpress_post_id,video_id,wordpress_site_id')
            .eq('user_id', actingUserId).eq('id', f.postId).maybeSingle()
          if (!row?.content) continue
          const original = row.content as string

          // A restyle row arrives with no newUrl, because the preview refused to
          // mint one. Build it now, for this post only, now that the creator has
          // actually ticked it.
          let newUrl = f.newUrl || ''
          if (!/^https?:\/\//i.test(newUrl)) {
            const video = await resolveVideo(row.video_id as string | null)
            if (!video) { errs.push(`${f.postId}: no source video, cannot rebuild the link`); continue }
            const currentUrl = bodyLinkOf(original) || f.oldUrl
            const knownAsin = await asinForRestyle(
              original, video, currentUrl,
              // Everything else worth following: the post's other buy links, and
              // the URL stored on the video row (a geni.us link for most of
              // these posts, which is exactly the thing that still resolves).
              [...bodyLinksOf(original), String(video.product_url || '')],
            )
            const built = await buildLinkFor(row as never, video, knownAsin)
            if (!built) {
              errs.push(knownAsin
                ? `${f.postId}: found product ${knownAsin} but could not build a ${chosenStyle} link for it`
                : `${f.postId}: could not work out which product this post is about`)
              continue
            }
            // The same honesty check the scan does: a mint that failed falls back
            // to a plain tagged link, and swapping one plain link for another is
            // not the fix the creator asked for.
            if (styleOfUrl(built) !== chosenStyle) {
              errs.push(`${f.postId}: rebuilt link came back as ${styleOfUrl(built) ?? 'unknown'}, not ${chosenStyle}`)
              continue
            }
            newUrl = built
          }

          // Swap the link a READER clicks. The row the client sent carries the
          // href seen at preview time; re-read it here so a post edited since
          // then is still matched.
          const oldUrl = bodyLinkOf(original) || f.oldUrl
          let updated = original.split(oldUrl).join(newUrl)
          updated = updated.replace(
            new RegExp(`href="${amazonProductUrlRegex('i').source}"`, 'gi'),
            (href) => (badAmazonAsin(href) ? `href="${newUrl}"` : href),
          )
          if (updated === original) continue
          if (row.wordpress_post_id) {
            // Push the update to the SAME site this post lives on (multi-site).
            const ctx = await siteFor((row as { wordpress_site_id?: string | null }).wordpress_site_id)
            if (ctx) await ctx.wpService.updatePost(row.wordpress_post_id, { content: updated } as never)
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await db.from('blog_posts').update({ content: updated }).eq('id', row.id)
          fixed++
          // Read the post back as a reader sees it: every affiliate href, not
          // just the one that was swapped.
          const leftovers = (updated.match(new RegExp(AFFILIATE_HREF.source, 'gi')) || [])
            .map((h) => h.match(/href="([^"]+)"/i)?.[1] || '')
            .filter((u) => { const st = styleOfUrl(u); return st !== null && st !== chosenStyle })
          if (leftovers.length) partiallyFixed.push(f.postId)
          // Best-effort: refresh the video's stored product link (single reviews
          // store the UUID in video_id; comparison posts store a youtube id and
          // simply won't match — harmless).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          try { if (row.video_id) await db.from('youtube_videos').update({ product_url: newUrl }).eq('user_id', actingUserId).eq('id', row.video_id) } catch { /* non-fatal */ }
        } catch (err) {
          errs.push(`${f.postId}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      return NextResponse.json({
        success: true,
        fixed,
        attempted: selectedFixes.length,
        errors: errs.slice(0, 10),
        partiallyFixed: partiallyFixed.length,
        chosenStyleLabel: STYLE_LABEL[chosenStyle],
      })
    }

    // ── Load published posts that have a body + a WP id ──────────────────────
    // wordpress_site_id is pulled so each post resolves its OWN ownSite below
    // (multi-site users have posts on different sites — self-link filtering
    // must compare against the post's actual site, not the user's default).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: posts } = await db
      .from('blog_posts')
      .select('id,video_id,title,slug,content,wordpress_post_id,wordpress_site_id')
      .eq('user_id', actingUserId)
      .not('wordpress_post_id', 'is', null)
      .not('content', 'is', null)
      .order('created_at', { ascending: false })
    const rows = (posts as PostRow[] | null) ?? []
    if (rows.length === 0) return NextResponse.json({ fixed: 0, total: 0, preview: [], message: 'No published posts found.' })

    // ── Resolve the source video + the current affiliate link for each post ─


    // ── Detect broken links (bounded concurrency on the network resolve) ─────
    type Reason = 'broken' | 'regroup' | 'restyle'
    /** newUrl is null for a restyle row: the replacement is minted at apply time. */
    type Candidate = { post: PostRow; video: NonNullable<Awaited<ReturnType<typeof resolveVideo>>>; oldUrl: string; newUrl: string | null; reason: Reason }
    const candidates: Candidate[] = []
    const errors: string[] = []
    const unresolved: string[] = []
    // Why each scanned post was NOT offered as a fix. A count of "nothing to do"
    // is the same screen whether every link is perfect or every link failed to
    // rebuild, and the difference is the whole answer, so it is counted.
    const skipped = { noVideo: 0, noLink: 0, alreadyRight: 0, couldNotRebuild: 0, wouldDowngrade: 0 }
    // Posts that ARE off-style and that the tool could not convert. These are
    // the ones a creator most needs named: their link is not the one they chose
    // and clicking again will not change that.
    const stuckOffStyle: string[] = []


    const CHUNK = 6
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      await Promise.all(chunk.map(async (post) => {
        try {
          const video = await resolveVideo(post.video_id)
          if (!video) { skipped.noVideo++; return }
          const content = post.content || ''
          let oldUrl = currentLinkFor(video.product_url, content)
          if (!oldUrl) { skipped.noLink++; return }
          const bodyUrl = bodyLinkOf(content)

          // Is the current link broken? Direct bad /dp/ ASIN, or a
          // geni.us/short link that resolves to one.
          const liveStyle = styleOfUrl(bodyUrl || oldUrl)
          const offStyle = liveStyle !== null && liveStyle !== chosenStyle
          const restyleMode = mode === 'restyle' || mode === 'all'

          let broken = badAmazonAsin(oldUrl)
          // The probe below FOLLOWS the link over the network to see where it
          // really lands. Skip it when the post is already a restyle candidate:
          // the link is being rebuilt either way, so following 250 geni.us
          // redirects would buy nothing and is the difference between a scan
          // that takes seconds and one that times out.
          if (!broken && !(restyleMode && offStyle) && (GENIUSLINK.test(oldUrl) || SHORTENERS.test(oldUrl))) {
            const finalUrl = await resolveTrueDestination(oldUrl)
            broken = badAmazonAsin(finalUrl)
          }

          // A null live style is a link with nothing to read (a non-Amazon store
          // page). It stays out of this: rewriting somebody's published post
          // needs certainty, not an inference.

          // 'broken': only repair links that are actually dead.
          // 'regroup': broken, or a geni.us link that may be in the wrong group.
          // 'restyle': broken, or a working link that is not the chosen style.
          // 'all': all of the above except regrouping working geni.us links,
          //   which mints a new shortcode for every post and is a deliberate
          //   act, not something to fold into a general Fix button.
          let reason: Reason
          if (broken) {
            reason = 'broken'
          } else if ((mode === 'restyle' || mode === 'all') && offStyle) {
            reason = 'restyle'
          } else if (mode === 'regroup' && GENIUSLINK.test(oldUrl)) {
            reason = 'regroup'
          } else {
            // Nothing to do for this post, and WHY matters: a link that is
            // already right reads very differently from one this mode does not
            // look at.
            if (offStyle) stuckOffStyle.push(post.title || post.slug || post.id)
            else skipped.alreadyRight++
            return
          }
          // Swap the string that is actually in the post. For a style change
          // that is the href a reader clicks; the video row can hold something
          // else entirely, and replacing a URL the body does not contain writes
          // nothing while reporting a fix.
          if (reason === 'restyle' && bodyUrl) oldUrl = bodyUrl

          // A RESTYLE ROW IS NOT BUILT HERE.
          // Its replacement is minted at apply time, for the posts the creator
          // actually ticks. That is what lets this scan cover every post in one
          // pass instead of 25 at a time: previewing is now a database read, and
          // the expensive, account-touching half happens once, on demand, to a
          // known list. A broken row still resolves below, because there the
          // corrected DESTINATION is the thing being agreed to and there are only
          // ever a handful of them.
          if (reason === 'restyle') {
            candidates.push({ post, video, oldUrl, newUrl: null, reason })
            return
          }

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
            userId: actingUserId,
            tier: wp?.tier,
            amazonTag: wp?.amazon_associates_tag,
            geniuslinkApiKey: wp?.geniuslink_api_key,
            geniuslinkApiSecret: wp?.geniuslink_api_secret,
            unwrapSourceLinks: true,
            videoId: video.youtube_video_id,
            geniuslinkGroupId: postSite?.siteId
              ? await resolveGeniuslinkGroupId({
                  supabase: db,
                  siteId: postSite.siteId,
                  siteUrl: postSite.ownSite,
                  apiKey: wp?.geniuslink_api_key,
                  apiSecret: wp?.geniuslink_api_secret,
                })
              : null,
          })
          if (!affiliateUrl || affiliateUrl === oldUrl || badAmazonAsin(affiliateUrl)) {
            skipped.couldNotRebuild++
            unresolved.push(post.title || post.slug || post.id)
            return
          }

          // The restyle honesty check that used to live here moved to the apply
          // step along with the minting: a rebuild that comes back in the wrong
          // style is refused there and named, rather than counted as a fix.
          // NEVER DOWNGRADE A WORKING CLOAKED LINK TO A RAW TAGGED URL.
          // resolveAffiliateUrl falls back to a plain tagged amazon.com link
          // whenever minting fails (API error, or the new link doesn't validate
          // to the product). That fallback is the right answer for a BROKEN
          // link, where anything beats a dead page. Applied to a working
          // geni.us or Passport link it silently strips the geo-routing and the
          // click data the creator pays for, and the screen would call it a fix.
          //
          // Read against the CHOSEN style, not against a list of domains: moving
          // geni.us → Passport, or Geniuslink → Bitly, is the creator changing
          // their mind and is exactly what restyle is for. Only a fall to
          // 'direct' that the creator did not ask for is refused.
          const newStyle = styleOfUrl(affiliateUrl)
          const oldWasCloaked = liveStyle !== null && liveStyle !== 'direct'
          if (reason !== 'broken' && oldWasCloaked && newStyle === 'direct' && chosenStyle !== 'direct') {
            skipped.wouldDowngrade++
            unresolved.push(post.title || post.slug || post.id)
            return
          }
          candidates.push({ post, video, oldUrl, newUrl: affiliateUrl, reason })
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
      mode,
      total: rows.length,
      toFix: candidates.length,
      unresolved: unresolved.length,
      // What the scan actually established, so an empty preview can say which
      // kind of empty it is. "No broken links found" was true for a creator
      // whose every link was the wrong style, and it read as all-clear.
      chosenStyle,
      chosenStyleLabel: STYLE_LABEL[chosenStyle],
      skipped,
      offStyleStuck: stuckOffStyle.slice(0, 20),
      offStyleStuckCount: stuckOffStyle.length,
      preview: candidates.map((c) => ({
        postId: c.post.id,
        title: (c.post.title || c.post.slug || '').replace(/<[^>]+>/g, ''),
        oldUrl: c.oldUrl,
        newUrl: c.newUrl,
        reason: c.reason,
      })),
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
