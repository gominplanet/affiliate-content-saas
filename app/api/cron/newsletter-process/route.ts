/**
 * GET /api/cron/newsletter-process — fires queued newsletter work
 *
 * Two responsibilities, both idempotent:
 *
 *   1. Scheduled broadcasts: rows where status='scheduled' AND
 *      scheduled_at <= now(). The row gets re-rendered against the live
 *      subscribers list (segment filter included) so a creator who
 *      schedules and then adds subscribers ships to everyone who's
 *      active at fire-time, not at compose-time.
 *
 *   2. A/B finalization: rows where status='ab_testing' AND
 *      ab_finalize_at <= now() AND ab_finalized_at IS NULL. The winning
 *      subject goes out to the holdback recipients.
 *
 * Wired into Vercel cron (vercel.json) at * * * * * (every minute).
 *
 * Auth: the cron secret. Vercel always sets a Bearer header on cron
 * pings; we also accept ?cron_secret=... for the convenience of curl-
 * triggered manual runs in dev.
 *
 * Safety:
 *   - We process at most a handful of rows per tick so a flood of
 *     scheduled broadcasts can't blow the 300s maxDuration in one go;
 *     the next tick picks up the next batch.
 *   - Every state transition is conditional on the prior state so
 *     concurrent ticks (extremely unlikely with a 1-minute cron but
 *     possible during deploys) can't double-send.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { renderNewsletterHtml, renderNewsletterText, type NewsletterRenderInput } from '@/lib/newsletter-html'
import { deriveFromAddress } from '@/lib/newsletter'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import {
  applySegmentFilter,
  finalizeAbBroadcast,
  sendBroadcastBatch,
  type NewsletterRecipient,
  type SegmentFilter,
} from '@/lib/newsletter-send'

const APP_BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io'
/** How many scheduled rows to fire per tick. The send loop inside one row
 *  can already take 30-60s for a multi-thousand-subscriber list; processing
 *  more than 2 rows in one tick risks the 300s maxDuration. */
const SCHEDULED_PER_TICK = 2
const AB_FINALIZE_PER_TICK = 3

export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const summary = { scheduledFired: 0, abFinalized: 0, errors: [] as string[] }

  // ── 1. Scheduled sends ───────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: scheduled } = await (admin as any)
    .from('newsletter_broadcasts')
    .select('id,user_id,scheduled_at')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(SCHEDULED_PER_TICK)
  for (const row of (scheduled ?? []) as Array<{ id: string; user_id: string; scheduled_at: string }>) {
    try {
      await fireScheduled({ broadcastId: row.id })
      summary.scheduledFired++
    } catch (err) {
      summary.errors.push(`scheduled:${row.id}:${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── 2. A/B finalizations ─────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: testing } = await (admin as any)
    .from('newsletter_broadcasts')
    .select('id,ab_finalize_at')
    .eq('status', 'ab_testing')
    .is('ab_finalized_at', null)
    .lte('ab_finalize_at', new Date().toISOString())
    .order('ab_finalize_at', { ascending: true })
    .limit(AB_FINALIZE_PER_TICK)
  for (const row of (testing ?? []) as Array<{ id: string; ab_finalize_at: string }>) {
    try {
      const result = await finalizeAbBroadcast({ admin, broadcastId: row.id })
      if (result.ok) summary.abFinalized++
      else summary.errors.push(`ab:${row.id}:${result.reason}`)
    } catch (err) {
      summary.errors.push(`ab:${row.id}:${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return NextResponse.json({ ok: true, ...summary, ts: new Date().toISOString() })
}

function isAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET
  if (!expected) {
    // No secret configured = open in dev only.
    return process.env.NODE_ENV !== 'production'
  }
  const auth = req.headers.get('authorization') || ''
  if (auth === `Bearer ${expected}`) return true
  const url = new URL(req.url)
  if (url.searchParams.get('cron_secret') === expected) return true
  return false
}

/** Fire a single scheduled broadcast. Re-renders against the live subscribers
 *  list so anyone who joined between compose and now is included. */
async function fireScheduled(opts: { broadcastId: string }): Promise<void> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (admin as any)
    .from('newsletter_broadcasts')
    .select('id,user_id,subject,subject_b,ab_sample_pct,ab_test_hours,compose_intro,compose_outro,personal_message,curated_links,blog_post_ids,segment_filter,status,html,plain_text')
    .eq('id', opts.broadcastId)
    .maybeSingle()
  if (!row) return
  // Defensive idempotency — only fire if still in scheduled state.
  if (row.status !== 'scheduled') return

  // Race lock: flip to 'sending' first. A second concurrent cron tick will
  // see a different status and skip. We do the lock as an UPDATE...WHERE
  // so it's atomic at the row level.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: locked } = await (admin as any)
    .from('newsletter_broadcasts')
    .update({ status: row.subject_b ? 'ab_testing' : 'sending' })
    .eq('id', opts.broadcastId)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle()
  if (!locked) return        // a parallel tick beat us to it

  // Load sender + brand + active subscribers + segment filter.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: nl }, { data: brand }, defaultSite, { data: subs }] = await Promise.all([
    (admin as any).from('newsletter_settings').select('sender_name,sender_local_part,sender_domain,domain_status,mailing_address').eq('user_id', row.user_id).maybeSingle(),
    (admin as any).from('brand_profiles').select('name,author_name,logo_url,headshot_url').eq('user_id', row.user_id).maybeSingle(),
    getWordPressCredentials(admin, row.user_id),
    (admin as any).from('newsletter_subscribers').select('id,email,unsub_token,source,created_at,tags').eq('user_id', row.user_id).eq('status', 'active'),
  ])

  const from = deriveFromAddress({
    senderDomain: nl?.sender_domain ?? null,
    senderLocalPart: nl?.sender_local_part ?? null,
    senderName: (nl?.sender_name as string) || (brand?.name as string) || 'Newsletter',
    domainStatus: nl?.domain_status ?? null,
  })
  if (!from) {
    // Revert lock so the row is visible as a problem.
    await (admin as any).from('newsletter_broadcasts').update({
      status: 'failed',
      error_message: 'Sender address could not be built.',
    }).eq('id', opts.broadcastId)
    return
  }

  const all = (subs ?? []) as NewsletterRecipient[]
  const recipients = applySegmentFilter(all, (row.segment_filter ?? null) as SegmentFilter | null)

  const baseInput: Omit<NewsletterRenderInput, 'links'> = {
    subject: row.subject as string,
    intro: (row.compose_intro as string | null) || '',
    personalMessage: (row.personal_message as string | null) || null,
    outro: (row.compose_outro as string | null) || '',
    posts: [],     // re-resolved below
    curatedLinks: (Array.isArray(row.curated_links) ? row.curated_links : []) as NewsletterRenderInput['curatedLinks'],
    brand: {
      name: (nl?.sender_name as string) || (brand?.name as string) || 'Newsletter',
      siteUrl: (defaultSite?.wordpress_url as string | null) ?? null,
      logoUrl: (brand?.logo_url as string | null) || (brand?.headshot_url as string | null) || null,
      mailingAddress: (nl?.mailing_address as string | null) || null,
      byline: (brand?.author_name as string | null) || null,
    },
  }
  if (Array.isArray(row.blog_post_ids) && row.blog_post_ids.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from('blog_posts')
      .select('id,title,excerpt,wordpress_url,featured_image_url')
      .eq('user_id', row.user_id)
      .in('id', row.blog_post_ids)
    baseInput.posts = ((data ?? []) as Array<{ id: string; title: string; excerpt: string | null; wordpress_url: string | null; featured_image_url: string | null }>)
      .filter(p => p.wordpress_url)
      .map(p => ({
        url: p.wordpress_url as string,
        title: p.title,
        excerpt: p.excerpt ?? '',
        imageUrl: p.featured_image_url ?? null,
      }))
  }

  // Re-render the snapshot HTML once with a placeholder URL — pre-existing
  // snapshot was rendered at compose time before scheduling. Keeping the
  // snapshot current means "View in browser" reflects the post-fire state.
  const snapshotHtml = renderNewsletterHtml({
    ...baseInput,
    links: { unsubscribeUrl: `${APP_BASE}/newsletter-unsubscribed?snapshot=1`, viewInBrowserUrl: null },
  })
  const snapshotText = renderNewsletterText({
    ...baseInput,
    links: { unsubscribeUrl: `${APP_BASE}/newsletter-unsubscribed?snapshot=1`, viewInBrowserUrl: null },
  })

  if (row.subject_b) {
    // Scheduled A/B — partition + send + flip ab_finalize_at relative to NOW
    // (the scheduled time, not the compose time).
    const { partitionAbSample } = await import('@/lib/newsletter-send')
    const samplePct = Math.max(5, Math.min(50, (row.ab_sample_pct as number) || 20))
    const testHours = Math.max(1, Math.min(48, (row.ab_test_hours as number) || 2))
    const { a, b } = partitionAbSample(recipients, samplePct, opts.broadcastId)

    await (admin as any).from('newsletter_broadcasts').update({
      ab_recipients_a: a.map(r => r.id),
      ab_recipients_b: b.map(r => r.id),
      ab_finalize_at: new Date(Date.now() + testHours * 3600_000).toISOString(),
      recipients_total: a.length + b.length,
      html: snapshotHtml,
      plain_text: snapshotText,
    }).eq('id', opts.broadcastId)

    const [resA, resB] = await Promise.all([
      sendBroadcastBatch({ recipients: a, subject: row.subject,   from, baseInput,                                 broadcastId: opts.broadcastId, userId: row.user_id, variant: 'a' }),
      sendBroadcastBatch({ recipients: b, subject: row.subject_b, from, baseInput: { ...baseInput, subject: row.subject_b }, broadcastId: opts.broadcastId, userId: row.user_id, variant: 'b' }),
    ])
    await (admin as any).from('newsletter_broadcasts').update({
      recipients_delivered: resA.sent + resB.sent,
      error_message: (resA.failed + resB.failed) > 0
        ? `${resA.failed + resB.failed}/${a.length + b.length} sample recipients errored`
        : null,
    }).eq('id', opts.broadcastId)
    return
  }

  // Plain scheduled send.
  await (admin as any).from('newsletter_broadcasts').update({
    recipients_total: recipients.length,
    html: snapshotHtml,
    plain_text: snapshotText,
  }).eq('id', opts.broadcastId)

  const { sent, failed } = await sendBroadcastBatch({
    recipients,
    subject: row.subject as string,
    from,
    baseInput,
    broadcastId: opts.broadcastId,
    userId: row.user_id,
    variant: null,
  })

  await (admin as any).from('newsletter_broadcasts').update({
    status: failed === recipients.length ? 'failed' : 'sent',
    recipients_delivered: sent,
    sent_at: new Date().toISOString(),
    error_message: failed > 0 ? `${failed}/${recipients.length} recipients errored at send` : null,
  }).eq('id', opts.broadcastId)
}
