// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/group-queue — Group Post Queue (LABS, admin while it is tested,
// lib/labs-preview.ts group_queue).
//
// The Pages + Groups route, in batches. Meta lets no app post into a Group, and
// a Group is where an affiliate link draws the most attention from Facebook's
// spam checks. So the affiliate link goes on the creator's PAGE through the
// API, and the Group gets a teaser pointing at that Page post, filled in by
// SCOUT for the creator to press Post.
//
// GET ?source=epc&minEpc=&minDiscount=&maxPrice=&limit=
//     Sponsored Products from the creator's EPC Library.
// GET ?source=videos
//     The creator's published Amazon videos, each with the product it shows.
//     Both also return the saved Facebook Groups and the disclosure.
// POST { action: 'write', items: [{ key, kind, title, brand?, discountPct?, description? }] }
//     One short post per item, no link and no price (we add the link).
// POST { action: 'page', item: { kind, asin, title, imageUrl?, caption, vdpUrl? } }
//     Publish one item to the Facebook Page. Returns the Page post's URL, or
//     the reason it did not go out. Nothing reads as posted without that URL.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { canUsePreview } from '@/lib/labs-preview'
import { normalizeTier, type Tier } from '@/lib/tier'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { spendGate } from '@/lib/ai-spend'
import { scrubBanned } from '@/lib/scrub'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { executeDealQuickPost } from '@/lib/deal-quick-post'
import { publishDealToSocials } from '@/lib/deal-social-publish'
import { resolveCloakedLinkDetailed, cloakFallbackNote, getLinkStyle } from '@/lib/link-cloak'
import { AFFILIATE_DISCLAIMER_DEFAULT } from '@/lib/social-disclaimer'
import { amazonVideoPage } from '@/lib/brand-content'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MODEL = 'claude-haiku-4-5-20251001'
const ASIN_RE = /^[A-Z0-9]{10}$/
const WRITE_MAX = 10

async function gate() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return { error: auth.error }
  const { user, ownerId } = auth as { user: { id: string }; ownerId: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intg } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('group_queue', intg?.tier)) return { error: NextResponse.json({ error: 'Group Post Queue is still being tested.' }, { status: 403 }) }
  return { userId: user.id, ownerId, tier: normalizeTier(intg?.tier) as Tier }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function groupsAndDisclosure(admin: any, ownerId: string) {
  const { data } = await admin.from('brand_profiles').select('facebook_groups,affiliate_disclaimer').eq('user_id', ownerId).maybeSingle()
  const raw = Array.isArray(data?.facebook_groups) ? data.facebook_groups : []
  const groups = (raw as Array<{ name?: string; url?: string }>)
    .map((g) => {
      const url = String(g?.url || '').trim()
      return { name: String(g?.name || '').trim(), url: /^https?:\/\//i.test(url) ? url : url ? `https://${url}` : '' }
    })
    .filter((g) => /facebook\.com\/groups\//i.test(g.url))
  const disclaimer = String(data?.affiliate_disclaimer || '').trim() || AFFILIATE_DISCLAIMER_DEFAULT
  return { groups, disclaimer }
}

export async function GET(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const p = req.nextUrl.searchParams
  const base = await groupsAndDisclosure(admin, g.ownerId)

  if (p.get('source') === 'videos') {
    const { data: vids, error } = await admin.from('amazon_videos')
      .select('aci,description,state,views,published_at,media_url')
      .eq('user_id', g.ownerId).order('published_at', { ascending: false, nullsFirst: false }).limit(300)
    if (error) return NextResponse.json({ ...base, items: [], error: error.message })
    // Only a published video has a public page to send people to.
    const live = ((vids ?? []) as Array<{ aci: string; description: string | null; state: string | null; views: number | null; published_at: string | null; media_url: string | null }>)
      .map((v) => ({ v, page: amazonVideoPage(v.aci, v.media_url, v.state) }))
      .filter((x) => !!x.page)
    const acis = live.map((x) => x.v.aci)
    const { data: prods } = acis.length
      ? await admin.from('amazon_video_products').select('aci,asin,title').eq('user_id', g.ownerId).in('aci', acis)
      : { data: [] }
    const byAci = new Map<string, Array<{ asin: string; title: string | null }>>()
    for (const r of (prods ?? []) as Array<{ aci: string; asin: string; title: string | null }>) {
      byAci.set(r.aci, [...(byAci.get(r.aci) ?? []), { asin: r.asin, title: r.title }])
    }
    const asins = [...new Set([...byAci.values()].flat().map((x) => x.asin))]
    const { data: cat } = asins.length
      ? await admin.from('storefront_catalog').select('asin,title,image_url').eq('user_id', g.ownerId).in('asin', asins)
      : { data: [] }
    const catBy = new Map(((cat ?? []) as Array<{ asin: string; title: string | null; image_url: string | null }>).map((c) => [c.asin, c]))
    const items = live.map(({ v, page }) => {
      const products = byAci.get(v.aci) ?? []
      const first = products[0]
      const c = first ? catBy.get(first.asin) : undefined
      return {
        aci: v.aci, vdpUrl: page!.url, description: v.description, views: v.views, publishedAt: v.published_at,
        asin: first?.asin ?? null, title: first?.title || c?.title || null, imageUrl: c?.image_url ?? null,
        productCount: products.length,
      }
    })
    // A video with no product read yet still lists, so the creator sees why it
    // cannot be posted rather than wondering where it went.
    const pending = live.filter((x) => !byAci.has(x.v.aci)).length
    return NextResponse.json({ ...base, items, pendingProducts: pending, total: (vids ?? []).length })
  }

  // Sponsored Products: the EPC Library.
  const limit = Math.min(200, Math.max(1, Number(p.get('limit')) || 100))
  const minEpc = Math.max(0, Number(p.get('minEpc')) || 0)
  const minDiscount = Math.max(0, Math.min(99, Number(p.get('minDiscount')) || 0))
  const maxPrice = Math.max(0, Number(p.get('maxPrice')) || 0)
  let q = admin.from('epc_products').select('*').eq('user_id', g.ownerId)
  if (minEpc > 0) q = q.gte('epc_value', minEpc)
  if (minDiscount >= 1) q = q.gte('discount_pct', minDiscount)
  if (maxPrice > 0) q = q.lte('price_cents', Math.round(maxPrice * 100))
  const { data, error } = await q.order('epc_value', { ascending: false, nullsFirst: false }).order('scanned_at', { ascending: false }).limit(limit)
  if (error) return NextResponse.json({ ...base, items: [], error: error.message })
  const items = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    asin: r.asin as string, title: (r.title as string | null) ?? null, brand: (r.brand as string | null) ?? null,
    imageUrl: (r.image_url as string | null) ?? null, epcValue: (r.epc_value as number | null) ?? null,
    epcDisplay: (r.epc_display as string | null) ?? null, priceCents: ((r.price_now_cents ?? r.price_cents) as number | null) ?? null,
    discountPct: (r.discount_pct as number | null) ?? null, rating: (r.rating as number | null) ?? null,
    budget: (r.budget as string | null) ?? null, detailsUrl: (r.details_url as string | null) ?? null,
    scannedAt: r.scanned_at as string,
  }))
  return NextResponse.json({ ...base, items })
}

type WriteItem = { key: string; kind: 'epc' | 'video'; title: string; brand?: string | null; discountPct?: number | null; description?: string | null }

function writePrompt(it: WriteItem): string {
  const product = `${it.title}${it.brand ? ` (${it.brand})` : ''}`
  if (it.kind === 'video') {
    return `Write a short Facebook post that sends people to the creator's own video review of this product.

Product: ${product}
What the creator said in the video description: ${(it.description || '').slice(0, 600) || 'not given'}

Rules:
- 2 or 3 short sentences. Open with a hook a shopper cares about, then say there is a hands-on video showing it.
- Only state facts from the description above. Do not invent results, numbers or claims.
- No price, no percentage, no year, no link, and do not write the word "link". We add the link.
- At most one emoji and one hashtag, only if natural. Plain text, no markdown.

Return ONLY the post text.`
  }
  const onSale = (it.discountPct ?? 0) >= 10
  return `Write a short Facebook post for a deals group about this Amazon product.

Product: ${product}
${onSale ? 'It is currently below its usual price.' : ''}

Rules:
- 2 or 3 short sentences. A strong hook, then why someone would want it.
- ${onSale ? 'You may say it is on sale right now, but' : 'Do NOT say it is on sale, and'} do NOT state a price, a "was" price, or a percentage. The number changes and the post stays up.
- Never claim the creator tested or owns it.
- No link, and do not write the word "link". We add the link.
- At most one emoji and one hashtag, only if natural. Plain text, no markdown.

Return ONLY the post text.`
}

export async function POST(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  const body = await req.json().catch(() => ({})) as { action?: string; items?: WriteItem[]; item?: Record<string, unknown> }

  if (body.action === 'write') {
    const items = (Array.isArray(body.items) ? body.items : [])
      .filter((it) => it && typeof it.key === 'string' && typeof it.title === 'string' && it.title.trim())
      .slice(0, WRITE_MAX)
    if (!items.length) return NextResponse.json({ error: 'Nothing to write.' }, { status: 400 })
    const spent = await spendGate(g.userId, g.tier)
    if (spent) return spent
    const anthropic = createAnthropicClient()
    const captions: Record<string, string> = {}
    const failed: string[] = []
    await Promise.all(items.map(async (it) => {
      try {
        const msg = await anthropic.messages.create({ model: MODEL, max_tokens: 260, messages: [{ role: 'user', content: writePrompt(it) }] })
        recordAnthropicUsage(msg, { userId: g.userId, tier: g.tier, feature: 'group_queue_post', model: MODEL })
        const text = scrubBanned(((msg.content[0] as { type: string; text: string }).text || '').trim()).slice(0, 700)
        if (text) captions[it.key] = text
        else failed.push(it.key)
      } catch { failed.push(it.key) }
    }))
    return NextResponse.json({ captions, failed })
  }

  if (body.action === 'page') {
    const it = body.item || {}
    const kind = it.kind === 'video' ? 'video' : 'epc'
    const asin = String(it.asin || '').trim().toUpperCase()
    const title = String(it.title || '').trim().slice(0, 300)
    const caption = String(it.caption || '').trim().slice(0, 1500)
    const imageUrl = typeof it.imageUrl === 'string' && /^https:\/\//.test(it.imageUrl) ? it.imageUrl : null
    if (!ASIN_RE.test(asin)) return NextResponse.json({ error: 'This item has no product to link to.' }, { status: 400 })
    if (!caption) return NextResponse.json({ error: 'Write the post first.' }, { status: 400 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data: rawInt } = await admin.from('integrations').select('*').eq('user_id', g.ownerId).maybeSingle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const intRow = decryptIntegrationRow(rawInt as any)
    const tag = String((intRow as { amazon_associates_tag?: string | null } | null)?.amazon_associates_tag || '').trim()

    if (kind === 'epc') {
      const out = await executeDealQuickPost({
        db: admin, userId: g.ownerId, tier: g.tier, intRow: intRow ?? null,
        asin, platforms: ['facebook'], story: false, caption, title: title || null, imageUrl,
        // Sponsored Products are Amazon clicks: never redirected to a shop.
        useShowcase: false,
      })
      if (out.missingTag) return NextResponse.json({ error: 'Add your Amazon Associates tag in Settings first, so your links earn.' }, { status: 400 })
      const fb = out.results.find((r) => r.platform === 'facebook')
      if (!fb) return NextResponse.json({ error: 'Nothing was posted. MVP had no product details for this item.' }, { status: 502 })
      return NextResponse.json({ ok: fb.ok, url: fb.ok ? fb.url : undefined, error: fb.ok ? undefined : fb.error, linkNote: out.geniuslinkNote || out.destinationNote || null }, { status: fb.ok ? 200 : 502 })
    }

    // Video: the creator's own Amazon video page, tagged, so the click lands on
    // their review with the product under it.
    const vdpUrl = String(it.vdpUrl || '').trim()
    if (!/^https:\/\/(www\.)?amazon\.[a-z.]+\/vdp\/[a-z0-9]+/i.test(vdpUrl)) return NextResponse.json({ error: 'This video has no public Amazon page to link to.' }, { status: 400 })
    const style = await getLinkStyle(admin, g.ownerId)
    if (!tag && style.style !== 'passport') return NextResponse.json({ error: 'Add your Amazon Associates tag in Settings first, so your links earn.' }, { status: 400 })
    const u = new URL(vdpUrl)
    if (tag) u.searchParams.set('tag', tag)
    const cloak = await resolveCloakedLinkDetailed({
      supabase: admin, userId: g.ownerId, destination: u.toString(), asin: null,
      channel: 'facebook', source: 'facebook', label: title || 'Amazon video', config: style, destinationOverride: 'amazon',
    })
    const { data: brand } = await admin.from('brand_profiles').select('affiliate_disclaimer').eq('user_id', g.ownerId).maybeSingle()
    const disclaimer = String(brand?.affiliate_disclaimer || '').trim() || AFFILIATE_DISCLAIMER_DEFAULT
    const results = await publishDealToSocials({
      supabase: admin, userId: g.ownerId,
      deal: { asin, title: title || asin, imageUrl },
      link: cloak.url, baseCaption: caption, disclaimer, platforms: ['facebook'],
    })
    const fb = results[0]
    if (!fb) return NextResponse.json({ error: 'Nothing was posted.' }, { status: 502 })
    return NextResponse.json({ ok: fb.ok, url: fb.ok ? fb.url : undefined, error: fb.ok ? undefined : fb.error, linkNote: cloakFallbackNote(cloak) }, { status: fb.ok ? 200 : 502 })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
