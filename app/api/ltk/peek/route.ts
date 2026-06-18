/**
 * POST /api/ltk/peek — best-effort metadata for a pasted LTK link, to PRE-FILL
 * the MVP x LTK form (the creator confirms/edits). Pro/admin-only (Labs).
 *
 * Cheap + side-effect-free: no AI, no spend, no writes. It fetches the LTK
 * page's OG tags only — and stops the moment the redirect chain leaves LTK's
 * own domains, so it never follows the affiliate redirect out to the retailer
 * (which would consume the creator's click / risk attribution). See
 * lib/og-image.ts → fetchLtkPreview. Returns nulls on anything generic/failed;
 * the form's manual fields stay the source of truth.
 *
 * Body: { url }  →  { ok, name, imageUrl }
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { fetchLtkPreview } from '@/lib/og-image'
import type { Tier } from '@/lib/tier'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    const tier = (intRow?.tier as Tier) ?? 'trial'
    if (tier !== 'pro' && tier !== 'admin') {
      return NextResponse.json({ ok: false, error: 'MVP x LTK is a Pro feature.' }, { status: 403 })
    }

    const { url } = await request.json() as { url?: string }
    const ltkUrl = (url || '').trim()
    if (!ltkUrl || !/^https?:\/\//i.test(ltkUrl)) {
      return NextResponse.json({ ok: false, error: 'Paste your LTK link first.' }, { status: 400 })
    }

    const preview = await fetchLtkPreview(ltkUrl)
    return NextResponse.json({ ok: true, name: preview.name, imageUrl: preview.imageUrl })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Unexpected error' }, { status: 500 })
  }
}
