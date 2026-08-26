// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/creator/brands/match  { names: string[] }  — the TRYBE cross-check.
// Given a list of brand names (e.g. TRYBE's "Discover Brands"), return which ones
// the creator has ALREADY worked with (matched by normalized brand key) and where
// (Amazon storefront / TikTok, with counts). Lets the creator instantly see, in a
// brand marketplace, which brands they're already promoting for free.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWorkedWithBrands } from '@/lib/creator-brands'
import { brandKey } from '@/lib/brand-normalize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as { names?: unknown }
    const names = Array.isArray(body.names) ? body.names.map((n) => String(n || '')).filter(Boolean).slice(0, 500) : []
    if (!names.length) return NextResponse.json({ ok: true, matches: [] })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = await getWorkedWithBrands(supabase as any, user.id)

    const matches = names.map((name) => {
      const hit = map.get(brandKey(name))
      return hit
        ? { name, worked: true, brand: hit.brand, amazon: hit.amazon, tiktok: hit.tiktok, confident: hit.confident, sources: [hit.amazon > 0 ? 'amazon' : null, hit.tiktok > 0 ? 'tiktok' : null].filter(Boolean) }
        : { name, worked: false }
    })
    return NextResponse.json({ ok: true, matched: matches.filter((m) => m.worked).length, matches })
  } catch (e) {
    console.warn('[creator/brands/match]', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ ok: false, matches: [] }, { status: 500 })
  }
}
