// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/brainstorm/amazon — the storefront-grounded Brainstorm for the
// Amazon Influencer tier. Unlike the blog/YouTube brainstorm (which reads
// youtube_videos + blog_posts + Search Console — none of which a storefront
// creator has), this grounds suggestions in what an Amazon creator actually
// has: their PROVEN sellers (storefront_earnings, SCOUT-synced), their open
// Creator Connections campaigns, and their niche. Every suggestion carries an
// ACTION so the idea becomes a one-click thumbnail / post / campaign, not a
// wall of text.
//
// Amazon only reports products with a few shipments, so the earnings we have
// ARE the winners — exactly what "make more of what works" wants. Thin-data
// creators fall back to research + campaigns guidance so it's never empty.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordUsage, usageFromAnthropic } from '@/lib/ai-usage'
import { normalizeTier, type Tier } from '@/lib/tier'

export const maxDuration = 60

interface Suggestion {
  title: string
  why: string
  action: 'thumbnail' | 'social' | 'campaign' | 'research'
  asin?: string | null
  label: string
}

const money = (cents: number | null | undefined) => (cents == null ? null : Math.round(cents) / 100)

export async function POST() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    // 1. Proven sellers — the LATEST period, ranked by earnings. Order by
    //    period_start DESC first so the newest period wins the "latest" pick
    //    (ordering by commission first let an older, higher-earning period
    //    masquerade as latest, and mixed weekly+monthly starts made "latest"
    //    usually the latest week). Prefer monthly (the dashboard's default
    //    view); fall back to weekly only if no monthly is synced yet.
    const EARN_COLS = 'asin,product_title,period_type,period_start,units,revenue_cents,commission_cents,clicks'
    type EarnRow = { asin: string; product_title: string | null; period_type: string; period_start: string; units: number | null; revenue_cents: number | null; commission_cents: number | null; clicks: number | null }
    let { data: earnRows } = await sb
      .from('storefront_earnings').select(EARN_COLS)
      .eq('user_id', user.id).eq('period_type', 'monthly')
      .order('period_start', { ascending: false })
      .order('commission_cents', { ascending: false, nullsFirst: false })
      .limit(300)
    if (!earnRows || earnRows.length === 0) {
      const wk = await sb
        .from('storefront_earnings').select(EARN_COLS)
        .eq('user_id', user.id).eq('period_type', 'weekly')
        .order('period_start', { ascending: false })
        .order('commission_cents', { ascending: false, nullsFirst: false })
        .limit(300)
      earnRows = wk.data
    }
    const earnings = (earnRows ?? []) as EarnRow[]
    // Rows are already period_start DESC then commission DESC, so the first row
    // is the latest period's best earner. Keep that period, top 15 by earnings.
    const latestPeriod = earnings.length ? earnings[0].period_start : null
    const topSellers = earnings
      .filter(e => e.period_start === latestPeriod)
      .slice(0, 15)
      .map(e => ({
        asin: e.asin,
        title: e.product_title || e.asin,
        units: e.units,
        earnings: money(e.commission_cents),
        revenue: money(e.revenue_cents),
        clicks: e.clicks,
        commissionPct: e.revenue_cents && e.commission_cents ? Math.round((e.commission_cents / e.revenue_cents) * 1000) / 10 : null,
        earningsPerClick: e.clicks && e.commission_cents ? Math.round((e.commission_cents / e.clicks)) / 100 : null,
      }))

    // 2. Open Creator Connections campaigns (payout hints live in free-text epc).
    const { data: campRows } = await sb
      .from('campaigns')
      .select('asin,product_title,campaign_name,epc,status')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
    const campaigns = (campRows ?? []) as Array<{ asin: string; product_title: string | null; campaign_name: string | null; epc: string | null; status: string }>

    // 3. Niche.
    const { data: brandRow } = await sb.from('brand_profiles').select('niches').eq('user_id', user.id).maybeSingle()
    const niches = ((brandRow?.niches as string[] | null) ?? []).slice(0, 8)

    // Tier (for cost telemetry).
    const { data: intRow } = await sb.from('integrations').select('tier').eq('user_id', user.id).single()
    const tier = normalizeTier((intRow as { tier?: string } | null)?.tier) as Tier

    const hasData = topSellers.length > 0 || campaigns.length > 0

    // Thin data → deterministic guidance, no AI spend.
    if (!hasData) {
      const suggestions: Suggestion[] = [
        { title: 'Connect SCOUT to unlock earnings-based ideas', why: 'Once SCOUT syncs your storefront, Brainstorm can point you at your proven sellers and best commission earners. Until then, start from research.', action: 'research', label: 'Open Research' },
        { title: 'Find products worth reviewing', why: niches.length ? `Search your niches (${niches.slice(0, 3).join(', ')}) for high-commission, high-demand products to make content for.` : 'Search the Amazon catalogue by sales, rating, price and commission to find your first products worth posting.', action: 'research', label: 'Open Research' },
        { title: 'Browse brand-deal campaigns', why: 'Creator Connections campaigns pay a bounty on top of commission. Grab a few that fit your niche and post them.', action: 'campaign', label: 'See campaigns' },
      ]
      return NextResponse.json({ suggestions, grounded: false })
    }

    // AI: turn the real data into actionable next moves.
    const client = createAnthropicClient()
    const dataBlock = JSON.stringify({ niches, topSellers, campaigns: campaigns.slice(0, 10) }, null, 2)
    const sys = `You are an Amazon storefront strategist for an influencer who posts product content to Pinterest, Instagram and Facebook (NO blog, NO YouTube). You get their REAL data: proven sellers (Amazon only reports products with a few sales, so these are genuine winners) with earnings, commission %, clicks and earnings-per-click; their open Creator Connections brand campaigns; and their niche.

Return ONLY a JSON array of 5-7 suggestions, each object:
{"title": "<punchy next move>", "why": "<1-2 sentences grounded in THEIR numbers — cite the actual product/earnings/commission>", "action": "thumbnail"|"social"|"campaign"|"research", "asin": "<the ASIN if the move is about a specific product they sell, else null>", "label": "<button text, e.g. 'Make the thumbnail'>"}

Rules: prioritise their best earners and best earnings-per-click (make more of what already sells). Flag high-click / low-conversion products as a repositioning idea. Push a couple of their strongest campaigns. Keep it concrete and storefront-specific. No blog/SEO/YouTube advice. Output the JSON array only, no prose.`

    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1800,
      system: sys,
      messages: [{ role: 'user', content: `Here is my data:\n\n${dataBlock}\n\nGive me my next 5-7 moves as the JSON array.` }],
    })
    try {
      const u = usageFromAnthropic(resp)
      recordUsage({ userId: user.id, tier, feature: 'brainstorm_amazon', model: 'claude-sonnet-4-6', input: u.input, output: u.output })
    } catch { /* telemetry best-effort */ }

    const text = resp.content.map(b => (b.type === 'text' ? b.text : '')).join('')
    let suggestions: Suggestion[] = []
    try {
      const jsonStr = (text.match(/\[[\s\S]*\]/) || [text])[0]
      const parsed = JSON.parse(jsonStr) as Suggestion[]
      suggestions = (Array.isArray(parsed) ? parsed : [])
        .filter(s => s && s.title && s.action)
        .map(s => ({
          title: String(s.title).slice(0, 140),
          why: String(s.why || '').slice(0, 400),
          action: (['thumbnail', 'social', 'campaign', 'research'].includes(s.action) ? s.action : 'research') as Suggestion['action'],
          asin: s.asin && /^[A-Z0-9]{10}$/.test(String(s.asin)) ? String(s.asin) : null,
          label: String(s.label || 'Open').slice(0, 40),
        }))
        .slice(0, 7)
    } catch { /* fall through to empty */ }

    if (suggestions.length === 0) {
      return NextResponse.json({ error: 'Could not generate ideas — try again.' }, { status: 502 })
    }
    return NextResponse.json({ suggestions, grounded: true })
  } catch (e) {
    console.warn('[brainstorm/amazon] error:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Brainstorm failed.' }, { status: 500 })
  }
}
