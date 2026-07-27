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

export const runtime = 'nodejs'
export const maxDuration = 30

const IMPORT_MAX = 40

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: intRow } = await sb.from('integrations').select('tier,amazon_associates_tag').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(intRow?.tier) as Tier
  if (!canUseDealRadar(tier)) return NextResponse.json({ error: 'Link in Bio is available on paid plans.' }, { status: 403 })
  const tag = ((intRow?.amazon_associates_tag as string | null) || '').trim()

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
  let position = (last?.position ?? -1) + 1

  const amazonUrl = (asin: string) =>
    tag ? `https://www.amazon.com/dp/${asin}?tag=${encodeURIComponent(tag)}` : `https://www.amazon.com/dp/${asin}`

  const tiles = rows
    .filter((r) => /^[A-Z0-9]{10}$/i.test(r.asin))
    .map((r) => ({
      page_id: page.id, user_id: user.id,
      title: (r.title || `Amazon deal ${r.asin}`).slice(0, 120),
      image_url: r.image_url || null,
      url: amazonUrl(r.asin.toUpperCase()),
      asin: r.asin.toUpperCase(), source: 'deal',
      position: position++,
    }))

  // Skip products already on the page (UNIQUE(page_id, asin)).
  const { data: added, error } = await sb.from('link_page_items')
    .upsert(tiles, { onConflict: 'page_id,asin', ignoreDuplicates: true })
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, added: (added ?? []).length })
}
