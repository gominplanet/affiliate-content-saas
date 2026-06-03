/**
 * Newsletter send orchestrator — shared by /api/newsletter/send (the
 * interactive POST) and /api/cron/newsletter-process (the cron that
 * fires scheduled + A/B-winner sends).
 *
 * Why a shared helper:
 *   - Both entry points need the same per-recipient render + Resend call
 *     loop, the same retry/timeout discipline, and the same counter
 *     bookkeeping.
 *   - Keeping it isolated means /api/cron/* can run without server-only
 *     Next imports leaking in (this file is pure logic over a Supabase
 *     admin client + a Resend wrapper).
 *
 * Public surface:
 *   - sendBroadcastBatch({...})    actually fires Resend.emails.send per
 *                                  recipient, ticking counters and
 *                                  returning { sent, failed }.
 *   - applySegmentFilter(subs, f)  in-memory filter — handles `source`,
 *                                  `signedUpAfter/Before`, `tags ANY-of`.
 *   - partitionAbSample(subs, p)   splits an array deterministically by
 *                                  shuffling with a seeded key so reruns
 *                                  of the cron do not re-partition the
 *                                  same broadcast differently.
 *   - finalizeAbBroadcast(...)     given an ab_testing row that's hit
 *                                  ab_finalize_at, picks the winning
 *                                  variant by open count, sends it to
 *                                  the non-sample recipients, flips
 *                                  status='sent'.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/services/email'
import {
  renderNewsletterHtml,
  renderNewsletterText,
  type NewsletterRenderInput,
} from '@/lib/newsletter-html'

const APP_BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io'
/** Resend's send is per-recipient. Fire N in parallel; the Promise.allSettled
 *  bounds wall-clock without blowing fetch concurrency limits. 50 keeps a
 *  single batch well under Vercel's 300s maxDuration even for slow renders. */
const BATCH = 50

export interface NewsletterRecipient {
  id: string
  email: string
  unsub_token: string
  source?: string | null
  created_at?: string | null
  tags?: string[] | null
}

export interface SegmentFilter {
  source?: 'blog_form' | 'csv_import' | 'manual' | null
  signedUpAfter?: string | null     // ISO timestamp
  signedUpBefore?: string | null    // ISO timestamp
  /** ANY-of match — a subscriber is included if any of their tags is in the
   *  filter's tags list. Empty/missing tags array means no tag filter. */
  tags?: string[] | null
}

/** Apply a segment filter to an in-memory subscriber list. Used at both the
 *  scheduled-send and immediate-send paths so segmentation behaves identically
 *  across them. Null/empty filter → returns the input unchanged. */
export function applySegmentFilter(
  recipients: NewsletterRecipient[],
  filter: SegmentFilter | null | undefined,
): NewsletterRecipient[] {
  if (!filter) return recipients
  const after = filter.signedUpAfter ? Date.parse(filter.signedUpAfter) : NaN
  const before = filter.signedUpBefore ? Date.parse(filter.signedUpBefore) : NaN
  const tagSet = filter.tags && filter.tags.length > 0 ? new Set(filter.tags) : null
  return recipients.filter(r => {
    if (filter.source && r.source !== filter.source) return false
    const ts = r.created_at ? Date.parse(r.created_at) : NaN
    if (Number.isFinite(after) && (!Number.isFinite(ts) || ts < after)) return false
    if (Number.isFinite(before) && (!Number.isFinite(ts) || ts > before)) return false
    if (tagSet) {
      const rt = r.tags || []
      if (!rt.some(t => tagSet.has(t))) return false
    }
    return true
  })
}

/** Deterministic Fisher-Yates with a tiny xmur3-style hash seed. We seed off
 *  the broadcast id so two cron runs of the same A/B broadcast partition the
 *  list identically — important because the cron WILL retry on transient
 *  failure. Math.random would have a different shuffle each run, leaking
 *  recipients across variants. */
function seededShuffle<T>(arr: T[], seed: string): T[] {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  }
  const rng = () => {
    h += 0x6D2B79F5
    let t = h
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Partition recipients into { a, b, holdback } where sample_pct of the list
 *  is split 50/50 across variants A and B (rounded), and the remainder is
 *  the holdback that receives the winning subject after the A/B test settles. */
export function partitionAbSample(
  recipients: NewsletterRecipient[],
  samplePct: number,
  seed: string,
): { a: NewsletterRecipient[]; b: NewsletterRecipient[]; holdback: NewsletterRecipient[] } {
  const total = recipients.length
  if (total < 4) {
    // Below this floor an A/B test makes no statistical sense — send
    // variant A to everyone, no test.
    return { a: recipients, b: [], holdback: [] }
  }
  const pct = Math.max(2, Math.min(50, samplePct | 0))
  const sampleSize = Math.max(2, Math.floor(total * (pct / 100)))
  const shuffled = seededShuffle(recipients, seed)
  const sample = shuffled.slice(0, sampleSize)
  const holdback = shuffled.slice(sampleSize)
  const half = Math.floor(sample.length / 2)
  return {
    a: sample.slice(0, half),
    b: sample.slice(half),
    holdback,
  }
}

export interface SendBroadcastBatchOptions {
  recipients: NewsletterRecipient[]
  subject: string
  from: string
  baseInput: Omit<NewsletterRenderInput, 'links'>
  broadcastId: string
  userId: string
  /** Tag attached to every email — used by the Resend webhook to attribute
   *  opens/clicks/bounces to the right A/B variant (or empty for non-A/B). */
  variant?: 'a' | 'b' | null
}

export interface SendBroadcastBatchResult {
  sent: number
  failed: number
}

/** Per-recipient render + Resend call. Used by both the initial send path
 *  and the A/B-winner finalize path. */
export async function sendBroadcastBatch(opts: SendBroadcastBatchOptions): Promise<SendBroadcastBatchResult> {
  const { recipients, subject, from, baseInput, broadcastId, userId, variant } = opts
  let sent = 0
  let failed = 0
  for (let i = 0; i < recipients.length; i += BATCH) {
    const chunk = recipients.slice(i, i + BATCH)
    const results = await Promise.allSettled(chunk.map(async (sub) => {
      const unsubscribeUrl = `${APP_BASE}/api/newsletter/unsubscribe?token=${encodeURIComponent(sub.unsub_token)}`
      const input: NewsletterRenderInput = { ...baseInput, links: { unsubscribeUrl, viewInBrowserUrl: null } }
      const html = renderNewsletterHtml(input)
      const text = renderNewsletterText(input)
      const tags = [
        { name: 'kind', value: 'newsletter_broadcast' },
        { name: 'broadcast_id', value: broadcastId },
        { name: 'user_id', value: userId },
      ]
      if (variant === 'a' || variant === 'b') {
        tags.push({ name: 'variant', value: variant })
      }
      await sendEmail({
        to: sub.email,
        from,
        subject,
        html,
        text,
        // RFC 8058 — Gmail/Yahoo/Outlook/Apple Mail render a native
        // one-click Unsubscribe button when these two headers are set.
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        tags,
      })
    }))
    for (const r of results) {
      if (r.status === 'fulfilled') sent++
      else { failed++; console.warn('[newsletter/send] item failed:', r.reason instanceof Error ? r.reason.message : r.reason) }
    }
  }
  return { sent, failed }
}

/** Once an A/B test's ab_finalize_at is past, pick the winner and send it
 *  to the holdback. Called from the cron processor; safe to call multiple
 *  times — early-returns if ab_finalized_at is already set. */
export async function finalizeAbBroadcast(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, 'public', any>
  broadcastId: string
}): Promise<{ ok: true; winner: 'a' | 'b'; sent: number } | { ok: false; reason: string }> {
  const { admin, broadcastId } = opts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (admin as any)
    .from('newsletter_broadcasts')
    .select('id,user_id,subject,subject_b,html,plain_text,blog_post_ids,personal_message,curated_links,segment_filter,compose_intro,compose_outro,ab_recipients_a,ab_recipients_b,ab_opens_a,ab_opens_b,ab_finalize_at,ab_finalized_at,status,recipients_total,recipients_delivered')
    .eq('id', broadcastId)
    .maybeSingle()
  if (!row) return { ok: false, reason: 'broadcast-missing' }
  if (row.ab_finalized_at) return { ok: false, reason: 'already-finalized' }
  if (row.status !== 'ab_testing') return { ok: false, reason: `wrong-status:${row.status}` }
  if (!row.subject_b) return { ok: false, reason: 'no-variant-b' }

  // Pick winner. Tie → A (the original subject — least surprising).
  const winner: 'a' | 'b' = (row.ab_opens_b ?? 0) > (row.ab_opens_a ?? 0) ? 'b' : 'a'
  const winningSubject = winner === 'b' ? (row.subject_b as string) : (row.subject as string)

  // Rebuild baseInput from the broadcast row. We need the sender/brand context
  // again. Pull newsletter_settings + brand_profiles + default WordPress site
  // (for the footer's siteUrl).
  const { getWordPressCredentials } = await import('@/lib/wordpress-sites')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: nl }, { data: brand }, defaultSite] = await Promise.all([
    (admin as any).from('newsletter_settings').select('sender_name,sender_local_part,sender_domain,domain_status,mailing_address').eq('user_id', row.user_id).maybeSingle(),
    (admin as any).from('brand_profiles').select('name,author_name,logo_url,headshot_url').eq('user_id', row.user_id).maybeSingle(),
    getWordPressCredentials(admin, row.user_id),
  ])
  const { deriveFromAddress } = await import('@/lib/newsletter')
  const from = deriveFromAddress({
    senderDomain: nl?.sender_domain ?? null,
    senderLocalPart: nl?.sender_local_part ?? null,
    senderName: (nl?.sender_name as string) || (brand?.name as string) || 'Newsletter',
    domainStatus: nl?.domain_status ?? null,
  })
  if (!from) return { ok: false, reason: 'no-from-address' }

  // Resolve holdback recipients fresh — subscribers may have churned since
  // the initial send. Filter against the live newsletter_subscribers state
  // and exclude anyone already in ab_recipients_a/b.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subs } = await (admin as any)
    .from('newsletter_subscribers')
    .select('id,email,unsub_token,source,created_at,tags')
    .eq('user_id', row.user_id)
    .eq('status', 'active')
  const all = (subs ?? []) as NewsletterRecipient[]
  const filtered = applySegmentFilter(all, (row.segment_filter ?? null) as SegmentFilter | null)
  const sentIds = new Set<string>([...(row.ab_recipients_a ?? []), ...(row.ab_recipients_b ?? [])])
  const holdback = filtered.filter(r => !sentIds.has(r.id))

  const baseInput = await rehydrateBaseInput({ admin, row, nl, brand, defaultSite })

  let sent = 0
  let failed = 0
  if (holdback.length > 0) {
    const result = await sendBroadcastBatch({
      recipients: holdback,
      subject: winningSubject,
      from,
      baseInput,
      broadcastId,
      userId: row.user_id,
      variant: winner,            // tag the holdback with the winning variant
    })
    sent = result.sent
    failed = result.failed
  }

  await (admin as any)
    .from('newsletter_broadcasts')
    .update({
      ab_finalized_at: new Date().toISOString(),
      ab_winner_variant: winner,
      status: 'sent',
      sent_at: new Date().toISOString(),
      recipients_total: (row.recipients_total ?? 0) + holdback.length,
      recipients_delivered: (row.recipients_delivered ?? 0) + sent,
      error_message: failed > 0 ? `${failed}/${holdback.length} winner-send errored` : null,
    })
    .eq('id', broadcastId)

  return { ok: true, winner, sent }
}

/** Rehydrate the NewsletterRenderInput shape for a broadcast row. Pulls the
 *  blog posts + curated links + brand info needed to render. */
async function rehydrateBaseInput(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, 'public', any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nl: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brand: any
  defaultSite: { wordpress_url: string } | null
}): Promise<Omit<NewsletterRenderInput, 'links'>> {
  const { admin, row, nl, brand, defaultSite } = opts
  // Re-resolve the posts the user picked at compose time, so the winner-send
  // looks identical to the sample (same images, same blurbs).
  let posts: NewsletterRenderInput['posts'] = []
  if (Array.isArray(row.blog_post_ids) && row.blog_post_ids.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from('blog_posts')
      .select('id,title,excerpt,wordpress_url,featured_image_url')
      .eq('user_id', row.user_id)
      .in('id', row.blog_post_ids)
    posts = ((data ?? []) as Array<{ id: string; title: string; excerpt: string | null; wordpress_url: string | null; featured_image_url: string | null }>)
      .filter(p => p.wordpress_url)
      .map(p => ({
        url: p.wordpress_url as string,
        title: p.title,
        excerpt: p.excerpt ?? '',
        imageUrl: p.featured_image_url ?? null,
      }))
  }
  return {
    subject: row.subject as string,
    // compose_intro/compose_outro were persisted at send-time (migration 090)
    // for exactly this case — the winner-send/scheduled-send needs to
    // re-render with the per-recipient unsub URL but the same body copy.
    intro: (row.compose_intro as string | null) || '',
    personalMessage: (row.personal_message as string | null) || null,
    outro: (row.compose_outro as string | null) || '',
    posts,
    curatedLinks: (Array.isArray(row.curated_links) ? row.curated_links : []) as NewsletterRenderInput['curatedLinks'],
    brand: {
      name: (nl?.sender_name as string) || (brand?.name as string) || 'Newsletter',
      siteUrl: (defaultSite?.wordpress_url as string | null) ?? null,
      logoUrl: (brand?.logo_url as string | null) || (brand?.headshot_url as string | null) || null,
      mailingAddress: (nl?.mailing_address as string | null) || null,
      byline: (brand?.author_name as string | null) || null,
    },
  }
}
