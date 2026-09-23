// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The coverage grid learns whether a listing is actually on the storefront.
//
// WHY THIS EXISTS. `storefront_coverage` has always declared two separate
// states, and the file that declares them says why:
//
//    UPLOADED IS NOT LIVE, and they are deliberately separate. `uploaded` means
//    SCOUT finished the upload; `live` means the video was afterwards found on
//    the storefront. Collapsing them turned the whole map into a claim about
//    what was attempted rather than a record of what is earning.
//
// Nothing ever wrote `live`. So the failure that comment warns against was the
// actual behaviour: every cell stopped at `uploaded`, and a map of attempts was
// being read as a map of earnings. A video Amazon silently dropped looked
// exactly like one selling every day.
//
// WHY SCOUT AND NOT A SERVER. There is no server-side session for amazon.de.
// The storefront belongs to the creator and only their signed-in browser can
// see it, which is the same reason the upload itself goes through SCOUT.
//
// AND SCOUT ALREADY DOES THIS CALL. Before uploading, it fetches the creator's
// list of shoppable media for that marketplace to spot duplicates. The same
// list, read later, answers the only question that matters: is our listing
// still in it. Nothing new has to be scraped, and no new permission is needed.
//
// GET  — what to look for, per marketplace.
// POST — what was found, as a list of Amazon's own listing ids.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { marketByDomain } from '@/lib/markets'

export const runtime = 'nodejs'

/** How many times a listing can go unfound before the row says so. Six passes
 *  rather than one: a storefront page is eventually consistent, and calling a
 *  listing missing on the first look would be the same over-confidence in the
 *  other direction. */
const CONFIRM_TRIES = 6

/** The youngest a listing can be before we expect to find it. Amazon takes its
 *  time putting a freshly published video on the page, and asking immediately
 *  would fail every time and mean nothing. */
const SETTLE_MS = 30 * 60_000

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const domain = (new URL(req.url).searchParams.get('domain') || '').trim()
  if (domain && !marketByDomain(domain)) {
    return NextResponse.json({ error: 'Unknown marketplace.' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  let q = sb.from('storefront_coverage')
    .select('id,domain,media_aci,updated_at,confirm_tries')
    .eq('user_id', user.id)
    .eq('state', 'uploaded')
    .not('media_aci', 'is', null)
    .lte('updated_at', new Date(Date.now() - SETTLE_MS).toISOString())
    .lt('confirm_tries', CONFIRM_TRIES)
    .limit(500)
  if (domain) q = q.eq('domain', domain)
  const { data: rows } = await q

  // GROUPED BY MARKETPLACE, because that is the unit of work: one storefront
  // page per domain, whatever it holds.
  const byDomain = new Map<string, string[]>()
  for (const r of (rows ?? [])) {
    const list = byDomain.get(r.domain) ?? []
    list.push(r.media_aci)
    byDomain.set(r.domain, list)
  }

  return NextResponse.json({
    ok: true,
    markets: [...byDomain.entries()].map(([d, aciList]) => ({
      domain: d,
      host: marketByDomain(d)?.host ?? d,
      waiting: aciList.length,
      aciList,
    })),
  })
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    domain?: string
    /** Every listing id SCOUT could see on that storefront. */
    found?: string[]
    /** True only when the list was read in full. A partial read must never be
     *  taken as proof a listing is absent, which is the whole failure mode this
     *  route exists to avoid repeating in a new shape. */
    complete?: boolean
  }
  const domain = (body.domain || '').trim()
  if (!domain || !marketByDomain(domain)) {
    return NextResponse.json({ error: 'A known marketplace is required.' }, { status: 400 })
  }
  const found = new Set((body.found ?? []).map((s) => String(s || '').trim()).filter(Boolean))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: rows } = await sb.from('storefront_coverage')
    .select('id,media_aci,confirm_tries')
    .eq('user_id', user.id).eq('domain', domain)
    .eq('state', 'uploaded').not('media_aci', 'is', null)
    .limit(500)

  const now = new Date().toISOString()
  let confirmed = 0, stillWaiting = 0, missing = 0

  for (const r of (rows ?? [])) {
    if (found.has(r.media_aci)) {
      await sb.from('storefront_coverage').update({
        state: 'live', confirmed_at: now, reason: null, updated_at: now,
      }).eq('id', r.id)
      confirmed++
      continue
    }
    // NOT FOUND IS ONLY NEWS IF WE SAW THE WHOLE LIST. Otherwise this is a
    // half-read page, and treating it as absence would write "Amazon dropped
    // your listing" about a scroll that did not finish.
    if (!body.complete) { stillWaiting++; continue }

    const tries = Number(r.confirm_tries ?? 0) + 1
    if (tries >= CONFIRM_TRIES) {
      await sb.from('storefront_coverage').update({
        confirm_tries: tries,
        reason: 'SCOUT uploaded this and Amazon is not showing it on your storefront. It may have been rejected after the fact, or removed. Open the storefront and check.',
        updated_at: now,
      }).eq('id', r.id)
      missing++
    } else {
      await sb.from('storefront_coverage')
        .update({ confirm_tries: tries, updated_at: now }).eq('id', r.id)
      stillWaiting++
    }
  }

  return NextResponse.json({ ok: true, confirmed, stillWaiting, missing })
}
