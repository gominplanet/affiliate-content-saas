/**
 * POST /api/brand/add-category
 *
 * Appends a user-defined category to brand_profiles.custom_categories.
 * Case-insensitive dedup against both the existing custom list AND the
 * user's brand niches (so they don't accidentally re-add what's already
 * available).
 *
 * Body: { category: string }
 * Returns: { ok: true, customCategories: string[] }
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

// Same 20 niches that ship with brand profiles — used for dedup. Mirrors
// the constant on the Brand page and the Content page picker.
const MASTER_NICHES = new Set([
  'home & kitchen', 'electronics & tech', 'outdoor & sports', 'beauty & personal care',
  'health & wellness', 'pet supplies', 'tools & home improvement', 'toys & games',
  'books & education', 'fashion & apparel', 'garden & outdoors', 'automotive',
  'baby & kids', 'office & productivity', 'food & grocery', 'travel & luggage',
  'arts & crafts', 'musical instruments', 'software & apps', 'finance & investing',
])

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { category } = await request.json() as { category?: string }
    const trimmed = (category ?? '').trim()
    if (!trimmed) return NextResponse.json({ error: 'Category name required' }, { status: 400 })
    if (trimmed.length > 60) return NextResponse.json({ error: 'Category name too long (60 char max)' }, { status: 400 })

    // Pull current brand row
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brand } = await supabase
      .from('brand_profiles')
      .select('custom_categories')
      .eq('user_id', user.id)
      .single()

    const existing: string[] = (brand?.custom_categories as string[] | null) ?? []
    const existingLower = new Set(existing.map(c => c.toLowerCase()))

    // Dedup against the master niches too — they're already in the dropdown
    if (MASTER_NICHES.has(trimmed.toLowerCase())) {
      return NextResponse.json({
        ok: true,
        customCategories: existing,
        warning: `"${trimmed}" is already a default category. No need to add it.`,
      })
    }
    if (existingLower.has(trimmed.toLowerCase())) {
      return NextResponse.json({
        ok: true,
        customCategories: existing,
        warning: `"${trimmed}" is already in your custom categories.`,
      })
    }

    const next = [...existing, trimmed]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateErr } = await supabase
      .from('brand_profiles')
      .update({ custom_categories: next })
      .eq('user_id', user.id)

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, customCategories: next })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
