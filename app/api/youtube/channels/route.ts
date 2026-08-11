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
import { listYouTubeChannels, setDefaultChannel, maxChannelsForTier, canAddChannel } from '@/lib/youtube-channels'
import { bustYouTubeCache } from '@/app/api/youtube/drafts/route'
import { resolveYouTubeChannel } from '@/services/youtube'
import { normalizeTier } from '@/lib/tier'

export const runtime = 'nodejs'
// Never cache — this must reflect a connect/disconnect the instant it happens,
// or the list shows a channel the DB no longer has (ghost after disconnect).
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth) return auth.error
  const { ownerId } = auth

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  // These three reads only depend on ownerId — run them together instead of
  // waterfalling (this route loads on the content page + every co-pilot visit).
  const [channels, { data: intRow }, { data: sites }] = await Promise.all([
    listYouTubeChannels(supabase, ownerId),
    sb.from('integrations').select('tier').eq('user_id', ownerId).maybeSingle(),
    sb.from('wordpress_sites')
      .select('id, label, default_youtube_channel_id')
      .eq('user_id', ownerId)
      .order('display_order', { ascending: true }),
  ])
  const tier = normalizeTier((intRow as { tier?: string } | null)?.tier)

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

  let body: { action?: string; channelRowId?: string | null; siteId?: string; channelUrl?: string }
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
    // The video cache is keyed by user, not channel — clear it so Co-Pilot
    // reloads from the newly-selected default instead of the old channel's videos.
    try { await bustYouTubeCache(supabase, ownerId) } catch { /* non-fatal */ }
    return NextResponse.json({ ok: true })
  }

  // Connect a channel by its public URL — no OAuth. Resolves the URL to a
  // channel ID and stores a read-only row (no tokens). Co-Pilot then lists that
  // channel's PUBLIC uploads by ID. This is the reliable path for creators whose
  // channel is a Brand Account that Google's OAuth chooser won't let them pick.
  if (body.action === 'addPublic') {
    const url = (body.channelUrl || '').toString().trim()
    if (!url) return NextResponse.json({ error: 'Paste your channel URL (e.g. youtube.com/@yourchannel).' }, { status: 400 })
    const gate = await canAddChannel(supabase, ownerId, tier)
    if (!gate.allowed) {
      return NextResponse.json({ error: `You're at your channel limit (${gate.cap}). Remove one first${gate.cap <= 1 ? ', or upgrade to Pro for more' : ''}.`, proRequired: gate.cap <= 1 }, { status: 403 })
    }
    const apiKey = process.env.YOUTUBE_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'YouTube lookup not configured' }, { status: 500 })
    const resolved = await resolveYouTubeChannel(apiKey, url)
    if (!resolved) {
      return NextResponse.json({ error: "Couldn't find a channel at that URL. Paste the channel's YouTube page link, e.g. youtube.com/@yourchannel." }, { status: 404 })
    }
    const existing = await listYouTubeChannels(supabase, ownerId)
    if (existing.some(c => c.channelId === resolved.channelId)) {
      return NextResponse.json({ error: `"${resolved.title}" is already connected.` }, { status: 409 })
    }
    // First real row → make it the default so Co-Pilot reads it straight away.
    const isFirst = existing.filter(c => c.id !== 'legacy').length === 0
    const { error } = await sb.from('youtube_channels').insert({
      user_id: ownerId,
      channel_id: resolved.channelId,
      channel_title: resolved.title,
      is_default: isFirst,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    try { await bustYouTubeCache(supabase, ownerId) } catch { /* non-fatal */ }
    return NextResponse.json({ ok: true, channel: { channelId: resolved.channelId, channelTitle: resolved.title } })
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
    // The video cache is per-user (not per-channel), so the removed channel's
    // videos would linger in Co-Pilot until the next full refresh — clear it now.
    try { await bustYouTubeCache(supabase, ownerId) } catch { /* non-fatal */ }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
