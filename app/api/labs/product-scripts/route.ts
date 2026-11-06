// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/labs/product-scripts — VIDEO SCRIPTS (lib/product-scripts). LABS,
// admin while it is tried (lib/labs-preview product_scripts).
//
// POST { action: 'resolve', url }   a short link (amzn.to, a.co, geni.us,
//                                   vm.tiktok.com ...) followed to where it
//                                   goes, hop by hop, only through short-link
//                                   hosts: -> { kind, url, asin }
// POST { action: 'write', input, url?, asin?, amazon?, reviews?, reviewsWhy?,
//        image?, notes? }           five scripts -> { scripts, read }
//
// The page reads an Amazon product and its reviews through SCOUT (the
// creator's own browser, where Amazon answers); MVP's server reads a TikTok
// Shop product page, any other product page, and Amazon as a fallback.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { canUsePreview } from '@/lib/labs-preview'
import { spendGate } from '@/lib/ai-spend'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordUsage, usageFromAnthropic } from '@/lib/ai-usage'
import { BANNED_RULE } from '@/lib/scrub'
import { fetchWithTimeout } from '@/lib/fetch-timeout'
import { fetchAmazonProduct } from '@/services/amazon'
import { parseTikTokProduct } from '@/lib/tiktok-product'
import { researchBrandSite } from '@/lib/trybe-research'
import { pickExamples, examplesBlock, type TopScript } from '@/lib/trybe-scripts'
import { hooksBlock, type TopHook } from '@/lib/trybe-hooks'
import {
  PRODUCT_SCRIPT_SYSTEM, SHORT_HOSTS, linkKind, storeOf, factsBlock, cleanReviews, reviewsBlock, reviewCorpus,
  parseProductScripts, tiktokReviewsFrom, type ProductFacts, type ReadReport,
} from '@/lib/product-scripts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300
// TikTok Shop serves its product page to a TikTok Shop region only (see
// app/api/labs/tiktok-shop/resolve).
export const preferredRegion = 'iad1'

const MODEL = 'claude-sonnet-4-6'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
/** A screenshot as the page sends it, made small first (about 1 MB). */
const IMAGE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/
const IMAGE_MAX = 3_500_000

async function gate() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return { error: auth.error }
  const { user } = auth as { user: { id: string } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intg } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('product_scripts', intg?.tier)) return { error: NextResponse.json({ error: 'Video Scripts is still being tested.' }, { status: 403 }) }
  return { userId: user.id, tier: (intg?.tier as string | null) ?? null }
}

/** Where a short link goes, followed only through short-link hosts, so MVP's
 *  server never fetches a page the creator named. */
async function followShort(url: string): Promise<string | null> {
  let at = url
  for (let hop = 0; hop < 5; hop++) {
    let host = ''
    try { host = new URL(at).hostname } catch { return null }
    if (!SHORT_HOSTS.test(host)) return at
    try {
      const res = await fetchWithTimeout(at, { timeoutMs: 8000, redirect: 'manual', headers: { 'User-Agent': UA } })
      const loc = res.headers.get('location')
      if (!loc) return null
      at = new URL(loc, at).toString()
    } catch { return null }
  }
  return null
}

/** A TikTok Shop product and the reviews its page carries. */
async function readTikTok(url: string): Promise<{ facts: ProductFacts; reviews: ReturnType<typeof tiktokReviewsFrom> } | null> {
  try {
    const res = await fetchWithTimeout(url, { timeoutMs: 12000, headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } })
    if (!res.ok) return null
    const html = await res.text()
    const p = parseTikTokProduct(html, url)
    if (!p) return null
    return {
      facts: {
        name: p.title, store: 'tiktok', description: p.description, rating: p.rating, reviewCount: p.reviewCount, soldCount: p.soldCount,
        seller: p.sellerName, price: p.price ? `${p.currencySymbol || ''}${p.price}` : null,
      },
      reviews: tiktokReviewsFrom(html),
    }
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = await req.json().catch(() => ({})) as Record<string, any>

  if (body.action === 'resolve') {
    const raw = String(body.url || '').trim().slice(0, 600)
    const first = linkKind(raw)
    if (!first.short) return NextResponse.json({ ok: true, ...first })
    const to = await followShort(raw)
    if (!to) return NextResponse.json({ ok: true, ...first, kind: 'site', unresolved: true })
    return NextResponse.json({ ok: true, ...linkKind(to) })
  }

  if (body.action !== 'write') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })

  const input = String(body.input || '').trim().slice(0, 600)
  const link = linkKind(typeof body.url === 'string' && body.url ? body.url : input)
  const asin = typeof body.asin === 'string' && /^[A-Z0-9]{10}$/.test(body.asin) ? body.asin : link.asin
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1200) : ''
  const img = typeof body.image === 'string' ? body.image.match(IMAGE) : null
  if (img && img[2].length > IMAGE_MAX) return NextResponse.json({ error: 'That screenshot is too large. Try a smaller one.' }, { status: 413 })
  if (!input && !img) return NextResponse.json({ error: 'Paste a link, type the product, or add a screenshot.' }, { status: 400 })

  const spend = await spendGate(g.userId, g.tier)
  if (spend) return spend

  // ── THE PRODUCT ─────────────────────────────────────────────────────────
  let facts: ProductFacts | null = null
  let by: ReadReport['by'] = null
  let tiktokReviews: ReturnType<typeof tiktokReviewsFrom> | null = null
  const a = body.amazon && typeof body.amazon === 'object' ? body.amazon : null
  if (link.kind === 'amazon') {
    if (a?.title) {
      facts = { name: String(a.title), store: 'amazon', bullets: Array.isArray(a.bullets) ? a.bullets.map(String) : [], description: String(a.description || ''), price: a.price ? String(a.price) : null, rating: a.rating ?? null }
      by = 'scout'
    } else if (asin) {
      const p = await fetchAmazonProduct(asin).catch(() => null)
      if (p?.title) {
        const deal = p.priceWas && p.price ? `was ${p.priceWas}, now ${p.price}` : null
        facts = { name: p.title, store: 'amazon', bullets: p.bullets, description: p.description, price: p.price, rating: p.rating, deal }
        by = 'server'
      }
    }
  } else if (link.kind === 'tiktok' && link.url) {
    const t = await readTikTok(link.url)
    if (t) { facts = t.facts; tiktokReviews = t.reviews; by = 'server' }
  } else if (link.kind === 'site' && link.url) {
    const site = await researchBrandSite(link.url).catch(() => null)
    if (site && (site.summary || site.products.length)) {
      let storeName: string | null = null
      try { storeName = new URL(link.url).hostname.replace(/^www\./, '') } catch { /* none */ }
      facts = { name: '', store: 'other', storeName, siteSummary: site.summary, siteProducts: site.products, deal: site.onSale?.length ? `on sale on the site: ${site.onSale.slice(0, 3).join('; ')}` : null }
      by = 'server'
    }
  }
  const productRead = !!facts
  if (!facts) facts = { name: link.kind === 'name' ? input : '', store: storeOf(link.kind) }
  if (!facts.name && link.kind === 'name') facts.name = input

  // ── THE BUYERS: Amazon's read by SCOUT, TikTok Shop's from its page ─────
  const reviews = cleanReviews(link.kind === 'amazon' ? body.reviews : tiktokReviews)
  const reviewsText = reviewsBlock(reviews)

  // ── WHAT WINS ON TRYBE, AS EXAMPLES ──────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  let examples: Array<Pick<TopScript, 'brand_id' | 'brand_name' | 'best_rank' | 'category' | 'script' | 'state'>> = []
  let hooks: TopHook[] = []
  try {
    const [{ data: ex }, { data: hk }] = await Promise.all([
      admin.from('trybe_top_scripts').select('brand_id,brand_name,best_rank,category,script,state').eq('state', 'ready').not('best_rank', 'is', null).order('best_rank', { ascending: true }).limit(200),
      admin.from('trybe_directory_meta').select('value').eq('key', 'top100_hooks').maybeSingle(),
    ])
    examples = pickExamples((ex ?? []) as typeof examples, { id: null, name: facts.name || '', categories: [] }, 5)
    const hv = hk?.value as { at?: string; hooks?: TopHook[] } | null
    if (hv?.at && Array.isArray(hv.hooks) && Date.now() - Date.parse(hv.at) < 10 * 86_400_000) hooks = hv.hooks
  } catch { examples = []; hooks = [] }
  const examplesText = examplesBlock(examples, '')
  const hooksText = hooksBlock(hooks, '', 8)

  const text = [
    `PRODUCT:\n${factsBlock(facts)}`,
    img ? 'SCREENSHOT: attached above. Read the product, its words and anything a buyer would notice from it.' : '',
    reviewsText,
    notes ? `CREATOR NOTES (what the creator wants worked in):\n${notes}` : '',
    examplesText,
    hooksText,
  ].filter(Boolean).join('\n\n')

  try {
    const msg = await createAnthropicClient().messages.create({
      model: MODEL, max_tokens: 9000,
      system: PRODUCT_SCRIPT_SYSTEM(BANNED_RULE),
      messages: [{
        role: 'user',
        content: [
          ...(img ? [{ type: 'image' as const, source: { type: 'base64' as const, media_type: `image/${img[1]}` as 'image/jpeg' | 'image/png' | 'image/webp', data: img[2] } }] : []),
          { type: 'text' as const, text },
        ],
      }],
    })
    try { const u = usageFromAnthropic(msg); recordUsage({ userId: g.userId, tier: g.tier, feature: 'product_scripts', model: MODEL, input: u.input, output: u.output, images: img ? 1 : 0 }) } catch { /* best-effort */ }
    const out = (msg.content as Array<{ type: string; text?: string }>).map((b) => (b.type === 'text' ? b.text || '' : '')).join('')
    const scripts = parseProductScripts(out, reviewCorpus(reviews))
    if (!scripts) return NextResponse.json({ error: 'The scripts came back in a shape MVP could not read. Try again.' }, { status: 502 })
    const reviewsWhy = typeof body.reviewsWhy === 'string' && ['no-scout', 'old-scout', 'scout-failed', 'none-shown'].includes(body.reviewsWhy) ? body.reviewsWhy as ReadReport['reviewsWhy'] : null
    const read: ReadReport = {
      source: link.kind === 'name' && img && !input ? 'screenshot' : link.kind,
      productRead, by,
      reviews: reviews.onPage.length, critical: reviews.critical.length, customersSay: !!reviews.customersSay,
      reviewsWhy: link.kind === 'amazon' && !reviews.onPage.length && !reviews.critical.length ? (reviewsWhy || 'scout-failed') : null,
      criticalWhy: reviews.criticalWhy ?? null,
      screenshot: !!img, examples: examples.length, hooks: hooks.length,
    }
    return NextResponse.json({ ok: true, scripts, read, store: facts.store })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? `MVP could not write the scripts: ${e.message}` : 'MVP could not write the scripts.' }, { status: 502 })
  }
}
