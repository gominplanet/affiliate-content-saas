// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/cc-digest — the daily "campaigns picked for you" batch.
// POST /api/cc-digest — record a per-card thumbs up/down (realignment signal).
//
// Every 24h a creator gets ~25 Creator Connections campaigns matched to their
// historical blog + YouTube topics. Generation is LAZY: the first dashboard
// visit of the day builds + caches the batch (cc_digest_cache), later visits
// read the cache. No campaign is ever shown twice (cc_digest_seen ledger), and
// per-card thumbs reweight future picks.
//
// Matching is hybrid: a cheap deterministic first pass (niche/keyword overlap ×
// catalog opportunity × learned feedback) shortlists the catalog, then one LLM
// call re-ranks the shortlist by true topical fit and picks the final 25.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { ccAccessOk } from '@/lib/cc-access'
import { toUserMessage } from '@/lib/friendly-error'
import { CC_SMART_RULES, hitsAvoidList } from '@/lib/cc-smart-rules'
import {
  brandTrust, campaignFullness, estPerSale, daysUntil, type BrandAgg,
} from '@/lib/cc-intelligence'
import {
  buildInterestProfile, campaignMatchText, matchScore, matchedCategory,
  aggregateFeedback, feedbackMultiplier, preScore, buildRerankPrompt,
  parseRerankResponse, type RerankCandidate,
} from '@/lib/cc-digest'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { spendGate } from '@/lib/ai-spend'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const DIGEST_SIZE = 25          // cards per daily digest
const SHORTLIST = 60            // candidates handed to the LLM re-rank
const POOL = 400               // rows pulled per catalog query
const RERANK_MODEL = 'claude-sonnet-4-6'

// ── GET: the daily batch ─────────────────────────────────────────────────────

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations').select('tier,amazon_associates_tag')
      .eq('user_id', user.id).maybeSingle()
    const tier = normalizeTier(intRow?.tier) as Tier
    const amazonTag = ((intRow as { amazon_associates_tag?: string | null } | null)?.amazon_associates_tag || '').trim()

    // CC access gate (proof-of-CC, not paid tier). Unverified → empty; the
    // dashboard card self-hides, no error surfaced.
    if (!(await ccAccessOk(supabase, user.id, tier))) {
      return NextResponse.json({ eligible: false, campaigns: [] })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const today = new Date().toISOString().slice(0, 10)

    // Fresh cache for today → serve it.
    const { data: cached } = await sb.from('cc_digest_cache')
      .select('campaigns, generated_at').eq('user_id', user.id).eq('digest_date', today).maybeSingle()
    if (cached && Array.isArray(cached.campaigns) && cached.campaigns.length > 0) {
      // Serve the cache only if it's already free of same-item duplicates. A
      // legacy batch that predates the dedup falls through and regenerates a
      // clean set now (rather than waiting out the 24h).
      const unique = dedupeCards(cached.campaigns as { campaignId: string; brand: string | null; asin: string; imageUrl: string | null }[])
      if (unique.length === cached.campaigns.length) {
        return NextResponse.json({ eligible: true, campaigns: cached.campaigns, generatedAt: cached.generated_at, cached: true })
      }
    }

    // ── Generate ──────────────────────────────────────────────────────────
    const profile = await loadInterestProfile(sb, user.id)

    // Everything we've ever shown this user (never repeat) + past thumbs.
    const { data: seenRows } = await sb.from('cc_digest_seen')
      .select('campaign_id, brand_name, category, feedback').eq('user_id', user.id)
    const seen = new Set<string>((seenRows ?? []).map((r: { campaign_id: string }) => r.campaign_id))
    const fb = aggregateFeedback((seenRows ?? []) as { brand_name: string | null; category: string | null; feedback: string | null }[])

    // Candidate pool: a topical (FTS) pull biased to the creator's keywords, plus
    // a quality (commission-sorted) pull — merged. Strict signal gates first;
    // fall back to loose gates only if strict runs dry (so we never repeat).
    let rows = await fetchPool(sb, profile, /*strict*/ true)
    let usable = filterPool(rows, seen)
    if (usable.length < DIGEST_SIZE) {
      const loose = await fetchPool(sb, profile, /*strict*/ false)
      usable = filterPool(mergeRows(rows, loose), seen)
    }

    if (usable.length === 0) {
      return NextResponse.json({ eligible: true, campaigns: [] })
    }

    // First-pass score every candidate.
    const scored = usable.map((r) => {
      const text = campaignMatchText(r)
      const agg: BrandAgg = {
        brandName: r.brand_name ?? '', totalCampaigns: 1, activeCampaigns: 1,
        totalBudget: numOr(r.budget, 0), totalRemaining: numOr(r.budget_remaining, 0),
        hasBudgetData: r.budget != null, avgCommissionPct: numOrNull(r.commission_pct),
      }
      const trust = brandTrust(agg)
      const fullness = campaignFullness(r.available_slot, r.total_slot)
      const perSale = estPerSale(numOrNull(r.commission_pct), numOrNull(r.price_now_cents))
      const cat = matchedCategory(text, profile)
      const match = matchScore(text, profile)
      const score = preScore({
        perSale, commissionPct: numOrNull(r.commission_pct), trust, fullness,
        daysLeft: daysUntil(r.ends_at), monthlySold: numOrNull(r.monthly_sold),
        match, feedbackMult: feedbackMultiplier(r, cat, fb),
      })
      return { row: r, cat, score }
    }).sort((a, b) => b.score - a.score)

    // Collapse same-item duplicates: one brand's product often appears under
    // several campaign ids ("High-Demand Automotive Product", "Promote a
    // Best-Selling Automotive Category", …) — same ASIN / same product image.
    // Keep only the best-scoring campaign per item (scored is sorted desc, so
    // the first occurrence of each key is the best), and remember the siblings
    // so we can mark them seen too (the same item won't resurface tomorrow
    // under a different campaign id).
    const siblings = new Map<string, string[]>()
    for (const s of scored) {
      const k = itemKey(s.row)
      const arr = siblings.get(k)
      if (arr) arr.push(s.row.campaign_id)
      else siblings.set(k, [s.row.campaign_id])
    }
    const seenKeys = new Set<string>()
    const deduped = scored.filter((s) => {
      const k = itemKey(s.row)
      if (seenKeys.has(k)) return false
      seenKeys.add(k)
      return true
    })

    const shortlist = deduped.slice(0, SHORTLIST)

    // LLM re-rank the shortlist by true topical fit → final order. Skipped
    // (deterministic order kept) if the spend ceiling is hit or the call fails.
    let order = shortlist.map((s) => s.row.campaign_id)
    const gate = await spendGate(user.id, tier)
    if (!gate) {
      const reranked = await llmRerank(profile, shortlist, tier, user.id)
      if (reranked.length) {
        const rank = new Map(reranked.map((id, i) => [id, i]))
        // Re-ranked ids first (in model order), then the rest in deterministic order.
        order = [...shortlist].sort((a, b) => {
          const ra = rank.has(a.row.campaign_id) ? rank.get(a.row.campaign_id)! : Infinity
          const rb = rank.has(b.row.campaign_id) ? rank.get(b.row.campaign_id)! : Infinity
          return ra - rb
        }).map((s) => s.row.campaign_id)
      }
    }

    const byId = new Map(shortlist.map((s) => [s.row.campaign_id, s]))
    const picked = order.map((id) => byId.get(id)).filter(Boolean).slice(0, DIGEST_SIZE) as typeof shortlist
    const campaigns = picked.map((s) => toCard(s.row, s.cat, amazonTag))

    // Persist: cache the batch + record every card in the seen-ledger so it
    // never returns (with its matched brand/category for realignment).
    await sb.from('cc_digest_cache').upsert({
      user_id: user.id, digest_date: today, campaigns, generated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,digest_date' })

    if (picked.length) {
      // Mark the picked campaign AND all its same-item siblings as seen, so the
      // product can't reappear tomorrow under one of its other campaign ids.
      const seenUpserts: { user_id: string; campaign_id: string; shown_on: string; brand_name: string | null; category: string | null }[] = []
      const added = new Set<string>()
      for (const s of picked) {
        for (const cid of siblings.get(itemKey(s.row)) ?? [s.row.campaign_id]) {
          if (added.has(cid)) continue
          added.add(cid)
          seenUpserts.push({
            user_id: user.id, campaign_id: cid, shown_on: today,
            brand_name: s.row.brand_name ?? null, category: s.cat ?? null,
          })
        }
      }
      await sb.from('cc_digest_seen').upsert(seenUpserts, { onConflict: 'user_id,campaign_id', ignoreDuplicates: true })
    }

    return NextResponse.json({ eligible: true, campaigns, generatedAt: new Date().toISOString(), cached: false })
  } catch (err) {
    console.error('[cc-digest GET]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Could not load your campaign digest just now.') }, { status: 500 })
  }
}

// ── POST: thumbs up/down ─────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as { campaignId?: string; feedback?: string | null }
    const campaignId = (body.campaignId || '').trim()
    if (!campaignId) return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 })
    const feedback = body.feedback === 'up' || body.feedback === 'down' ? body.feedback
      : body.feedback == null ? null
      : undefined
    if (feedback === undefined) return NextResponse.json({ error: 'feedback must be "up", "down" or null' }, { status: 400 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    // The row exists (written at generation time); update its reaction. Guard on
    // user_id so RLS + the filter both scope to the caller.
    const { error } = await sb.from('cc_digest_seen')
      .update({ feedback, reacted_at: new Date().toISOString() })
      .eq('user_id', user.id).eq('campaign_id', campaignId)
    if (error) return NextResponse.json({ error: toUserMessage(error, 'Could not save your feedback.') }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[cc-digest POST]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Could not save your feedback.') }, { status: 500 })
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

const SELECT_COLS =
  'campaign_id, campaign_name, brand_name, asins, commission_pct, starts_at, ends_at, ' +
  'budget, budget_remaining, available_slot, total_slot, image_url, price_now_cents, ' +
  'price_was_cents, discount_pct, rating, review_count, monthly_sold, video_count'

interface CatalogRow {
  campaign_id: string; campaign_name: string; brand_name: string | null
  asins: string[] | null; commission_pct: number | null
  starts_at: string | null; ends_at: string
  budget: number | null; budget_remaining: number | null
  available_slot: number | null; total_slot: number | null
  image_url: string | null; price_now_cents: number | null; price_was_cents: number | null
  discount_pct: number | null; rating: number | null; review_count: number | null
  monthly_sold: number | null; video_count: number | null
}

/** Pull a candidate pool. `strict` applies the MVP Focus signal gates (rating /
 *  demand / price band / carousel); loose keeps only runway + a commission floor
 *  so we can backfill rather than ever repeat a campaign. Topical FTS pull is
 *  merged with a commission-sorted quality pull. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchPool(sb: any, profile: ReturnType<typeof buildInterestProfile>, strict: boolean): Promise<CatalogRow[]> {
  const rules = CC_SMART_RULES
  const runwayDays = strict ? rules.minDaysLeft : 30
  const runwayCutoff = new Date(Date.now() + runwayDays * 86_400_000).toISOString().slice(0, 10)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = sb.from('cc_campaign_catalog').select(SELECT_COLS)
      .gte('ends_at', runwayCutoff)
      .gte('commission_pct', rules.minCommissionPct)
    if (strict) {
      q = q.gte('rating', rules.minRating)
        .gte('monthly_sold', rules.minMonthlySales)
        .gte('price_now_cents', rules.minPrice * 100)
        .lte('price_now_cents', rules.maxPrice * 100)
        .gt('video_count', 0)
    }
    return q.order('commission_pct', { ascending: false }).order('ends_at', { ascending: true })
  }

  const ftsTerms = topKeywordsForFts(profile)
  const runs: Promise<{ data: CatalogRow[] | null }>[] = []
  // Topical pull — bias toward the creator's own keywords.
  if (ftsTerms) {
    runs.push(base().textSearch('search_vec', ftsTerms, { type: 'websearch' }).range(0, POOL - 1)
      .then((r: { data: CatalogRow[] | null }) => r, () => ({ data: null })))
  }
  // Quality pull — best campaigns regardless of match (fills the pool).
  runs.push(base().range(0, POOL - 1).then((r: { data: CatalogRow[] | null }) => r, () => ({ data: null })))

  const results = await Promise.all(runs)
  const merged: CatalogRow[] = []
  for (const res of results) if (Array.isArray(res.data)) merged.push(...res.data)
  return dedupeRows(merged)
}

function topKeywordsForFts(profile: ReturnType<typeof buildInterestProfile>): string | null {
  const terms = [
    ...profile.categories,
    ...[...profile.keywords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k),
  ].filter((t) => t && t.length >= 3).slice(0, 16)
  if (!terms.length) return null
  return terms.join(' OR ')
}

function dedupeRows(rows: CatalogRow[]): CatalogRow[] {
  const seen = new Set<string>()
  const out: CatalogRow[] = []
  for (const r of rows) { if (!seen.has(r.campaign_id)) { seen.add(r.campaign_id); out.push(r) } }
  return out
}

function mergeRows(a: CatalogRow[], b: CatalogRow[]): CatalogRow[] {
  return dedupeRows([...a, ...b])
}

/** Drop rows with no usable ASIN, already-shown campaigns, and avoid-list hits. */
function filterPool(rows: CatalogRow[], seen: Set<string>): CatalogRow[] {
  return rows.filter((r) =>
    !seen.has(r.campaign_id) &&
    pickAsin(r) != null &&
    !hitsAvoidList({ campaignName: r.campaign_name, brand: r.brand_name, crumbs: null }, CC_SMART_RULES),
  )
}

const ASIN_IN_NAME = /\bB0[A-Z0-9]{8}\b/i
function pickAsin(r: { asins?: string[] | null; campaign_name?: string | null }): string | null {
  const first = Array.isArray(r.asins) && r.asins[0] ? String(r.asins[0]).toUpperCase() : null
  if (first) return first
  const m = (r.campaign_name || '').match(ASIN_IN_NAME)
  return m ? m[0].toUpperCase() : null
}

/** Product identity used to collapse duplicate campaigns for the SAME item.
 *  Same brand + same product image = same product — the strongest visible
 *  signal, and it collapses brand-level campaigns that reuse one product under
 *  several campaign ids (the JASKLEV case) even when their ASINs differ. Falls
 *  back to ASIN, then campaign id so a row with no identity signal is never
 *  wrongly merged with another. Product images are per-ASIN from enrichment,
 *  so brand+image won't merge genuinely different products. */
function itemKey(r: CatalogRow): string {
  const img = (r.image_url || '').split('?')[0]
  if (r.brand_name && img) return `bi:${r.brand_name.trim().toLowerCase()}|${img}`
  const asin = pickAsin(r)
  if (asin) return `a:${asin}`
  return `c:${r.campaign_id}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadInterestProfile(sb: any, userId: string) {
  const [bp, vids, blogs] = await Promise.all([
    sb.from('brand_profiles').select('niches, custom_categories').eq('user_id', userId).maybeSingle()
      .then((r: { data: { niches?: string[] | null; custom_categories?: string[] | null } | null }) => r.data, () => null),
    sb.from('youtube_videos').select('title, generated_tags, selected_category')
      .eq('user_id', userId).order('published_at', { ascending: false }).limit(60)
      .then((r: { data: { title: string | null; generated_tags: unknown; selected_category: string | null }[] | null }) => r.data ?? [], () => []),
    sb.from('blog_posts').select('title, seo_keyword, affiliate_keywords')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(60)
      .then((r: { data: { title: string | null; seo_keyword: string | null; affiliate_keywords: string[] | null }[] | null }) => r.data ?? [], () => []),
  ])

  const videoTags: string[] = []
  for (const v of vids) {
    const t = v.generated_tags
    if (Array.isArray(t)) videoTags.push(...t.map((x) => String(x)))
    else if (typeof t === 'string') videoTags.push(t)
  }
  const blogKeywords: string[] = []
  for (const b of blogs) {
    if (b.seo_keyword) blogKeywords.push(b.seo_keyword)
    if (Array.isArray(b.affiliate_keywords)) blogKeywords.push(...b.affiliate_keywords)
  }

  return buildInterestProfile({
    niches: bp?.niches ?? [],
    customCategories: bp?.custom_categories ?? [],
    videoTitles: vids.map((v: { title: string | null }) => v.title),
    videoTags,
    videoCategories: vids.map((v: { selected_category: string | null }) => v.selected_category),
    blogTitles: blogs.map((b: { title: string | null }) => b.title),
    blogKeywords,
  })
}

async function llmRerank(
  profile: ReturnType<typeof buildInterestProfile>,
  shortlist: { row: CatalogRow; cat: string | null; score: number }[],
  tier: Tier, userId: string,
): Promise<string[]> {
  try {
    const candidates: RerankCandidate[] = shortlist.map((s) => ({
      campaignId: s.row.campaign_id,
      name: s.row.campaign_name,
      brand: s.row.brand_name,
      category: s.cat,
      commissionPct: numOrNull(s.row.commission_pct),
      price: s.row.price_now_cents != null ? Math.round(s.row.price_now_cents) / 100 : null,
    }))
    const { system, user } = buildRerankPrompt(profile, candidates, DIGEST_SIZE)
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: RERANK_MODEL, max_tokens: 1500, system,
      messages: [{ role: 'user', content: user }],
    })
    recordAnthropicUsage(msg, { userId, tier, feature: 'cc_digest_rerank', model: RERANK_MODEL })
    const text = (msg.content[0] as { type: string; text?: string })?.text || ''
    return parseRerankResponse(text, new Set(candidates.map((c) => c.campaignId)), DIGEST_SIZE)
  } catch (err) {
    console.error('[cc-digest rerank]', err instanceof Error ? err.message : err)
    return []
  }
}

function toCard(r: CatalogRow, category: string | null, amazonTag: string) {
  const asin = pickAsin(r) as string
  const total = typeof r.total_slot === 'number' ? r.total_slot : null
  const open = typeof r.available_slot === 'number' ? r.available_slot : null
  const budgetPct = r.budget != null && r.budget > 0 && r.budget_remaining != null
    ? Math.max(0, Math.min(100, Math.round((r.budget_remaining / r.budget) * 100))) : null
  return {
    campaignId: r.campaign_id,
    name: r.campaign_name,
    brand: r.brand_name,
    asin,
    category,
    commissionPct: numOrNull(r.commission_pct),
    price: r.price_now_cents != null ? Math.round(r.price_now_cents) / 100 : null,
    priceWas: r.price_was_cents != null ? Math.round(r.price_was_cents) / 100 : null,
    discountPct: r.discount_pct ?? null,
    rating: r.rating != null ? Number(r.rating) : null,
    reviewCount: r.review_count ?? null,
    monthlySold: r.monthly_sold ?? null,
    imageUrl: r.image_url ?? null,
    slotsOpen: open,
    totalSlot: total,
    daysLeft: daysUntil(r.ends_at),
    budgetPct,
    buyUrl: `https://www.amazon.com/dp/${asin}${amazonTag ? `?tag=${encodeURIComponent(amazonTag)}` : ''}`,
    // The CC message page URL the outreach modal opens (constructible from id).
    detailsUrl: `https://affiliate-program.amazon.com/p/connect/request?campaignId=${encodeURIComponent(r.campaign_id)}&type=affiliate-plus&status=active`,
  }
}

/** Dedupe already-built cards by the same product identity as itemKey, keeping
 *  the first (best-ranked) of each. Used as a read-time guard on cached batches. */
function dedupeCards<T extends { campaignId: string; brand: string | null; asin: string; imageUrl: string | null }>(cards: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const c of cards) {
    const img = (c.imageUrl || '').split('?')[0]
    const key = c.brand && img ? `bi:${c.brand.trim().toLowerCase()}|${img}` : c.asin ? `a:${c.asin}` : `c:${c.campaignId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

function numOr(v: unknown, d: number): number { return typeof v === 'number' && isFinite(v) ? v : d }
function numOrNull(v: unknown): number | null { return typeof v === 'number' && isFinite(v) ? v : null }
