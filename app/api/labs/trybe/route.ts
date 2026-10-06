// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/labs/trybe — TRYBE outreach (Labs, admin while it is tested).
//
//   GET                       the queue, settings and today's count
//   POST {action:'settings'}  core message, daily cap, categories, keywords
//   POST {action:'match'}     judge found brands against the niche (website read)
//   POST {action:'found'}     a day's find ran (the daily find waits a day)
//   POST {action:'import'}    brands SCOUT read from TRYBE's Discover Brands
//   POST {action:'draft'}     research each brand's website, write its message
//   POST {action:'edit'|'skip'|'unskip'|'reset'}
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
    return { error: NextResponse.json({ error: 'TRYBE outreach is still being tested.' }, { status: 403 }) }
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
  return NextResponse.json({ ok: true, settings, usedToday: used, brands })
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
        await admin.from('trybe_brands').update({ status: 'new', fit_score: r.trybe_score ?? null, fit_reason: 'No niche set yet, so it is listed without a fit check.', fit_prefs: key, fit_checked_at: now, updated_at: now })
          .eq('user_id', ownerId).eq('brand_id', r.brand_id)
      }
      return NextResponse.json({ ok: true, results: todo.map(r => ({ brandId: r.brand_id, ok: true, fit: true, score: r.trybe_score ?? null, reason: 'No niche set yet.' })) })
    }
    const spend = await spendGate(userId, tier)
    if (spend) return spend
    const facts = await Promise.all(todo.map(r => siteFacts(r)))
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
      await admin.from('trybe_brands').update({
        ...site, status: v.fit ? 'new' : 'not_fit', fit_score: v.score, fit_reason: v.reason || null, fit_prefs: key, fit_checked_at: now, updated_at: now,
      }).eq('user_id', ownerId).eq('brand_id', r.brand_id).in('status', ['new', 'not_fit'])
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
        await admin.from('trybe_brands').update({
          draft: text, drafted_at: new Date().toISOString(), status: 'drafted', error: null,
          site_summary: summary || null, site_products: products, site_error: siteError, site_fetched_at: fresh ? r.site_fetched_at : sf.fetchedAt,
          updated_at: new Date().toISOString(),
        }).eq('user_id', ownerId).eq('brand_id', r.brand_id)
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
