/**
 * Link in Bio — page settings.
 *   GET  → { page, items, origin }   (the creator's page + tiles)
 *   POST { handle?, title?, bio?, avatar_url?, theme?, published? }
 *          → claim a handle (first call) or update settings.
 *
 * Open to all paid tiers (same gate as Deal Radar). Owner-only via RLS; handle
 * uniqueness is checked across users with the service-role client.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier, type Tier } from '@/lib/tier'
import { canUseDealRadar } from '@/lib/feature-access'
import { normalizeHandle, isValidHandle, themeFor } from '@/lib/link-in-bio'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: page } = await sb.from('link_pages').select('*').eq('user_id', user.id).maybeSingle()
  let items: unknown[] = []
  if (page) {
    const { data } = await sb.from('link_page_items').select('*').eq('page_id', page.id).order('position', { ascending: true })
    items = data ?? []
  }
  // Brand logo/headshot/name + every public profile URL MVP already knows, so
  // the editor can PORT a link with one tap instead of pasting it.
  const { data: brand } = await sb.from('brand_profiles').select('name,logo_url,headshot_url,youtube_channel_url').eq('user_id', user.id).maybeSingle()
  const { data: intg } = await sb.from('integrations')
    .select('wordpress_url,instagram_username,tiktok_username,twitter_handle,threads_username,facebook_page_id')
    .eq('user_id', user.id).maybeSingle()

  const at = (h: unknown) => String(h || '').trim().replace(/^@+/, '')
  const knownLinks: Record<string, string> = {}
  if (brand?.youtube_channel_url) knownLinks.youtube = String(brand.youtube_channel_url)
  if (intg?.instagram_username) knownLinks.instagram = `https://instagram.com/${at(intg.instagram_username)}`
  if (intg?.tiktok_username) knownLinks.tiktok = `https://tiktok.com/@${at(intg.tiktok_username)}`
  if (intg?.twitter_handle) knownLinks.x = `https://x.com/${at(intg.twitter_handle)}`
  if (intg?.threads_username) knownLinks.threads = `https://threads.net/@${at(intg.threads_username)}`
  if (intg?.facebook_page_id) knownLinks.facebook = `https://facebook.com/${String(intg.facebook_page_id).trim()}`
  if (intg?.wordpress_url) knownLinks.website = String(intg.wordpress_url)

  return NextResponse.json({
    ok: true, page: page ?? null, items, origin: new URL(request.url).origin,
    brand: { name: brand?.name ?? null, logoUrl: brand?.logo_url ?? null, headshotUrl: brand?.headshot_url ?? null },
    blogUrl: (intg?.wordpress_url as string | null) || null,
    knownLinks,
  })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: intRow } = await sb.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(intRow?.tier) as Tier
  if (!canUseDealRadar(tier)) {
    return NextResponse.json({ error: 'Link in Bio is available on paid plans.' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as {
    handle?: string; title?: string; bio?: string; avatar_url?: string; theme?: string; published?: boolean
  }

  const { data: existing } = await sb.from('link_pages').select('*').eq('user_id', user.id).maybeSingle()

  // Resolve a handle change / first claim.
  let handle: string | undefined
  if (body.handle != null) {
    handle = normalizeHandle(body.handle)
    if (!isValidHandle(handle)) {
      return NextResponse.json({ error: 'Handle must be 2–30 letters, numbers or hyphens.' }, { status: 400 })
    }
    if (!existing || handle !== existing.handle) {
      // Uniqueness across ALL users (RLS would hide other users' rows).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any
      const { data: taken } = await admin.from('link_pages').select('id').eq('handle', handle).neq('user_id', user.id).maybeSingle()
      if (taken) return NextResponse.json({ error: `“${handle}” is taken — try another.` }, { status: 409 })
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (handle != null) patch.handle = handle
  if (body.title !== undefined) patch.title = (body.title || '').slice(0, 80) || null
  if (body.bio !== undefined) patch.bio = (body.bio || '').slice(0, 300) || null
  if (body.avatar_url !== undefined) patch.avatar_url = (body.avatar_url || '').trim() || null
  if (body.theme !== undefined) patch.theme = themeFor(body.theme).key
  if (body.published !== undefined) patch.published = !!body.published

  try {
    if (existing) {
      const { data, error } = await sb.from('link_pages').update(patch).eq('user_id', user.id).select('*').single()
      if (error) throw error
      return NextResponse.json({ ok: true, page: data })
    }
    // First claim needs a handle.
    if (!handle) return NextResponse.json({ error: 'Pick a handle to create your page.' }, { status: 400 })
    const { data, error } = await sb.from('link_pages').insert({
      user_id: user.id, handle,
      title: patch.title ?? null, bio: patch.bio ?? null, avatar_url: patch.avatar_url ?? null,
      theme: (patch.theme as string) ?? 'light', published: patch.published ?? false,
    }).select('*').single()
    if (error) throw error
    return NextResponse.json({ ok: true, page: data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/duplicate key|23505/i.test(msg)) return NextResponse.json({ error: 'That handle is taken — try another.' }, { status: 409 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
