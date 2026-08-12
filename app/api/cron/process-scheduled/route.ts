/**
 * GET /api/cron/process-scheduled
 *
 * Vercel cron worker. Fires on the schedule in vercel.json (every minute).
 * Picks up due scheduled_posts rows, publishes them to the target platform,
 * and updates status to 'completed' or 'failed'.
 *
 * Auth: Vercel cron requests carry `Authorization: Bearer ${CRON_SECRET}`.
 * Set CRON_SECRET in Vercel env vars to any random string. Any request
 * without a matching header is rejected.
 *
 * No retries in v1 — a failed publish is marked 'failed' with the error
 * message and stops. Users can re-schedule from the UI if they want.
 *
 * Concurrency safety: we issue an atomic UPDATE that claims pending+due
 * rows to status='processing' in one DB round-trip. Two cron invocations
 * racing for the same row → one wins, the other sees an empty result.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSession as createBlueskySession, createPost as createBlueskyPost } from '@/services/bluesky'
import { createTweet, refreshAccessToken as refreshTwitterToken } from '@/services/twitter'
import { reserveXPost, refundXPost, xCapMessage } from '@/lib/x-cap'
import { ThreadsService } from '@/services/threads'
import { recordSocialPermalink } from '@/lib/social-permalink'
import { socialPermalink } from '@/lib/brand-recap'
import { createFacebookService } from '@/services/facebook'
import { createLinkedInService } from '@/services/linkedin'
import { fetchOgImage, stripLinkPlaceholders } from '@/lib/og-image'
import { sendPhoto, sendMessage, escapeMarkdownV2 } from '@/services/telegram'
import { capSocialText, SOCIAL_LIMITS } from '@/lib/social-cap'
import { decryptIntegrationRow, encryptIntegrationWrite } from '@/lib/integration-secrets'
import { scrubBanned } from '@/lib/scrub'
import { maybeDecrypt } from '@/lib/secrets'
import { getDeadChannels, shouldSkipChannel, autoSkipMessage, type DeadChannel } from '@/lib/channel-health'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials, isSitePaused } from '@/lib/wordpress-sites'
import { normalizeTier } from '@/lib/tier'
import { isPlainPermalink } from '@/lib/clean-permalink'
import { pingIndexNowForUrl } from '@/lib/seo-on-publish'
import { publishTikTokForTarget, type TikTokScheduleOptions } from '@/lib/tiktok-publish'
import { publishInstagramForTarget, type IgMode } from '@/lib/instagram-publish'
import { publishPinForPost } from '@/lib/pin-publish'
import { resolveBestThumbnail } from '@/lib/youtube-frames'
import { resolvePostAffiliateLink } from '@/lib/ig-dm'
import { ensureAffiliateGeniuslink } from '@/lib/blog-share-url'
import { resolveGeniuslinkGroupId } from '@/lib/geniuslink-group'
import { parseLinkPrefs, linkPrefFor, composeCaption, primaryCardUrl, effectiveDisclosure, youtubeWatchUrl } from '@/lib/social-link-mode'
import { buildPinAssets, composePinDescription } from '@/lib/pin-assets'
import { ensureDisclaimer, AFFILIATE_DISCLAIMER_DEFAULT } from '@/lib/social-disclaimer'

// Vercel cron functions run with a generous timeout but we still want
// to cap the per-tick work — if the batch is huge we'll catch the
// stragglers on the next minute.
const MAX_PER_TICK = 25
export const maxDuration = 60

// Disclaimer used by Threads + Telegram + Facebook so the body the user
// edited stays clean and we append ours at publish time.
const THREADS_DISCLAIMER = '#ad — As an Amazon Associate I earn from qualifying purchases.'

// Long-form disclaimer guarantee (LinkedIn, Telegram) — see lib/social-disclaimer.
// Short-form (X, Bluesky) carry the blog link; the full disclosure lives on the
// destination post.

interface ScheduledRow {
  id: string
  user_id: string
  blog_post_id: string
  /** 'social' = a social push to a specific platform. 'blog_publish' =
   *  flip the underlying WP post from status=draft to status=publish
   *  (only used by the draft-flip schedule mode; wp-native scheduling
   *  doesn't generate these rows — WP's own cron handles the flip). */
  kind: 'social' | 'blog_publish'
  /** Required when kind='social'; null when kind='blog_publish'. */
  platform: 'facebook' | 'threads' | 'twitter' | 'linkedin' | 'bluesky' | 'telegram' | 'tiktok' | 'instagram' | 'pinterest' | null
  body_text: string
  /** Optional chosen destination (multi-account). Null = use the user's
   *  default / legacy integrations credentials. */
  social_account_id?: string | null
  /** How many times this row has already been requeued after a transient
   *  failure. Bounded by MAX_PUBLISH_RETRIES. */
  retry_count?: number
}

// Transient upstream errors (network blips / 5xx / timeouts) shouldn't kill a
// scheduled post — requeue it a bounded number of times instead of marking it
// permanently failed. Mirrors the classifier in blog/generate.
const MAX_PUBLISH_RETRIES = 2
const TRANSIENT_RE = /terminated|fetch failed|socket|ECONNRESET|ETIMEDOUT|EAI_AGAIN|aborted|network|timeout|overloaded|rate.?limit|\b429\b|internal server error|\b5\d{2}\b|502|503|504/i

interface BlogPostRow {
  id: string
  title: string | null
  wordpress_url: string | null
  /** WordPress post id — used by the Pinterest pin to look up the post's
   *  category and route the pin to the matching board. */
  wordpress_post_id?: number | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  youtube_videos?: any
}

interface IntegrationRow {
  facebook_page_id?: string | null
  facebook_page_access_token?: string | null
  threads_access_token?: string | null
  threads_user_id?: string | null
  twitter_access_token?: string | null
  twitter_refresh_token?: string | null
  // X is the one platform whose expiry column is a timestamptz named
  // twitter_expires_at. The others are `<platform>_token_expiry` epoch ms.
  twitter_expires_at?: string | null
  linkedin_access_token?: string | null
  linkedin_person_id?: string | null
  bluesky_handle?: string | null
  bluesky_app_password?: string | null
  telegram_bot_token?: string | null
  telegram_channel_id?: string | null
}

export async function GET(request: Request) {
  // Vercel cron auth
  const auth = request.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not set on server' }, { status: 500 })
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  // 0. Stuck-claim recovery (audit 2026-06-06). Rows stuck in 'processing'
  // for >5 min were claimed by a tick that crashed mid-publish — they
  // block their slot forever unless an admin manually retries. Reclaim them
  // for the current tick, but with an attempt cap (via retry_count) so a
  // publish that hard-crashes the function BEFORE its try/catch every time
  // (e.g. a call that hangs to the 60s ceiling) is terminal-failed instead of
  // re-claimed forever — MAX_PUBLISH_RETRIES only covers the caught-error path.
  // Best-effort: if the RPC isn't live yet (migration 249) the tick still
  // proceeds to the claim below.
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: reclaimErr } = await (admin as any).rpc('reclaim_stuck_scheduled_posts', {
    p_table: 'scheduled_posts',
    p_stuck_before: fiveMinAgo,
    p_max_attempts: MAX_PUBLISH_RETRIES,
  })
  if (reclaimErr) console.error('[cron/process-scheduled] reclaim failed', reclaimErr.message)

  // 1. Atomic claim — flip due+pending rows to 'processing' in one update.
  // Schema-agnostic: we DON'T select `kind` here because that column was
  // added in migration 103 and the cron must keep running on databases
  // where migration 103 hasn't been applied yet. Instead we synthesize
  // kind from `platform`: rows where platform is null are blog_publish
  // (only possible post-migration-103); rows with a platform are social
  // (works on every schema version).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: claimed, error: claimErr } = await (admin as any)
    .from('scheduled_posts')
    .update({ status: 'processing', claimed_at: nowIso, last_attempt_at: nowIso })
    .eq('status', 'pending')
    .lte('scheduled_at', nowIso)
    .select('id,user_id,blog_post_id,platform,body_text,social_account_id,retry_count')
    .limit(MAX_PER_TICK)

  if (claimErr) {
    return NextResponse.json({ error: `Claim failed: ${claimErr.message}` }, { status: 500 })
  }

  // claimed comes back with platform typed as `string | null`. Synthesize
  // `kind` based on the platform — rows with platform=null are blog_publish
  // rows (the parent in draft-flip mode), rows with a platform are social
  // pushes. Works whether or not migration 103 has been applied.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: ScheduledRow[] = ((claimed ?? []) as Array<Record<string, unknown>>).map(r => ({
    id: r.id as string,
    user_id: r.user_id as string,
    blog_post_id: r.blog_post_id as string,
    platform: (r.platform as ScheduledRow['platform']) ?? null,
    body_text: (r.body_text as string) ?? '',
    social_account_id: (r.social_account_id as string | null | undefined) ?? null,
    retry_count: (r.retry_count as number | null | undefined) ?? 0,
    kind: r.platform == null ? 'blog_publish' : 'social',
  }))
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 })
  }

  // 1.5 Dead-channel guard.
  //
  // A creator with an expired X token + an unconnected Telegram was failing
  // EVERY scheduled post, every day, silently (39 of 43 weekly failures came
  // from one account). Look up each affected user's dead channels once, then
  // skip those rows instead of hammering a connection we already know is
  // broken. shouldSkipChannel still lets ONE real attempt through per day, so
  // the moment they reconnect publishing resumes on its own. Skipped rows are
  // tagged with AUTO_SKIP_PREFIX so they never count toward the streak that
  // marks a channel dead (otherwise skipping would keep it dead forever).
  const socialUserIds = [...new Set(rows.filter(r => r.platform).map(r => r.user_id))]
  const deadByUser = new Map<string, DeadChannel[]>()
  await Promise.all(socialUserIds.map(async (uid) => {
    // requireConnected: false — the cron pauses NEVER-CONNECTED platforms too
    // (that's most of the failure volume), it just doesn't nag the user about
    // them. The topbar alert uses the default (connected-only).
    deadByUser.set(uid, await getDeadChannels(admin, uid, { requireConnected: false }))
  }))
  const skipRows: ScheduledRow[] = []
  const liveRows: ScheduledRow[] = []
  for (const row of rows) {
    const dead = row.platform
      ? (deadByUser.get(row.user_id) || []).find(d => d.platform === row.platform)
      : undefined
    if (dead && shouldSkipChannel(dead)) skipRows.push(row)
    else liveRows.push(row)
  }
  if (skipRows.length) {
    await Promise.allSettled(skipRows.map(row =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (admin as any)
        .from('scheduled_posts')
        .update({
          status: 'failed',
          error_message: autoSkipMessage(row.platform as string).slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id),
    ))
    console.warn('[cron/process-scheduled] auto-skipped dead channels',
      skipRows.map(r => `${r.user_id.slice(0, 8)}:${r.platform}`))
  }

  // 2. Publish all claimed rows in PARALLEL.
  //
  // Perf (audit 2026-06-02): previously serial. Each publish is
  // 1-4s, so 25 claimed rows could take 100s — past this route's
  // `maxDuration = 60`, dropping the tail silently. They're
  // independent (different blog posts, often different users,
  // different platforms) so parallelism is safe. allSettled means
  // one failure doesn't poison the batch.
  const results = await Promise.allSettled(liveRows.map(async (row): Promise<{ id: string; ok: boolean; error?: string; externalId?: string }> => {
    try {
      const result = await publishOne(admin, row)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await admin
        .from('scheduled_posts')
        .update({
          status: 'completed',
          external_id: result.externalId ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      return { id: row.id, ok: true, externalId: result.externalId }
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err)
      // Scrub sensitive substrings before persisting to DB. Provider
      // error bodies (LinkedIn, Twitter, etc.) routinely echo Bearer
      // tokens, basic-auth headers, and access_token= params back in
      // their response payloads. We persist a sanitized version so the
      // admin dashboard + notification bell don't leak secrets across
      // tenants. Audit fix 2026-06-06.
      const msg = rawMsg
        .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
        .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [REDACTED]')
        .replace(/access_token=[^&\s"]+/gi, 'access_token=[REDACTED]')
        .replace(/refresh_token=[^&\s"]+/gi, 'refresh_token=[REDACTED]')
        .replace(/"access_token"\s*:\s*"[^"]+"/gi, '"access_token":"[REDACTED]"')
        .replace(/"refresh_token"\s*:\s*"[^"]+"/gi, '"refresh_token":"[REDACTED]"')
      // Transient upstream blip → requeue (back to 'pending') for the next tick
      // instead of a permanent 'failed', up to MAX_PUBLISH_RETRIES. The idempotency
      // guard in publishOne stops a retry from double-posting if the earlier
      // attempt actually reached the platform. A retried row also doesn't pollute
      // the dead-channel streak (it never lands as 'failed').
      const attempts = (row.retry_count ?? 0)
      const isTransient = TRANSIENT_RE.test(rawMsg)
      if (isTransient && attempts < MAX_PUBLISH_RETRIES) {
        console.warn('[cron/process-scheduled] transient publish error — requeueing', { id: row.id, platform: row.platform, attempt: attempts + 1, error: msg })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any)
          .from('scheduled_posts')
          .update({ status: 'pending', retry_count: attempts + 1, error_message: msg.slice(0, 500), updated_at: new Date().toISOString() })
          .eq('id', row.id)
        return { id: row.id, ok: false, error: `retry ${attempts + 1}/${MAX_PUBLISH_RETRIES}: ${msg}` }
      }
      console.error('[cron/process-scheduled] publish failed', { id: row.id, platform: row.platform, error: msg })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await admin
        .from('scheduled_posts')
        .update({
          status: 'failed',
          error_message: msg.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      return { id: row.id, ok: false, error: msg }
    }
  }))

  // Promise.allSettled never rejects, so we just unwrap the values.
  const flatResults = results.map(r => r.status === 'fulfilled' ? r.value : { id: 'unknown', ok: false, error: 'fulfilment failed' })

  return NextResponse.json({ ok: true, processed: rows.length, results: flatResults })
}

/**
 * Per-row dispatch. kind='blog_publish' goes to flipBlogPostToPublished
 * (PATCHes WP from draft to publish); kind='social' goes to the existing
 * per-platform publishOne.
 */
async function publishOne(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  row: ScheduledRow,
): Promise<{ externalId?: string }> {
  if (row.kind === 'blog_publish') {
    return flipBlogPostToPublished(admin, row)
  }
  // Social path — platform is guaranteed non-null by the kind ↔ platform
  // DB check constraint (migration 103), but TS can't see that, so
  // narrow here for the exhaustive switch below.
  // Scrub ONCE here rather than per-platform. Every immediate publish route
  // wraps its body in scrubBanned, but this cron never did — so "Publish"
  // stripped banned words and "Schedule for later" shipped them verbatim,
  // including ones we forbid outright. Facebook, Threads and X were the live
  // cases; LinkedIn/Telegram/Bluesky happened to be clean because their
  // dry-runs pre-scrub. Doing it at the single entry point means a platform
  // added later can't quietly miss it. scrubBanned is idempotent, so the
  // already-clean platforms are unaffected.
  //
  // Must sit ABOVE the platform guard: reassigning `row` after it would reset
  // TS's non-null narrowing and break the exhaustive `never` check below.
  row = { ...row, body_text: scrubBanned(row.body_text) }

  if (!row.platform) {
    throw new Error(`scheduled_posts row ${row.id}: kind=social but platform is null (DB invariant broken)`)
  }

  // Vertical video posts (TikTok / Instagram Reels) resolve the 9:16 render from
  // blog_post_id and Direct-Post via the shared publishers — they don't need the
  // text-social WP-URL + integration path below. Per-platform settings live in
  // `options` (migration 137); fetched here so the main claim query stays
  // schema-safe on DBs that predate the column.
  if (row.platform === 'tiktok' || row.platform === 'instagram') {
    let options: Record<string, unknown> = {}
    let videoId: string | null = null
    try {
      // options + video_id added in migrations 137/138 — fetched here (not in the
      // main claim) so the cron keeps running on DBs that predate them. These
      // rows can only exist post-migration anyway.
      const { data: optRow } = await admin.from('scheduled_posts').select('options,video_id').eq('id', row.id).maybeSingle()
      if (optRow?.options && typeof optRow.options === 'object') options = optRow.options as Record<string, unknown>
      videoId = (optRow?.video_id as string | null) ?? null
    } catch { /* columns absent on an old DB — these rows can't exist there */ }
    const target = { blogPostId: row.blog_post_id || null, videoId }
    if (row.platform === 'tiktok') {
      const tkOpts: TikTokScheduleOptions = {
        privacyLevel: (options.privacyLevel as TikTokScheduleOptions['privacyLevel']) || 'SELF_ONLY',
        disableComment: !!options.disableComment,
        disableDuet: !!options.disableDuet,
        disableStitch: !!options.disableStitch,
        brandContentToggle: !!options.brandContentToggle,
        brandOrganicToggle: !!options.brandOrganicToggle,
      }
      const { publishId } = await publishTikTokForTarget(admin, row.user_id, target, row.body_text, tkOpts)
      return { externalId: publishId }
    }
    const r = await publishInstagramForTarget(admin, row.user_id, target, row.body_text, (options.mode as IgMode) || 'reel')
    return { externalId: r.reelId || r.storyId || undefined }
  }

  // Pull the blog post + integration creds
  const [postRes, intRes] = await Promise.all([
    admin
      .from('blog_posts')
      .select('id,title,wordpress_url,wordpress_post_id,wordpress_site_id,geniuslink_code,content,twitter_post_id,threads_post_id,linkedin_post_id,facebook_post_id,bluesky_post_uri,pinterest_pin_id,telegram_message_id,youtube_videos(thumbnail_url,youtube_video_id)')
      .eq('id', row.blog_post_id)
      .single(),
    admin
      .from('integrations')
      .select('*')
      .eq('user_id', row.user_id)
      .single(),
  ])

  const post: BlogPostRow | null = postRes.data
  // Transparently decrypt every encrypted secret column on the
  // integrations row (2026-06-02 rollout). Downstream code reads
  // tokens via `integration.<field>` as before — they're plaintext
  // now thanks to the wrap.
  const integration: IntegrationRow | null = decryptIntegrationRow(intRes.data)
  if (!post) throw new Error('Blog post no longer exists')
  if (!integration) throw new Error('User has no integrations row')
  if (!post.wordpress_url) {
    throw new Error('Blog post has no published URL')
  }

  // Idempotency guard: if this post already carries this platform's external id,
  // a previous run published it and (most likely) the function died before the
  // row was flipped to `completed`, so stuck-recovery re-queued it. Publishing
  // again would post a duplicate. The id column is written ONLY on a successful
  // publish, so its presence means "already posted" — return it and let the row
  // complete cleanly. Closes the common crash-after-publish-before-completed
  // window (audit follow-up #1). TikTok/Instagram handled above (no shared id).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = post as any
  const existingExternalId: Record<string, unknown> = {
    twitter: p.twitter_post_id,
    threads: p.threads_post_id,
    linkedin: p.linkedin_post_id,
    facebook: p.facebook_post_id,
    bluesky: p.bluesky_post_uri,
    pinterest: p.pinterest_pin_id,
    telegram: p.telegram_message_id,
  }
  const alreadyPosted = existingExternalId[row.platform]
  if (alreadyPosted) {
    console.warn(`[process-scheduled] row ${row.id}: ${row.platform} already has external id ${String(alreadyPosted)} — skipping republish (idempotency)`)
    return { externalId: String(alreadyPosted) }
  }

  let url = post.wordpress_url ?? ''

  // Repair an ugly ?p=123 URL before sharing. A post created as a draft or
  // scheduled had its plain permalink captured at create time; once it's live,
  // WordPress reports the real "Post name" URL. If the stored URL is still the
  // ?p= form, fetch the current permalink from WP and persist it so this share
  // (and every future one) uses the clean link. Best-effort — on any failure we
  // fall back to whatever we had.
  if (isPlainPermalink(url) && post.wordpress_post_id) {
    try {
      const siteId = (post as { wordpress_site_id?: string | null }).wordpress_site_id ?? null
      const creds = await getWordPressCredentials(admin, row.user_id, siteId)
      if (creds?.wordpress_url && creds.wordpress_username && creds.wordpress_app_password) {
        const wp = createWordPressService(creds.wordpress_url, creds.wordpress_username, creds.wordpress_app_password, creds.wordpress_api_token ?? undefined)
        const fresh = (await wp.getPostLink(post.wordpress_post_id)).trim()
        if (fresh && !isPlainPermalink(fresh)) {
          url = fresh
          await admin.from('blog_posts').update({ wordpress_url: fresh }).eq('id', post.id)
        }
      }
    } catch { /* keep the stored URL on any failure */ }
  }

  // Per-user link prefs (affiliate on/off × content blog/video/none) for FB /
  // LinkedIn / Bluesky, plus the video URL + Amazon-tag flag for disclosure.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkPrefs = parseLinkPrefs((integration as any).social_link_modes)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let schedAffiliateLink = resolvePostAffiliateLink(post as any)
  // "If a user has a Geniuslink, MVP always uses it." A post generated during a
  // brief Geniuslink outage has no code, so this resolves to the raw Amazon
  // tagged link. When the creator has Geniuslink connected, build one now (in
  // the correct per-site group) and persist the code so every later share reuses
  // it. Best-effort — falls back to the raw tagged link if Geniuslink is down.
  if (schedAffiliateLink && (integration as any)?.geniuslink_api_key && (integration as any)?.geniuslink_api_secret) {
    const glGroupId = await resolveGeniuslinkGroupId({
      supabase: admin,
      siteId: (post as any).wordpress_site_id ?? null,
      siteUrl: (post as any).wordpress_url ?? null,
      apiKey: (integration as any).geniuslink_api_key,
      apiSecret: (integration as any).geniuslink_api_secret,
    }).catch(() => null)
    schedAffiliateLink = await ensureAffiliateGeniuslink(admin, {
      postId: (post as any).id,
      link: schedAffiliateLink,
      title: post.title ?? '',
      apiKey: (integration as any).geniuslink_api_key,
      apiSecret: (integration as any).geniuslink_api_secret,
      groupId: glGroupId,
    })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schedVideoUrl = youtubeWatchUrl((post as any).youtube_videos?.youtube_video_id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schedHasAmazonTag = !!(integration as any).amazon_associates_tag

  switch (row.platform) {
    // ─────────────────────────── BLUESKY ──────────────────────────────────
    case 'bluesky': {
      if (!integration.bluesky_handle || !integration.bluesky_app_password) {
        throw new Error('Bluesky not connected')
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let bsImage = (post as any).youtube_videos?.thumbnail_url as string | undefined
      if (!bsImage) bsImage = (await fetchOgImage(url)) || undefined // blog og:image (reliable)
      const session = await createBlueskySession(integration.bluesky_handle, integration.bluesky_app_password)
      const bsPref = linkPrefFor(linkPrefs, 'bluesky')
      const bsCard = primaryCardUrl(bsPref, schedAffiliateLink, url, schedVideoUrl) ?? url
      const bsBody = stripLinkPlaceholders(row.body_text)
      const finalText = `${bsBody}${bsPref.product && schedAffiliateLink ? ' #ad' : ''}\n\n${bsCard}`
      const result = await createBlueskyPost(session, {
        text: finalText, linkUrl: bsCard, linkText: bsCard,
        embed: { url: bsCard, title: post.title ?? '', description: (row.body_text || '').slice(0, 200), imageUrl: bsImage },
      })
      // Persist post URI on the blog row to match the manual flow.
      await admin.from('blog_posts').update({ bluesky_post_uri: result.uri }).eq('id', row.blog_post_id)
      return { externalId: result.uri }
    }

    // ─────────────────────────── TWITTER / X ──────────────────────────────
    case 'twitter': {
      let accessToken = integration.twitter_access_token
      if (!accessToken) throw new Error('X not connected')
      let refreshToken = integration.twitter_refresh_token

      // Persist a freshly-refreshed token pair (encrypted) so the next tick
      // and any 401-retry reuse it. Returns the new access token.
      const doRefresh = async (): Promise<string> => {
        if (!refreshToken) throw new Error('X needs reconnecting — no refresh token on file.')
        const refreshed = await refreshTwitterToken(refreshToken)
        refreshToken = refreshed.refresh_token ?? refreshToken
        const { error: saveErr } = await admin.from('integrations').update(encryptIntegrationWrite({
          twitter_access_token: refreshed.access_token,
          twitter_refresh_token: refreshToken,
          twitter_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        })).eq('user_id', row.user_id)
        // X rotates refresh tokens: the one we just spent is now dead on their
        // side. If this write fails we've lost the replacement, so every later
        // refresh 400s until the user reconnects — fail loudly rather than post
        // once and break tomorrow.
        if (saveErr) throw new Error(`X token saved failed — reconnect X: ${saveErr.message}`)
        return refreshed.access_token
      }

      // Proactive refresh when we KNOW it's expired.
      const expiry = integration.twitter_expires_at ? new Date(integration.twitter_expires_at).getTime() : 0
      if (expiry && Date.now() > expiry - 60_000 && refreshToken) {
        try { accessToken = await doRefresh() }
        catch (e) { throw new Error(`X token refresh failed: ${e instanceof Error ? e.message : String(e)}`) }
      }

      // Monthly X post cap (X is the only paid-per-post channel). Reserve a slot
      // ATOMICALLY before posting so several X posts in one tick can't all pass a
      // stale count and overspend. Over cap → fail this post with a clear reason.
      // Refund the reservation if the tweet fails so a blip doesn't burn a slot.
      const xres = await reserveXPost(admin, row.user_id)
      if (!xres.ok) throw new Error(xCapMessage(xres.resetLabel))

      // Cap the body so the trailing link always survives — an un-capped
      // `${body} ${url}` on a near-280-char body pushed the tweet over the limit
      // and X rejected the whole scheduled post. Matches the immediate path.
      const xSuffix = row.body_text.includes(url) ? '' : ` ${url}`
      const finalText = capSocialText(stripLinkPlaceholders(row.body_text), SOCIAL_LIMITS.twitter, xSuffix)
      let result
      try {
        try {
          result = await createTweet(accessToken!, finalText)
        } catch (e) {
          // Reactive refresh: a 401 means the access token is dead even though
          // expiry looked fine (missing/stale expiry, or token revoked then
          // re-issued). Refresh once and retry before giving up.
          const msg = e instanceof Error ? e.message : String(e)
          if (/\b401\b|unauthorized/i.test(msg) && refreshToken) {
            accessToken = await doRefresh()
            result = await createTweet(accessToken, finalText)
          } else {
            throw e
          }
        }
      } catch (e) {
        await refundXPost(admin, xres.reservationId) // tweet failed → don't burn the slot
        throw e
      }
      // Success: the reservation already counted this post (no recordXPost).
      await admin.from('blog_posts').update({ twitter_post_id: result.id }).eq('id', row.blog_post_id)
      await recordSocialPermalink(admin, row.blog_post_id, 'x', socialPermalink.x(result.id))
      return { externalId: result.id }
    }

    // ─────────────────────────── THREADS ──────────────────────────────────
    case 'threads': {
      if (!integration.threads_access_token || !integration.threads_user_id) {
        throw new Error('Threads not connected')
      }
      // Body → blog link → disclaimer, capped to the Threads limit. The link
      // was previously missing entirely (post had no way back to the blog).
      const threadsSuffix = `${row.body_text.includes(url) ? '' : `\n\n🔗 ${url}`}\n\n${THREADS_DISCLAIMER}`
      const fullText = capSocialText(stripLinkPlaceholders(row.body_text), SOCIAL_LIMITS.threads, threadsSuffix)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const imageUrl = (post as any).youtube_videos?.thumbnail_url ?? undefined
      const threads = new ThreadsService(integration.threads_access_token, integration.threads_user_id)
      const result = await threads.createPost(fullText, imageUrl)
      await admin.from('blog_posts').update({ threads_post_id: result.id }).eq('id', row.blog_post_id)
      if (result.permalink) await recordSocialPermalink(admin, row.blog_post_id, 'threads', result.permalink)
      return { externalId: result.id }
    }

    // ─────────────────────────── LINKEDIN ─────────────────────────────────
    case 'linkedin': {
      if (!integration.linkedin_access_token || !integration.linkedin_person_id) {
        throw new Error('LinkedIn not connected')
      }
      // Native IMAGE post (shows the thumbnail) when we can resolve one:
      // video → YouTube thumbnail (joined), else the article's og:image. Scrub
      // any "[link in comments]" placeholder from the stored caption and put the
      // real link in the body (IMAGE posts have no link card).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const liYt = (post as any).youtube_videos?.youtube_video_id
      // resolveBestThumbnail avoids the maxresdefault 404 that non-HD uploads
      // hit — LinkedIn fetches the bytes server-side, so a dead URL breaks the
      // image post (and this runs unattended, so the failure would be silent).
      let liImage = liYt
        ? await resolveBestThumbnail(liYt)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : ((post as any).youtube_videos?.thumbnail_url || '')
      if (!liImage) liImage = (await fetchOgImage(url)) || ''
      const liPref = linkPrefFor(linkPrefs, 'linkedin')
      const liComposed = composeCaption({
        product: liPref.product, content: liPref.content, writeUp: stripLinkPlaceholders(row.body_text),
        blogUrl: url, videoUrl: schedVideoUrl, affiliateLink: schedAffiliateLink,
        disclosure: effectiveDisclosure(AFFILIATE_DISCLAIMER_DEFAULT, schedAffiliateLink, schedHasAmazonTag), blogLabel: 'Read the full review',
      })
      const postText = capSocialText(liComposed, SOCIAL_LIMITS.linkedin)
      const liCardUrl = primaryCardUrl(liPref, schedAffiliateLink, url, schedVideoUrl) ?? url
      const linkedin = createLinkedInService(integration.linkedin_access_token, integration.linkedin_person_id)
      const liArticle = { articleUrl: liCardUrl, articleTitle: post.title ?? '', articleDescription: row.body_text.slice(0, 200) }
      let result: { id: string }
      if (liImage) {
        try {
          result = await linkedin.createImagePost({ text: postText, imageUrl: liImage, title: post.title ?? '', description: row.body_text.slice(0, 200) })
        } catch (imgErr) {
          // Fall back to a text/article post only for image problems. An auth
          // error (expired LinkedIn token) must bubble up so it's classified as
          // 'expired' (reconnect), not silently downgraded to a link post.
          const im = imgErr instanceof Error ? imgErr.message : String(imgErr)
          if (/\b401\b|\b403\b|token|expired|revoked|unauthorized|oauth/i.test(im)) throw imgErr
          result = await linkedin.createPost({ text: postText, ...liArticle })
        }
      } else {
        result = await linkedin.createPost({ text: postText, ...liArticle })
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await admin.from('blog_posts').update({ linkedin_post_id: (result as any).id ?? null }).eq('id', row.blog_post_id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const liId = (result as any).id as string | undefined
      if (liId) await recordSocialPermalink(admin, row.blog_post_id, 'linkedin', socialPermalink.linkedin(liId))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { externalId: (result as any).id }
    }

    // ─────────────────────────── FACEBOOK ─────────────────────────────────
    case 'facebook': {
      // Resolve the target Page: a chosen social_accounts row (if the
      // schedule carried one) or the legacy default integrations columns.
      let fbPageId = integration.facebook_page_id
      let fbPageToken = integration.facebook_page_access_token
      if (row.social_account_id) {
        const { data: acct } = await admin
          .from('social_accounts')
          .select('external_id,access_token')
          .eq('id', row.social_account_id)
          .eq('user_id', row.user_id)
          .eq('platform', 'facebook')
          .maybeSingle()
        if (acct?.external_id && acct?.access_token) {
          fbPageId = acct.external_id
          // social_accounts.access_token is encrypted at rest too
          // (2026-06-02 rollout). Decrypt before use.
          fbPageToken = maybeDecrypt(acct.access_token)
        }
      }
      if (!fbPageId || !fbPageToken) {
        throw new Error('Facebook not connected')
      }
      // Pull the disclaimer from the brand profile (same as the manual endpoint)
      const { data: brand } = await admin
        .from('brand_profiles')
        .select('affiliate_disclaimer')
        .eq('user_id', row.user_id)
        .single()
      const disclaimer = (brand as { affiliate_disclaimer?: string } | null)?.affiliate_disclaimer
        || '⚠️ This post may contain affiliate links. We may earn a commission at no extra cost to you.'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ytId = (post as any).youtube_videos?.youtube_video_id
      // resolveBestThumbnail avoids the maxresdefault 404 that made Facebook
      // reject the photo with "Missing or invalid image file".
      const imageUrl: string = ytId
        ? await resolveBestThumbnail(ytId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : ((post as any).youtube_videos?.thumbnail_url ?? '')
      // Optional "buy it now" CTA — the same opt-in as immediate publish,
      // persisted on the scheduled row's `options`. When on it LEADS the caption
      // (first line + disclaimer), then the blurb + blog link, then a closing
      // disclaimer — matching the manual endpoint. Only when the post has a link.
      let fbIncludeAffiliate = false
      try {
        const { data: fbOpt } = await admin.from('scheduled_posts').select('options').eq('id', row.id).maybeSingle()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fbIncludeAffiliate = !!((fbOpt?.options as any)?.includeAffiliateCta)
      } catch { /* options column absent on an old DB — flag can't exist there */ }
      const fbPref = linkPrefFor(linkPrefs, 'facebook')
      const caption = composeCaption({
        product: fbPref.product, content: fbPref.content, writeUp: row.body_text,
        blogUrl: url, videoUrl: schedVideoUrl, affiliateLink: schedAffiliateLink,
        disclosure: effectiveDisclosure(disclaimer, schedAffiliateLink, schedHasAmazonTag), blogLabel: 'Read the full post',
      })
      const fbFallbackLink = primaryCardUrl(fbPref, schedAffiliateLink, url, schedVideoUrl) ?? url
      const fb = createFacebookService(fbPageToken, fbPageId)
      // Store the PAGE-POST id (a /photos post returns { id: <photo id>,
      // post_id: <PAGEID_POSTID> }; a /feed post returns the page-post id as
      // `id`) so the comment→DM webhook can match this post. Fall back to a
      // link post if the image is unreachable so this unattended job never
      // fails silently.
      let fbPostId: string
      if (imageUrl) {
        try {
          const r = await fb.postPhoto({ imageUrl, caption })
          fbPostId = (r as { id: string; post_id?: string }).post_id || r.id
        } catch (photoErr) {
          // Only fall back to a link post when the IMAGE is the problem. An
          // auth error (expired/revoked Page token) must bubble up so the
          // dead-channel classifier marks it 'expired' (reconnect) instead of a
          // vague 'failing' — otherwise a link post can quietly mask a dying token.
          const pm = photoErr instanceof Error ? photoErr.message : String(photoErr)
          if (/\b401\b|\b403\b|token|expired|revoked|unauthorized|oauth/i.test(pm)) throw photoErr
          const r = await fb.postLink({ message: caption, link: fbFallbackLink })
          fbPostId = r.id
        }
      } else {
        const r = await fb.postLink({ message: caption, link: fbFallbackLink })
        fbPostId = r.id
      }
      await admin.from('blog_posts').update({ facebook_post_id: fbPostId }).eq('id', row.blog_post_id)
      await recordSocialPermalink(admin, row.blog_post_id, 'facebook', socialPermalink.facebook(fbPostId))
      return { externalId: fbPostId }
    }

    // ─────────────────────────── TELEGRAM ─────────────────────────────────
    case 'telegram': {
      // MVP runs ONE shared bot (env TELEGRAM_BOT_TOKEN) — that's what the
      // connect flow verifies against and what /api/blog/telegram-post posts
      // with. The per-user telegram_bot_token column is a leftover from an
      // older bring-your-own-bot design and is never written by any code path,
      // so requiring it here failed EVERY scheduled Telegram post while the
      // immediate "Post now" button worked fine. Prefer a per-user token if one
      // ever exists, else fall back to the shared bot.
      const tgToken = integration.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || ''
      if (!tgToken || !integration.telegram_channel_id) {
        throw new Error('Telegram not connected')
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let imageUrl: string | null = (post as any).youtube_videos?.thumbnail_url ?? null
      if (!imageUrl) imageUrl = (await fetchOgImage(url)) || null
      const escapedBody = escapeMarkdownV2(ensureDisclaimer(stripLinkPlaceholders(row.body_text), AFFILIATE_DISCLAIMER_DEFAULT))
      const escapedUrl = escapeMarkdownV2(url)
      const linkLabel = escapeMarkdownV2('Read the full review →')
      const finalCaption = `${escapedBody}\n\n[${linkLabel}](${escapedUrl})`
      const result = imageUrl
        ? await sendPhoto(tgToken, integration.telegram_channel_id, imageUrl, finalCaption)
        : await sendMessage(tgToken, integration.telegram_channel_id, finalCaption)
      await admin
        .from('blog_posts')
        .update({ telegram_message_id: String(result.messageId) })
        .eq('id', row.blog_post_id)
      return { externalId: String(result.messageId) }
    }

    // ─────────────────────────── PINTEREST ────────────────────────────────
    case 'pinterest': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(integration as any).pinterest_access_token) throw new Error('Pinterest not connected')
      // Build the SAME vertical pin the manual "Pin to Pinterest" button makes —
      // a composed 2:3 image + AI copy — instead of pinning the raw HORIZONTAL
      // thumbnail. The scheduled/cascade path used to fall back to thumbnail_url,
      // so scheduled pins came out landscape and off-brand while manual pins
      // looked right (the exact mismatch a creator reported). buildPinAssets
      // needs the full post row (content/excerpt/image fields), which the cron's
      // lean select doesn't have — fetch it. Falls back to the thumbnail only if
      // composition fails, so a pin still goes out.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: fullPost } = await admin.from('blog_posts').select('*').eq('id', row.blog_post_id).maybeSingle()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let assets: Awaited<ReturnType<typeof buildPinAssets>> | null = null
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        assets = await buildPinAssets(fullPost ?? post, { userId: row.user_id, tier: (integration as any).tier ?? null })
      } catch (e) {
        console.warn('[cron/pinterest] buildPinAssets failed — falling back to thumbnail:', e instanceof Error ? e.message : String(e))
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let fallbackImage: string | null = assets?.fallbackImageUrl ?? (post as any).youtube_videos?.thumbnail_url ?? null
      if (!assets?.imageBase64 && !fallbackImage) fallbackImage = (await fetchOgImage(url)) || null
      if (!assets?.imageBase64 && !fallbackImage) throw new Error('No image available for the Pinterest pin')
      const { pinId } = await publishPinForPost({
        p: post,
        ig: integration,
        site: null,
        title: assets?.title || post.title || '',
        description: assets ? composePinDescription(assets) : (row.body_text || post.title || ''),
        imageBase64: assets?.imageBase64 ?? undefined,
        mediaType: assets?.mediaType ?? undefined,
        fallbackImageUrl: fallbackImage ?? undefined,
      })
      await admin.from('blog_posts').update({ pinterest_pin_id: pinId }).eq('id', row.blog_post_id)
      await recordSocialPermalink(admin, row.blog_post_id, 'pinterest', socialPermalink.pinterest(pinId))
      return { externalId: pinId }
    }

    default: {
      // Exhaustive check — TS will fail if a new platform isn't handled.
      const exhaustive: never = row.platform
      throw new Error(`Unknown platform: ${exhaustive}`)
    }
  }
}

/**
 * Handler for kind='blog_publish' rows — flips the underlying WordPress
 * post from status=draft to status=publish. Only used by the draft-flip
 * schedule mode; wp-native scheduling lets WP's own cron do this.
 *
 * After the flip we fire the deferred publish-time hooks (IndexNow ping)
 * that the generate route skipped because the post wasn't live yet.
 * YouTube backlink is intentionally NOT fired here — it would race
 * against the social cron rows that also just claimed; keeping it
 * publish-time-only for fresh posts is acceptable.
 *
 * The child social rows are NOT touched — they stay pending and fire on
 * their own scheduled_at (which is scheduledFor + offset, i.e. shortly
 * after this row runs).
 */
async function flipBlogPostToPublished(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  row: ScheduledRow,
): Promise<{ externalId?: string }> {
  // Look up the blog post — we need wordpress_post_id + wordpress_site_id
  // (multi-site: a Pro user's post may live on a non-default WP install).
  const { data: post } = await admin
    .from('blog_posts')
    .select('id,wordpress_post_id,wordpress_url,wordpress_site_id')
    .eq('id', row.blog_post_id)
    .maybeSingle()
  if (!post) throw new Error('Blog post no longer exists')
  if (!post.wordpress_post_id) {
    throw new Error('Blog post has no wordpress_post_id — was it ever pushed to WP?')
  }

  // Resolve the matching WP credentials. Pass wordpress_site_id so the
  // post that was created on a specific site gets flipped on THAT site
  // even if the user's default has changed since they scheduled.
  const creds = await getWordPressCredentials(admin, row.user_id, post.wordpress_site_id)
  if (!creds) {
    // Distinguish a paused site (over the tier's site cap after a downgrade)
    // from genuinely-missing credentials, so the schedule row shows an
    // actionable reason instead of a scary "not found".
    if (post.wordpress_site_id) {
      const { data: ig } = await admin
        .from('integrations').select('tier').eq('user_id', row.user_id).maybeSingle()
      const paused = await isSitePaused(
        admin, row.user_id, post.wordpress_site_id, normalizeTier(ig?.tier),
      )
      if (paused) {
        throw new Error(
          'This blog is paused on your current plan — you have more connected sites than your plan publishes to. Upgrade to Pro, or make this blog your active site, to publish here again.',
        )
      }
    }
    throw new Error('WordPress credentials not found for this user/site')
  }

  const wpService = createWordPressService(
    creds.wordpress_url,
    creds.wordpress_username,
    creds.wordpress_app_password,
    creds.wordpress_api_token ?? undefined,
  )

  // The flip itself — single PATCH to /posts/:id with status=publish.
  // WP accepts this even if the post is in 'draft' or 'pending' status.
  const updated = await wpService.updatePost(post.wordpress_post_id, { status: 'publish' })

  // Now that the post is LIVE, WordPress reports its real "Post name" permalink
  // (before publish, `link` is the ugly ?p=123 form). Persist it so the social
  // cascade that runs after this flip shares the clean URL instead of ?p=. Only
  // overwrite when WP gave us a real, non-plain link.
  const freshLink = (updated.link || '').trim()
  if (freshLink && !isPlainPermalink(freshLink) && freshLink !== post.wordpress_url) {
    await admin.from('blog_posts').update({ wordpress_url: freshLink }).eq('id', post.id)
  }

  // Fire the deferred IndexNow ping now that the URL is live.
  // Fire-and-forget so a slow/rejected ping never fails the cron row.
  void pingIndexNowForUrl(admin, row.user_id, updated.link ?? post.wordpress_url ?? '', post.wordpress_site_id ?? null)
    .catch(() => {})

  return { externalId: String(post.wordpress_post_id) }
}
