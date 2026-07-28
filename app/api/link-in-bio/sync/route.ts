/**
 * Link in Bio — import the creator's posted products as tiles.
 *
 * Pulls product_watches (populated when they turn a deal into a post, plus any
 * manual watches), and adds one tile per product it doesn't already have. Each
 * tile links to the tagged Amazon URL so clicks earn on the creator's Associates
 * tag; our own /api/link-click adds tile-level click counts on top. (Manual
 * tiles can carry a Geniuslink the creator pastes.)
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { canUseDealRadar } from '@/lib/feature-access'
import { resolveAffiliateUrl } from '@/lib/weekly-digest'

export const runtime = 'nodejs'
export const maxDuration = 60

const IMPORT_MAX = 40

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: intRow } = await sb.from('integrations').select('tier,amazon_associates_tag,geniuslink_api_key,geniuslink_api_secret').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(intRow?.tier) as Tier
  if (!canUseDealRadar(tier)) return NextResponse.json({ error: 'Link in Bio is available on paid plans.' }, { status: 403 })
  const tag = ((intRow?.amazon_associates_tag as string | null) || '').trim() || null
  const gKey = ((intRow?.geniuslink_api_key as string | null) || '').trim() || null
  const gSecret = ((intRow?.geniuslink_api_secret as string | null) || '').trim() || null

  const { data: page } = await sb.from('link_pages').select('id').eq('user_id', user.id).maybeSingle()
  if (!page?.id) return NextResponse.json({ error: 'Create your page first.' }, { status: 400 })

  // Products the creator has engaged with (posted deals auto-watch; plus manual).
  const { data: watches } = await sb.from('product_watches')
    .select('asin,title,image_url,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(IMPORT_MAX)
  const rows = (watches ?? []) as Array<{ asin: string; title: string | null; image_url: string | null }>
  if (!rows.length) return NextResponse.json({ ok: true, added: 0, message: 'No posted products to import yet.' })

  // Append after the current last position.
  const { data: last } = await sb.from('link_page_items').select('position').eq('page_id', page.id)
    .order('position', { ascending: false }).limit(1).maybeSingle()
  const position = (last?.position ?? -1) + 1

  // Products already on the page — skip them (so we never re-wrap a Geniuslink
  // for a tile that already exists).
  const { data: existing } = await sb.from('link_page_items').select('asin').eq('page_id', page.id).not('asin', 'is', null)
  const have = new Set(((existing ?? []) as Array<{ asin: string | null }>).map((e) => (e.asin || '').toUpperCase()))

  // Build each tile's link. ALWAYS wrap through Geniuslink when the creator has
  // it configured (resolveAffiliateUrl falls back to the tagged link on failure),
  // so a publicly-shared tile carries their Geniuslink — never a bare tag. If we
  // run low on time on a big import, the remainder uses the tagged link.
  const started = Date.now()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tiles: any[] = []
  let position2 = position
  for (const r of rows) {
    if (!/^[A-Z0-9]{10}$/i.test(r.asin)) continue
    const asinU = r.asin.toUpperCase()
    if (have.has(asinU)) continue
    const title = (r.title || `Amazon deal ${asinU}`).slice(0, 120)
    let url: string
    if (gKey && gSecret && Date.now() - started < 45_000) {
      url = await resolveAffiliateUrl(asinU, title, tag, gKey, gSecret)
    } else {
      url = tag ? `https://www.amazon.com/dp/${asinU}?tag=${encodeURIComponent(tag)}` : `https://www.amazon.com/dp/${asinU}`
    }
    tiles.push({ page_id: page.id, user_id: user.id, kind: 'product', title, image_url: r.image_url || null, url, asin: asinU, source: 'deal', position: position2++ })
  }
  if (!tiles.length) return NextResponse.json({ ok: true, added: 0, message: 'Your posted products are already here.' })

  const { data: added, error } = await sb.from('link_page_items')
    .upsert(tiles, { onConflict: 'page_id,asin', ignoreDuplicates: true })
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, added: (added ?? []).length })
}
