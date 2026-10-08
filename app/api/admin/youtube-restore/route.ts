// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/admin/youtube-restore — admin only. Refills the admin's own stored
// YouTube video details now (lib/youtube-retention restorePass), instead of
// waiting for the hourly run. Open it in the browser while signed in; run it
// again until "still empty" stops falling. ?email= refills another creator.
//
// Written 2026-10-08, after a disconnect and reconnect left 3,371 of Seb's
// videos with no title, description or thumbnail and nothing refilled them.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { restorePass } from '@/lib/youtube-retention'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  const { data: caller } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any
  let userId = user.id
  const email = new URL(req.url).searchParams.get('email')
  if (email) {
    const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const found = (list?.users ?? []).find((u: { email?: string }) => (u.email || '').toLowerCase() === email.toLowerCase())
    if (!found) return NextResponse.json({ error: `No account with ${email}.` }, { status: 404 })
    userId = found.id
  }
  const out = await restorePass(sb, 2500, Date.now() + (maxDuration - 40) * 1000, { userId, everyRow: true })
  const count = async (empty: boolean) => {
    const q = sb.from('youtube_videos').select('id', { count: 'exact', head: true }).eq('user_id', userId)
    const { count: n } = await (empty ? q.eq('title', '') : q.neq('title', ''))
    return n ?? 0
  }
  const [withTitle, stillEmpty] = await Promise.all([count(false), count(true)])
  return NextResponse.json({
    ok: true,
    restoredThisRun: out.restored,
    youtubeDidNotShow: out.stillMissing,
    notYouTubeIds: out.notYouTube,
    stoppedFor: out.stoppedFor ?? null,
    nowWithTitle: withTitle,
    stillEmpty,
    note: out.stoppedFor === 'quota' ? 'YouTube’s daily allowance is used up; the rest refills after midnight Pacific.'
      : out.stoppedFor === 'time' ? 'Out of time for this run. Open this page again to carry on.'
      : stillEmpty ? `${stillEmpty} still empty: ${out.notYouTube} have an id that is not a YouTube video id, so YouTube cannot be asked about them; ${out.stillMissing} are videos YouTube does not show to any of your logins or MVP's key (deleted, or private on a channel not connected).` : 'Every video is filled.',
  })
}
