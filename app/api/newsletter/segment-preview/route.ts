/**
 * POST /api/newsletter/segment-preview
 *
 * Returns "X of Y active subscribers will receive this" for a given
 * SegmentFilter. The /newsletter/compose page calls this whenever the
 * segment criteria change so users see a live match count before they
 * confirm the send.
 *
 * Why a dedicated route instead of letting the client filter:
 *   - At 10k+ subscribers, shipping the full list to the browser is
 *     wasteful and exposes more data than needed.
 *   - Reuses applySegmentFilter() so the preview number matches the
 *     real send exactly — same filter logic, same DB column reads, no
 *     drift.
 *   - Tier-gated to Pro (segmented sends are Pro-only) — wraps the
 *     preview so non-Pro users don't see a tease.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { applySegmentFilter, type SegmentFilter, type NewsletterRecipient } from '@/lib/newsletter-send'
import { tierHas } from '@/lib/tier'
import { normalizeTier } from '@/lib/tier'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Tier gate — matches /api/newsletter/send. Non-Pro callers get 402 so
  // the UI can surface the upgrade CTA inline rather than showing a stale
  // count.
  const { data: integ } = await supabase
    .from('integrations')
    .select('tier')
    .eq('user_id', user.id)
    .maybeSingle()
  const tier = normalizeTier(integ?.tier)
  if (!tierHas(tier, 'newsletterSegmentedSends')) {
    return NextResponse.json(
      { error: 'Segmented sends are a Pro feature.' },
      { status: 402 },
    )
  }

  const body = await request.json().catch(() => ({})) as { filter?: SegmentFilter | null }
  const filter = body.filter ?? null

  // Pull only the active rows + only the columns applySegmentFilter
  // actually reads. Skipping the unused columns trims payload + DB read.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error } = await (supabase as any)
    .from('newsletter_subscribers')
    .select('email,source,tags,created_at')
    .eq('user_id', user.id)
    .eq('status', 'active')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const all = (rows ?? []) as NewsletterRecipient[]
  const matching = applySegmentFilter(all, filter)

  return NextResponse.json({
    total: all.length,
    matching: matching.length,
  })
}
