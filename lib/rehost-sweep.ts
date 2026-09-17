// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE SWEEP ITSELF, shared by the cron and the admin "Run now" button.
//
// Move creators' pictures off our generation CDN and onto their own sites,
// without waiting for them to notice.
//
// WHY THIS IS A CRON AND NOT ONLY A BUTTON.
//
// Measured from blog_posts:
//
//   610ad913   81 posts   oldest 26 Jun   newest 16 Sep
//   80822bd4   69 posts   oldest 12 Jul   newest 15 Sep
//   74efb4c7   23 posts   oldest 27 Jun   newest 10 Sep
//   f1d13171    7 posts   oldest  3 Aug   newest  7 Sep
//   9936ec62    4 posts   oldest 28 May   newest  2 Sep
//   d8f53815    2 posts   oldest 30 Jul   newest 11 Sep
//              186 posts, every one of them live on a site
//
// The repair existed behind a button, which meant it only ran for a creator who
// opened MVP and pressed it. None of these six had. A sample of 40 of the source
// files all still answered, so every one of these is repairable TODAY, and fal's
// documentation says expired files are deleted and cannot be recovered. Waiting
// for six people to log in is betting their published articles against a clock
// nobody can read.
//
// WHAT IT IS ALLOWED TO DO. It downloads a picture that already exists and
// uploads that same file to the creator's own site, then repoints the post at
// the copy. No model call, no spend, same picture, same article. It never
// regenerates: a regenerated picture is one the creator never chose and did not
// pay for, so that stays their decision.
//
// WHAT IT MUST NEVER DO. Report a repair that did not happen. One of these six
// has a site that refuses every upload, so a run against it moves nothing, and
// "0 of 81 moved because the site refused every upload" has to be plainly
// different from "81 moved". The runner keeps refused and gone apart for the
// same reason: a refusal means fix WordPress, a gone source means the picture
// has to be made again, and sending somebody to their host over a deleted file
// wastes their week.
//
// Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`.
import { createAdminClient } from '@/lib/supabase/admin'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'
import { rehostPosts, describeRun, defaultSourceAlive, makeOgImageFollower, type RehostTarget } from '@/lib/rehost-run'

// Deliberately small. This edits other people's published posts, so a run that
// goes wrong should go wrong over a handful of them and be visible in the next
// run's numbers, not over a whole library. The backlog drains over a few days
// and nothing about it is urgent enough to justify a bigger blast radius.
export const MAX_USERS_PER_RUN = 3
export const MAX_POSTS_PER_USER = 8

export interface SweepReport {
  ok: boolean
  owners?: number
  moved?: number
  refused?: number
  gone?: number
  summary?: string
  error?: string
  results?: Array<Record<string, unknown>>
}

/** Run the sweep. Returns what actually happened, including when that is
 *  nothing, so the caller can put it on a screen instead of in a log. */
export async function runHotlinkedSweep(): Promise<SweepReport> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  // Who still has posts pointing at our CDN. Matched on the stored content
  // rather than on images_status, because images_status only started telling
  // the truth recently and every post that needs this repair predates it.
  let ownerIds: string[] = []
  try {
    const { data, error } = await admin
      .from('blog_posts')
      .select('user_id')
      .ilike('content', '%fal.media%')
      .not('wordpress_post_id', 'is', null)
      .limit(3000)
    if (error) throw error
    // Biggest backlog first, deterministically. Taking whatever three the
    // query happened to return made a run unpredictable, and an unpredictable
    // run cannot be checked: "nothing changed on the site I can see" then means
    // either that it failed or that it worked on somebody else, and there is no
    // way to tell those apart from outside.
    const counts = new Map<string, number>()
    for (const r of (data ?? []) as Array<{ user_id: string }>) {
      counts.set(r.user_id, (counts.get(r.user_id) ?? 0) + 1)
    }
    ownerIds = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_USERS_PER_RUN)
      .map(([id]) => id)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'could not list owners' }
  }

  if (ownerIds.length === 0) {
    return { ok: true, owners: 0, moved: 0, refused: 0, gone: 0, summary: 'No posts are pointing at our image server.', results: [] }
  }

  const perOwner: Array<Record<string, unknown>> = []

  for (const ownerId of ownerIds) {
    let posts: RehostTarget[] = []
    try {
      const { data, error } = await admin
        .from('blog_posts')
        .select('id,title,content,wordpress_post_id,wordpress_url,wordpress_site_id')
        .eq('user_id', ownerId)
        .ilike('content', '%fal.media%')
        .not('wordpress_post_id', 'is', null)
        .order('created_at', { ascending: true })   // oldest first: closest to expiry
        .limit(MAX_POSTS_PER_USER * 4)
      if (error) throw error
      posts = (data ?? []) as RehostTarget[]
    } catch (e) {
      perOwner.push({ ownerId, skipped: `could not read the posts: ${e instanceof Error ? e.message : 'unknown'}` })
      continue
    }

    if (posts.length === 0) {
      perOwner.push({ ownerId, postsExamined: 0, summary: 'No posts needed repairing.' })
      continue
    }

    // GROUP BY SITE, NOT BY OWNER.
    //
    // A creator can have up to ten blogs, and a WordPress post id only means
    // anything inside one of them. Resolving one set of credentials per owner
    // and using it for every post would hand post id 42 on site B the body of
    // post 42 from site A, overwriting somebody's unrelated published article.
    // rehostPosts refuses a post whose recorded URL is on another host, so this
    // grouping is what lets those posts be repaired at all rather than skipped.
    //
    // A null site id is a legacy post from before multi-site, which means the
    // default blog, and that is exactly what an undefined siteId resolves to.
    const bySite = new Map<string, RehostTarget[]>()
    for (const post of posts) {
      const key = (post as RehostTarget & { wordpress_site_id?: string | null }).wordpress_site_id ?? ''
      const list = bySite.get(key)
      if (list) list.push(post)
      else bySite.set(key, [post])
    }

    for (const [siteKey, sitePosts] of bySite) {
      const batch = sitePosts.slice(0, MAX_POSTS_PER_USER)

      // skipCapGuard: this is maintenance on already-published posts. A creator
      // who dropped a plan still has those posts live, and leaving their
      // pictures to expire over a billing state is worse than what the cap is
      // protecting against.
      let site: Awaited<ReturnType<typeof getWordPressCredentials>> = null
      try {
        site = await getWordPressCredentials(admin, ownerId, siteKey || undefined, { skipCapGuard: true })
      } catch (e) {
        perOwner.push({ ownerId, siteId: siteKey || null, skipped: `could not read the site credentials: ${e instanceof Error ? e.message : 'unknown'}` })
        continue
      }
      if (!site?.wordpress_url) {
        perOwner.push({ ownerId, siteId: siteKey || null, skipped: 'that blog is no longer connected, so there is nowhere to move its pictures to' })
        continue
      }

      const wp = createWordPressService(
        site.wordpress_url,
        site.wordpress_username,
        site.wordpress_app_password,
        site.wordpress_api_token || undefined,
      )

      const result = await rehostPosts(batch, site.wordpress_url, {
        uploadFromUrl: async (url, filename) => (await wp.uploadImageFromUrl(url, filename))?.source_url ?? null,
        updatePost: async (id, content) => { await wp.updatePost(id, { content }) },
        saveContent: async (postId, content, hostedCount, status) => {
          try {
            await admin.from('blog_posts').update({ content, images_hosted_count: hostedCount, images_status: status }).eq('id', postId)
          } catch {
            // images_hosted_count needs migration 339. Keep the content write,
            // which is the part the reader sees.
            await admin.from('blog_posts').update({ content }).eq('id', postId)
          }
        },
        sourceAlive: defaultSourceAlive,
        afterMoved: makeOgImageFollower(wp),
      })

      perOwner.push({
        ownerId,
        site: site.wordpress_url,
        postsExamined: batch.length,
        moved: result.moved,
        refused: result.refused,
        gone: result.gone,
        siteRefusedEverything: result.siteRefusedEverything,
        summary: describeRun(result, batch.length),
        // Posts the runner declined to touch, which is not the same as posts it
        // tried and failed on, and must not be read as either.
        skippedPosts: result.posts.filter(x => x.skipped).length,
        // Capped: a run against a site refusing everything would otherwise
        // return one line per picture and drown the thing worth reading.
        failures: result.failures.slice(0, 5),
      })
    }
  }

  const moved = perOwner.reduce((n, o) => n + (Number(o.moved) || 0), 0)
  const refused = perOwner.reduce((n, o) => n + (Number(o.refused) || 0), 0)
  const gone = perOwner.reduce((n, o) => n + (Number(o.gone) || 0), 0)

  return {
    ok: true,
    owners: perOwner.length,
    moved,
    refused,
    gone,
    // The headline says what happened, including when that is nothing. A run
    // reporting ok:true with no numbers beside it is the silence this replaces.
    summary: moved === 0 && refused === 0 && gone === 0
      ? 'Nothing was moved and nothing was refused, so there was nothing to do this run.'
      : `Moved ${moved}, refused ${refused}, gone ${gone}.`,
    results: perOwner,
  }
}
