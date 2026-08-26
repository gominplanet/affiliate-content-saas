// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/creator/brands?q=  — the creator's unified, SEARCHABLE list of brands
//   they've worked with, merged from their Amazon storefront + TikTok.
// POST /api/creator/brands/match {names:[...]} lives in ./match — the TRYBE cross-
//   check. This endpoint is the list; that one is the lookup.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWorkedWithBrands, brandList } from '@/lib/creator-brands'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    const q = new URL(request.url).searchParams.get('q')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = await getWorkedWithBrands(supabase as any, user.id)
    const all = brandList(map)
    const filtered = brandList(map, q)
    return NextResponse.json({
      ok: true,
      total: all.length,
      amazonBrands: all.filter((b) => b.amazon > 0).length,
      tiktokBrands: all.filter((b) => b.tiktok > 0).length,
      brands: filtered.slice(0, 500),
    })
  } catch (e) {
    console.warn('[creator/brands]', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ ok: true, total: 0, amazonBrands: 0, tiktokBrands: 0, brands: [] })
  }
}
