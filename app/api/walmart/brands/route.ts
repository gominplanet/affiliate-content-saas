/**
 * GET /api/walmart/brands — live read of the caller's PartnerBoost Walmart
 * brands via the Monetization API (mod=medium&op=monetization_api,
 * brand_type=Walmart). Powers the admin-only "Walmart PB" Labs tool.
 *
 * ADMIN-ONLY (integrations.tier === 'admin') while we test the integration
 * live. Read-only: it lists brands + your relationship status + the deep-link
 * tracking base. It does NOT (and cannot) join campaigns — joining is a
 * dashboard action in PartnerBoost (terms acceptance + merchant approval).
 *
 * The PartnerBoost token is a server-only env var (PARTNERBOOST_API_TOKEN).
 * It is NEVER returned to the client, logged, or echoed in errors.
 *
 * Query params (all optional): relationship (Joined|Pending|Rejected|No
 * Relationship), country (two-letter), page, limit (max 2000).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import type { Tier } from '@/lib/tier'

export const dynamic = 'force-dynamic'

const PB_ENDPOINT = 'https://app.partnerboost.com/api.php'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations')
      .select('tier')
      .eq('user_id', user.id)
      .maybeSingle()
    const tier = (intRow?.tier as Tier) ?? 'trial'
    if (tier !== 'admin') {
      return NextResponse.json({ ok: false, error: 'Walmart PB is admin-only while in Labs.' }, { status: 403 })
    }

    // .trim() guards the common paste error: a trailing space/newline in the
    // Vercel value makes PartnerBoost return "Publisher does not exist".
    const token = process.env.PARTNERBOOST_API_TOKEN?.trim()
    if (!token) {
      // Not an error — the page shows a one-time setup notice.
      return NextResponse.json({ ok: false, needsToken: true, error: 'PARTNERBOOST_API_TOKEN is not set in the environment.' })
    }

    const { searchParams } = new URL(request.url)
    const relationship = searchParams.get('relationship') || ''
    const country = searchParams.get('country') || ''
    const page = searchParams.get('page') || '1'
    const limit = searchParams.get('limit') || '100'
    const ALLOWED_TYPES = ['Walmart', 'Amazon', 'DTC', 'TikTok', 'Indirect']
    const brandTypeRaw = searchParams.get('brandType') || 'Walmart'
    const brandType = ALLOWED_TYPES.includes(brandTypeRaw) ? brandTypeRaw : 'Walmart'

    const qs = new URLSearchParams({
      mod: 'medium',
      op: 'monetization_api',
      token,
      brand_type: brandType,
      type: 'json',
      page,
      limit,
    })
    if (relationship) qs.set('relationship', relationship)
    if (country) qs.set('country', country)

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 30_000)
    let res: Response
    try {
      res = await fetch(`${PB_ENDPOINT}?${qs.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: ctrl.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    const text = await res.text()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let json: any
    try {
      json = JSON.parse(text)
    } catch {
      return NextResponse.json(
        { ok: false, error: 'PartnerBoost returned a non-JSON response (token or endpoint issue).' },
        { status: 502 },
      )
    }

    const code = json?.status?.code
    if (code !== 0) {
      return NextResponse.json(
        { ok: false, error: json?.status?.msg ? `PartnerBoost: ${json.status.msg}` : `PartnerBoost error code ${code}` },
        { status: 502 },
      )
    }

    const data = json?.data || {}
    const list = Array.isArray(data.list) ? data.list : []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brands = list.map((b: any) => ({
      mcid: b.mcid ?? null,
      brand_id: b.brand_id != null ? String(b.brand_id) : null,
      merchant_name: b.merchant_name ?? '',
      comm_rate: b.comm_rate ?? '',
      avg_payout: b.avg_payout ?? '',
      offer_type: b.offer_type ?? '',
      relationship: b.relationship ?? '',
      allow_sml: String(b.allow_sml ?? '') === '1', // deep-linking enabled
      categories: b.categories ?? '',
      tags: b.tags ?? '',
      country: b.country ?? '',
      logo: b.logo ?? '',
      site_url: b.site_url ?? '',
      tracking_url: b.tracking_url ?? '',
      tracking_url_short: b.tracking_url_short ?? '',
      brand_status: b.merchant_status ?? b.brand_status ?? '',
      rd: b.RD ?? b.rd ?? '',
    }))

    return NextResponse.json({
      ok: true,
      total: Number(data.total_mcid ?? brands.length) || brands.length,
      totalPage: Number(data.total_page ?? 1) || 1,
      page: Number(page) || 1,
      brands,
    })
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError'
      ? 'PartnerBoost request timed out.'
      : e instanceof Error ? e.message : 'Unexpected error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
