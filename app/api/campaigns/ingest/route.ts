/**
 * POST /api/campaigns/ingest
 *
 * Bearer-token authed (NOT a session — the Chrome extension runs on
 * amazon.com and has no dashboard cookie). The user's per-account
 * ingest token (integrations.cc_ingest_token) resolves the account;
 * RLS is bypassed via the service-role client.
 *
 * Body: { campaigns: [{ asin, campaignName?, epc?, endsAt? }] }
 *
 * Each scouted campaign becomes a `pending` campaigns row, ready for
 * one-click "Generate post" on the CC Campaigns page. ASINs that already
 * have a non-failed campaign row are skipped (idempotent re-scans).
 *
 * Pro-tier only — same gate as the generate route.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tierAllowsCampaigns, type Tier } from '@/lib/tier'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

// GET /api/campaigns/ingest — validate an ingest token (no writes). The SCOUT
// extension calls this on Connect so it can confirm the token works, then
// collapse the token field. Returns { ok, pro, queued } or 401.
export async function GET(request: Request) {
  try {
    const auth = request.headers.get('authorization') || ''
    const token = auth.toLowerCase().startsWith('bearer ')
      ? auth.slice(7).trim()
      : (request.headers.get('x-cc-token') || '').trim()
    if (!token) {
      return NextResponse.json({ ok: false, error: 'Missing ingest token' }, { status: 401, headers: CORS })
    }
    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await admin
      .from('integrations')
      .select('user_id,tier')
      .eq('cc_ingest_token', token)
      .single()
    if (!intRow?.user_id) {
      return NextResponse.json({ ok: false, error: 'Invalid ingest token' }, { status: 401, headers: CORS })
    }
    const tier = (intRow.tier as Tier) ?? 'trial'
    let queued = 0
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count } = await admin
        .from('campaigns')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', intRow.user_id as string)
      queued = count ?? 0
    } catch { /* count is best-effort */ }
    return NextResponse.json({ ok: true, pro: tierAllowsCampaigns(tier), queued }, { headers: CORS })
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500, headers: CORS })
  }
}

interface IncomingCampaign {
  asin?: string
  campaignName?: string
  // The real brand name (kept separate from the product-ish campaignName).
  brandName?: string
  epc?: string
  endsAt?: string
  // Which Creator Connections program this campaign belongs to. EPC = pay per
  // click (dollar `epc`); affiliate_plus = extra commission per sale (percent).
  program?: 'epc' | 'affiliate_plus'
  commissionPct?: number
  // Deep-import signals read from the product's Amazon page.
  monthlySales?: number
  hasCarouselVideo?: boolean
  // Where the carousel video sits on the product page: 'top' (hero gallery),
  // 'bottom' (related-videos section) or 'none'.
  carouselVideoPos?: 'top' | 'bottom' | 'none'
  // Product (Buy Box) price read off the /dp during the deep check — powers the
  // price sort on /epc (the campaign card carries no price).
  price?: number
  // The campaign's Creator Connections page, so MVP can later re-open it to
  // message the brand.
  detailsUrl?: string
}

export async function POST(request: Request) {
  try {
    const auth = request.headers.get('authorization') || ''
    const token = auth.toLowerCase().startsWith('bearer ')
      ? auth.slice(7).trim()
      : (request.headers.get('x-cc-token') || '').trim()
    if (!token) {
      return NextResponse.json({ error: 'Missing ingest token' }, { status: 401, headers: CORS })
    }

    const admin = createAdminClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await admin
      .from('integrations')
      .select('user_id,tier')
      .eq('cc_ingest_token', token)
      .single()
    if (!intRow?.user_id) {
      return NextResponse.json({ error: 'Invalid ingest token' }, { status: 401, headers: CORS })
    }
    const userId = intRow.user_id as string
    const tier = (intRow.tier as Tier) ?? 'trial'
    if (!tierAllowsCampaigns(tier)) {
      return NextResponse.json(
        { error: 'Creator Campaigns is a Pro feature.' },
        { status: 403, headers: CORS },
      )
    }

    const body = await request.json().catch(() => ({})) as { campaigns?: IncomingCampaign[] }
    const incoming = Array.isArray(body.campaigns) ? body.campaigns : []
    if (incoming.length === 0) {
      return NextResponse.json({ error: 'No campaigns in payload' }, { status: 400, headers: CORS })
    }

    // Normalize + validate
    const seen = new Set<string>()
    const clean = incoming
      .map(c => {
        const asin = String(c.asin ?? '').toUpperCase().trim()
        const program = c.program === 'affiliate_plus' ? 'affiliate_plus' : 'epc'
        const commissionPct = typeof c.commissionPct === 'number' && isFinite(c.commissionPct)
          ? c.commissionPct
          : null
        return {
          asin,
          campaign_name: c.campaignName?.toString().trim() || null,
          brand_name: c.brandName?.toString().trim() || null,
          // Keep the two payment models in their own fields: dollar EPC stays in
          // `epc`, the Affiliate+ rate in `commission_pct` (never conflated).
          epc: program === 'epc' ? (c.epc?.toString().trim() || null) : null,
          program,
          commission_pct: program === 'affiliate_plus' ? commissionPct : null,
          monthly_sales: typeof c.monthlySales === 'number' && isFinite(c.monthlySales) ? Math.round(c.monthlySales) : null,
          has_carousel_video: typeof c.hasCarouselVideo === 'boolean'
            ? c.hasCarouselVideo
            : (c.carouselVideoPos ? c.carouselVideoPos !== 'none' : null),
          carousel_video_pos: (c.carouselVideoPos === 'top' || c.carouselVideoPos === 'bottom' || c.carouselVideoPos === 'none') ? c.carouselVideoPos : null,
          product_price: typeof c.price === 'number' && isFinite(c.price) && c.price > 0 ? c.price : null,
          details_url: (c.detailsUrl && /^https:\/\/(www\.amazon\.com|affiliate-program\.amazon\.com)\//i.test(c.detailsUrl.trim())) ? c.detailsUrl.trim() : null,
          ends_at: c.endsAt?.toString().trim() || null,
        }
      })
      .filter(c => {
        if (!/^[A-Z0-9]{10}$/.test(c.asin)) return false
        if (seen.has(c.asin)) return false
        seen.add(c.asin)
        return true
      })

    if (clean.length === 0) {
      return NextResponse.json({ error: 'No valid ASINs in payload' }, { status: 400, headers: CORS })
    }

    // Look up existing rows for these ASINs. Normally an ASIN that already has a
    // live (non-failed) row is skipped. EXCEPTION: a Sponsored (EPC) re-import can
    // HEAL a still-pending row that a pre-fix import mis-tagged as Affiliate+ with
    // no rate — overwrite it in place with the correct program + EPC/price instead
    // of silently dedup-skipping (so the user doesn't have to delete + re-import).
    interface ExRow { id: string; asin: string; status: string; program: string | null; commission_pct: number | null; blog_post_id: string | null }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await admin
      .from('campaigns')
      .select('id,asin,status,program,commission_pct,blog_post_id')
      .eq('user_id', userId)
      .in('asin', clean.map(c => c.asin))
    const exByAsin = new Map<string, ExRow>()
    for (const r of ((existing ?? []) as unknown as ExRow[])) {
      if (r.status !== 'failed' && !exByAsin.has(r.asin)) exByAsin.set(r.asin, r)
    }

    // An incoming EPC import heals a PENDING, rate-less Affiliate+ row (the exact
    // signature of a pre-v1.11.47 Sponsored import) — never touches a row that's
    // been acted on (accepted/generated/published) or a real Affiliate+ campaign.
    const canHeal = (ex: ExRow, c: typeof clean[number]) =>
      c.program === 'epc' &&
      ex.program === 'affiliate_plus' &&
      ex.commission_pct == null &&
      ex.status === 'pending' &&
      !ex.blog_post_id

    const toInsert: Array<typeof clean[number] & { user_id: string; status: 'pending' }> = []
    const toHeal: Array<{ id: string; patch: Record<string, unknown> }> = []
    for (const c of clean) {
      const ex = exByAsin.get(c.asin)
      if (!ex) { toInsert.push({ ...c, user_id: userId, status: 'pending' as const }); continue }
      if (canHeal(ex, c)) {
        // Flip program → epc + clear commission; only set the other fields when the
        // import actually carries a value, so we never clobber good data with null.
        const patch: Record<string, unknown> = { program: 'epc', commission_pct: null }
        if (c.epc != null) patch.epc = c.epc
        if (c.product_price != null) patch.product_price = c.product_price
        if (c.monthly_sales != null) patch.monthly_sales = c.monthly_sales
        if (c.has_carousel_video != null) patch.has_carousel_video = c.has_carousel_video
        if (c.carousel_video_pos != null) patch.carousel_video_pos = c.carousel_video_pos
        if (c.campaign_name) patch.campaign_name = c.campaign_name
        if (c.brand_name) patch.brand_name = c.brand_name
        if (c.details_url) patch.details_url = c.details_url
        toHeal.push({ id: ex.id, patch })
      }
      // else: already present and not healable → skip
    }

    let inserted = 0
    if (toInsert.length > 0) {
      const { error, count } = await admin
        .from('campaigns')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert(toInsert as any, { count: 'exact' })
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500, headers: CORS })
      }
      inserted = count ?? toInsert.length
    }

    let healed = 0
    for (const u of toHeal) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await admin.from('campaigns').update(u.patch as any).eq('id', u.id).eq('user_id', userId)
      if (!error) healed++
    }

    return NextResponse.json(
      { ok: true, inserted, healed, skipped: clean.length - toInsert.length - healed, received: incoming.length },
      { headers: CORS },
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500, headers: CORS })
  }
}
