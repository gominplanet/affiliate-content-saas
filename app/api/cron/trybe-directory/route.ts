// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/trybe-directory — reads TRYBE brands' own websites, a few at
// a time, into the shared TRYBE directory (migration 417).
//
// So a creator's keywords can match what a brand actually sells ("bible"
// finds a brand through its product "Bible Journaling Kit"), each brand's
// website is read once: its home page text and, for most of these stores,
// Shopify's public product list. Brands in TRYBE's Top 100 first, then the
// newest (TRYBE gives no score to order by). A site that could
// not be read is stamped with why and not asked again for a month.
//
// HOW KNOWN EACH BRAND IS (migration 452, lib/brand-popularity; Seb,
// 2026-10-21): its website's rank among the world's websites (the Tranco
// list, one question a second) and what Google suggests after its name. Read
// first each run for about 45 seconds, rated brands first, about 240
// brands an hour, again after two weeks. A source that did not answer leaves
// the brand not read, and after two misses in a row it is not asked again
// that run.
//
// The passes live in lib/trybe-directory-refresh, which the team's Refresh
// everything button runs too, until none is left.
//
// Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { payLinePass, popularityPass, sitesPass, socialsPass, BUDGET_MS, POP_BUDGET_MS } from '@/lib/trybe-directory-refresh'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const started = Date.now()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any
  // Every brand with no pay line once an hour, the first page the other runs.
  const pay = await payLinePass(sb, new Date().getUTCMinutes() < 10 ? 12 : 1).catch((e) => ({ error: e instanceof Error ? e.message : 'error' }))
  // Before migration 452 this reads nothing and says so in its answer.
  const popularity = await popularityPass(sb, started + POP_BUDGET_MS).catch((e) => ({ error: e instanceof Error ? e.message : 'error' }))
  const sites = await sitesPass(sb, started + BUDGET_MS)
  // Before migration 417 there is nothing to read: said, not thrown.
  if (sites.error) return NextResponse.json({ ok: false, error: sites.error }, { status: /does not exist|schema cache/i.test(sites.error) ? 200 : 500 })
  const socials = Date.now() - started < BUDGET_MS ? await socialsPass(sb, started + BUDGET_MS) : 0
  return NextResponse.json({ ok: true, asked: sites.asked, read: sites.read, failed: sites.failed, socials, popularity, pay, ms: Date.now() - started })
}
