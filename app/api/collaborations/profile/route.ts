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
      livestreams?: unknown
      livestreamLink?: unknown
      portfolioUrl?: unknown
      mediaKitUrl?: unknown
      whatsapp?: unknown
      wechat?: unknown
      lark?: unknown
    }

    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    // The portfolio/link-hub is shared with Brand Profile (linktree_url).
    // Only overwrite it when a non-empty value is provided here, so
    // saving the collab form with a blank field can't wipe a Linktree
    // the user set in Brand Profile.
    const portfolio = str(body.portfolioUrl).trim()
    const links = Array.isArray(body.exampleLinks)
      ? body.exampleLinks
          .filter((x): x is string => typeof x === 'string')
          .map(s => s.trim())
          .filter(Boolean)
          .slice(0, 3)
      : []

    // Cast through `any` for the new contact_whatsapp/wechat/lark
    // columns added in migration 096 — generated Database types in
    // this branch don't have them yet. Drop the cast on next types
    // regen pass.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('brand_profiles')
      .update({
        collab_track_record: str(body.collabsDone),
        collab_example_links: links,
        collab_extra_notes: str(body.extraNotes),
        collab_livestreams: !!body.livestreams,
        collab_livestream_link: str(body.livestreamLink),
        ...(portfolio ? { linktree_url: portfolio } : {}),
        // Media kit URL (migration 102). Same defensive convention as
        // portfolio — only overwrite when the form has a non-empty value
        // so a blank field on a single pitch can't wipe what the user
        // saved in Brand Profile.
        ...(str(body.mediaKitUrl).trim() ? { media_kit_url: str(body.mediaKitUrl).trim() } : {}),
        // Contact channels — only update each one when a non-empty value
        // arrives, so a blank field in a single pitch can't wipe an
        // already-saved handle. Same defensive convention as portfolio.
        ...(str(body.whatsapp).trim() ? { contact_whatsapp: str(body.whatsapp).trim() } : {}),
        ...(str(body.wechat).trim()   ? { contact_wechat:   str(body.wechat).trim()   } : {}),
        ...(str(body.lark).trim()     ? { contact_lark:     str(body.lark).trim()     } : {}),
      })
      .eq('user_id', user.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
