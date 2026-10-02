// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/launch/items/[id]/retry — let a blocked video try again.
//
// WHY THIS EXISTS. A video that used up its three tries said "Cannot go" and
// that was the end of it. Every cause it names is something a creator can fix:
// reconnect the channel, change the title, pick a different CTA. There was no
// way to say "I fixed it, go again" short of deleting the video and setting it
// up from scratch, which throws away a finished render and two thumbnails.
//
// THE TRY COUNT IS WHAT GETS RESET, not the work. The render and the
// thumbnails stay exactly where they are, so a retry costs one attempt at the
// step that failed rather than the whole pipeline again.

import { NextResponse } from 'next/server'
import { DRAFT_REASON_PREFIX } from '@/lib/studio-upload'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: item } = await sb.from('launch_items')
    .select('id,state,rendered_url,thumbnail_url,thumbnail_clean_url,planned_publish_at,youtube_video_id')
    .eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!item) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })

  // ALREADY ON YOUTUBE MEANS THERE IS NOTHING TO RETRY, and re-running the
  // publish step would upload it a second time.
  if (item.state === 'scheduled' || item.state === 'published') {
    return NextResponse.json({
      error: 'This one is already on YouTube. There is nothing to try again.',
    }, { status: 409 })
  }
  if (item.state !== 'blocked') {
    return NextResponse.json({
      error: 'This one has not given up. It is still working through its tries.',
    }, { status: 409 })
  }

  // BACK TO THE STEP THAT FAILED, not to the beginning. Which step that is, is
  // decided by what the video already has rather than by remembering: no
  // render means the CTA step, no thumbnail means the thumbnail step, and
  // everything present means it was YouTube that refused.
  const patch: Record<string, unknown> = { reason: null, updated_at: new Date().toISOString() }
  let from: string
  // THE UPLOAD'S TRIES START AGAIN ON EVERY PATH. A video sent back to its
  // thumbnail kept the tries it had used on YouTube, and could give up the
  // moment it came back without being tried once.
  patch.publish_tries = 0
  // A STUDIO DRAFT SCOUT UPLOADED AND COULD NOT SAVE goes back to SCOUT, not
  // to the API: only Save in Studio takes a video out of draft, so the API
  // path set its settings and left it a draft.
  let unsavedDraft = false
  if (String(item.youtube_video_id || '').trim()) {
    const { data: su, error: suErr } = await sb.from('launch_items').select('studio_upload').eq('id', id).maybeSingle()
    const rec = !suErr && su?.studio_upload && typeof su.studio_upload === 'object' ? su.studio_upload as Record<string, unknown> : null
    unsavedDraft = !!rec && rec.visibility == null
  }
  if (unsavedDraft) {
    patch.reason = `${DRAFT_REASON_PREFIX}${item.youtube_video_id}) as a draft in Studio: SCOUT saves it next, with this page open.`
    patch.updated_at = new Date(Date.now() - 20 * 60_000).toISOString()
    const { data: moved } = await sb.from('launch_items').update(patch)
      .eq('id', id).eq('user_id', user.id).eq('state', 'blocked').select('id')
    if (!moved || moved.length === 0) return NextResponse.json({ error: 'This one has already moved on. Reload to see where it is.' }, { status: 409 })
    return NextResponse.json({ ok: true, from: 'saving the draft in Studio', message: 'SCOUT saves this draft in Studio next, while this page is open. The row says how it goes.' })
  }
  if (String(item.youtube_video_id || '').trim()) {
    // ALREADY UPLOADED, so this must not start again from the file, or from
    // its thumbnail (checked first for that reason: a video on YouTube that
    // went without a designed thumbnail is not rebuilt and re-queued). The
    // worker skips the upload for a row that has an id, which is what stopped
    // one launch putting three copies of the same video on a real channel.
    patch.state = 'prepared'
    from = 'setting the publish time on the video already on your channel'
  } else if (!item.rendered_url) {
    patch.state = 'draft'; patch.render_tries = 0
    from = 'the CTA'
  } else if (!item.thumbnail_url) {
    patch.state = 'preparing'; patch.thumb_tries = 0
    from = 'the thumbnail'
  } else {
    patch.state = 'prepared'; patch.publish_tries = 0
    from = 'the YouTube upload'
  }

  // Only while it is still given up: two presses, or a press racing the
  // worker, must not both move it.
  const { data: moved, error } = await sb.from('launch_items').update(patch)
    .eq('id', id).eq('user_id', user.id).eq('state', 'blocked').select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!moved || moved.length === 0) return NextResponse.json({ error: 'This one has already moved on. Reload to see where it is.' }, { status: 409 })

  // WHAT IT WILL ACTUALLY DO, so nobody presses it twice wondering.
  return NextResponse.json({
    ok: true,
    from,
    message: `Trying ${from} again. It starts within a minute and the row says how it goes.`,
  })
}
