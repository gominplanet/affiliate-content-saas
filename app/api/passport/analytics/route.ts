// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/passport/analytics?days=30 — the Passport Links dashboard data.
//
// Aggregates the creator's click log into: totals, clicks by country, by day (a
// trend), top products, and by source. Bounded fetch + in-JS aggregation keeps it
// simple; if click volume ever gets huge this moves to a SQL rollup, but the shape
// the dashboard consumes stays the same.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { AMAZON_MARKETPLACES as MARKETPLACES } from '@/lib/passport-links'
import { canUsePassport } from '@/lib/feature-access'
import { normalizeTier } from '@/lib/tier'

export const dynamic = 'force-dynamic'

const MAX_ROWS = 20000

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tierRow } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePassport(normalizeTier(tierRow?.tier))) {
    return NextResponse.json({ error: 'Passport Links is available on the Amazon, Studio, and Pro plans.' }, { status: 403 })
  }

  const url = new URL(request.url)
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30))
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let { data: rows, error } = await (supabase as any)
      .from('passport_link_clicks')
      .select('code, country, marketplace, source, device, browser, os, created_at')
      .eq('user_id', user.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS)
    // Older DBs (migration 284 not run yet) don't have device/browser/os — retry
    // without them so the dashboard still renders the country/marketplace slices.
    // Only on a missing-column error (Postgres 42703 / "column ... does not exist"):
    // a transient error shouldn't silently drop the device/browser data when the
    // columns are actually present.
    const isMissingColumn = !!error && (error.code === '42703' || /column .* does not exist/i.test(error.message || ''))
    if (isMissingColumn) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const retry = await (supabase as any)
        .from('passport_link_clicks')
        .select('code, country, marketplace, source, created_at')
        .eq('user_id', user.id)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS)
      rows = retry.data
      error = retry.error
    }
    if (error) {
      // Table missing (migration 282 not run) → empty dashboard, not an error.
      return NextResponse.json({ ok: true, total: 0, botClicks: 0, byGroup: [], byCountry: [], byMarketplace: [], byDevice: [], byBrowser: [], byDay: [], topProducts: [], bySource: [], uniqueProducts: 0, uniqueCountries: 0, days })
    }
    const allRows = (rows ?? []) as { code: string; country: string | null; marketplace: string | null; source: string | null; device?: string | null; browser?: string | null; os?: string | null; created_at: string }[]
    // Bots (crawlers + social link-preview fetchers like facebookexternalhit /
    // WhatsApp / Slackbot) aren't real visitors — posting a link to socials alone
    // triggers a burst of them, which otherwise inflates every count. Keep them
    // OUT of all human metrics and report the tally separately so it's honest but
    // clearly not counted as a click. parseUserAgent tags these as browser 'Bot'.
    const botClicks = allRows.filter((c) => c.browser === 'Bot').length
    const allHuman = allRows.filter((c) => c.browser !== 'Bot')

    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1)

    // ── Groups (migration 292): map each click's code → its group, for the
    // by-group breakdown and the optional ?group= filter. Degrades cleanly if the
    // groups schema isn't present yet (everything reads as ungrouped). ──
    const groupParam = (url.searchParams.get('group') || '').trim() // '' all · 'none' ungrouped · else group id
    const distinctCodes = [...new Set(allHuman.map((c) => c.code))]
    const codeToGroup = new Map<string, string | null>()
    if (distinctCodes.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: linkRows } = await (supabase as any)
        .from('passport_links').select('code, group_id').in('code', distinctCodes)
      for (const l of ((linkRows ?? []) as { code: string; group_id: string | null }[])) codeToGroup.set(l.code, l.group_id ?? null)
    }
    const groupName = new Map<string, string>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: groupRows } = await (supabase as any).from('passport_groups').select('id, name').eq('user_id', user.id)
    for (const g of ((groupRows ?? []) as { id: string; name: string }[])) groupName.set(g.id, g.name)

    // by-group tally over ALL human clicks, so the legend is stable regardless of
    // which group is being filtered to.
    const UNGROUPED = '__none__'
    const groupM = new Map<string, number>()
    for (const c of allHuman) bump(groupM, codeToGroup.get(c.code) || UNGROUPED)

    // Working set: everything, or just the selected group.
    const clicks = groupParam
      ? allHuman.filter((c) => {
        const gid = codeToGroup.get(c.code) || null
        return groupParam === 'none' ? !gid : gid === groupParam
      })
      : allHuman

    const countryM = new Map<string, number>()
    const marketM = new Map<string, number>()
    const deviceM = new Map<string, number>()
    const browserM = new Map<string, number>()
    const sourceM = new Map<string, number>()
    const codeM = new Map<string, number>()
    const dayM = new Map<string, number>()
    // amazon host → the alpha-2 store code, for a friendly "sent to" label.
    const hostToCode: Record<string, string> = Object.fromEntries(
      Object.entries(MARKETPLACES).map(([code, m]) => [m.host, code]),
    )
    for (const c of clicks) {
      bump(countryM, (c.country || 'US').toUpperCase())
      if (c.marketplace) bump(marketM, hostToCode[c.marketplace] || c.marketplace)
      bump(deviceM, c.device || 'Unknown')
      bump(browserM, c.browser || 'Unknown')
      bump(sourceM, c.source || 'direct')
      bump(codeM, c.code)
      bump(dayM, c.created_at.slice(0, 10))
    }

    // Resolve top product codes → asin + label for display.
    const topCodes = [...codeM.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    let labels: Record<string, { asin: string; label: string | null }> = {}
    if (topCodes.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: links } = await (supabase as any)
        .from('passport_links').select('code, asin, label').in('code', topCodes.map(([c]) => c))
      labels = Object.fromEntries(((links ?? []) as { code: string; asin: string; label: string | null }[]).map((l) => [l.code, { asin: l.asin, label: l.label }]))
    }

    // Dense day series (fill gaps with 0) so the trend renders evenly.
    const byDay: { date: string; count: number }[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
      byDay.push({ date: d, count: dayM.get(d) || 0 })
    }

    const entries = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])

    const byGroup = [...groupM.entries()]
      .map(([id, count]) => ({ id: id === UNGROUPED ? null : id, name: id === UNGROUPED ? 'Ungrouped' : (groupName.get(id) || 'Group'), count }))
      .sort((a, b) => b.count - a.count)

    return NextResponse.json({
      ok: true,
      total: clicks.length,
      botClicks,
      days,
      byGroup,
      group: groupParam || null,
      uniqueProducts: codeM.size,
      uniqueCountries: countryM.size,
      byCountry: entries(countryM).map(([country, count]) => ({ country, count })),
      byMarketplace: entries(marketM).map(([store, count]) => ({ store, count })),
      byDevice: entries(deviceM).map(([device, count]) => ({ device, count })),
      byBrowser: entries(browserM).map(([browser, count]) => ({ browser, count })).slice(0, 8),
      bySource: entries(sourceM).map(([source, count]) => ({ source, count })).slice(0, 10),
      topProducts: topCodes.map(([code, count]) => ({ code, count, asin: labels[code]?.asin || null, label: labels[code]?.label || null })),
      byDay,
    })
  } catch {
    return NextResponse.json({ ok: true, total: 0, botClicks: 0, byGroup: [], byCountry: [], byMarketplace: [], byDevice: [], byBrowser: [], byDay: [], topProducts: [], bySource: [], uniqueProducts: 0, uniqueCountries: 0, days })
  }
}
