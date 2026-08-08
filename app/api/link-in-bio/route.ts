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
  // the editor can PORT a link with one tap instead of pasting it. brand_profiles
  // holds the URLs the creator typed themselves (the source of truth); the
  // integrations handle columns are a fallback when a brand URL is blank.
  const { data: brand } = await sb.from('brand_profiles')
    .select('name,logo_url,headshot_url,youtube_channel_url,instagram_url,tiktok_url,twitter_url,pinterest_url,facebook_url,threads_url')
    .eq('user_id', user.id).maybeSingle()
  const { data: intg } = await sb.from('integrations')
    .select('wordpress_url,instagram_username,tiktok_username,twitter_handle,threads_username,facebook_page_id')
    .eq('user_id', user.id).maybeSingle()

  const at = (h: unknown) => String(h || '').trim().replace(/^@+/, '')
  const trimOr = (v: unknown, fb?: string): string | undefined => { const s = v == null ? '' : String(v).trim(); return s || fb || undefined }
  const knownLinks: Record<string, string> = {}
  const add = (k: string, v?: string) => { if (v) knownLinks[k] = v }
  add('youtube', trimOr(brand?.youtube_channel_url))
  add('instagram', trimOr(brand?.instagram_url, intg?.instagram_username ? `https://instagram.com/${at(intg.instagram_username)}` : undefined))
  add('tiktok', trimOr(brand?.tiktok_url, intg?.tiktok_username ? `https://tiktok.com/@${at(intg.tiktok_username)}` : undefined))
  add('x', trimOr(brand?.twitter_url, intg?.twitter_handle ? `https://x.com/${at(intg.twitter_handle)}` : undefined))
  add('facebook', trimOr(brand?.facebook_url, intg?.facebook_page_id ? `https://facebook.com/${String(intg.facebook_page_id).trim()}` : undefined))
  add('threads', trimOr(brand?.threads_url, intg?.threads_username ? `https://threads.net/@${at(intg.threads_username)}` : undefined))
  add('pinterest', trimOr(brand?.pinterest_url))
  add('website', trimOr(intg?.wordpress_url))

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
    cta_label?: string; cta_url?: string
    ad_enabled?: boolean; ad_image_url?: string; ad_title?: string; ad_subtitle?: string; ad_url?: string
    heading_stories?: string; heading_ads?: string; heading_more?: string; accent?: string
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
  // Custom main CTA button. cta_url renders as a raw <a href> on the PUBLIC
  // shop page, so it MUST be scheme-sanitized — safeUrl() forces http(s) and
  // neutralizes javascript:/data: (stored-XSS guard).
  if (body.cta_label !== undefined) patch.cta_label = (body.cta_label || '').slice(0, 60) || null
  if (body.cta_url !== undefined) patch.cta_url = safeUrl(body.cta_url) || null
  // Optional advertisement insert.
  if (body.ad_enabled !== undefined) patch.ad_enabled = !!body.ad_enabled
  if (body.ad_image_url !== undefined) patch.ad_image_url = safeUrl(body.ad_image_url) || null
  if (body.ad_title !== undefined) patch.ad_title = (body.ad_title || '').slice(0, 80) || null
  if (body.ad_subtitle !== undefined) patch.ad_subtitle = (body.ad_subtitle || '').slice(0, 140) || null
  if (body.ad_url !== undefined) patch.ad_url = safeUrl(body.ad_url) || null
  // Editable section headings (blank → renderer default).
  if (body.heading_stories !== undefined) patch.heading_stories = (body.heading_stories || '').slice(0, 80) || null
  if (body.heading_ads !== undefined) patch.heading_ads = (body.heading_ads || '').slice(0, 80) || null
  if (body.heading_more !== undefined) patch.heading_more = (body.heading_more || '').slice(0, 80) || null
  // Custom accent — validate a #rgb/#rrggbb hex, else clear (fall back to theme).
  if (body.accent !== undefined) {
    const a = (body.accent || '').trim()
    patch.accent = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(a) ? a : null
  }

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
    // Supabase returns a PostgrestError — a plain object, NOT an Error instance —
    // so `String(err)` would render "[object Object]". Pull .message off it.
    const msg = errMessage(err)
    if (/duplicate key|23505/i.test(msg)) return NextResponse.json({ error: 'That handle is taken — try another.' }, { status: 409 })
    if (/column .* does not exist|schema cache|42703/i.test(msg)) {
      return NextResponse.json({ error: 'This page needs a quick database update (migrations 235–236) before custom colors/ads can save. Ask your admin to run them.' }, { status: 500 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// Force a user-supplied URL to http(s). Anything without an http(s) scheme
// (javascript:, data:, vbscript:, …) gets "https://" prepended, which renders
// it inert as a link target. Empty stays empty. Matches items/route.ts cleanUrl.
function safeUrl(v: unknown): string {
  const t = (v == null ? '' : String(v)).trim().slice(0, 1000)
  if (!t) return ''
  return /^https?:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, '')}`
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; details?: unknown; hint?: unknown }
    const parts = [e.message, e.details, e.hint].filter((x) => typeof x === 'string' && x)
    if (parts.length) return parts.join(' — ')
  }
  return String(err)
}
