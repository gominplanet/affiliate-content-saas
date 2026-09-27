// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/pinterest/settings — where product pins go, and the Pinterest tracking
// ID for pins that go straight to Amazon (migration 382).
//
// GET   { pref, pinterestTag, mainTag, claimCode, headMetaTags, migrated }
// POST  { pref?, pinterestTag? }   saved on the owner's row; says plainly when
//       migration 382 is missing rather than pretending it saved.
//
// The site claim code is not stored here: it is a meta tag on the creator's
// WordPress site, written through /api/wordpress/customizations like the other
// verification tags, so the page reports whether WordPress actually took it.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { PIN_PRODUCT_DESTS, readPinProductDest, claimCodeIn } from '@/lib/pinterest-destination'

export const dynamic = 'force-dynamic'

async function owner() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return { error: auth.error }
  return { ownerId: (auth as { ownerId: string }).ownerId }
}

export async function GET() {
  const o = await owner()
  if ('error' in o) return o.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (createAdminClient() as any).from('integrations').select('*').eq('user_id', o.ownerId).maybeSingle()
  const tags = (data?.blog_customizations as { headMetaTags?: unknown } | null)?.headMetaTags ?? []
  return NextResponse.json({
    pref: readPinProductDest(data?.pinterest_product_dest),
    pinterestTag: data?.pinterest_amazon_tag || '',
    mainTag: data?.amazon_associates_tag || '',
    claimCode: claimCodeIn(tags),
    headMetaTags: Array.isArray(tags) ? tags : [],
    migrated: !!data && 'pinterest_product_dest' in data,
  })
}

export async function POST(req: Request) {
  const o = await owner()
  if ('error' in o) return o.error
  const b = await req.json().catch(() => ({})) as { pref?: string; pinterestTag?: string }
  const patch: Record<string, unknown> = {}
  if (b.pref !== undefined) {
    if (!(PIN_PRODUCT_DESTS as string[]).includes(String(b.pref))) return NextResponse.json({ error: 'Pick where pins should go.' }, { status: 400 })
    patch.pinterest_product_dest = b.pref
  }
  if (b.pinterestTag !== undefined) {
    const tag = String(b.pinterestTag).trim()
    if (tag && !/^[A-Za-z0-9-]{3,40}$/.test(tag)) {
      return NextResponse.json({ error: 'That does not look like an Amazon tracking ID. It is letters, numbers and dashes, like yourtag-pin-20.' }, { status: 400 })
    }
    patch.pinterest_amazon_tag = tag || null
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (createAdminClient() as any).from('integrations').update(patch).eq('user_id', o.ownerId).select('pinterest_product_dest, pinterest_amazon_tag')
  if (error) {
    const missing = /pinterest_product_dest|pinterest_amazon_tag/.test(error.message)
    return NextResponse.json({ ok: false, error: missing ? 'These settings need migration 382, so nothing was saved.' : error.message }, { status: missing ? 422 : 500 })
  }
  if (!(data ?? []).length) return NextResponse.json({ ok: false, error: 'Your account settings row was not found, so nothing was saved.' }, { status: 404 })
  return NextResponse.json({ ok: true, pref: data[0].pinterest_product_dest, pinterestTag: data[0].pinterest_amazon_tag || '' })
}
