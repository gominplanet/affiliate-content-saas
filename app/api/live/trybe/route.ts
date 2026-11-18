// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/live/trybe: which of your received TRYBE samples are sold on
// Amazon, for an Amazon Live (Seb, 2026-11-18: "I've received samples from
// Tribe. If they exist on Amazon, let's have MVP figure that out and then
// create a live show based on those products"). Matched by lib/live-trybe
// from your Amazon videos, your storefront, the brand's Creator Connections
// products and a Keepa search by name. MVP tables and Keepa only: no Amazon
// page is fetched. Each answer is kept on the sample (migration 470) so a
// name is searched once a month, not on every press. A source that did not
// answer leaves the sample "not checked", never "not on Amazon".

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { normalizeTier } from '@/lib/tier'
import { canUsePreview } from '@/lib/labs-preview'
import { nameVariants, productWords } from '@/lib/trybe-finder'
import { brandKey } from '@/lib/brand-normalize'
import { fetchKeepaSearch } from '@/services/keepa'
import { fetchKeepaBasicsCached } from '@/lib/keepa-cache'
import { stageOf } from '@/lib/trybe-week'
import { findListing, liveSamples, remembered, FOUND_WORDS, KEEPA_SEARCHES_PER_RUN, type FoundBy, type Listing, type LiveTrybeItem, type SampleRow } from '@/lib/live-trybe'

export const runtime = 'nodejs'
export const maxDuration = 120

type Db = any // eslint-disable-line @typescript-eslint/no-explicit-any

const BASE = 'id, brand_name, product, received_at, filmed_at, submitted_at'
const MEMORY = ', amazon_asin, amazon_title, amazon_by, amazon_checked_at'
const KEEPA_US = 1
// Keepa searches stop here so the answer comes back inside the request.
const SEARCH_BUDGET_MS = 60_000

async function paged<T>(make: () => Db, max: number): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = []
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await make().range(from, Math.min(max, from + 1000) - 1)
    if (error) return { rows, error: error.message }
    rows.push(...((data || []) as T[]))
    if (!data || data.length < 1000) break
  }
  return { rows, error: null }
}

export async function POST() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return auth.error
  const { user, ownerId } = auth as { user: { id: string }; ownerId: string }
  const admin = createAdminClient() as Db
  const { data: intg } = await admin.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(intg?.tier)
  if (!canUsePreview('amazon_live', tier) || !canUsePreview('trybe_outreach', tier) || !canUsePreview('live_trybe', tier)) {
    return NextResponse.json({ error: 'A live from your TRYBE samples is part of MVP Pro.' }, { status: 403 })
  }

  // The samples you received. Without migration 470 the answers are not kept.
  let memory = true
  const read = (cols: string) => admin.from('trybe_samples').select(cols).eq('user_id', ownerId).not('received_at', 'is', null).order('received_at', { ascending: false }).limit(300)
  let { data: rows, error } = await read(BASE + MEMORY)
  if (error && /amazon_(asin|title|by|checked_at)/.test(error.message)) {
    memory = false
    ;({ data: rows, error } = await read(BASE))
  }
  if (error) {
    const missing = /trybe_samples/.test(error.message) && /does not exist|schema cache|could not find/i.test(error.message)
    return NextResponse.json({ error: missing ? (tier === 'admin' ? 'Samples need migration 427 in Supabase first.' : 'Samples are finishing an update on MVP. Try again in a few minutes.') : `MVP could not read your samples: ${error.message}` }, { status: 500 })
  }
  const samples = liveSamples((rows || []) as SampleRow[]).slice(0, 60)
  if (!samples.length) return NextResponse.json({ ok: true, items: [], notes: [], memory })

  // What MVP already has: your Amazon videos and your storefront.
  const notes: string[] = []
  const vids = await paged<{ asin: string; title: string | null }>(() => admin.from('amazon_video_products').select('asin, title').eq('user_id', ownerId).order('aci', { ascending: true }).order('asin', { ascending: true }), 20000)
  if (vids.error) notes.push('Your Amazon videos could not be read just now, so a product you filmed may show as not checked.')
  const store = await paged<{ asin: string; title: string | null; image_url: string | null }>(() => admin.from('storefront_catalog').select('asin, title, image_url').eq('user_id', ownerId).order('asin', { ascending: true }), 20000)
  if (store.error) notes.push('Your storefront could not be read just now.')
  const sourcesRead = !vids.error && !store.error

  // Each brand's Creator Connections products, by its name.
  const brandAsins = new Map<string, Set<string>>()
  let campaignsRead = true
  const variants = Array.from(new Set(samples.flatMap((s) => nameVariants(s.brand_name))))
  for (let i = 0; i < variants.length; i += 400) {
    const { data, error: e } = await admin.from('cc_campaign_catalog').select('brand_name, asins').in('brand_name', variants.slice(i, i + 400)).limit(5000)
    if (e) { campaignsRead = false; notes.push('Amazon’s Creator Connections list could not be read just now.'); break }
    for (const c of (data || []) as Array<{ brand_name: string | null; asins: string[] | null }>) {
      const k = brandKey(c.brand_name || '')
      if (!k) continue
      const set = brandAsins.get(k) || new Set<string>()
      for (const a of c.asins || []) if (/^[A-Z0-9]{10}$/.test(a)) set.add(a)
      brandAsins.set(k, set)
    }
  }
  const ccTitles = new Map<string, Listing[]>()

  const started = Date.now()
  let searches = 0
  const items: LiveTrybeItem[] = []
  const keep: Array<{ id: string; asin: string | null; title: string | null; by: FoundBy | null }> = []
  for (const s of samples) {
    const base = { sampleId: s.id, brand: s.brand_name, product: s.product, stage: stageOf(s), image: null as string | null }
    if (memory && remembered(s)) {
      const by = (s.amazon_by && s.amazon_by in FOUND_WORDS ? s.amazon_by : null) as FoundBy | null
      items.push(s.amazon_asin
        ? { ...base, state: 'found', asin: s.amazon_asin, title: s.amazon_title ?? null, by, why: by ? FOUND_WORDS[by] : 'Found on Amazon' }
        : { ...base, state: 'none', asin: null, title: null, by: null, why: 'Not found on Amazon when MVP last looked' })
      continue
    }
    if (!productWords(s.product, s.brand_name).length) {
      items.push({ ...base, state: 'none', asin: null, title: null, by: null, why: 'Named only by its brand, so MVP cannot tell which product it is. Give it the product’s own name in TRYBE This week.' })
      continue
    }
    const bk = brandKey(s.brand_name)
    const ba = brandAsins.get(bk) || new Set<string>()
    let hit = findListing(s.product, s.brand_name, [{ by: 'video', listings: vids.rows }, { by: 'storefront', listings: store.rows }], ba)
    // The brand's campaign products, titled from Keepa's cache (a token for
    // each ASIN Keepa has not told MVP about yet), at most 40 a brand.
    if (!hit && ba.size) {
      if (!ccTitles.has(bk)) {
        const asins = Array.from(ba).slice(0, 40)
        const basics = await fetchKeepaBasicsCached(admin, asins).catch(() => new Map())
        ccTitles.set(bk, asins.map((a) => ({ asin: a, title: basics.get(a)?.title ?? null })))
      }
      hit = findListing(s.product, s.brand_name, [{ by: 'campaign', listings: ccTitles.get(bk) || [] }], ba)
    }
    // Then Amazon by its name, through Keepa.
    let unanswered: string | null = null
    if (!hit) {
      if (searches >= KEEPA_SEARCHES_PER_RUN || Date.now() - started > SEARCH_BUDGET_MS) unanswered = 'Not checked yet: MVP looks it up on Amazon the next time you press the button.'
      else {
        searches++
        const found = await fetchKeepaSearch(`${s.brand_name} ${s.product}`, KEEPA_US)
        if (found === null) unanswered = 'Not checked: Keepa did not answer just now.'
        else hit = findListing(s.product, s.brand_name, [{ by: 'keepa', listings: found.map((k) => ({ asin: k.asin, title: k.title, brand: k.brand })) }], ba)
      }
    }
    if (hit) {
      items.push({ ...base, state: 'found', asin: hit.asin, title: hit.title, by: hit.by, why: FOUND_WORDS[hit.by] })
      keep.push({ id: s.id, asin: hit.asin, title: hit.title, by: hit.by })
    } else if (unanswered || !sourcesRead || !campaignsRead) {
      items.push({ ...base, state: 'unchecked', asin: null, title: null, by: null, why: unanswered || 'Not checked: part of what MVP knows could not be read just now.' })
    } else {
      items.push({ ...base, state: 'none', asin: null, title: null, by: null, why: 'Not found on Amazon under this name' })
      keep.push({ id: s.id, asin: null, title: null, by: null })
    }
  }

  // Pictures: your storefront's first, then Keepa's.
  const found = items.filter((i) => i.state === 'found' && i.asin)
  const storeImg = new Map(store.rows.filter((r) => r.image_url).map((r) => [r.asin, r.image_url as string]))
  const need = found.filter((i) => !storeImg.has(i.asin as string)).map((i) => i.asin as string)
  const basics = need.length ? await fetchKeepaBasicsCached(admin, need).catch(() => new Map()) : new Map()
  for (const i of found) {
    const b = basics.get(i.asin as string)
    i.image = storeImg.get(i.asin as string) ?? b?.imageUrl ?? null
    if (!i.title) i.title = b?.title ?? null
  }

  // Keep each answer on its sample, so a name is looked up once a month.
  let kept = 0
  if (memory) {
    const at = new Date().toISOString()
    for (let i = 0; i < keep.length; i += 10) {
      const done = await Promise.all(keep.slice(i, i + 10).map((k) => admin.from('trybe_samples')
        .update({ amazon_asin: k.asin, amazon_title: k.title, amazon_by: k.by, amazon_checked_at: at }).eq('id', k.id).eq('user_id', ownerId)
        .then((r: { error: unknown }) => !r.error, () => false)))
      kept += done.filter(Boolean).length
    }
  }
  return NextResponse.json({ ok: true, items, notes, memory, kept, needsSql: !memory && tier === 'admin' })
}
