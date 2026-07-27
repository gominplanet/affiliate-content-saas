/**
 * GET /api/cron/discover-niche-deals
 *
 * New-deal niche alerts (discovery). For each Pro creator, finds brand-NEW real
 * deals in their niche (high opportunity score) that just landed in the shared
 * deal_radar_cache and drops them into their dashboard Price Alerts box
 * (price_alerts.kind = 'new_niche_deal'). Turns Deal Radar from something you
 * check into something that pings you when opportunity appears.
 *
 * Paced: least-recently-scanned users first, a 2-day per-user cooldown, a batch
 * cap, and at most a few alerts per user per run (no flooding). Dedupes against
 * any existing alert for the same ASIN. Scheduled daily; the cooldown spreads it.
 *
 * Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 120

const BATCH = Math.max(1, Number(process.env.NICHE_ALERT_BATCH) || 30)
const PER_USER_MAX = 3          // most alerts to add per user per run
const COOLDOWN_HOURS = 40       // ~every 2 days per user
const NEW_WINDOW_HOURS = 30     // a deal counts as "new" if first seen this recently

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  const deadline = Date.now() + 100_000
  const cooldown = new Date(Date.now() - COOLDOWN_HOURS * 3600_000).toISOString()
  const newSince = new Date(Date.now() - NEW_WINDOW_HOURS * 3600_000).toISOString()

  const { data: users } = await sb
    .from('integrations')
    .select('user_id,tier,last_niche_alert_at')
    .in('tier', ['pro', 'admin'])
    .or(`last_niche_alert_at.is.null,last_niche_alert_at.lt.${cooldown}`)
    .order('last_niche_alert_at', { ascending: true, nullsFirst: true })
    .limit(BATCH)

  let scanned = 0, created = 0

  for (const u of (users ?? []) as Array<{ user_id: string }>) {
    if (Date.now() > deadline) break
    scanned++
    try {
      const { data: brand } = await sb.from('brand_profiles').select('niches').eq('user_id', u.user_id).maybeSingle()
      const niches: string[] = (Array.isArray(brand?.niches) ? brand.niches : []).map((n: string) => (n || '').trim()).filter(Boolean).slice(0, 6)

      // Candidate NEW, verified deals — niche-matched when we have niches,
      // best opportunity first.
      let q = sb.from('deal_radar_cache')
        .select('asin,title,image_url,price_now_cents,discount_pct,deal_quality,opportunity_score')
        .in('deal_quality', ['excellent', 'genuine'])
        .gte('first_seen_at', newSince)
      if (niches.length) {
        const query = niches.map((t) => t.replace(/[^a-z0-9 ]/gi, ' ').trim()).filter(Boolean).join(' OR ')
        if (query) q = q.textSearch('fts', query, { type: 'websearch', config: 'english' })
      }
      const { data: candidates } = await q.order('opportunity_score', { ascending: false, nullsFirst: false }).limit(12)
      const rows = (candidates ?? []) as CandidateRow[]
      if (!rows.length) { await stamp(sb, u.user_id); continue }

      // Dedupe against ASINs this user already has any alert for.
      const asins = rows.map((r) => r.asin)
      const { data: existing } = await sb.from('price_alerts').select('asin').eq('user_id', u.user_id).in('asin', asins)
      const seen = new Set(((existing ?? []) as Array<{ asin: string }>).map((x) => x.asin))

      const toInsert = rows.filter((r) => !seen.has(r.asin)).slice(0, PER_USER_MAX).map((r) => ({
        user_id: u.user_id,
        asin: r.asin,
        kind: 'new_niche_deal',
        title: r.title,
        image_url: r.image_url,
        price_now_cents: r.price_now_cents,
        price_ref_cents: null,
        label: `New deal in your niche${r.discount_pct != null ? ` · ${r.discount_pct}% off` : ''}`,
        blog_post_id: null,
      }))

      if (toInsert.length) { await sb.from('price_alerts').insert(toInsert); created += toInsert.length }
      await stamp(sb, u.user_id)
    } catch (err) {
      console.warn('[discover-niche-deals] failed for', u.user_id, err instanceof Error ? err.message : err)
      await stamp(sb, u.user_id)
    }
  }

  return NextResponse.json({ ok: true, scanned, created })
}

interface CandidateRow {
  asin: string
  title: string
  image_url: string | null
  price_now_cents: number | null
  discount_pct: number | null
  deal_quality: string | null
  opportunity_score: number | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function stamp(sb: any, userId: string): Promise<void> {
  await sb.from('integrations').update({ last_niche_alert_at: new Date().toISOString() }).eq('user_id', userId)
}
