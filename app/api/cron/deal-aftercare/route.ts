// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/deal-aftercare — Ended deals, on its own (every six hours).
//
// For each creator who can use it and switched it on themselves, and for the
// owner (integrations.deal_aftercare_auto, migrations 380 and 386: opt-in, so
// opening Ended Deals to Pro did not start rewriting anyone's posts unasked):
//   1. a price check for deal posts whose state is not known yet
//   2. deal posts whose sale ended become lasting reviews
//   3. lasting reviews whose product is on sale again get their deal back
// A post is only ever changed on a real answer: a passed end date or a fresh
// price check. "Could not check" changes nothing.
//
// Bounded. Keepa tokens are shared by everyone, so price checks are capped per
// creator and per run; the AI rewrite and WordPress edits are slow, so a run
// does a few and the next run carries on. What each run did is on each post.
//
// Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canUsePreview } from '@/lib/labs-preview'
import { runAftercareForOwner, type AutoRunResult } from '@/lib/deal-aftercare-server'
import type { Tier } from '@/lib/tier'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TIERS: Tier[] = ['trial', 'creator', 'amazon', 'studio', 'pro', 'admin']
const CHECKS_PER_OWNER = 25
const CHECKS_PER_RUN = 150
const CONVERTS_PER_OWNER = 3
const REVIVES_PER_OWNER = 5
const MAX_OWNERS = 40

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const started = Date.now()
  // LAST START WITH ROOM FOR ONE REWRITE. A convert is an 8,000 token rewrite
  // plus WordPress edits; started at 249s it ran past 300 and was killed
  // between the post edit and the row that records it.
  const deadline = started + 200_000
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const tiers = TIERS.filter((t) => canUsePreview('deal_aftercare', t))

  // Who has it on: the owner, and creators who switched it on themselves.
  let owners: string[] = []
  let r = await admin.from('integrations').select('user_id').in('tier', tiers).eq('deal_aftercare_auto', true)
    .or('tier.eq.admin,deal_aftercare_auto_chosen_at.not.is.null').limit(2000)
  // Before migration 386 nobody's choice is recorded, so only the owner runs.
  if (r.error) r = await admin.from('integrations').select('user_id').eq('tier', 'admin').limit(50)
  if (r.error) return NextResponse.json({ ok: false, error: r.error.message }, { status: 500 })
  owners = [...new Set(((r.data ?? []) as Array<{ user_id: string }>).map((x) => x.user_id))]

  // Only creators with deal posts, newest activity first.
  const withDeals: string[] = []
  for (let i = 0; i < owners.length && withDeals.length < MAX_OWNERS; i += 100) {
    const { data } = await admin.from('blog_posts').select('user_id').eq('post_type', 'deal').in('user_id', owners.slice(i, i + 100)).limit(1000)
    for (const row of (data ?? []) as Array<{ user_id: string }>) if (!withDeals.includes(row.user_id)) withDeals.push(row.user_id)
  }

  let checksLeft = CHECKS_PER_RUN
  const results: Array<{ ownerId: string } & Partial<AutoRunResult> & { error?: string }> = []
  for (const ownerId of withDeals.slice(0, MAX_OWNERS)) {
    if (Date.now() > deadline) break
    try {
      const res = await runAftercareForOwner(admin, ownerId, {
        checks: Math.min(CHECKS_PER_OWNER, checksLeft), converts: CONVERTS_PER_OWNER, revives: REVIVES_PER_OWNER, deadline,
      })
      checksLeft -= res.checked
      results.push({ ownerId, ...res })
    } catch (e) {
      results.push({ ownerId, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) })
    }
  }
  const sum = (k: 'converted' | 'revived' | 'failed') => results.reduce((n, x) => n + (x[k]?.length ?? 0), 0)
  const summary = { ok: true, owners: results.length, checked: CHECKS_PER_RUN - checksLeft, converted: sum('converted'), revived: sum('revived'), failed: sum('failed'), ms: Date.now() - started }
  console.log('[cron/deal-aftercare]', JSON.stringify(summary))
  return NextResponse.json({ ...summary, results })
}
