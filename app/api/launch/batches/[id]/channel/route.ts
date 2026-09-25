// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/launch/batches/[id]/channel  — the channels this batch could go
//      to, and what YouTube says the chosen (or default) login uploads to.
// POST /api/launch/batches/[id]/channel  { channelId } — confirm one. Saved
//      only when YouTube agrees that login uploads to that very channel.
//
// A CHECK, NOT A DROPDOWN. Picking a name from a list proves nothing: the
// name is what MVP wrote down when the channel was connected, and the login
// behind it can upload somewhere else. So the answer shown is YouTube's own,
// asked with the same login the uploader will use.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { pushChannels, liveUploadChannel, batchChannelId, wrongChannelMessage } from '@/lib/launch-channel'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: batch } = await sb.from('launch_batches').select('id,state').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!batch) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })

  const confirmed = await batchChannelId(sb, id)
  const channels = await pushChannels(sb, user.id)
  // The channel to check: the confirmed one, else the default, else the first.
  const target = confirmed
    || channels.find((c) => c.isDefault)?.channelId
    || channels[0]?.channelId
    || null
  const check = target ? await liveUploadChannel(sb, user.id, target) : { live: null, error: 'No YouTube channel is connected for uploading. Connect one under Settings.' }
  return NextResponse.json({
    available: confirmed !== undefined,
    confirmed: confirmed ?? null,
    locked: batch.state === 'launching' || batch.state === 'launched',
    channels,
    checked: target,
    live: check.live,
    matches: !!check.live && check.live.id === target,
    error: check.error,
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const body = await req.json().catch(() => ({})) as { channelId?: string }
  const channelId = String(body.channelId || '').trim()

  const { data: batch } = await sb.from('launch_batches').select('id,state').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!batch) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })
  if (batch.state === 'launching' || batch.state === 'launched') {
    return NextResponse.json({ error: 'This batch has already launched, so its channel is set. Start a new batch for another channel.' }, { status: 409 })
  }
  const all = await pushChannels(sb, user.id)
  const known = all.find((c) => c.channelId === channelId)
  if (!known) return NextResponse.json({ error: 'That channel is not one of yours with a login saved. Connect it under Settings.' }, { status: 400 })

  const { live, error } = await liveUploadChannel(sb, user.id, channelId)
  if (!live) return NextResponse.json({ error: error || 'YouTube did not say which channel this login uploads to.' }, { status: 502 })
  if (live.id !== channelId) {
    return NextResponse.json({ error: wrongChannelMessage(known.title, live.title), live }, { status: 409 })
  }

  const current = await batchChannelId(sb, id)
  if (current === undefined) {
    return NextResponse.json({ error: 'Confirming the YouTube channel needs migration 372 in the database first. Nothing was saved.' }, { status: 503 })
  }
  const { error: wErr } = await sb.from('launch_batches').update({ youtube_channel_id: channelId }).eq('id', id).eq('user_id', user.id)
  if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 })
  // A PLAYLIST BELONGS TO ONE CHANNEL. The playlist list on the page is read
  // through the confirmed channel's login, or the default's before one is
  // confirmed, so a playlist picked through any other login would be refused
  // by this channel on every video. It is cleared whenever the login that
  // listed it is not the one now confirmed.
  const listedBy = current || all.find((c) => c.isDefault)?.channelId || null
  if (listedBy !== channelId) {
    await sb.from('launch_batches').update({ playlist_id: null }).eq('id', id).eq('user_id', user.id)
  }
  return NextResponse.json({ ok: true, live })
}
