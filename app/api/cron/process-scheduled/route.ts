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
import { sendPhoto, sendMessage, escapeMarkdownV2 } from '@/services/telegram'
import { capSocialText, SOCIAL_LIMITS } from '@/lib/social-cap'
import { decryptIntegrationRow, encryptIntegrationWrite } from '@/lib/integration-secrets'
import { maybeDecrypt } from '@/lib/secrets'

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
  platform: 'facebook' | 'threads' | 'twitter' | 'linkedin' | 'bluesky' | 'telegram'
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

  // 1. Atomic claim — flip due+pending rows to 'processing' in one update.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: claimed, error: claimErr } = await admin
    .from('scheduled_posts')
    .update({ status: 'processing', claimed_at: nowIso, last_attempt_at: nowIso })
    .eq('status', 'pending')
    .lte('scheduled_at', nowIso)
    .select('id,user_id,blog_post_id,platform,body_text,social_account_id')
    .limit(MAX_PER_TICK)

  if (claimErr) {
    return NextResponse.json({ error: `Claim failed: ${claimErr.message}` }, { status: 500 })
  }

  // claimed comes back with platform typed as `string` (RPC return shape);
  // narrow to the ScheduledRow discriminated union at the boundary.
  const rows: ScheduledRow[] = (claimed ?? []) as ScheduledRow[]
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
      const msg = err instanceof Error ? err.message : String(err)
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
 * Per-platform publish. Looks up the user's blog post + integration creds
 * via the admin client (no session), then calls the same service code
 * the manual-publish endpoints use.
 */
async function publishOne(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  row: ScheduledRow,
): Promise<{ externalId?: string }> {
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
      const session = await createBlueskySession(integration.bluesky_handle, integration.bluesky_app_password)
      const finalText = `${row.body_text}\n\n${url}`
      const result = await createBlueskyPost(session, { text: finalText, linkUrl: url, linkText: url })
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
      const postText = capSocialText(row.body_text, SOCIAL_LIMITS.linkedin)
      const linkedin = createLinkedInService(integration.linkedin_access_token, integration.linkedin_person_id)
      const result = await linkedin.createPost({
        text: postText,
        articleUrl: url,
        articleTitle: post.title ?? '',
        articleDescription: row.body_text.slice(0, 200),
      })
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
      const imageUrl: string | null = (post as any).youtube_videos?.thumbnail_url ?? null
      const escapedBody = escapeMarkdownV2(row.body_text)
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
