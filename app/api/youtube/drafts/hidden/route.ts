// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/youtube/drafts/hidden          → { ids: string[] }
// POST /api/youtube/drafts/hidden          { videoId, hidden: boolean } | { clearAll: true }
//
// THE VIDEOS A CREATOR HID FROM CO-PILOT (Seb, 2026-10-19: "dismiss an entry so
// that particular video is not being recalled on the list again"). Kept on
// integrations.copilot_hidden_videos (migration 443). Nothing on YouTube
// changes: the video only stops coming back on MVP's list, and it can be
// brought back.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 15

/** Ids kept, newest last. A channel's whole back catalogue fits well inside. */
const MAX_HIDDEN = 2000
const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/

const missing = (m: string) => /copilot_hidden_videos|schema cache|does not exist/i.test(m)
const SETUP = 'Hiding videos needs migration 443 in Supabase first.'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (createAdminClient() as any).from('integrations')
    .select('copilot_hidden_videos').eq('user_id', user.id).maybeSingle()
  // Said, not swallowed: without the column nothing can be hidden, and the
  // list shows everything, as before.
  if (error) return NextResponse.json({ ids: [], ...(missing(error.message) ? { needsMigration: true, error: SETUP } : { error: error.message }) })
  const ids = Array.isArray(data?.copilot_hidden_videos) ? (data.copilot_hidden_videos as unknown[]).filter((v): v is string => typeof v === 'string') : []
  return NextResponse.json({ ids })
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { videoId?: unknown; hidden?: unknown; clearAll?: unknown }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('integrations').select('copilot_hidden_videos').eq('user_id', user.id).maybeSingle()
  if (error) return NextResponse.json({ error: missing(error.message) ? SETUP : error.message, needsMigration: missing(error.message) }, { status: missing(error.message) ? 503 : 500 })
  const have = Array.isArray(data?.copilot_hidden_videos) ? (data.copilot_hidden_videos as unknown[]).filter((v): v is string => typeof v === 'string') : []
  let next: string[]
  if (body.clearAll === true) next = []
  else {
    const id = typeof body.videoId === 'string' ? body.videoId.trim() : ''
    if (!VIDEO_ID.test(id)) return NextResponse.json({ error: 'That is not a YouTube video id.' }, { status: 400 })
    next = have.filter((v) => v !== id)
    if (body.hidden !== false) next = [...next, id].slice(-MAX_HIDDEN)
  }
  const { error: upErr } = await admin.from('integrations').update({ copilot_hidden_videos: next }).eq('user_id', user.id)
  if (upErr) return NextResponse.json({ error: missing(upErr.message) ? SETUP : upErr.message, needsMigration: missing(upErr.message) }, { status: missing(upErr.message) ? 503 : 500 })
  return NextResponse.json({ ok: true, ids: next })
}
