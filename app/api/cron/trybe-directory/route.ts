// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/trybe-directory — reads TRYBE brands' own websites, a few at
// a time, into the shared TRYBE directory (migration 417).
//
// So a creator's keywords can match what a brand actually sells ("bible"
// finds a brand through its product "Bible Journaling Kit"), each brand's
// website is read once: its home page text and, for most of these stores,
// Shopify's public product list. Highest TRYBE score first. A site that could
// not be read is stamped with why and not asked again for a month.
//
// Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { researchBrandSite } from '@/lib/trybe-research'
import { siteSearchText } from '@/lib/trybe-directory'

export const runtime = 'nodejs'
export const maxDuration = 120

/** Brands read per run, and at once. */
const PER_RUN = 36
const AT_ONCE = 6
/** A read that failed is tried again after this long. */
const RETRY_FAILED_MS = 30 * 86_400_000
/** Stop starting new reads this close to the time limit. */
const BUDGET_MS = 95_000

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const started = Date.now()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any
  const { data: fresh, error } = await sb.from('trybe_directory')
    .select('brand_id, website')
    .is('site_fetched_at', null).not('website', 'is', null)
    .order('trybe_score', { ascending: false, nullsFirst: false })
    .limit(PER_RUN)
  if (error) {
    // Before migration 417 there is nothing to read: said, not thrown.
    return NextResponse.json({ ok: false, error: error.message }, { status: /does not exist|schema cache/i.test(error.message) ? 200 : 500 })
  }
  let rows = (fresh || []) as Array<{ brand_id: string; website: string }>
  if (rows.length < PER_RUN) {
    const { data: again } = await sb.from('trybe_directory')
      .select('brand_id, website')
      .not('site_error', 'is', null).not('website', 'is', null)
      .lt('site_fetched_at', new Date(Date.now() - RETRY_FAILED_MS).toISOString())
      .limit(PER_RUN - rows.length)
    rows = rows.concat((again || []) as Array<{ brand_id: string; website: string }>)
  }

  let read = 0, failed = 0
  for (let i = 0; i < rows.length && Date.now() - started < BUDGET_MS; i += AT_ONCE) {
    await Promise.all(rows.slice(i, i + AT_ONCE).map(async (r) => {
      const res = await researchBrandSite(r.website).catch((e) => ({ summary: '', products: [] as string[], error: e instanceof Error ? e.message : 'error' }))
      const ok = !!(res.summary || res.products.length)
      ok ? read++ : failed++
      await sb.from('trybe_directory').update({
        site_summary: res.summary || null,
        site_products: res.products,
        site_text: ok ? siteSearchText(res.summary, res.products) : null,
        site_error: ok ? null : (res.error || 'Nothing readable on the website.'),
        site_fetched_at: new Date().toISOString(),
      }).eq('brand_id', r.brand_id)
    }))
  }
  return NextResponse.json({ ok: true, asked: rows.length, read, failed, ms: Date.now() - started })
}
