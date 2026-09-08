// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/youtube/description-lines  { key, text }
//
// Saves ONE of MVP's boilerplate description lines as this creator's default,
// from the "Save as default" offer in Co-Pilot. The full editor on the YouTube
// page writes the same column; this exists so a creator who has just rewritten
// a sentence in the description box can keep it without going to find a
// settings screen they do not know about.
//
// One line per call, merged into the stored object rather than replacing it, so
// saving the sign-off never clears a disclosure they set last week.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getOwnerUserId } from '@/lib/agency'
import { LINE_KEYS, disclosureIsValid, type LineKey } from '@/lib/yt-description-lines'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { key?: unknown; text?: unknown }
  const key = String(body.key || '') as LineKey
  if (!(LINE_KEYS as readonly string[]).includes(key)) {
    return NextResponse.json({ error: 'That is not a line MVP writes.' }, { status: 400 })
  }
  const text = String(body.text ?? '').trim().slice(0, 600)
  if (!text) return NextResponse.json({ error: 'Write the line you want, or reset it to the default on the YouTube page.' }, { status: 400 })

  // The disclosure is the one line where the creator's freedom meets someone
  // else's rules. Refused here as well as at generation time, so they find out
  // now rather than discovering later that MVP quietly kept its own wording.
  if ((key === 'disclosureProduct' || key === 'disclosureGeneral') && !disclosureIsValid(text)) {
    return NextResponse.json({
      error: 'That needs to stay a disclosure. Amazon and the FTC both require it, so it has to mention a commission or affiliate links.',
    }, { status: 400 })
  }

  // The owner's row, so a VA saving a line changes the account they work on
  // rather than their own empty profile.
  const ownerId = await getOwnerUserId(user.id)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  // select('*') rather than naming the column: yt_description_lines ships in
  // migration 321, and PostgREST rejects an entire read over one column it does
  // not know, which would take this route down on any database running ahead of
  // the migration.
  const { data: row } = await sb.from('brand_profiles').select('*').eq('user_id', ownerId).maybeSingle()
  const existing = (row?.yt_description_lines as Record<string, unknown> | null) ?? {}

  const { error } = await sb.from('brand_profiles').upsert(
    { user_id: ownerId, yt_description_lines: { ...existing, [key]: text } },
    { onConflict: 'user_id' },
  )
  if (error) {
    console.error('[youtube/description-lines] save failed:', error.message)
    return NextResponse.json({ error: 'Could not save that line. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, key, text })
}
