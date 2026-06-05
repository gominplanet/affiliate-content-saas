/**
 * POST /api/newsletter/send — fire (or queue) a broadcast
 *
 * Three modes, picked by the input shape:
 *   regular   no subject_b, no scheduled_at      → sends immediately to all
 *                                                  segment-matching subscribers
 *   ab-test   subject_b + ab_sample_pct          → sends sample_pct of
 *                                                  recipients now (half A,
 *                                                  half B), sets status =
 *                                                  'ab_testing' + ab_finalize_at;
 *                                                  cron picks the winner
 *                                                  ab_test_hours later
 *   scheduled scheduled_at in the future         → persists status='scheduled';
 *                                                  the cron fires it at the
 *                                                  scheduled time
 *
 * Segment filtering layers on top of any mode: when segment_filter is set,
 * only matching active subscribers receive the broadcast. Cap checks use
 * the FULL active subscriber count (so segmenting doesn't dodge the cap).
 *
 * Inputs:
 *   subject           string                      required
 *   intro             string                      required
 *   personalMessage   string?
 *   outro             string                      required
 *   posts             [{ url, title, excerpt, imageUrl?, blurb? }]
 *   curatedLinks      [{ url, label?, blurb }]
 *   subject_b         string?                     optional A/B variant
 *   ab_sample_pct     number?    default 20       test-set % when A/B
 *   ab_test_hours     number?    default 2        wait window before winner
 *   scheduled_at      ISO string?                 future ts → queued for cron
 *   segment_filter    SegmentFilter?              narrows recipients
 *
 * Returns:
 *   regular:   { ok, broadcastId, recipients, sent, failed }
 *   ab-test:   { ok, broadcastId, mode:'ab_testing', sample, finalizeAt }
 *   scheduled: { ok, broadcastId, mode:'scheduled', scheduledAt }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, allowedNewsletterBroadcasts, tierHas } from '@/lib/tier'
import { isEmailConfigured } from '@/services/email'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import {
  renderNewsletterHtml,
  renderNewsletterText,
  type NewsletterRenderInput,
  type NewsletterBlogPost,
  type NewsletterCuratedLink,
} from '@/lib/newsletter-html'
import { deriveFromAddress } from '@/lib/newsletter'
import {
  applySegmentFilter,
  partitionAbSample,
  sendBroadcastBatch,
  type NewsletterRecipient,
  type SegmentFilter,
} from '@/lib/newsletter-send'

const APP_BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io'

export const maxDuration = 300

interface SendInput {
  subject?: string
  intro?: string
  personalMessage?: string
  outro?: string
  posts?: NewsletterBlogPost[]
  curatedLinks?: NewsletterCuratedLink[]
  /** A/B testing — when subject_b is set we treat the send as an A/B. */
  subject_b?: string
  ab_sample_pct?: number
  ab_test_hours?: number
  /** Schedule the send for the future. ISO timestamp. */
  scheduled_at?: string
  /** Narrow which subscribers receive this broadcast. */
  segment_filter?: SegmentFilter
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
  const subjectB = (body.subject_b || '').trim()
  const intro = (body.intro || '').trim()
  const outro = (body.outro || '').trim()
  const personalMessage = (body.personalMessage || '').trim() || null
  const posts = (Array.isArray(body.posts) ? body.posts : []).slice(0, 10)
  const curatedLinks = (Array.isArray(body.curatedLinks) ? body.curatedLinks : []).slice(0, 10)
  if (!subject || subject.length > 200) return NextResponse.json({ error: 'Subject is required (under 200 chars).' }, { status: 400 })
  if (subjectB && subjectB.length > 200) return NextResponse.json({ error: 'Test subject B must be under 200 chars.' }, { status: 400 })
  if (!intro || !outro) return NextResponse.json({ error: 'Intro and outro are required.' }, { status: 400 })
  if (posts.length === 0 && curatedLinks.length === 0 && !personalMessage) {
    return NextResponse.json({ error: 'Issue is empty — add at least one post, link, or message.' }, { status: 400 })
  }

  // Schedule validation — must be in the future and at most 60 days out.
  let scheduledAt: Date | null = null
  if (body.scheduled_at) {
    const parsed = new Date(body.scheduled_at)
    if (!Number.isFinite(parsed.getTime())) {
      return NextResponse.json({ error: 'scheduled_at is not a valid timestamp.' }, { status: 400 })
    }
    const now = Date.now()
    if (parsed.getTime() < now + 60_000) {
      // Sub-minute scheduling is functionally "send now" — reject so the
      // cron's once-per-minute polling isn't relied on for "imminent" sends.
      return NextResponse.json({ error: 'Schedule the send at least one minute in the future.' }, { status: 400 })
    }
    if (parsed.getTime() > now + 60 * 86400_000) {
      return NextResponse.json({ error: 'Schedule cannot be more than 60 days out.' }, { status: 400 })
    }
    scheduledAt = parsed
  }

  // ── Tier cap: broadcasts per billing month ────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await supabase
    .from('integrations').select('tier, legacy_creator_newsletter').eq('user_id', user.id).maybeSingle()
  const defaultSite = await getWordPressCredentials(supabase, user.id)
  const tier = normalizeTier((integ as { tier?: string } | null)?.tier)
  // Legacy-Creator grandfathering — see migration 100 + lib/tier.ts comment.
  const legacyCreatorNewsletter = Boolean((integ as { legacy_creator_newsletter?: boolean } | null)?.legacy_creator_newsletter)

  // Tier restructure 2026-06-04: gate the SUB-features (A/B / scheduling /
  // segmented sends) server-side. Compose UI hides the toggles for
  // ineligible tiers but a curl request could still set scheduled_at /
  // subject_b / segment_filter and bypass.
  if (body.scheduled_at && !tierHas(tier, 'newsletterScheduling')) {
    return NextResponse.json({
      error: 'Scheduling broadcasts is a Studio + Pro feature.',
      code: 'tier_not_allowed_scheduling',
    }, { status: 403 })
  }
  if (body.subject_b && !tierHas(tier, 'newsletterABTesting')) {
    return NextResponse.json({
      error: 'A/B subject lines are a Pro feature.',
      code: 'tier_not_allowed_ab',
    }, { status: 403 })
  }
  if (body.segment_filter && !tierHas(tier, 'newsletterSegmentedSends')) {
    return NextResponse.json({
      error: 'Segmented sends are a Pro feature.',
      code: 'tier_not_allowed_segments',
    }, { status: 403 })
  }

  const monthlyCap = allowedNewsletterBroadcasts(tier, { legacyCreatorNewsletter })
  if (monthlyCap !== null) {
    const monthStart = new Date()
    monthStart.setUTCDate(1)
    monthStart.setUTCHours(0, 0, 0, 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await supabase
      .from('newsletter_broadcasts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('status', ['sending', 'sent', 'scheduled', 'ab_testing'])
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

  // ── Load active subscribers + apply segment filter ───────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subs } = await supabase
    .from('newsletter_subscribers')
    .select('id,email,unsub_token,source,created_at,tags')
    .eq('user_id', user.id)
    .eq('status', 'active')
  const allRecipients = (subs as NewsletterRecipient[] | null) || []
  const segmentFilter: SegmentFilter | null = body.segment_filter ?? null
  const recipients = applySegmentFilter(allRecipients, segmentFilter)
  if (recipients.length === 0) {
    return NextResponse.json({
      error: segmentFilter
        ? 'No subscribers match this segment. Loosen the filter or grow the list.'
        : 'No active subscribers yet — share the signup form to grow your list before sending.',
    }, { status: 400 })
  }

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
  const snapshotHtml = renderNewsletterHtml({
    ...baseInput,
    links: { unsubscribeUrl: `${APP_BASE}/newsletter-unsubscribed?snapshot=1`, viewInBrowserUrl: null },
  })
  const snapshotText = renderNewsletterText({
    ...baseInput,
    links: { unsubscribeUrl: `${APP_BASE}/newsletter-unsubscribed?snapshot=1`, viewInBrowserUrl: null },
  })

  // ── Mode 3: SCHEDULED — persist + return, the cron will fire it ──────────
  if (scheduledAt) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bRow, error: bErr } = await (supabase as any)
      .from('newsletter_broadcasts')
      .insert({
        user_id: user.id,
        subject,
        subject_b: subjectB || null,
        ab_sample_pct: subjectB ? clampSamplePct(body.ab_sample_pct) : null,
        ab_test_hours: subjectB ? clampHours(body.ab_test_hours) : null,
        html: snapshotHtml,
        plain_text: snapshotText,
        blog_post_ids: posts.map(p => (p as unknown as { id?: string }).id).filter(Boolean) as string[],
        personal_message: personalMessage,
        curated_links: curatedLinks as never,
        compose_intro: intro,
        compose_outro: outro,
        segment_filter: segmentFilter,
        scheduled_at: scheduledAt.toISOString(),
        status: 'scheduled',
        recipients_total: recipients.length,
      })
      .select('id')
      .single()
    if (bErr || !bRow) return NextResponse.json({ error: bErr?.message || 'Failed to schedule broadcast' }, { status: 500 })
    return NextResponse.json({
      ok: true,
      broadcastId: bRow.id as string,
      mode: 'scheduled',
      scheduledAt: scheduledAt.toISOString(),
      recipients: recipients.length,
    })
  }

  // ── Mode 2: A/B TEST — split sample, send both variants, defer winner ────
  if (subjectB) {
    const samplePct = clampSamplePct(body.ab_sample_pct)
    const testHours = clampHours(body.ab_test_hours)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bRow, error: bErr } = await (supabase as any)
      .from('newsletter_broadcasts')
      .insert({
        user_id: user.id,
        subject,
        subject_b: subjectB,
        ab_sample_pct: samplePct,
        ab_test_hours: testHours,
        html: snapshotHtml,
        plain_text: snapshotText,
        blog_post_ids: posts.map(p => (p as unknown as { id?: string }).id).filter(Boolean) as string[],
        personal_message: personalMessage,
        curated_links: curatedLinks as never,
        compose_intro: intro,
        compose_outro: outro,
        segment_filter: segmentFilter,
        status: 'ab_testing',
        recipients_total: 0, // ticks up after we finalize
      })
      .select('id')
      .single()
    if (bErr || !bRow) return NextResponse.json({ error: bErr?.message || 'Failed to record broadcast' }, { status: 500 })
    const broadcastId = bRow.id as string

    const { a, b, holdback } = partitionAbSample(recipients, samplePct, broadcastId)

    // Persist the split so the cron knows which IDs got which variant + so
    // the winner-send excludes them.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('newsletter_broadcasts').update({
      ab_recipients_a: a.map(r => r.id),
      ab_recipients_b: b.map(r => r.id),
      ab_finalize_at: new Date(Date.now() + testHours * 3600_000).toISOString(),
      recipients_total: a.length + b.length,
    }).eq('id', broadcastId)

    // Send A + B in parallel.
    const [resA, resB] = await Promise.all([
      sendBroadcastBatch({ recipients: a, subject,    from, baseInput, broadcastId, userId: user.id, variant: 'a' }),
      sendBroadcastBatch({ recipients: b, subject: subjectB, from, baseInput: { ...baseInput, subject: subjectB }, broadcastId, userId: user.id, variant: 'b' }),
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('newsletter_broadcasts').update({
      recipients_delivered: resA.sent + resB.sent,
      error_message: (resA.failed + resB.failed) > 0
        ? `${resA.failed + resB.failed}/${a.length + b.length} sample recipients errored`
        : null,
    }).eq('id', broadcastId)

    return NextResponse.json({
      ok: true,
      broadcastId,
      mode: 'ab_testing',
      sample: { aSize: a.length, bSize: b.length, holdback: holdback.length },
      finalizeAt: new Date(Date.now() + testHours * 3600_000).toISOString(),
      sentA: resA.sent,
      sentB: resB.sent,
      failedA: resA.failed,
      failedB: resB.failed,
    })
  }

  // ── Mode 1: REGULAR — single subject, send to all matching recipients ────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bRow, error: bErr } = await (supabase as any)
    .from('newsletter_broadcasts')
    .insert({
      user_id: user.id,
      subject,
      html: snapshotHtml,
      plain_text: snapshotText,
      blog_post_ids: posts.map(p => (p as unknown as { id?: string }).id).filter(Boolean) as string[],
      personal_message: personalMessage,
      curated_links: curatedLinks as never,
      compose_intro: intro,
      compose_outro: outro,
      segment_filter: segmentFilter,
      status: 'sending',
      recipients_total: recipients.length,
    })
    .select('id')
    .single()
  if (bErr || !bRow) return NextResponse.json({ error: bErr?.message || 'Failed to record broadcast' }, { status: 500 })
  const broadcastId = bRow.id as string

  const { sent, failed } = await sendBroadcastBatch({
    recipients,
    subject,
    from,
    baseInput,
    broadcastId,
    userId: user.id,
    variant: null,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
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

function clampSamplePct(raw: number | undefined): number {
  // 5% floor (too few recipients = test is statistical noise).
  // 50% ceiling (above this the "winner-send to holdback" doesn't beat
  // just sending the better-guessed subject to everyone outright).
  const n = typeof raw === 'number' ? Math.round(raw) : 20
  return Math.max(5, Math.min(50, n))
}

function clampHours(raw: number | undefined): number {
  // 1h floor (Resend's open-pixel delivery lag + email-client poll cadence
  // means anything under an hour is noise).
  // 48h ceiling (the broadcast goes stale after that).
  const n = typeof raw === 'number' ? Math.round(raw) : 2
  return Math.max(1, Math.min(48, n))
}
