// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/launchpad/clean-thumbnail — the TEXT-FREE thumbnail for non-English
// storefronts. Same recipe as the storefront master's branded thumbnail (the
// creator's real face next to the real product), just with zero words on it, so
// no English hook ships to a French or German storefront. Honours the face the
// creator picked in the YouTube step (or "no human").
//   body: { asin, title, faceId?, noHuman? }  ->  { ok, url }
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { buildProductThumbnail } from '@/lib/product-thumbnail'

export const runtime = 'nodejs'
export const maxDuration = 300

function asinFrom(v: string): string | null {
  const s = (v || '').trim()
  if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase()
  const m = s.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i)
  return m ? m[1].toUpperCase() : null
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integ } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(integ?.tier)
  if (!['pro', 'admin'].includes(tier)) {
    return NextResponse.json({ error: 'Launchpad is a Pro feature.', code: 'tier_not_allowed' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { asin?: string; title?: string; faceId?: string; noHuman?: boolean }
  const asin = asinFrom(body.asin || '')
  if (!asin) return NextResponse.json({ error: 'A valid product ASIN is required.' }, { status: 400 })
  const title = (body.title || '').trim().slice(0, 200)
  const faceId = typeof body.faceId === 'string' && body.faceId.trim() ? body.faceId.trim() : null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const url = await buildProductThumbnail(sb, { userId: user.id, tier, title, asin, withText: false, faceId, noHuman: body.noHuman === true })
  if (!url) return NextResponse.json({ error: 'Could not build the text-free thumbnail.' }, { status: 502 })
  return NextResponse.json({ ok: true, url })
}
