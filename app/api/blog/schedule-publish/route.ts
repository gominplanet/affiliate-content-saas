/**
 * POST /api/blog/schedule-publish
 *
 * Orchestrator for "Schedule" on a Library row. Generates the blog post
 * NOW (so the user gets immediate preview + the credit is consumed up
 * front), but defers the actual go-live to the chosen timestamp, then
 * cascades chosen social pushes after.
 *
 * Two scheduling modes (see lib/schedule-types.ts):
 *   - 'wp-native' → WP holds status=future + post_date; WP cron flips it.
 *   - 'draft-flip' → WP holds status=draft; our cron worker
 *     (/api/cron/process-scheduled) flips it to publish, then the social
 *     children fire at their own scheduled_at.
 *
 * Flow:
 *   1. Auth + light validation (the heavy lifting is in /api/blog/generate
 *      which we invoke internally with scheduleMode + scheduledFor)
 *   2. Invoke /api/blog/generate to produce the post. The route already
 *      knows how to honour wpStatus=future/draft + skip the publish-time
 *      hooks (IndexNow, YouTube backlink) when scheduling.
 *   3. If draft-flip: insert a kind='blog_publish' parent row in
 *      scheduled_posts at scheduledFor — cron will flip the WP post.
 *   4. For each chosen social channel: insert a kind='social' child row
 *      at scheduledFor + offset, linked to the parent for cascade-cancel.
 *      (For wp-native: parent_id is null since there's no MVP-side parent
 *      row — WP handles the publish. Cancelling those falls back to
 *      cancelling each row individually + a separate WP-side cancel.)
 *
 * Body:
 *   {
 *     videoId: string                 // youtube_videos.id
 *     scheduledFor: string             // ISO 8601, future
 *     scheduleMode: 'wp-native' | 'draft-flip'
 *     socials: SocialScheduleEntry[]   // pre-composed body per channel
 *     siteId?: string | null           // multi-site (Pro)
 *     includeImages?: boolean
 *   }
 *
 * Returns:
 *   {
 *     ok: true,
 *     postId: uuid,                    // blog_posts.id
 *     wordpressPostId: number,
 *     wordpressUrl: string,
 *     parentScheduleId?: uuid,         // present in draft-flip mode
 *     childScheduleIds: uuid[],        // one per scheduled social
 *   }
 *
 * Errors return 4xx/5xx with { error: string }.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getPublishContext } from '@/lib/agency-publish'
import { tierAllowsSocial, normalizeTier, type Tier } from '@/lib/tier'
import type { ScheduleMode, SocialScheduleEntry, SchedulableSocial } from '@/lib/schedule-types'
import { queueCascade } from '@/lib/schedule-cascade'
import { scheduleTooFar, SCHEDULE_TOO_FAR_WORDS } from '@/lib/schedule-types'
import { fetchWithTimeout } from '@/lib/fetch-timeout'

const SUPPORTED_SOCIALS: SchedulableSocial[] = ['facebook', 'threads', 'twitter', 'linkedin', 'bluesky', 'telegram', 'pinterest']
const SUPPORTED_MODES: ScheduleMode[] = ['wp-native', 'draft-flip']

// This route SYNCHRONOUSLY awaits the internal /api/blog/generate call, which
// now takes ~250-290s (Opus 4.8 + quality passes). Without an explicit budget
// the platform default can cut the request off mid-generate — so scheduling
// would silently fail. Match the generate route's 600s (Vercel clamps to 300
// without Fluid Compute). See lib/generation-jobs.ts for the same reasoning.
export const maxDuration = 600

/** How long the internal generate call is allowed to take.
 *
 *  The same number the generation worker uses (lib/generation-job-runner's
 *  RUNNER_ABORT_MS), and for the same reason: a post takes about four minutes
 *  to write and publish, and Vercel clamps the invocation at 300s without Fluid
 *  Compute, so 290s leaves room to record the outcome before the platform cuts
 *  the request off. Named as a constant so the guard in
 *  scripts/test-schedule-budget can assert it is passed. */
const GENERATE_BUDGET_MS = 290_000

export async function POST(request: Request) {
  try {
    // A Virtual Assistant publishes through the owner's accounts (lib/agency-publish).
    const pub = await getPublishContext(await createServerClient())
    if ('error' in pub) return pub.error
    const { supabase, user } = pub

    const body = (await request.json()) as {
      videoId?: string
      scheduledFor?: string
      scheduleMode?: ScheduleMode
      socials?: SocialScheduleEntry[]
      siteId?: string | null
      includeImages?: boolean
    }

    const { videoId, scheduledFor, scheduleMode, siteId, includeImages } = body
    const socials = Array.isArray(body.socials) ? body.socials : []

    // ─── Validate input ─────────────────────────────────────────────────
    if (!videoId) return NextResponse.json({ error: 'videoId required' }, { status: 400 })
    if (!scheduledFor) return NextResponse.json({ error: 'scheduledFor required' }, { status: 400 })
    if (!scheduleMode || !SUPPORTED_MODES.includes(scheduleMode)) {
      return NextResponse.json(
        { error: `scheduleMode must be one of ${SUPPORTED_MODES.join(', ')}` },
        { status: 400 },
      )
    }
    const whenMs = new Date(scheduledFor).getTime()
    if (isNaN(whenMs)) {
      return NextResponse.json({ error: 'scheduledFor is not a valid ISO timestamp' }, { status: 400 })
    }
    if (scheduleTooFar(whenMs)) return NextResponse.json({ error: SCHEDULE_TOO_FAR_WORDS }, { status: 400 })
    if (whenMs <= Date.now() + 60_000) {
      return NextResponse.json(
        { error: 'scheduledFor must be at least 1 minute in the future' },
        { status: 400 },
      )
    }
    // Tier read — same gate the manual schedule-post + generate routes
    // use. Picking a specific account-id is a Pro feature; the gate is
    // applied per-row below.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    // Normalize at the read site: a legacy DB value ('growth'/'starter'/'free')
    // must map to a canonical Tier, else the account-gate below (and any direct
    // tier comparison) misbehaves for former-Pro rows.
    const tier: Tier = normalizeTier(tierRow?.tier)

    // Validate each social entry now so we can early-error before we
    // burn a generation credit.
    for (const s of socials) {
      if (!s.platform || !SUPPORTED_SOCIALS.includes(s.platform)) {
        return NextResponse.json(
          { error: `social.platform must be one of ${SUPPORTED_SOCIALS.join(', ')}` },
          { status: 400 },
        )
      }
      if (!tierAllowsSocial(tier, s.platform)) {
        return NextResponse.json(
          { error: `${s.platform} auto-publish is not available on your plan.` },
          { status: 403 },
        )
      }
      if (!s.bodyText || !s.bodyText.trim()) {
        return NextResponse.json(
          { error: `social.bodyText required for ${s.platform} (lock in the body before scheduling)` },
          { status: 400 },
        )
      }
    }

    // ─── 1. Invoke /api/blog/generate to produce the post ─────────────────
    // We forward the request cookies so the inner route sees the same
    // authenticated user.
    //
    // 2026-06-06 regression note: the audit suggested switching to
    // NEXT_PUBLIC_APP_URL for host hardening, but if that env var is set
    // to the marketing domain (or any wrong origin) the internal fetch
    // 404s and the user sees the generic "Blog generation failed"
    // toast with no signal. Reverted to using request.url.host —
    // Vercel doesn't honor X-Forwarded-Host for `request.url` so the
    // spoofing concern was theoretical. If a future deployment puts a
    // header-rewriting CDN in front, revisit then with an allowlist.
    const url = new URL(request.url)
    const generateUrl = `${url.protocol}//${url.host}/api/blog/generate`
    const cookieHeader = request.headers.get('cookie') ?? ''
    const genRes = await fetchWithTimeout(generateUrl, {
      // ── NAME THE BUDGET, OR GET THIRTY SECONDS ────────────────────────────
      //
      // fetchWithTimeout applies DEFAULT_TIMEOUT_MS (30s) to any caller that
      // names no deadline of its own. Generating and publishing a post takes
      // 250 to 290 seconds, as the maxDuration comment at the top of this file
      // says in as many words. So from the day the default landed, every single
      // scheduled post aborted here at thirty seconds.
      //
      // What made it invisible is that aborting this fetch does not stop the
      // work. The generate route is a SEPARATE invocation: it carried on,
      // finished, created the WordPress draft, and wrote scheduled_for and
      // schedule_mode onto blog_posts. Only the rows BELOW were lost, and they
      // are the ones that publish the post and fire the social cascade. The
      // creator got a schedule recorded in his dashboard, a draft on his site,
      // and nothing that would ever join them up.
      //
      // Reported 17 Sep by a creator whose posts stopped going out. His last
      // scheduled_posts row is dated 8 Sep; commit cc7b7a25, "Give outbound
      // calls a deadline", is dated 8 Sep. Before it, two blog_publish rows and
      // fourteen social rows every day like clockwork. After it, none.
      //
      // The same regression was found and fixed for the auto-pilot worker on
      // 10 Sep, by teaching fetchWithTimeout to respect a caller-supplied
      // signal. That fix could not help this call, because this call never
      // named a budget at all. Both are passed here, matching the worker.
      timeoutMs: GENERATE_BUDGET_MS,
      signal: AbortSignal.timeout(GENERATE_BUDGET_MS),
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieHeader },
      body: JSON.stringify({
        videoId,
        siteId: siteId ?? null,
        // Skip the generate route's own (unreliable, Vercel-cut-off) after()
        // image block. The client fires the reliable /api/blog/refresh-images
        // step after this returns — the same path the Library "Add images" and
        // "Generate + publish all" buttons use — so images are baked into the
        // post before it goes live, without double-generating (double cost).
        includeImages: false,
        scheduleMode,
        scheduledFor,
        // Queue the cascade inside generate, right after the post is saved
        // (lib/schedule-cascade): if this request runs out of time, the
        // socials are queued anyway.
        queueCascade: true,
        socials,
      }),
    })
    // Read response as text first so we can log the actual body when
    // it isn't JSON (the previous behaviour was to silently fall back
    // to the generic error toast — that's how the NEXT_PUBLIC_APP_URL
    // misconfig went undetected for a session).
    const genText = await genRes.text()
    let genJson: { success?: boolean; postId?: string; wordpressPostId?: number; wordpressUrl?: string; error?: string; title?: string } = {}
    try { genJson = JSON.parse(genText) } catch { /* not JSON */ }
    if (!genRes.ok || !genJson.success || !genJson.postId || !genJson.wordpressPostId) {
      const bodySnippet = (typeof genText === 'string' ? genText.slice(0, 400) : '').replace(/\s+/g, ' ').trim()
      console.error('[schedule-publish] generate failed', {
        status: genRes.status,
        ok: genRes.ok,
        hasSuccess: !!genJson.success,
        hasPostId: !!genJson.postId,
        hasWpPostId: !!genJson.wordpressPostId,
        error: genJson.error,
        bodySnippet: genJson.error ? undefined : bodySnippet,
        generateUrl,
      })
      const surfaceMsg = genJson.error
        || (genRes.status === 404 ? `Internal generate route returned 404. Check NEXT_PUBLIC_APP_URL / host config (tried ${generateUrl})` : null)
        || `Blog generation failed (HTTP ${genRes.status}). ${bodySnippet ? `Response: ${bodySnippet.slice(0, 200)}` : 'Check server logs.'}`
      return NextResponse.json(
        { error: surfaceMsg },
        { status: genRes.status || 500 },
      )
    }

    const blogPostId = genJson.postId
    const wpPostId = genJson.wordpressPostId
    const wpUrl = genJson.wordpressUrl
    console.log('[schedule-publish] generate ok', { blogPostId, wpPostId, scheduleMode, scheduledFor, socialCount: socials.length })

    // ─── 2. The cascade (lib/schedule-cascade) ─────────────────────────────
    // Generate queued it already, right after saving the post; this call is
    // idempotent, so it returns those rows, or writes them if generate could
    // not. Either way a platform is queued once.
    const cascade = await queueCascade(supabase, { userId: user.id, blogPostId, scheduleMode, scheduledFor, title: genJson.title || '', socials })
    const parentScheduleId: string | null = cascade.parentScheduleId
    if (scheduleMode === 'draft-flip' && cascade.parentMissingColumn) {
      // Migration 103 not applied: no blog_publish row can exist, so hand the
      // publish to WordPress's own cron instead.
      {
        console.warn('[schedule-publish] migration 103 not detected — degrading draft-flip to wp-native')
        try {
          // Resolve creds + flip WP status.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { getWordPressCredentials } = await import('@/lib/wordpress-sites')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { createWordPressService } = await import('@/services/wordpress')
          const creds = await getWordPressCredentials(supabase, user.id, siteId ?? null)
          if (creds) {
            const wp = createWordPressService(creds.wordpress_url, creds.wordpress_username, creds.wordpress_app_password, creds.wordpress_api_token ?? undefined)
            await wp.updatePost(wpPostId, { status: 'future', date: new Date(scheduledFor).toISOString() })
            // Audit fix 2026-06-06: update blog_posts.schedule_mode to
            // reflect what actually happened. We TOLD the generate route
            // 'draft-flip' but the live state is wp-native — without
            // this update, the Library badge + cancel-schedule path
            // would behave inconsistently with what WP is doing.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
              .from('blog_posts')
              .update({ schedule_mode: 'wp-native' })
              .eq('id', blogPostId)
              .eq('user_id', user.id)
              .catch(() => { /* non-fatal */ })
          } else {
            // No WP credentials to flip the draft to 'future', and migration 103
            // isn't applied so there's no MVP cron row to publish it either.
            // Falling through would return ok while the post strands as a
            // permanent draft and its social children fire at a 404 draft URL.
            // Fail loudly so the user reconnects and retries instead.
            console.error('[schedule-publish] degrade-to-wp-native: no WordPress credentials resolved')
            return NextResponse.json(
              { error: 'Could not resolve your WordPress connection to schedule this post. Reconnect WordPress under Setup → Integrations, then try again.' },
              { status: 400 },
            )
          }
        } catch (degradeErr) {
          console.error('[schedule-publish] degrade-to-wp-native failed:', degradeErr instanceof Error ? degradeErr.message : String(degradeErr))
          return NextResponse.json(
            { error: `Schedule write failed (migration 103 not applied): the parent row could not be written. Run migration 103 in Supabase, or use "Save as draft" off (wp-native mode).` },
            { status: 500 },
          )
        }
      }
    }
    if (cascade.error) {
      console.error('[schedule-publish] cascade not queued:', cascade.error)
      return NextResponse.json(
        {
          error: `Blog generated, but ${cascade.error}. The blog post is in WordPress, so you can push to socials manually from its card once it goes live.`,
          postId: blogPostId,
          wordpressPostId: wpPostId,
          wordpressUrl: wpUrl,
          parentScheduleId,
        },
        { status: 500 },
      )
    }
    const childScheduleIds = cascade.childScheduleIds
    const skippedPlatforms = cascade.skippedPlatforms
    if (skippedPlatforms.length) console.warn('[schedule-publish] skipped platforms', { userId: user.id, skippedPlatforms })
    console.log('[schedule-publish] cascade', { count: childScheduleIds.length, parentScheduleId, queuedBy: (genJson as { cascade?: unknown }).cascade ? 'generate' : 'schedule-publish' })

    return NextResponse.json({
      ok: true,
      postId: blogPostId,
      wordpressPostId: wpPostId,
      wordpressUrl: wpUrl,
      parentScheduleId,
      childScheduleIds,
      // Channels dropped because they aren't connected — the UI surfaces this
      // so the schedule silently doing less than asked is never a surprise.
      skippedPlatforms,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
