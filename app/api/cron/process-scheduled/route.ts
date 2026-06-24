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
import { ThreadsService } from '@/services/threads'
import { createFacebookService } from '@/services/facebook'
import { createLinkedInService } from '@/services/linkedin'
import { fetchOgImage, stripLinkPlaceholders } from '@/lib/og-image'
import { sendPhoto, sendMessage, escapeMarkdownV2 } from '@/services/telegram'
import { capSocialText, SOCIAL_LIMITS } from '@/lib/social-cap'
import { decryptIntegrationRow, encryptIntegrationWrite } from '@/lib/integration-secrets'
import { maybeDecrypt } from '@/lib/secrets'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { pingIndexNowForUrl } from '@/lib/seo-on-publish'
import { publishTikTokForBlogPost, type TikTokScheduleOptions } from '@/lib/tiktok-publish'
import { publishInstagramForBlogPost, type IgMode } from '@/lib/instagram-publish'

// Vercel cron functions run with a generous timeout but we still want
// to cap the per-tick work — if the batch is huge we'll catch the
// stragglers on the next minute.
const MAX_PER_TICK = 25
export const maxDuration = 60

// Disclaimer used by Threads + Telegram + Facebook so the body the user
// edited stays clean and we append ours at publish time.
const THREADS_DISCLAIMER = '#ad — As an Amazon Associate I earn from qualifying purchases.'

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
  platform: 'facebook' | 'threads' | 'twitter' | 'linkedin' | 'bluesky' | 'telegram' | 'tiktok' | 'instagram' | null
  body_text: string
  /** Optional chosen destination (multi-account). Null = use the user's
   *  default / legacy integrations credentials. */
  social_account_id?: string | null
}

interface BlogPostRow {
  id: string
  title: string | null
  wordpress_url: string | null
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
  twitter_token_expiry?: number | null
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
  // block their slot forever unless an admin manually retries. Flip them
  // back to 'pending' so the current tick can pick them up. The 5-min
  // threshold matches /admin/cron's "stuck" definition for consistency.
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from('scheduled_posts')
    .update({ status: 'pending', updated_at: nowIso })
    .eq('status', 'processing')
    .lt('claimed_at', fiveMinAgo)

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
    .select('id,user_id,blog_post_id,platform,body_text,social_account_id')
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
    kind: r.platform == null ? 'blog_publish' : 'social',
  }))
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 })
  }

  // 2. Publish all claimed rows in PARALLEL.
  //
  // Perf (audit 2026-06-02): previously serial. Each publish is
  // 1-4s, so 25 claimed rows could take 100s — past this route's
  // `maxDuration = 60`, dropping the tail silently. They're
  // independent (different blog posts, often different users,
  // different platforms) so parallelism is safe. allSettled means
  // one failure doesn't poison the batch.
  const results = await Promise.allSettled(rows.map(async (row): Promise<{ id: string; ok: boolean; error?: string; externalId?: string }> => {
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
    try {
      const { data: optRow } = await admin.from('scheduled_posts').select('options').eq('id', row.id).maybeSingle()
      if (optRow?.options && typeof optRow.options === 'object') options = optRow.options as Record<string, unknown>
    } catch { /* options column absent (pre-137) — these rows can't exist there */ }
    if (row.platform === 'tiktok') {
      const tkOpts: TikTokScheduleOptions = {
        privacyLevel: (options.privacyLevel as TikTokScheduleOptions['privacyLevel']) || 'SELF_ONLY',
        disableComment: !!options.disableComment,
        disableDuet: !!options.disableDuet,
        disableStitch: !!options.disableStitch,
        brandContentToggle: !!options.brandContentToggle,
        brandOrganicToggle: !!options.brandOrganicToggle,
      }
      const { publishId } = await publishTikTokForBlogPost(admin, row.user_id, row.blog_post_id, row.body_text, tkOpts)
      return { externalId: publishId }
    }
    const r = await publishInstagramForBlogPost(admin, row.user_id, row.blog_post_id, row.body_text, (options.mode as IgMode) || 'reel')
    return { externalId: r.reelId || r.storyId || undefined }
  }

  // Pull the blog post + integration creds
  const [postRes, intRes] = await Promise.all([
    admin
      .from('blog_posts')
      .select('id,title,wordpress_url,youtube_videos(thumbnail_url,youtube_video_id)')
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

  const url = post.wordpress_url ?? ''

  switch (row.platform) {
    // ─────────────────────────── BLUESKY ──────────────────────────────────
    case 'bluesky': {
      if (!integration.bluesky_handle || !integration.bluesky_app_password) {
        throw new Error('Bluesky not connected')
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let bsImage = (post as any).youtube_videos?.thumbnail_url as string | undefined
      if (!bsImage) bsImage = (await fetchOgImage(url)) || undefined
      const session = await createBlueskySession(integration.bluesky_handle, integration.bluesky_app_password)
      const finalText = `${stripLinkPlaceholders(row.body_text)}\n\n${url}`
      const result = await createBlueskyPost(session, {
        text: finalText, linkUrl: url, linkText: url,
        embed: { url, title: post.title ?? '', description: (row.body_text || '').slice(0, 200), imageUrl: bsImage },
      })
      // Persist post URI on the blog row to match the manual flow.
      await admin.from('blog_posts').update({ bluesky_post_uri: result.uri }).eq('id', row.blog_post_id)
      return { externalId: result.uri }
    }

    // ─────────────────────────── TWITTER / X ──────────────────────────────
    case 'twitter': {
      let accessToken = integration.twitter_access_token
      if (!accessToken) throw new Error('X not connected')
      // Refresh if expired
      const expiry = integration.twitter_token_expiry
      if (expiry && Date.now() > expiry - 60_000 && integration.twitter_refresh_token) {
        try {
          const refreshed = await refreshTwitterToken(integration.twitter_refresh_token)
          accessToken = refreshed.access_token
          // Encrypt refreshed tokens on write (2026-06-02). The decrypt
          // happens automatically on the next cron via
          // decryptIntegrationRow() above.
          await admin
            .from('integrations')
            .update(encryptIntegrationWrite({
              twitter_access_token: refreshed.access_token,
              twitter_refresh_token: refreshed.refresh_token ?? integration.twitter_refresh_token,
              twitter_token_expiry: Date.now() + refreshed.expires_in * 1000,
            }))
            .eq('user_id', row.user_id)
        } catch (e) {
          throw new Error(`X token refresh failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      const finalText = `${row.body_text} ${url}`
      const result = await createTweet(accessToken!, finalText)
      await admin.from('blog_posts').update({ twitter_post_id: result.id }).eq('id', row.blog_post_id)
      return { externalId: result.id }
    }

    // ─────────────────────────── THREADS ──────────────────────────────────
    case 'threads': {
      if (!integration.threads_access_token || !integration.threads_user_id) {
        throw new Error('Threads not connected')
      }
      const fullText = capSocialText(row.body_text, SOCIAL_LIMITS.threads, `\n\n${THREADS_DISCLAIMER}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const imageUrl = (post as any).youtube_videos?.thumbnail_url ?? undefined
      const threads = new ThreadsService(integration.threads_access_token, integration.threads_user_id)
      const result = await threads.createPost(fullText, imageUrl)
      await admin.from('blog_posts').update({ threads_post_id: result.id }).eq('id', row.blog_post_id)
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
      let liImage = liYt
        ? `https://img.youtube.com/vi/${liYt}/maxresdefault.jpg`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : ((post as any).youtube_videos?.thumbnail_url || '')
      if (!liImage) liImage = (await fetchOgImage(url)) || ''
      const liClean = stripLinkPlaceholders(row.body_text)
      const postText = capSocialText(
        liImage && !liClean.includes(url) ? `${liClean}\n\n🔗 Read the full review: ${url}` : liClean,
        SOCIAL_LIMITS.linkedin,
      )
      const linkedin = createLinkedInService(integration.linkedin_access_token, integration.linkedin_person_id)
      const liArticle = { articleUrl: url, articleTitle: post.title ?? '', articleDescription: row.body_text.slice(0, 200) }
      let result: { id: string }
      if (liImage) {
        try {
          result = await linkedin.createImagePost({ text: postText, imageUrl: liImage, title: post.title ?? '', description: row.body_text.slice(0, 200) })
        } catch {
          result = await linkedin.createPost({ text: postText, ...liArticle })
        }
      } else {
        result = await linkedin.createPost({ text: postText, ...liArticle })
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await admin.from('blog_posts').update({ linkedin_post_id: (result as any).id ?? null }).eq('id', row.blog_post_id)
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const imageUrl: string = ytId
        ? `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`
        : ((post as any).youtube_videos?.thumbnail_url ?? '')
      const caption = `${row.body_text}\n\n🔗 Read the full post: ${url}\n\n${disclaimer}`
      const fb = createFacebookService(fbPageToken, fbPageId)
      const result = imageUrl
        ? await fb.postPhoto({ imageUrl, caption })
        : await fb.postLink({ message: caption, link: url })
      await admin.from('blog_posts').update({ facebook_post_id: result.id }).eq('id', row.blog_post_id)
      return { externalId: result.id }
    }

    // ─────────────────────────── TELEGRAM ─────────────────────────────────
    case 'telegram': {
      if (!integration.telegram_bot_token || !integration.telegram_channel_id) {
        throw new Error('Telegram not connected')
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let imageUrl: string | null = (post as any).youtube_videos?.thumbnail_url ?? null
      if (!imageUrl) imageUrl = (await fetchOgImage(url)) || null
      const escapedBody = escapeMarkdownV2(stripLinkPlaceholders(row.body_text))
      const escapedUrl = escapeMarkdownV2(url)
      const linkLabel = escapeMarkdownV2('Read the full review →')
      const finalCaption = `${escapedBody}\n\n[${linkLabel}](${escapedUrl})`
      const result = imageUrl
        ? await sendPhoto(integration.telegram_bot_token, integration.telegram_channel_id, imageUrl, finalCaption)
        : await sendMessage(integration.telegram_bot_token, integration.telegram_channel_id, finalCaption)
      await admin
        .from('blog_posts')
        .update({ telegram_message_id: String(result.messageId) })
        .eq('id', row.blog_post_id)
      return { externalId: String(result.messageId) }
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
  if (!creds) throw new Error('WordPress credentials not found for this user/site')

  const wpService = createWordPressService(
    creds.wordpress_url,
    creds.wordpress_username,
    creds.wordpress_app_password,
    creds.wordpress_api_token ?? undefined,
  )

  // The flip itself — single PATCH to /posts/:id with status=publish.
  // WP accepts this even if the post is in 'draft' or 'pending' status.
  const updated = await wpService.updatePost(post.wordpress_post_id, { status: 'publish' })

  // Fire the deferred IndexNow ping now that the URL is live.
  // Fire-and-forget so a slow/rejected ping never fails the cron row.
  void pingIndexNowForUrl(admin, row.user_id, updated.link ?? post.wordpress_url ?? '', post.wordpress_site_id ?? null)
    .catch(() => {})

  return { externalId: String(post.wordpress_post_id) }
}
