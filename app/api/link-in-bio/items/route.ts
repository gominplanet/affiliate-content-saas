/**
 * Link in Bio — tile CRUD.
 *   POST   { title, url, image_url? }        → add a manual tile
 *   PATCH  { order: [id,...] }               → reorder
 *   PATCH  { id, hidden?/title?/url?/image_url? } → edit one tile
 *   DELETE { id }                            → remove a tile
 *
 * Owner-only via RLS. Manual tiles have asin = null.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createGeniuslinkService } from '@/services/geniuslink'
import { asinFromAmazonUrl } from '@/lib/product-link'

export const runtime = 'nodejs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ownPage(sb: any, userId: string) {
  const { data } = await sb.from('link_pages').select('id').eq('user_id', userId).maybeSingle()
  return data?.id as string | undefined
}

const cleanUrl = (u: string) => {
  const t = (u || '').trim()
  if (!t) return null
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}

/**
 * Turn ANY pasted product link into the creator's own tracked affiliate link:
 * if it's not already a geni.us short link, wrap it with their Geniuslink. So a
 * creator can paste a raw Amazon (or any affiliate) URL and MVP does the rest.
 * Best-effort — no creds / already-wrapped / any failure just keeps the URL.
 * Also returns the ASIN when derivable (stored for tracking / CC matching).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function autoWrapGeniuslink(sb: any, userId: string, url: string, title: string): Promise<{ url: string; asin: string | null }> {
  const asin = asinFromAmazonUrl(url) || null
  if (/(^|\.)geni\.us\//i.test(url)) return { url, asin } // already a Geniuslink
  try {
    const { data: intRow } = await sb.from('integrations')
      .select('geniuslink_api_key, geniuslink_api_secret').eq('user_id', userId).maybeSingle()
    const key = intRow?.geniuslink_api_key
    const secret = intRow?.geniuslink_api_secret
    if (!key || !secret) return { url, asin } // no creds → keep the pasted link
    const genius = createGeniuslinkService(key, secret)
    const wrapped = await genius.createLink(url, (title || 'Product').slice(0, 120))
    if (wrapped) return { url: wrapped, asin }
  } catch { /* keep the pasted link */ }
  return { url, asin }
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const pageId = await ownPage(sb, user.id)
  if (!pageId) return NextResponse.json({ error: 'Create your page first.' }, { status: 400 })

  const body = await request.json().catch(() => ({})) as { title?: string; url?: string; image_url?: string; kind?: string; icon?: string; subtitle?: string }
  const title = (body.title || '').trim().slice(0, 120)
  const url = cleanUrl(body.url || '')
  if (!title || !url) return NextResponse.json({ error: 'A title and a link are required.' }, { status: 400 })
  const kind = body.kind === 'link' ? 'link' : 'product'

  // Product tiles: auto-wrap the pasted link in the creator's own Geniuslink so
  // they don't have to paste a geni.us link themselves — any Amazon/affiliate
  // URL becomes their tracked affiliate link. Social "link" tiles are left as-is.
  let finalUrl = url
  let asin: string | null = null
  if (kind === 'product') {
    const wrapped = await autoWrapGeniuslink(sb, user.id, url, title)
    finalUrl = wrapped.url
    asin = wrapped.asin
  }

  const { data: last } = await sb.from('link_page_items').select('position').eq('page_id', pageId)
    .order('position', { ascending: false }).limit(1).maybeSingle()
  const position = (last?.position ?? -1) + 1

  const { data, error } = await sb.from('link_page_items').insert({
    page_id: pageId, user_id: user.id, kind, title, url: finalUrl,
    ...(asin ? { asin } : {}),
    image_url: (body.image_url || '').trim() || null,
    icon: kind === 'link' ? ((body.icon || '').trim() || 'link') : null,
    subtitle: (body.subtitle || '').trim() || null,
    source: 'manual', position,
  }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, item: data })
}

export async function PATCH(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const body = await request.json().catch(() => ({})) as {
    order?: string[]; id?: string; hidden?: boolean; in_story?: boolean; clearStory?: boolean; title?: string; url?: string; image_url?: string
  }

  // Bulk: clear the whole "in my story" section (e.g. after 24h stories expire).
  if (body.clearStory) {
    await sb.from('link_page_items').update({ in_story: false }).eq('user_id', user.id).eq('in_story', true)
    return NextResponse.json({ ok: true })
  }

  // Reorder: write new positions in the given order.
  if (Array.isArray(body.order)) {
    const ids = body.order.filter((x) => typeof x === 'string')
    await Promise.all(ids.map((id, i) =>
      sb.from('link_page_items').update({ position: i }).eq('id', id).eq('user_id', user.id)))
    return NextResponse.json({ ok: true })
  }

  // Edit one tile.
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  if (body.hidden !== undefined) patch.hidden = !!body.hidden
  if (body.in_story !== undefined) patch.in_story = !!body.in_story
  if (body.title !== undefined) patch.title = (body.title || '').trim().slice(0, 120)
  if (body.url !== undefined) { const u = cleanUrl(body.url); if (u) patch.url = u }
  if (body.image_url !== undefined) patch.image_url = (body.image_url || '').trim() || null
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

  const { data, error } = await sb.from('link_page_items').update(patch).eq('id', body.id).eq('user_id', user.id).select('*').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, item: data })
}

export async function DELETE(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const body = await request.json().catch(() => ({})) as { id?: string }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await sb.from('link_page_items').delete().eq('id', body.id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
