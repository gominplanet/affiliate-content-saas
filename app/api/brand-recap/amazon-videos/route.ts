// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/brand-recap/amazon-videos — keep the Amazon videos SCOUT read off
// the creator's Manage Content page, each against the product it sells.
//
// SCOUT reads the page in the creator's own signed-in Amazon (a server cannot)
// and sends every video's public /vdp/ link with the ASIN in it. They are kept
// in product_post_links (migration 379) like any other post, so Brand recap
// lists them under the right product from then on.
//
// Body: { videos: [{ vdpUrl, asin }] }. Answers with what was kept and what
// was not, so "found 40, kept 0" is never shown as success.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { canUsePreview } from '@/lib/labs-preview'
import { shareableUrl } from '@/lib/brand-content'

export const dynamic = 'force-dynamic'

const VDP = /^https:\/\/(www\.)?amazon\.[a-z.]+\/vdp\/[a-z0-9]+/i

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return auth.error
  const { user, ownerId } = auth as { user: { id: string }; ownerId: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intg } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('brand_recap', intg?.tier)) return NextResponse.json({ error: 'Brand recap is still being tested.' }, { status: 403 })

  const b = await req.json().catch(() => ({})) as { videos?: Array<{ vdpUrl?: unknown; asin?: unknown }> }
  const list = Array.isArray(b.videos) ? b.videos.slice(0, 2000) : []
  let noProduct = 0, notAVideo = 0
  const rows: Array<{ user_id: string; asin: string; platform: string; url: string; source: string }> = []
  const seen = new Set<string>()
  for (const v of list) {
    const raw = String(v?.vdpUrl ?? '')
    const url = VDP.test(raw) ? shareableUrl(raw) : null
    if (!url) { notAVideo++; continue }
    const asin = String(v?.asin ?? '').toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) { noProduct++; continue }
    if (seen.has(url)) continue
    seen.add(url)
    rows.push({ user_id: ownerId, asin, platform: 'amazon_video', url, source: 'amazon_scan' })
  }
  if (!rows.length) return NextResponse.json({ ok: true, found: list.length, kept: 0, noProduct, notAVideo })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (createAdminClient() as any).from('product_post_links').upsert(rows, { onConflict: 'user_id,url', ignoreDuplicates: true })
  if (error) {
    const missing = /product_post_links/.test(error.message) && /exist|schema cache|find/i.test(error.message)
    return NextResponse.json({ ok: false, error: missing ? 'Migration 379 is needed to keep these links, so none were kept.' : error.message }, { status: missing ? 422 : 500 })
  }
  return NextResponse.json({ ok: true, found: list.length, kept: rows.length, noProduct, notAVideo })
}
