/**
 * GET  /api/youtube/channels
 *   → { channels: YouTubeChannel[], siteMap: Record<siteId, channelRowId|null>, tier, cap }
 *   Lists the user's connected YouTube channels (Pro multi-channel, migration
 *   127) plus, for each WordPress site, which channel it pulls from by default.
 *
 * POST /api/youtube/channels
 *   { action: 'setDefault', channelRowId }        → set the user's default channel
 *   { action: 'setSiteChannel', siteId, channelRowId|null } → map a WP site to a channel
 *   { action: 'remove', channelRowId }            → disconnect a channel (not the default/only one)
 *
 * Multi-channel is Pro-only; the GET is readable by all (single-channel users
 * just see one row) but the mutations that imply >1 channel are Pro-gated.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { listYouTubeChannels, setDefaultChannel, maxChannelsForTier } from '@/lib/youtube-channels'
import { normalizeTier } from '@/lib/tier'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth) return auth.error
  const { ownerId } = auth

  const channels = await listYouTubeChannels(supabase, ownerId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: intRow } = await sb.from('integrations').select('tier').eq('user_id', ownerId).maybeSingle()
  const tier = normalizeTier((intRow as { tier?: string } | null)?.tier)

  const { data: sites } = await sb
    .from('wordpress_sites')
    .select('id, label, default_youtube_channel_id')
    .eq('user_id', ownerId)
    .order('display_order', { ascending: true })

  return NextResponse.json({
    channels,
    tier,
    cap: maxChannelsForTier(tier),
    sites: (sites ?? []).map((s: { id: string; label: string | null; default_youtube_channel_id: string | null }) => ({
      id: s.id,
      label: s.label || 'Main',
      channelRowId: s.default_youtube_channel_id,
    })),
  })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth) return auth.error
  const { ownerId } = auth

  let body: { action?: string; channelRowId?: string | null; siteId?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: intRow } = await sb.from('integrations').select('tier').eq('user_id', ownerId).maybeSingle()
  const tier = normalizeTier((intRow as { tier?: string } | null)?.tier)
  const isPro = tier === 'pro' || tier === 'admin'

  if (body.action === 'setDefault') {
    if (!body.channelRowId) return NextResponse.json({ error: 'channelRowId required' }, { status: 400 })
    const res = await setDefaultChannel(supabase, ownerId, body.channelRowId)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'setSiteChannel') {
    if (!isPro) {
      return NextResponse.json({ error: 'Mapping a YouTube channel per site is a Pro feature.', proRequired: true }, { status: 403 })
    }
    if (!body.siteId) return NextResponse.json({ error: 'siteId required' }, { status: 400 })
    // channelRowId null = clear the mapping (revert site to the default channel).
    const { error } = await sb
      .from('wordpress_sites')
      .update({ default_youtube_channel_id: body.channelRowId ?? null })
      .eq('user_id', ownerId)
      .eq('id', body.siteId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'remove') {
    if (!body.channelRowId) return NextResponse.json({ error: 'channelRowId required' }, { status: 400 })
    const channels = await listYouTubeChannels(supabase, ownerId)
    if (channels.length <= 1) {
      return NextResponse.json({ error: 'Can’t remove your only channel. Use Set Up → YouTube to disconnect entirely.' }, { status: 400 })
    }
    const target = channels.find(c => c.id === body.channelRowId)
    if (!target) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    const { error } = await sb.from('youtube_channels').delete().eq('user_id', ownerId).eq('id', body.channelRowId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // If we removed the default, promote another channel.
    if (target.isDefault) {
      const next = channels.find(c => c.id !== body.channelRowId)
      if (next) await setDefaultChannel(supabase, ownerId, next.id)
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
