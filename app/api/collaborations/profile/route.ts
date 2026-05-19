/**
 * POST /api/collaborations/profile
 *
 * Saves the reusable "Track record & extras" fields (collab count, up to
 * 3 example-work links, wins/extra notes) onto brand_profiles so the
 * Collaborations form pre-fills them instead of the user retyping every
 * pitch. UPDATE (not upsert) — mirrors the /api/learn convention; the
 * brand_profiles row exists by onboarding.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as {
      collabsDone?: unknown
      exampleLinks?: unknown
      extraNotes?: unknown
    }

    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    const links = Array.isArray(body.exampleLinks)
      ? body.exampleLinks
          .filter((x): x is string => typeof x === 'string')
          .map(s => s.trim())
          .filter(Boolean)
          .slice(0, 3)
      : []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('brand_profiles')
      .update({
        collab_track_record: str(body.collabsDone),
        collab_example_links: links,
        collab_extra_notes: str(body.extraNotes),
      })
      .eq('user_id', user.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
