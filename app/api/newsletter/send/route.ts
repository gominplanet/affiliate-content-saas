/**
 * POST /api/newsletter/send — fire a broadcast to all active subscribers
 *
 * Inputs (server doesn't trust the client's HTML — re-renders from the
 * structured fields so an XSS-injected draft can't leak through):
 *   subject           string
 *   intro             string
 *   personalMessage   string?
 *   outro             string
 *   posts             [{ url, title, excerpt, imageUrl?, blurb? }]
 *   curatedLinks      [{ url, label?, blurb }]
 *
 * Flow:
 *   1. Cap check (tier's broadcasts-per-month + subscriber-count guards).
 *   2. Insert a newsletter_broadcasts row with status='sending'.
 *   3. Load active subscribers + iterate in chunks of 100.
 *   4. For each chunk: render HTML/text per recipient (token-scoped
 *      unsubscribe URL), call resend.emails.send(), tick counters.
 *   5. Mark broadcast 'sent' with final recipients_total.
 *
 * Returns: { ok: true, broadcastId, recipients }
 *
 * Errors during the send loop are logged but don't fail the whole
 * broadcast — the row stays 'sending' until the last batch finishes,
 * then flips to 'sent' even if some recipients errored. Per-recipient
 * delivery state is the Resend webhook's job (different route).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, allowedNewsletterBroadcasts } from '@/lib/tier'
import { sendEmail, isEmailConfigured } from '@/services/email'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import {
  renderNewsletterHtml,
  renderNewsletterText,
  type NewsletterRenderInput,
  type NewsletterBlogPost,
  type NewsletterCuratedLink,
} from '@/lib/newsletter-html'
import { deriveFromAddress } from '@/lib/newsletter'

const APP_BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io'
const BATCH = 50 // Recipients per Resend round trip. Conservative — Resend's
                  // batch API maxes out higher, but 50 keeps any single send
                  // call comfortably under the 30s Vercel timeout.

export const maxDuration = 300

interface SendInput {
  subject?: string
  intro?: string
  personalMessage?: string
  outro?: string
  posts?: NewsletterBlogPost[]
  curatedLinks?: NewsletterCuratedLink[]
}

export async function POST(req: Request) {
  if (!isEmailConfigured()) {
    return NextResponse.json({ error: 'Email service is not configured.' }, { status: 503 })
  }
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: SendInput
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const subject = (body.subject || '').trim()
  const intro = (body.intro || '').trim()
  const outro = (body.outro || '').trim()
  const personalMessage = (body.personalMessage || '').trim() || null
  const posts = (Array.isArray(body.posts) ? body.posts : []).slice(0, 10)
  const curatedLinks = (Array.isArray(body.curatedLinks) ? body.curatedLinks : []).slice(0, 10)
  if (!subject || subject.length > 200) return NextResponse.json({ error: 'Subject is required (under 200 chars).' }, { status: 400 })
  if (!intro || !outro) return NextResponse.json({ error: 'Intro and outro are required.' }, { status: 400 })
  if (posts.length === 0 && curatedLinks.length === 0 && !personalMessage) {
    return NextResponse.json({ error: 'Issue is empty — add at least one post, link, or message.' }, { status: 400 })
  }

  // ── Tier cap: broadcasts per billing month ────────────────────────────────
  // Tier is per-user; siteUrl for the newsletter footer comes from the
  // user's default WordPress site (multi-site users: footer points at the
  // default brand site). Single-site users get the same site they always
  // had.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const defaultSite = await getWordPressCredentials(supabase, user.id)
  const tier = normalizeTier(integ?.tier as string | undefined)
  const monthlyCap = allowedNewsletterBroadcasts(tier)
  if (monthlyCap !== null) {
    const monthStart = new Date()
    monthStart.setUTCDate(1)
    monthStart.setUTCHours(0, 0, 0, 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await supabase
      .from('newsletter_broadcasts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('status', ['sending', 'sent'])
      .gte('created_at', monthStart.toISOString())
    if ((count ?? 0) >= monthlyCap) {
      return NextResponse.json({
        error: `You've hit your tier's broadcast cap (${monthlyCap}/month). Upgrade for more sends.`,
        limitReached: true,
      }, { status: 402 })
    }
  }

  // ── Load sender settings + brand context ──────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: nl }, { data: brand }] = await Promise.all([
    supabase.from('newsletter_settings').select('enabled,sender_domain,sender_local_part,sender_name,domain_status,mailing_address').eq('user_id', user.id).maybeSingle(),
    supabase.from('brand_profiles').select('name,author_name,logo_url,headshot_url').eq('user_id', user.id).maybeSingle(),
  ])
  if (!nl?.enabled) return NextResponse.json({ error: 'Enable the newsletter on the dashboard first.' }, { status: 400 })

  const from = deriveFromAddress({
    senderDomain: nl?.sender_domain as string | null,
    senderLocalPart: nl?.sender_local_part as string | null,
    senderName: (nl?.sender_name as string) || (brand?.name as string) || 'Newsletter',
    domainStatus: nl?.domain_status as string | null,
  })
  if (!from) return NextResponse.json({ error: 'Sender address could not be built.' }, { status: 500 })

  // ── Load active subscribers ───────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subs } = await supabase
    .from('newsletter_subscribers')
    .select('id,email,unsub_token')
    .eq('user_id', user.id)
    .eq('status', 'active')
  const recipients = (subs as Array<{ id: string; email: string; unsub_token: string }> | null) || []
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'No active subscribers yet — share the signup form to grow your list before sending.' }, { status: 400 })
  }

  // ── Persist a draft broadcast row so the recipient count is tracked even
  //    if the send loop dies mid-way ─────────────────────────────────────────
  const baseInput: Omit<NewsletterRenderInput, 'links'> = {
    subject, intro, personalMessage, outro,
    posts, curatedLinks,
    brand: {
      name: (nl?.sender_name as string) || (brand?.name as string) || 'Newsletter',
      siteUrl: defaultSite?.wordpress_url ?? null,
      logoUrl: (brand?.logo_url as string) || (brand?.headshot_url as string) || null,
      mailingAddress: (nl?.mailing_address as string) || null,
      byline: (brand?.author_name as string) || null,
    },
  }
  // Snapshot HTML uses a placeholder unsub URL — we re-render per recipient
  // below. The snapshot is for the "view in browser" / re-send-to-new-sub
  // use cases.
  const snapshotHtml = renderNewsletterHtml({
    ...baseInput,
    links: { unsubscribeUrl: `${APP_BASE}/newsletter-unsubscribed?snapshot=1`, viewInBrowserUrl: null },
  })
  const snapshotText = renderNewsletterText({
    ...baseInput,
    links: { unsubscribeUrl: `${APP_BASE}/newsletter-unsubscribed?snapshot=1`, viewInBrowserUrl: null },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bRow, error: bErr } = await supabase
    .from('newsletter_broadcasts')
    .insert({
      user_id: user.id,
      subject,
      html: snapshotHtml,
      plain_text: snapshotText,
      blog_post_ids: posts.map(p => (p as unknown as { id?: string }).id).filter(Boolean) as string[],
      personal_message: personalMessage,
      curated_links: curatedLinks as never,  // Json column; typed array doesn't satisfy Json recursively
      status: 'sending',
      recipients_total: recipients.length,
    })
    .select('id')
    .single()
  if (bErr || !bRow) return NextResponse.json({ error: bErr?.message || 'Failed to record broadcast' }, { status: 500 })
  const broadcastId = bRow.id as string

  // ── Send loop — per-recipient render so each gets their own unsub link ────
  let sent = 0
  let failed = 0
  for (let i = 0; i < recipients.length; i += BATCH) {
    const chunk = recipients.slice(i, i + BATCH)
    // Resend's emails.send is per-recipient — no native batch with distinct
    // payloads. We fire them in parallel within the chunk; the Promise.all
    // bounds latency without blowing fetch concurrency limits.
    const results = await Promise.allSettled(chunk.map(async (sub) => {
      const unsubscribeUrl = `${APP_BASE}/api/newsletter/unsubscribe?token=${encodeURIComponent(sub.unsub_token)}`
      const input: NewsletterRenderInput = { ...baseInput, links: { unsubscribeUrl, viewInBrowserUrl: null } }
      const html = renderNewsletterHtml(input)
      const text = renderNewsletterText(input)
      await sendEmail({
        to: sub.email,
        from,
        subject,
        html,
        text,
        // RFC 8058 — Gmail, Yahoo, Outlook, Apple Mail render a one-click
        // "Unsubscribe" button next to the sender name when these two
        // headers are present. The POST body { token } is handled by
        // /api/newsletter/unsubscribe. Huge deliverability win for bulk
        // senders since Feb 2024 (the Gmail/Yahoo bulk-sender rules).
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        // Tags surface back in Resend's webhook payloads so we can
        // attribute every delivered/bounced/opened/clicked event to the
        // right broadcast row (driving the counters on /newsletter).
        tags: [
          { name: 'kind', value: 'newsletter_broadcast' },
          { name: 'broadcast_id', value: broadcastId },
          { name: 'user_id', value: user.id },
        ],
      })
    }))
    for (const r of results) {
      if (r.status === 'fulfilled') sent++
      else { failed++; console.warn('[newsletter/send] item failed:', r.reason instanceof Error ? r.reason.message : r.reason) }
    }
  }

  // ── Finalise ──────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase
    .from('newsletter_broadcasts')
    .update({
      status: failed === recipients.length ? 'failed' : 'sent',
      recipients_delivered: sent,
      sent_at: new Date().toISOString(),
      error_message: failed > 0 ? `${failed}/${recipients.length} recipients errored at send` : null,
    })
    .eq('id', broadcastId)

  return NextResponse.json({
    ok: true,
    broadcastId,
    recipients: recipients.length,
    sent,
    failed,
  })
}
