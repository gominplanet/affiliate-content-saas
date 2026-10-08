// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/labs/trybe — TRYBE outreach (Labs, admin while it is tested).
//
//   GET                       the queue, settings and today's count
//   POST {action:'settings'}  core message, daily cap, categories, keywords
//   POST {action:'match'}     judge found brands against the niche (website read)
//   POST {action:'found'}     a day's find ran (the daily find waits a day)
//   POST {action:'directory'} TRYBE's whole brand list, as SCOUT read it (shared)
//   POST {action:'shortlist'} brands in MVP's directory that match the niche
//   POST {action:'browse'}    live search of MVP's copy of TRYBE, as filters change
//   POST {action:'adopt'}     put brands picked from the live list on the creator's list
//   POST {action:'import'}    brands SCOUT read from TRYBE's Discover Brands
//   POST {action:'draft'}     research each brand's website, write its message
//   POST {action:'edit'|'skip'|'unskip'|'remove'|'reset'}
//   POST {action:'claim'}     reserve one send under the daily cap
//   POST {action:'result'}    what SCOUT saw happen to that send
//
// The cap is enforced here, at claim time, not in the browser: a page that is
// reloaded, or open twice, cannot send more than the cap allows.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { canUsePreview } from '@/lib/labs-preview'
import { normalizeTier } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordUsage, usageFromAnthropic } from '@/lib/ai-usage'
import { scrubBanned, BANNED_RULE } from '@/lib/scrub'
import { getWorkedWithBrands } from '@/lib/creator-brands'
import { brandKey } from '@/lib/brand-normalize'
import { researchBrandSite } from '@/lib/trybe-research'
import { mergeDirectory, directorySearchText, nicheScore, readCategories, siteSearchText } from '@/lib/trybe-directory'
import {
  clampCap, countsTowardCap, sanitizeScanned, sendUrl, tidyDraft,
  DRAFT_SYSTEM, draftUserPrompt, DEFAULT_DAILY_CAP, type ScannedBrand,
  cleanTerms, prefsKey, FIT_SYSTEM, fitUserPrompt, parseFit,
} from '@/lib/trybe-outreach'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MODEL = 'claude-sonnet-4-6'
// Judging fit is a short yes or no per brand: the small model, a few at a time.
const FIT_MODEL = 'claude-haiku-4-5-20251001'
const RESEARCH_TTL_MS = 14 * 24 * 3600_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

async function gate() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return { error: auth.error }
  const { user, ownerId } = auth as { user: { id: string }; ownerId: string }
  const admin = createAdminClient() as Db
  const { data: intg } = await admin.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('trybe_outreach', intg?.tier)) {
    return { error: NextResponse.json({ error: 'TRYBE Outreach is part of the Pro plan.' }, { status: 403 }) }
  }
  return { userId: user.id, ownerId, tier: normalizeTier(intg?.tier), admin, supabase }
}

async function readSettings(admin: Db, ownerId: string) {
  // Every column, so a database without migration 416 still reads the
  // message and the cap (the niche reads as not set).
  const { data } = await admin.from('trybe_outreach_settings').select('*').eq('user_id', ownerId).maybeSingle()
  return {
    coreMessage: (data?.core_message as string | null) || '',
    dailyCap: clampCap(data?.daily_cap ?? DEFAULT_DAILY_CAP),
    categories: cleanTerms(data?.categories),
    keywords: cleanTerms(data?.keywords),
    dailyFind: data?.daily_find !== false,
    lastFindAt: (data?.last_find_at as string | null) ?? null,
  }
}

/** A brand's website, read once and kept two weeks. */
async function siteFacts(r: Record<string, any>): Promise<{ summary: string; products: string[]; siteError: string | null; fetchedAt: string | null; fresh: boolean }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const fresh = !!r.site_fetched_at && Date.now() - Date.parse(r.site_fetched_at) < RESEARCH_TTL_MS
  if (fresh) return { summary: r.site_summary || '', products: Array.isArray(r.site_products) ? r.site_products : [], siteError: r.site_error || null, fetchedAt: r.site_fetched_at, fresh }
  const res = await researchBrandSite(r.website)
  return { summary: res.summary, products: res.products, siteError: res.error, fetchedAt: new Date().toISOString(), fresh }
}

async function usedToday(admin: Db, ownerId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { data } = await admin.from('trybe_brands').select('status, send_started_at')
    .eq('user_id', ownerId).in('status', ['sent', 'sending']).gte('send_started_at', since)
  const now = Date.now()
  return ((data || []) as Array<{ status: string; send_started_at: string | null }>).filter(r => countsTowardCap(r, now)).length
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  const { admin, ownerId, supabase } = g
  const [settings, used, rows] = await Promise.all([
    readSettings(admin, ownerId),
    usedToday(admin, ownerId),
    admin.from('trybe_brands').select('*').eq('user_id', ownerId).order('created_at', { ascending: false }).limit(1000),
  ])
  let worked = new Map<string, unknown>()
  try { worked = await getWorkedWithBrands(supabase as Db, ownerId) } catch { /* best-effort */ }
  const brands = ((rows.data || []) as Array<Record<string, unknown>>).map(r => ({ ...r, worked_with: worked.has(brandKey(String(r.name || ''))) }))
  return NextResponse.json({ ok: true, settings, usedToday: used, brands, directory: await directoryStats(admin), isAdmin: g.tier === 'admin' })
}

/** A brand's products with the ones naming a keyword first, so a search for
 *  "golf" shows the golf products a store sells before the rest. */
function productsFirst(products: string[], keywords: string[]): string[] {
  const kw = keywords.map(k => k.toLowerCase()).filter(Boolean)
  if (!kw.length) return products
  const hit = (p: string) => kw.some(k => p.toLowerCase().includes(k))
  return [...products.filter(hit), ...products.filter(p => !hit(p))]
}

/** A database refusal in words, naming the migration when a column is missing. */
function dbWords(message: string): string {
  return /column .* does not exist|schema cache/i.test(message) ? 'The TRYBE niche settings need migration 416 in Supabase first.' : message
}

/** Every row a query returns, a thousand at a time: Supabase hands back at
 *  most 1,000 rows per request whatever .limit() says, which quietly cut the
 *  list of brands a creator already has and the directory search short. */
async function allRows<T>(make: () => any, max: number): Promise<{ rows: T[]; error: { message: string } | null }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const rows: T[] = []
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await make().range(from, Math.min(max, from + 1000) - 1)
    if (error) return { rows, error }
    rows.push(...((data || []) as T[]))
    if (!data || data.length < 1000) break
  }
  return { rows, error: null }
}

/** How complete MVP's copy of TRYBE is. Null before migration 417. */
async function directoryStats(admin: Db) {
  try {
    const head = { count: 'exact' as const, head: true }
    const [all, withSite, read, collected, meta] = await Promise.all([
      admin.from('trybe_directory').select('brand_id', head),
      admin.from('trybe_directory').select('brand_id', head).not('website', 'is', null),
      admin.from('trybe_directory').select('brand_id', head).not('site_text', 'is', null),
      admin.from('trybe_directory_meta').select('value').eq('key', 'collected').maybeSingle(),
      admin.from('trybe_directory_meta').select('value').eq('key', 'categories').maybeSingle(),
    ])
    if (all.error) return null
    // ONLY A WHOLE COLLECTION COUNTS as collected: one that stopped partway
    // leaves this empty, so the next Find brands collects again instead of
    // waiting a day on half a list.
    const c = (collected.data?.value || {}) as { at?: string; complete?: boolean; pages?: number; totalPages?: number }
    return {
      brands: all.count ?? 0,
      withWebsite: withSite.count ?? 0,
      websitesRead: read.count ?? 0,
      lastCollectedAt: c.complete && c.at ? c.at : null,
      lastPartial: !c.complete && c.at ? { at: c.at, pages: c.pages ?? null, totalPages: c.totalPages ?? null } : null,
      categories: Array.isArray(meta.data?.value) ? (meta.data.value as string[]) : [],
    }
  } catch { return null }
}

async function writerFacts(admin: Db, ownerId: string): Promise<string[]> {
  const { data } = await admin.from('brand_profiles').select('*').eq('user_id', ownerId).maybeSingle()
  const bp = (data || {}) as Record<string, unknown>
  const op = (bp.outreach_profile && typeof bp.outreach_profile === 'object') ? bp.outreach_profile as Record<string, unknown> : {}
  const s = (o: Record<string, unknown>, k: string) => { const v = o[k]; return typeof v === 'string' && v.trim() ? v.trim().slice(0, 600) : '' }
  const cats = Array.isArray(op.categories) ? (op.categories as unknown[]).map(String).filter(Boolean).slice(0, 8) : []
  return [
    (s(bp, 'brand_name') || s(bp, 'creator_name') || s(bp, 'display_name')) && `Name: ${s(bp, 'brand_name') || s(bp, 'creator_name') || s(bp, 'display_name')}`,
    s(op, 'intro') && `About them: ${s(op, 'intro')}`,
    s(op, 'offer') && `What they offer: ${s(op, 'offer')}`,
    cats.length ? `Categories they cover: ${cats.join(', ')}` : '',
    s(bp, 'niche') && `Niche: ${s(bp, 'niche')}`,
    (s(op, 'youtube') || s(bp, 'youtube_url')) && `YouTube: ${s(op, 'youtube') || s(bp, 'youtube_url')}`,
    s(op, 'storefrontUrl') && `Amazon storefront: ${s(op, 'storefrontUrl')}`,
    s(op, 'signoff') && `Sign-off: ${s(op, 'signoff')}`,
  ].filter(Boolean) as string[]
}

export async function POST(request: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const { admin, ownerId, userId, tier } = g
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const action = String(body.action || '')
  const brandId = typeof body.brandId === 'string' ? body.brandId.slice(0, 80) : ''
  const now = new Date().toISOString()

  if (action === 'settings') {
    const coreMessage = typeof body.coreMessage === 'string' ? body.coreMessage.trim().slice(0, 2000) : ''
    const dailyCap = clampCap(body.dailyCap)
    const row: Record<string, unknown> = { user_id: ownerId, core_message: coreMessage, daily_cap: dailyCap, updated_at: now }
    // Sent only when the page sends them, so an older page cannot wipe them.
    if (body.categories !== undefined) row.categories = cleanTerms(body.categories)
    if (body.keywords !== undefined) row.keywords = cleanTerms(body.keywords)
    if (typeof body.dailyFind === 'boolean') row.daily_find = body.dailyFind
    const { error } = await admin.from('trybe_outreach_settings').upsert(row)
    if (error) {
      const missing = /column .* does not exist|schema cache/i.test(error.message)
      return NextResponse.json({ error: missing ? 'The niche settings need migration 416 in Supabase first.' : error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, settings: await readSettings(admin, ownerId) })
  }

  if (action === 'found') {
    const { error } = await admin.from('trybe_outreach_settings').upsert({ user_id: ownerId, last_find_at: now, updated_at: now })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, lastFindAt: now })
  }

  if (action === 'directory') {
    // TRYBE's own brand list, as SCOUT read it page by page from the
    // creator's TRYBE tab. Shared: kept once for every member. Only what TRYBE
    // says about the brand is written; what MVP read from its website stays.
    const items = Array.isArray(body.items) ? (body.items as unknown[]).slice(0, 800) : []
    const list = mergeDirectory(items)
    // TRYBE answers {success, data: [...]}: readCategories reads either shape.
    if (body.categories != null) {
      const cats = readCategories(body.categories)
      if (cats.length) await admin.from('trybe_directory_meta').upsert({ key: 'categories', value: cats, updated_at: now })
    }
    if (!list.length) {
      const keys = items.length && items[0] && typeof items[0] === 'object' ? Object.keys(items[0] as object).slice(0, 30) : []
      return NextResponse.json({ ok: true, saved: 0, withWebsite: 0, received: items.length, keys })
    }
    // WHAT WAS KNOWN STAYS KNOWN: an entry that arrives emptier than the one
    // saved before (another offer by the same brand, tomorrow's collection)
    // never blanks a website, description or categories already kept.
    const { data: had } = await admin.from('trybe_directory')
      .select('brand_id, name, website, about, categories, pay_text, trybe_score, total_creators, rating')
      .in('brand_id', list.map(b => b.brandId))
    const prev = new Map(((had || []) as Array<Record<string, any>>).map(r => [r.brand_id, r])) // eslint-disable-line @typescript-eslint/no-explicit-any
    // SHARED, SO GUARDED: every member's SCOUT writes here, and what is kept
    // is what every member's search and drafts read. A member's collection
    // adds brands and fills what is missing; only an admin's collection may
    // change a name, website or description already kept.
    const trusted = tier === 'admin'
    const rows = list.map(b => {
      const p = prev.get(b.brandId) || {}
      const keep = (fresh: string | null, had: string | null | undefined) => (trusted ? (fresh ?? had ?? null) : (had ?? fresh ?? null))
      const merged = {
        name: trusted || !p.name ? b.name : p.name,
        website: keep(b.website, p.website),
        categories: b.categories.length ? b.categories : (p.categories || []),
        about: keep(b.about, p.about),
      }
      return {
        brand_id: b.brandId, ...merged,
        pay_text: b.payText ?? p.pay_text ?? null,
        trybe_score: b.trybeScore == null ? (p.trybe_score ?? null) : Math.round(b.trybeScore),
        total_creators: b.totalCreators == null ? (p.total_creators ?? null) : Math.round(b.totalCreators),
        rating: b.rating ?? p.rating ?? null,
        raw: b.raw, search_text: directorySearchText(merged), last_seen_at: now,
      }
    })
    const { error } = await admin.from('trybe_directory').upsert(rows, { onConflict: 'brand_id' })
    if (error) {
      const missing = /does not exist|schema cache/i.test(error.message)
      return NextResponse.json({ error: missing ? 'The TRYBE directory needs migration 417 in Supabase first.' : error.message }, { status: 500 })
    }
    // The last chunk of a collection says how far SCOUT got.
    if (body.collected && typeof body.collected === 'object') {
      const c = body.collected as { complete?: unknown; pages?: unknown; totalPages?: unknown }
      await admin.from('trybe_directory_meta').upsert({ key: 'collected', value: { at: now, complete: c.complete === true, pages: Number(c.pages) || null, totalPages: Number(c.totalPages) || null }, updated_at: now })
    }
    return NextResponse.json({
      ok: true, saved: rows.length, withWebsite: rows.filter(r => r.website).length, received: items.length,
      keys: items[0] && typeof items[0] === 'object' ? Object.keys(items[0] as object).slice(0, 30) : [],
    })
  }

  if (action === 'browse') {
    // LIVE FILTERING (Seb, 2026-10-07: "as users change filters, the results
    // ... should change"). MVP's copy of TRYBE is searched as the creator
    // ticks categories or types keywords: no SCOUT, no TRYBE, no website
    // fetched. Brands already on their list come back with where they stand.
    const cats = cleanTerms(body.categories), kws = cleanTerms(body.keywords)
    const want = Math.max(1, Math.min(120, Number(body.limit) || 60))
    const terms = [...kws, ...cats].map(t => t.toLowerCase().replace(/[%,()]/g, ' ').trim()).filter(Boolean)
    const words = Array.from(new Set(terms.flatMap(t => [/^[a-z0-9 ]+$/.test(t) ? t : '', ...t.split(/[^a-z0-9]+/).filter(w => w.length > 3)]).filter(Boolean))).slice(0, 40)
    const COLS = 'brand_id, name, website, categories, about, pay_text, trybe_score, total_creators, rating, site_products, site_text'
    let rows: Array<Record<string, any>> = [] // eslint-disable-line @typescript-eslint/no-explicit-any
    // No user given: nothing is left out, so a brand on the list still shows.
    const rpc = await admin.rpc('trybe_directory_search', { p_words: words, p_user: null, p_limit: 400 })
    if (!rpc.error) {
      const ids = ((rpc.data || []) as Array<{ brand_id: string }>).map(r => r.brand_id)
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error: e } = await admin.from('trybe_directory').select(COLS).in('brand_id', ids.slice(i, i + 200))
        if (e) return NextResponse.json({ error: e.message }, { status: 500 })
        rows.push(...((data || []) as Array<Record<string, any>>)) // eslint-disable-line @typescript-eslint/no-explicit-any
      }
    } else {
      let q = admin.from('trybe_directory').select(COLS)
      if (words.length) q = q.or(words.flatMap(w => [`search_text.ilike.%${w}%`, `site_text.ilike.%${w}%`]).join(','))
      const { data, error: e } = await q.order('trybe_score', { ascending: false, nullsFirst: false }).limit(800)
      if (e) {
        const missing = /does not exist|schema cache/i.test(e.message)
        return NextResponse.json({ error: missing ? 'The TRYBE directory needs migration 417 in Supabase first.' : e.message }, { status: 500 })
      }
      rows = (data || []) as Array<Record<string, any>> // eslint-disable-line @typescript-eslint/no-explicit-any
    }
    const ranked = rows
      .map(r => ({ r, match: terms.length ? nicheScore({ name: r.name, categories: r.categories || [], about: r.about, siteText: r.site_text, products: r.site_products || [] }, cats, kws) : 0 }))
      .filter(x => !terms.length || x.match > 0)
      .sort((a, b) => b.match - a.match || (b.r.trybe_score ?? 0) - (a.r.trybe_score ?? 0))
    // DONE BRANDS LEAVE THE LIST (Seb, 2026-10-07: "these should be gone, no?
    // I changed keywords ... and i'm still seeing these"). A brand already
    // messaged, written, or removed is left out unless asked for, and the
    // count of those left out is said so the list is never quietly short.
    const mineBy = new Map<string, Record<string, any>>() // eslint-disable-line @typescript-eslint/no-explicit-any
    const rankedIds = ranked.map(x => x.r.brand_id)
    for (let i = 0; i < rankedIds.length; i += 200) {
      const { data: mineRows } = await admin.from('trybe_brands').select('brand_id, status, fit_score, fit_reason').eq('user_id', ownerId).in('brand_id', rankedIds.slice(i, i + 200))
      for (const m of (mineRows || []) as Array<Record<string, any>>) mineBy.set(m.brand_id, m) // eslint-disable-line @typescript-eslint/no-explicit-any
    }
    const DONE = ['drafted', 'sending', 'sent', 'already', 'failed', 'removed']
    const isDone = (id: string) => DONE.includes(String(mineBy.get(id)?.status || ''))
    const hiddenMine = body.includeMine === true ? 0 : ranked.filter(x => isDone(x.r.brand_id)).length
    const shown = body.includeMine === true ? ranked : ranked.filter(x => !isDone(x.r.brand_id))
    const top = shown.slice(0, want)
    return NextResponse.json({
      ok: true,
      matched: shown.length,
      hiddenMine,
      capped: rows.length >= 400,
      brands: top.map(({ r, match }) => {
        const m = mineBy.get(r.brand_id)
        return {
          brand_id: r.brand_id, name: r.name, website: r.website, categories: r.categories || [], about: r.about,
          pay_text: r.pay_text, trybe_score: r.trybe_score, total_creators: r.total_creators, match,
          products: productsFirst(r.site_products || [], kws).slice(0, 8), website_read: !!r.site_text,
          status: m?.status ?? null, fit_score: m?.fit_score ?? null, fit_reason: m?.fit_reason ?? null,
        }
      }),
    })
  }

  if (action === 'adopt') {
    // Brands the creator picked from the live list go on their own list,
    // ready to draft. Picked by hand, so they skip the AI fit check; a brand
    // already on the list (queued, sent, skipped) is left as it is.
    const ids = (Array.isArray(body.brandIds) ? body.brandIds : []).map(String).filter(id => /^[A-Za-z0-9-]{6,80}$/.test(id)).slice(0, 60)
    if (!ids.length) return NextResponse.json({ ok: true, added: 0, ready: [] })
    const settings = await readSettings(admin, ownerId)
    const key = prefsKey(settings.categories, settings.keywords)
    const { data: dir, error: dErr } = await admin.from('trybe_directory')
      .select('brand_id, name, website, categories, about, pay_text, rating, trybe_score, total_creators, site_summary, site_products, site_error, site_fetched_at')
      .in('brand_id', ids)
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })
    const { data: ins, error: insErr } = await admin.from('trybe_brands').upsert(((dir || []) as Array<Record<string, any>>).map(r => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      user_id: ownerId, brand_id: r.brand_id, name: r.name, categories: r.categories || [], website: r.website, about: r.about,
      pay_text: r.pay_text, rating: r.rating, trybe_score: r.trybe_score, total_creators: r.total_creators,
      site_summary: r.site_summary, site_products: r.site_products || [], site_error: r.site_error, site_fetched_at: r.site_fetched_at,
      status: 'new', fit_reason: 'Picked by you from the live list.', fit_prefs: key, fit_checked_at: now, updated_at: now,
    })), { onConflict: 'user_id,brand_id', ignoreDuplicates: true }).select('brand_id')
    if (insErr) return NextResponse.json({ error: dbWords(insErr.message) }, { status: 500 })
    // A brand already there that the AI said no to, or that was skipped or
    // removed, is ready too: picked by hand now overrides all three.
    await admin.from('trybe_brands').update({ status: 'new', updated_at: now })
      .eq('user_id', ownerId).in('brand_id', ids).in('status', ['not_fit', 'skipped', 'removed'])
    const { data: ready } = await admin.from('trybe_brands').select('brand_id').eq('user_id', ownerId).in('brand_id', ids).eq('status', 'new')
    return NextResponse.json({ ok: true, added: (ins || []).length, ready: ((ready || []) as Array<{ brand_id: string }>).map(r => r.brand_id) })
  }

  if (action === 'shortlist') {
    // MVP'S OWN SEARCH. The niche is matched against MVP's copy of every
    // TRYBE brand: name, TRYBE description and categories, and the brand's
    // own website text and products where they have been read. The best are
    // put on the creator's list for the fit check; brands already on it (sent,
    // skipped, judged) are left out.
    const settings = await readSettings(admin, ownerId)
    const want = Math.max(1, Math.min(60, Number(body.limit) || 40))
    const terms = [...settings.keywords, ...settings.categories].map(t => t.toLowerCase().replace(/[%,()]/g, ' ').trim()).filter(Boolean)
    // Each term's words, anywhere in what TRYBE or the website says. Letters,
    // digits and spaces only, so nothing in a term can break the filter.
    const words = Array.from(new Set(terms.flatMap(t => [/^[a-z0-9 ]+$/.test(t) ? t : '', ...t.split(/[^a-z0-9]+/).filter(w => w.length > 3)]).filter(Boolean))).slice(0, 40)
    const COLS = 'brand_id, name, website, categories, about, pay_text, trybe_score, total_creators, rating, site_summary, site_products, site_text, site_error, site_fetched_at'
    let cands: Array<Record<string, any>> = [] // eslint-disable-line @typescript-eslint/no-explicit-any
    let error: { message: string } | null = null
    // THE DATABASE NARROWS IT (migration 418): only the best few hundred
    // brands not already on this creator's list come back, then they are
    // ranked finely here.
    const rpc = await admin.rpc('trybe_directory_search', { p_words: words, p_user: ownerId, p_limit: 300 })
    if (!rpc.error) {
      const ids = ((rpc.data || []) as Array<{ brand_id: string }>).map(r => r.brand_id)
      for (let i = 0; i < ids.length && !error; i += 150) {
        const { data, error: e } = await admin.from('trybe_directory').select(COLS).in('brand_id', ids.slice(i, i + 150))
        if (e) error = e
        else cands.push(...((data || []) as Array<Record<string, any>>)) // eslint-disable-line @typescript-eslint/no-explicit-any
      }
    } else {
      // Before migration 418: the same search done here, capped so a broad
      // niche cannot pull the whole directory into one request.
      const mine = await allRows<{ brand_id: string }>(() => admin.from('trybe_brands').select('brand_id').eq('user_id', ownerId).order('brand_id'), 20000)
      if (mine.error) return NextResponse.json({ error: mine.error.message }, { status: 500 })
      const have = new Set(mine.rows.map(r => r.brand_id))
      const make = () => {
        let q = admin.from('trybe_directory').select(COLS)
        if (words.length) q = q.or(words.flatMap(w => [`search_text.ilike.%${w}%`, `site_text.ilike.%${w}%`]).join(','))
        // A stable order, so paging never skips or repeats a brand.
        return q.order('trybe_score', { ascending: false, nullsFirst: false }).order('brand_id')
      }
      const got = await allRows<Record<string, any>>(make, 2000) // eslint-disable-line @typescript-eslint/no-explicit-any
      cands = got.rows.filter(r => !have.has(r.brand_id))
      error = got.error
    }
    if (error) {
      const missing = /does not exist|schema cache/i.test(error.message)
      return NextResponse.json({ error: missing ? 'The TRYBE directory needs migration 417 in Supabase first.' : error.message }, { status: 500 })
    }
    const scored = cands
      .map(r => ({ r, score: terms.length ? nicheScore({ name: r.name, categories: r.categories || [], about: r.about, siteText: r.site_text, products: r.site_products || [] }, settings.categories, settings.keywords) : (r.trybe_score ?? 0) }))
      .filter(x => !terms.length || x.score > 0)
      .sort((a, b) => b.score - a.score || (b.r.trybe_score ?? 0) - (a.r.trybe_score ?? 0))
    const pick = scored.slice(0, want)
    let added = 0
    if (pick.length) {
      const { data: ins, error: insErr } = await admin.from('trybe_brands').upsert(pick.map(({ r }) => ({
        user_id: ownerId, brand_id: r.brand_id, name: r.name, categories: r.categories || [], website: r.website,
        about: r.about, pay_text: r.pay_text, rating: r.rating, trybe_score: r.trybe_score, total_creators: r.total_creators,
        site_summary: r.site_summary, site_products: r.site_products || [], site_error: r.site_error, site_fetched_at: r.site_fetched_at,
        status: 'new', updated_at: now,
      })), { onConflict: 'user_id,brand_id', ignoreDuplicates: true }).select('brand_id')
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
      // What was actually added, not what was asked for.
      added = (ins || []).length
    }
    return NextResponse.json({ ok: true, matched: scored.length, added, searched: terms.length ? cands.length : null })
  }

  if (action === 'match') {
    // NOT EVERY BRAND (Seb, 2026-10-06). Each brand found is read from its
    // TRYBE profile and its own website and judged against the creator's
    // categories and keywords. One that does not fit is 'not_fit': never
    // drafted or sent unless the creator picks it.
    const ids = (Array.isArray(body.brandIds) ? body.brandIds : []).map(String).slice(0, 6)
    if (!ids.length) return NextResponse.json({ ok: true, results: [] })
    const settings = await readSettings(admin, ownerId)
    const key = prefsKey(settings.categories, settings.keywords)
    const { data: rows } = await admin.from('trybe_brands').select('*').eq('user_id', ownerId).in('brand_id', ids)
    const todo = ((rows || []) as Array<Record<string, any>>).filter(r => r.status === 'new' || r.status === 'not_fit') // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!todo.length) return NextResponse.json({ ok: true, results: [] })
    if (!settings.categories.length && !settings.keywords.length) {
      for (const r of todo) {
        const { error: upErr } = await admin.from('trybe_brands').update({ status: 'new', fit_score: r.trybe_score ?? null, fit_reason: 'No niche set yet, so it is listed without a fit check.', fit_prefs: key, fit_checked_at: now, updated_at: now })
          .eq('user_id', ownerId).eq('brand_id', r.brand_id)
        if (upErr) return NextResponse.json({ error: dbWords(upErr.message) }, { status: 500 })
      }
      return NextResponse.json({ ok: true, results: todo.map(r => ({ brandId: r.brand_id, ok: true, fit: true, score: r.trybe_score ?? null, reason: 'No niche set yet.' })) })
    }
    const spend = await spendGate(userId, tier)
    if (spend) return spend
    const facts = await Promise.all(todo.map(r => siteFacts(r)))
    // A website read here is read for every member: kept in the shared
    // directory too, so the background reader does not fetch it again.
    await Promise.all(todo.map(async (r, i) => {
      const f = facts[i]
      if (f.fresh) return
      const ok = !!(f.summary || f.products.length)
      try {
        await admin.from('trybe_directory').update({
          site_summary: f.summary || null, site_products: f.products, site_text: ok ? siteSearchText(f.summary, f.products) : null,
          site_error: ok ? null : (f.siteError || 'Nothing readable on the website.'), site_fetched_at: f.fetchedAt,
        }).eq('brand_id', r.brand_id).is('site_fetched_at', null)
      } catch { /* the member's own copy is kept either way */ }
    }))
    const verdicts = await (async () => {
      try {
        const msg = await createAnthropicClient().messages.create({
          model: FIT_MODEL,
          max_tokens: 900,
          system: FIT_SYSTEM,
          messages: [{ role: 'user', content: fitUserPrompt(settings.categories, settings.keywords, todo.map((r, i) => ({
            id: String(r.brand_id), name: String(r.name), categories: r.categories || [], about: r.about || null,
            siteSummary: facts[i].summary, siteProducts: facts[i].products,
          }))) }],
        })
        try { const u = usageFromAnthropic(msg); recordUsage({ userId, tier, feature: 'trybe_outreach_fit', model: FIT_MODEL, input: u.input, output: u.output }) } catch { /* best-effort */ }
        return parseFit((msg.content as Array<{ type: string; text?: string }>).map(b => b.type === 'text' ? b.text || '' : '').join(''), todo.map(r => String(r.brand_id)))
      } catch { return [] }
    })()
    const results = []
    for (let i = 0; i < todo.length; i++) {
      const r = todo[i]
      const f = facts[i]
      const v = verdicts.find(x => x.id === r.brand_id)
      // The website is kept either way, for the draft that may follow.
      const site = f.fresh ? {} : { site_summary: f.summary || null, site_products: f.products, site_error: f.siteError, site_fetched_at: f.fetchedAt }
      if (!v) {
        await admin.from('trybe_brands').update({ ...site, updated_at: now }).eq('user_id', ownerId).eq('brand_id', r.brand_id)
        results.push({ brandId: r.brand_id, ok: false, error: 'MVP could not judge this brand. It is asked again next time.' })
        continue
      }
      // SAVED, OR SAID: a verdict that was not saved is not reported as one
      // (without migration 416 every save failed, the page counted fits, and
      // the list stayed empty while the same brands were judged and paid for
      // again on every run).
      const { error: upErr } = await admin.from('trybe_brands').update({
        ...site, status: v.fit ? 'new' : 'not_fit', fit_score: v.score, fit_reason: v.reason || null, fit_prefs: key, fit_checked_at: now, updated_at: now,
      }).eq('user_id', ownerId).eq('brand_id', r.brand_id).in('status', ['new', 'not_fit'])
      if (upErr) return NextResponse.json({ error: dbWords(upErr.message) }, { status: 500 })
      results.push({ brandId: r.brand_id, ok: true, fit: v.fit, score: v.score, reason: v.reason })
    }
    return NextResponse.json({ ok: true, results })
  }

  if (action === 'import') {
    const list = (Array.isArray(body.brands) ? body.brands : []).slice(0, 500).map(sanitizeScanned).filter((b: ScannedBrand | null): b is ScannedBrand => !!b)
    if (!list.length) return NextResponse.json({ ok: true, added: 0, updated: 0, already: 0 })
    const ids = list.map((b: ScannedBrand) => b.brandId)
    const { data: existing } = await admin.from('trybe_brands').select('brand_id, status').eq('user_id', ownerId).in('brand_id', ids)
    const have = new Map<string, string>(((existing || []) as Array<{ brand_id: string; status: string }>).map(r => [r.brand_id, r.status]))
    let added = 0, updated = 0, already = 0
    const rows = list.map((b: ScannedBrand) => {
      const prev = have.get(b.brandId)
      if (prev) updated++; else added++
      // TRYBE showing the brand as requested wins over a queue that never
      // sent it, but never rewrites what MVP itself saw happen.
      const status = b.alreadyRequested && (!prev || prev === 'new' || prev === 'drafted' || prev === 'failed') ? 'already' : (prev || 'new')
      if (status === 'already') already++
      return {
        user_id: ownerId, brand_id: b.brandId, name: b.name, categories: b.categories,
        brand_url: b.brandUrl, website: b.website, about: b.about, pay_text: b.payText,
        rating: b.rating, reviews: b.reviews, creator_earnings: b.creatorEarnings,
        total_creators: b.totalCreators, trybe_score: b.trybeScore, status, updated_at: now,
      }
    })
    const { error } = await admin.from('trybe_brands').upsert(rows, { onConflict: 'user_id,brand_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, added, updated, already })
  }

  if (action === 'draft') {
    const ids = (Array.isArray(body.brandIds) ? body.brandIds : []).map(String).slice(0, 4)
    if (!ids.length) return NextResponse.json({ ok: true, results: [] })
    const settings = await readSettings(admin, ownerId)
    if (!settings.coreMessage.trim()) return NextResponse.json({ error: 'Write your core message first.' }, { status: 400 })
    const spend = await spendGate(userId, tier)
    if (spend) return spend
    const creator = await writerFacts(admin, ownerId)
    const { data: rows } = await admin.from('trybe_brands').select('*').eq('user_id', ownerId).in('brand_id', ids)
    const client = createAnthropicClient()
    const results = await Promise.all(((rows || []) as Array<Record<string, any>>).map(async (r) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (r.status === 'sent' || r.status === 'sending' || r.status === 'already') return { brandId: r.brand_id, ok: false, error: 'Already requested.' }
      if (r.status === 'not_fit') return { brandId: r.brand_id, ok: false, error: 'Not a fit for your niche. Pick it with Use anyway first.' }
      // Research once, then reuse for two weeks (the fit check usually read it).
      const sf = await siteFacts(r)
      const summary = sf.summary, products = sf.products, siteError = sf.siteError, fresh = sf.fresh
      try {
        const msg = await client.messages.create({
          model: MODEL,
          max_tokens: 500,
          system: DRAFT_SYSTEM(BANNED_RULE),
          messages: [{ role: 'user', content: draftUserPrompt({
            coreMessage: settings.coreMessage, creator,
            brand: { name: r.name, categories: r.categories || [], about: r.about, payText: r.pay_text, website: r.website, siteSummary: summary, siteProducts: products },
          }) }],
        })
        try { const u = usageFromAnthropic(msg); recordUsage({ userId, tier, feature: 'trybe_outreach', model: MODEL, input: u.input, output: u.output }) } catch { /* best-effort */ }
        const text = tidyDraft(scrubBanned((msg.content as Array<{ type: string; text?: string }>).map(b => b.type === 'text' ? b.text || '' : '').join('')))
        if (!text) throw new Error('The draft came back empty.')
        const { error: upErr } = await admin.from('trybe_brands').update({
          draft: text, drafted_at: new Date().toISOString(), status: 'drafted', error: null,
          site_summary: summary || null, site_products: products, site_error: siteError, site_fetched_at: fresh ? r.site_fetched_at : sf.fetchedAt,
          updated_at: new Date().toISOString(),
        }).eq('user_id', ownerId).eq('brand_id', r.brand_id)
        if (upErr) throw new Error(`The draft was written but not saved: ${dbWords(upErr.message)}`)
        return { brandId: r.brand_id, ok: true, researched: !!(summary || products.length), siteError }
      } catch (e) {
        return { brandId: r.brand_id, ok: false, error: e instanceof Error ? e.message : 'Draft failed.' }
      }
    }))
    return NextResponse.json({ ok: true, results })
  }

  if (action === 'edit') {
    const draft = typeof body.draft === 'string' ? body.draft.trim().slice(0, 2000) : ''
    const { error } = await admin.from('trybe_brands').update({ draft, status: draft ? 'drafted' : 'new', updated_at: now })
      .eq('user_id', ownerId).eq('brand_id', brandId).in('status', ['new', 'drafted', 'failed', 'skipped'])
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'skip' || action === 'unskip') {
    const { data: row } = await admin.from('trybe_brands').select('status, draft').eq('user_id', ownerId).eq('brand_id', brandId).maybeSingle()
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (row.status === 'sent' || row.status === 'sending') return NextResponse.json({ error: 'Already sent.' }, { status: 409 })
    const status = action === 'skip' ? 'skipped' : (row.draft ? 'drafted' : 'new')
    await admin.from('trybe_brands').update({ status, updated_at: now }).eq('user_id', ownerId).eq('brand_id', brandId)
    return NextResponse.json({ ok: true, status })
  }

  if (action === 'remove') {
    // OFF THE PAGE FOR GOOD (Seb, 2026-10-07: "let's just be able to delete
    // it so it doesn't stay on that page forever"). The row stays, marked
    // 'removed', so the daily find never brings the brand back; the creator
    // can still pick it again by hand from the brand list. Never a brand that
    // went, or may have gone, to TRYBE.
    const { data: gone, error } = await admin.from('trybe_brands').update({ status: 'removed', updated_at: now })
      .eq('user_id', ownerId).eq('brand_id', brandId).in('status', ['new', 'not_fit', 'drafted', 'skipped', 'failed']).select('brand_id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!(gone || []).length) return NextResponse.json({ error: 'Only a brand that was not sent can be removed.' }, { status: 409 })
    return NextResponse.json({ ok: true, status: 'removed' })
  }

  if (action === 'reset') {
    // A send MVP never heard back about. The creator checked TRYBE's Pending
    // Requests: it either went (sent) or it did not (back in the queue).
    const went = body.went === true
    const { error } = await admin.from('trybe_brands').update(
      went ? { status: 'sent', sent_at: now, error: null, updated_at: now } : { status: 'drafted', send_started_at: null, error: null, updated_at: now },
    ).eq('user_id', ownerId).eq('brand_id', brandId).eq('status', 'sending')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'claim') {
    const settings = await readSettings(admin, ownerId)
    const used = await usedToday(admin, ownerId)
    if (used >= settings.dailyCap) {
      return NextResponse.json({ ok: false, capped: true, usedToday: used, dailyCap: settings.dailyCap })
    }
    const { data: row } = await admin.from('trybe_brands').select('*').eq('user_id', ownerId).eq('brand_id', brandId).maybeSingle()
    if (!row) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    if (!row.draft || !['drafted', 'failed'].includes(row.status)) {
      return NextResponse.json({ ok: false, error: `Not in the queue (${row.status}).` }, { status: 409 })
    }
    const { data: claimed } = await admin.from('trybe_brands')
      .update({ status: 'sending', send_started_at: now, sent_message: row.draft, error: null, updated_at: now })
      .eq('user_id', ownerId).eq('brand_id', brandId).in('status', ['drafted', 'failed']).select('brand_id')
    if (!claimed || !claimed.length) return NextResponse.json({ ok: false, error: 'Already being sent.' }, { status: 409 })
    // Counted again after claiming: two tabs that both saw the last slot free
    // cannot both send. The one over the cap puts its claim back.
    const after = await usedToday(admin, ownerId)
    if (after > settings.dailyCap) {
      await admin.from('trybe_brands').update({ status: row.status, send_started_at: null, updated_at: now })
        .eq('user_id', ownerId).eq('brand_id', brandId).eq('status', 'sending')
      return NextResponse.json({ ok: false, capped: true, usedToday: after - 1, dailyCap: settings.dailyCap })
    }
    return NextResponse.json({ ok: true, usedToday: used + 1, dailyCap: settings.dailyCap, name: row.name, message: row.draft, url: sendUrl(row.brand_id, row.brand_url) })
  }

  if (action === 'result') {
    const outcome = String(body.outcome || '')
    const err = typeof body.error === 'string' ? body.error.slice(0, 400) : null
    const patch =
      outcome === 'sent' ? { status: 'sent', sent_at: now, error: null } :
      outcome === 'already' ? { status: 'already', error: null } :
      // Failed before Send Request was pressed: frees the slot.
      outcome === 'failed' ? { status: 'failed', send_started_at: null, error: err || 'SCOUT could not send it.' } :
      // Pressed, but TRYBE never confirmed. Stays counted; the creator checks.
      { status: 'sending', error: err || 'SCOUT pressed Send Request but TRYBE did not confirm it.' }
    const { error } = await admin.from('trybe_brands').update({ ...patch, updated_at: now })
      .eq('user_id', ownerId).eq('brand_id', brandId).eq('status', 'sending')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
