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
import { tierAllowsSocial, normalizeTier, type Tier } from '@/lib/tier'
import type { ScheduleMode, SocialScheduleEntry, SchedulableSocial } from '@/lib/schedule-types'
import { DEFAULT_SOCIAL_OFFSETS_MIN } from '@/lib/schedule-types'

const SUPPORTED_SOCIALS: SchedulableSocial[] = ['facebook', 'threads', 'twitter', 'linkedin', 'bluesky', 'telegram']
const SUPPORTED_MODES: ScheduleMode[] = ['wp-native', 'draft-flip']

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    const tier = (tierRow?.tier as Tier) ?? 'trial'

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
    const genRes = await fetch(generateUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieHeader },
      body: JSON.stringify({
        videoId,
        siteId: siteId ?? null,
        includeImages: includeImages !== false,
        scheduleMode,
        scheduledFor,
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
        || (genRes.status === 404 ? `Internal generate route returned 404 — check NEXT_PUBLIC_APP_URL / host config (tried ${generateUrl})` : null)
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

    // ─── 2. (draft-flip only) Insert the parent blog_publish row ──────────
    // For wp-native, WP handles the flip — we skip this and the social
    // children below have parent_id=null. The user can still
    // individually cancel each scheduled social; cancelling the WP-side
    // publish requires going into wp-admin (we may add an explicit
    // cancel endpoint that PATCHes wp post to draft in a follow-up).
    let parentScheduleId: string | null = null
    let draftFlipDegradedToWpNative = false
    if (scheduleMode === 'draft-flip') {
      // The supabase-generated DB types haven't been regenerated against
      // migration 103 (kind + parent_id columns), so an `as any` cast
      // bypasses the type rejection while the production DB accepts the
      // shape. Same pattern as the rest of the codebase's "post-migration,
      // pre-codegen" inserts. Run `npx supabase gen types` after migration
      // 103 lands to drop the cast.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: parentRow, error: parentErr } = await (supabase as any)
        .from('scheduled_posts')
        .insert({
          user_id: user.id,
          blog_post_id: blogPostId,
          kind: 'blog_publish',
          platform: null,
          scheduled_at: new Date(scheduledFor).toISOString(),
          // body_text is NOT NULL — store the title as a human-readable
          // label for the Scheduled tab. The cron worker doesn't read it
          // for blog_publish rows (it just PATCHes the WP post).
          body_text: `Publish: ${(genJson as { title?: string }).title || 'blog post'}`.slice(0, 500),
          status: 'pending',
        })
        .select('id')
        .single()

      const parentMissingColumn =
        parentErr &&
        typeof parentErr.message === 'string' &&
        /column .* does not exist|does not exist|unknown column/i.test(parentErr.message)

      if (parentErr && parentMissingColumn) {
        // Migration 103 not applied yet — we can't write a kind='blog_publish'
        // row, so our cron has no way to flip the WP post from draft to
        // publish at the scheduled time. Degrade gracefully: PATCH the WP
        // post from 'draft' to 'future' with the chosen date, so WordPress's
        // own cron handles publish. We lose the "edit before live" window
        // (the post was created as draft, but flipping to future still
        // allows manual edits via wp-admin), but the post WILL go live at
        // the scheduled time and the social cascade still works.
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
            draftFlipDegradedToWpNative = true
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
          }
        } catch (degradeErr) {
          console.error('[schedule-publish] degrade-to-wp-native failed:', degradeErr instanceof Error ? degradeErr.message : String(degradeErr))
          return NextResponse.json(
            { error: `Schedule write failed (migration 103 not applied): ${parentErr.message}. Run migration 103 in Supabase, or use "Save as draft" off (wp-native mode).` },
            { status: 500 },
          )
        }
      } else if (parentErr || !parentRow) {
        return NextResponse.json(
          { error: `Schedule write failed: ${parentErr?.message || 'unknown'}` },
          { status: 500 },
        )
      } else {
        parentScheduleId = parentRow.id
      }
    }

    // ─── 3. Insert child social rows ───────────────────────────────────────
    // One row per chosen platform at scheduledFor + offset. For Pro
    // multi-account users we accept a specific socialAccountId; otherwise
    // it stays null and the cron falls back to the user's default
    // integrations credentials.
    const childRows: Array<{
      user_id: string
      blog_post_id: string
      platform: SchedulableSocial
      scheduled_at: string
      body_text: string
      status: 'pending'
      kind: 'social'
      parent_id: string | null
      social_account_id: string | null
    }> = []
    // Audit perf fix 2026-06-06: batch the social_account_id lookups
    // instead of one-await-per-platform (was a 500-900ms N+1 for a Pro
    // user picking accounts on 6 channels).
    const accountIdsRequested = socials
      .map(s => s.socialAccountId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    const allowedAccountIds = new Set<string>()
    if (accountIdsRequested.length > 0 && ['pro', 'admin'].includes(normalizeTier(tier))) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: accts } = await supabase
        .from('social_accounts')
        .select('id,platform')
        .in('id', accountIdsRequested)
        .eq('user_id', user.id)
      for (const a of (accts ?? []) as Array<{ id: string; platform: string }>) {
        // Composite key id|platform so we don't accept a Twitter id for a
        // LinkedIn slot.
        allowedAccountIds.add(`${a.id}|${a.platform}`)
      }
    }

    const baseMs = new Date(scheduledFor).getTime()
    for (const s of socials) {
      const offsetMin = typeof s.offsetMinutes === 'number'
        ? s.offsetMinutes
        : DEFAULT_SOCIAL_OFFSETS_MIN[s.platform]
      const fireAt = new Date(baseMs + offsetMin * 60_000).toISOString()

      // Use the pre-batched account allowlist.
      let resolvedAccountId: string | null = null
      if (s.socialAccountId && allowedAccountIds.has(`${s.socialAccountId}|${s.platform}`)) {
        resolvedAccountId = s.socialAccountId
      }

      childRows.push({
        user_id: user.id,
        blog_post_id: blogPostId,
        platform: s.platform,
        scheduled_at: fireAt,
        body_text: s.bodyText.trim(),
        status: 'pending',
        kind: 'social',
        parent_id: parentScheduleId,
        social_account_id: resolvedAccountId,
      })
    }

    let childScheduleIds: string[] = []
    if (childRows.length > 0) {
      // Defensive insert: first try with kind + parent_id (migration 103
      // schema). If that fails because either column doesn't exist
      // (migration not applied yet on the target DB), retry WITHOUT them
      // so social pushes still queue and the cron still publishes them
      // — the parent draft-flip just won't have its tree linked for
      // cascade-cancel. Better than silently dropping every push.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let { data: insertedChildren, error: childErr } = await (supabase as any)
        .from('scheduled_posts')
        .insert(childRows)
        .select('id')

      const looksLikeMissingColumn =
        childErr &&
        typeof childErr.message === 'string' &&
        /column .* does not exist|does not exist|unknown column/i.test(childErr.message)

      if (childErr && looksLikeMissingColumn) {
        console.warn('[schedule-publish] migration 103 not detected, retrying with legacy schema:', childErr.message)
        const legacyRows = childRows.map(r => ({
          user_id: r.user_id,
          blog_post_id: r.blog_post_id,
          platform: r.platform,
          scheduled_at: r.scheduled_at,
          body_text: r.body_text,
          status: r.status,
          social_account_id: r.social_account_id,
        }))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const retry = await (supabase as any)
          .from('scheduled_posts')
          .insert(legacyRows)
          .select('id')
        insertedChildren = retry.data
        childErr = retry.error
      }

      if (childErr) {
        // Hard 500 — the user paid for a generation and we couldn't
        // queue the cascade. Surface the underlying error so the user
        // (or support) can act. The blog post is in WordPress already;
        // they can push manually from the Library row.
        console.error('[schedule-publish] child insert failed (hard):', childErr.message)
        return NextResponse.json(
          {
            error: `Blog generated, but social pushes failed to queue. Cause: ${childErr.message}. The blog post is in WordPress — you can push to socials manually from the Library row once it goes live.`,
            postId: blogPostId,
            wordpressPostId: wpPostId,
            wordpressUrl: wpUrl,
            parentScheduleId,
          },
          { status: 500 },
        )
      }
      childScheduleIds = ((insertedChildren ?? []) as Array<{ id: string }>).map(r => r.id)
      console.log('[schedule-publish] queued children', { count: childScheduleIds.length, childScheduleIds, parentScheduleId })
    }

    return NextResponse.json({
      ok: true,
      postId: blogPostId,
      wordpressPostId: wpPostId,
      wordpressUrl: wpUrl,
      parentScheduleId,
      childScheduleIds,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
