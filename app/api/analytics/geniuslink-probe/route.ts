/**
 * GET /api/analytics/geniuslink-probe?shortcode=<optional>
 *
 * Probes Geniuslink's /v1/reports/link-click-trend-by-resolution endpoint
 * with several candidate bot-filter parameter names in parallel, returning
 * the lifetime click count from each. Whichever variant returns the
 * LOWEST count is the one that successfully filters bots — Geniuslink
 * happily ignores unknown query params and returns full counts.
 *
 * Why: clicktype=Human didn't change MVP's totals. Either the parameter
 * name is different on this endpoint, or this endpoint has no bot filter
 * at all. This endpoint proves it definitively without me having to
 * guess parameter names from incomplete docs.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

const GENIUSLINK_API = 'https://api.geni.us'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations')
    .select('geniuslink_api_key, geniuslink_api_secret')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!intRow?.geniuslink_api_key || !intRow?.geniuslink_api_secret) {
    return NextResponse.json({ error: 'No Geniuslink credentials' }, { status: 400 })
  }

  // Geniuslink uses X-Api-Key + X-Api-Secret headers (NOT HTTP Basic Auth).
  // First version of this probe got 400 on every request because of this.
  const authHeaders: Record<string, string> = {
    'X-Api-Key': String(intRow.geniuslink_api_key),
    'X-Api-Secret': String(intRow.geniuslink_api_secret),
    Accept: 'application/json',
  }

  // Pick a shortcode: caller-provided OR auto-pick the user's top-performing one
  // (Purple Leaf umbrella has 978 clicks, a clear signal).
  const { searchParams } = new URL(request.url)
  let shortcode = (searchParams.get('shortcode') || '').trim()
  if (!shortcode) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pickPost } = await (supabase as any)
      .from('blog_posts')
      .select('geniuslink_code')
      .eq('user_id', user.id)
      .not('geniuslink_code', 'is', null)
      .limit(1)
      .maybeSingle()
    shortcode = pickPost?.geniuslink_code || ''
  }
  if (!shortcode) {
    return NextResponse.json({ error: 'No shortcode available — pass ?shortcode=ABC' }, { status: 400 })
  }

  // Variants to try. Each calls the same endpoint with one bot-filter param
  // (or none). Whichever returns the smallest number is the one that works.
  const variants: Array<{ label: string; extra: Record<string, string> }> = [
    { label: 'baseline_no_filter', extra: {} },
    { label: 'clicktype=Human', extra: { clicktype: 'Human' } },
    { label: 'clickType=Human (camelCase)', extra: { clickType: 'Human' } },
    { label: 'humanonly=true', extra: { humanonly: 'true' } },
    { label: 'humanonly=True (capital)', extra: { humanonly: 'True' } },
    { label: 'IsHuman=true', extra: { IsHuman: 'true' } },
    { label: 'excludebots=true', extra: { excludebots: 'true' } },
    { label: 'filtertype=human', extra: { filtertype: 'human' } },
    { label: 'junk=false', extra: { junk: 'false' } },
    { label: 'includejunk=false', extra: { includejunk: 'false' } },
  ]

  const results = await Promise.all(variants.map(async v => {
    const params = new URLSearchParams({
      shortcode,
      advertiserid: '0',
      resolution: 'lifetime',
      ...v.extra,
    })
    const url = `${GENIUSLINK_API}/v1/reports/link-click-trend-by-resolution?${params.toString()}`
    try {
      const res = await fetch(url, { headers: authHeaders, signal: AbortSignal.timeout(15_000) })
      const text = await res.text()
      let json: unknown
      try { json = JSON.parse(text) } catch { json = null }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clicks = (json as any)?.ClicksByDate?.[0]?.Value?.Clicks ?? null
      return {
        label: v.label,
        http_status: res.status,
        lifetime_clicks: clicks,
        url_sent: url,
      }
    } catch (e) {
      return {
        label: v.label,
        http_status: 0,
        lifetime_clicks: null,
        error: e instanceof Error ? e.message : 'fetch failed',
      }
    }
  }))

  // Find the smallest non-null count. If it equals baseline, no filter works.
  const baseline = results.find(r => r.label === 'baseline_no_filter')?.lifetime_clicks ?? null
  const lowest = results
    .filter(r => typeof r.lifetime_clicks === 'number')
    .reduce<typeof results[number] | null>((acc, r) => {
      if (!acc) return r
      return ((r.lifetime_clicks as number) < (acc.lifetime_clicks as number)) ? r : acc
    }, null)

  let verdict: string
  if (!lowest || baseline === null) {
    verdict = 'Could not probe — all calls failed. Check credentials.'
  } else if (lowest.lifetime_clicks === baseline) {
    verdict = `🚨 None of the bot-filter parameters work on this endpoint. Every variant returned ${baseline} clicks. This endpoint has no bot filter — we\'d need to either switch to /v1/clicks (per-click records we filter ourselves) or accept the discrepancy as cosmetic.`
  } else {
    verdict = `✅ Bot-filter parameter: "${lowest.label}". Baseline returned ${baseline}, filtered returned ${lowest.lifetime_clicks}.`
  }

  return NextResponse.json({
    shortcode,
    baseline_clicks: baseline,
    results,
    verdict,
  })
}
