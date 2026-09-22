// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/launch/items/[id]/move — change where a video sits in the run.
//
// WHY ORDER MATTERS HERE AND NOWHERE ELSE IN THE PRODUCT. `position` is not
// cosmetic: it is the publishing order. The first video takes the first slot,
// and with one post a day that means the first video added goes out today and
// the tenth goes out next week. Until now the only way to decide that was the
// order the files happened to be picked in a file dialog.
//
// NOTHING ALREADY ON YOUTUBE MOVES. Its time is set on YouTube's side, so
// changing its place here would make the page disagree with the channel.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { direction?: 'up' | 'down' }
  const dir = body.direction === 'down' ? 1 : -1

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: item } = await sb.from('launch_items')
    .select('id,batch_id,position,state').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!item) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })
  if (item.state === 'scheduled' || item.state === 'published') {
    return NextResponse.json({
      error: 'This one already has its time on YouTube, so moving it here would change nothing.',
    }, { status: 409 })
  }

  // THE WHOLE BATCH IS REORDERED, not two rows swapped. A swap against a list
  // with a hole in it (a delete that half finished, a row written by an older
  // build) moves a video somewhere nobody asked for. Renumbering from the
  // sorted list cannot do that.
  const { data: rows } = await sb.from('launch_items')
    .select('id,position,state').eq('batch_id', item.batch_id)
    .order('position', { ascending: true })
  const list = (rows ?? []) as Array<{ id: string; position: number; state: string }>
  const at = list.findIndex((r) => r.id === id)
  const to = at + dir
  if (at < 0) return NextResponse.json({ error: 'Video not found in this batch.' }, { status: 404 })
  if (to < 0 || to >= list.length) {
    // NOT AN ERROR. Pressing up on the first one is a no-op, and saying "that
    // failed" about a button that simply had nowhere to go is noise.
    return NextResponse.json({ ok: true, moved: false })
  }
  // A VIDEO ALREADY ON YOUTUBE CANNOT BE DISPLACED EITHER, or its neighbour
  // would take a slot that is already spoken for.
  const neighbour = list[to]
  if (neighbour.state === 'scheduled' || neighbour.state === 'published') {
    return NextResponse.json({
      error: 'The one next to it is already on YouTube, so it cannot swap places with it.',
    }, { status: 409 })
  }

  const next = [...list]
  next.splice(to, 0, next.splice(at, 1)[0])
  for (let i = 0; i < next.length; i++) {
    if (next[i].position !== i) {
      await sb.from('launch_items').update({ position: i }).eq('id', next[i].id).eq('user_id', user.id)
    }
  }
  return NextResponse.json({ ok: true, moved: true })
}
