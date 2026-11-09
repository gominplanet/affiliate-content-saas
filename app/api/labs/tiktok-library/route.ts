// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MATCH MY TIKTOK (Seb, 2026-11-09). A creator's own TikTok videos, matched to
// the brands on TRYBE (lib/tiktok-match, lib/tiktok-library). Migration 465.
//
//   GET                                   the library: profile, the scan as it
//                                         went, the matches with their videos
//   POST {action:'start', handle}         a SCOUT scan begins: returns its id
//   POST {action:'batch', scanId, ...}    SCOUT hands over what TikTok's own
//                                         profile page received; with done,
//                                         the scan ends and matches are made
//   POST {action:'stop'}                  stop the scan (SCOUT stops at its
//                                         next hand-over)
//   POST {action:'daily', on}             check for new videos every day
//   POST {action:'official'}              read the videos through TikTok's
//                                         video list API (once approved)
//   POST {action:'rematch'}               work the matches out again now
//
// SCOUT CALLS THIS FROM ITS OWN WORKER with the creator's MVP session, so the
// scan goes on with MVP's tab closed. A hand-over for a scan that is no longer
// the current one (stopped, or a new one started) is refused, and SCOUT stops.

import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { trybeAccess } from '@/lib/labs-preview'
import { cleanHandle, cleanProfile, itemsOfBody, parseWebItem, withProductCount, type TikTokVideo } from '@/lib/tiktok-videos'
import { saveVideos, loadVideos, recomputeMatches, matchesStale, type KeptMatch } from '@/lib/tiktok-library'
import { videoListSwitchOn, scopesIncludeVideoList, readVideoList } from '@/lib/tiktok-video-list'
import { isMatch } from '@/lib/tiktok-match'
import { getValidTikTokToken } from '@/services/tiktok'

export const runtime = 'nodejs'
export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const BATCH_ITEMS_MAX = 200

async function gate() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return { error: auth.error }
  const { user, ownerId } = auth as { user: { id: string }; ownerId: string }
  const admin = createAdminClient() as Db
  const { data: intg } = await admin.from('integrations').select('tier, tiktok_username, tiktok_scopes, tiktok_access_token').eq('user_id', ownerId).maybeSingle()
  const { data: me } = await admin.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (trybeAccess(me?.tier) === 'none') return { error: NextResponse.json({ error: 'Match my TikTok is part of TRYBE on the Pro plan.' }, { status: 403 }) }
  return { admin, ownerId, intg: intg || {} }
}

const dbWords = (m: string) => (/tiktok_(library|videos)/.test(m) && /does not exist|schema cache/.test(m) ? 'Match my TikTok needs migration 465 in Supabase first.' : m)

async function library(admin: Db, ownerId: string) {
  const { data, error } = await admin.from('tiktok_library').select('*').eq('user_id', ownerId).maybeSingle()
  return { lib: (data || null) as Record<string, any> | null, error: error ? dbWords(error.message) : null } // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** A scan that has said nothing for this long was cut off (Chrome closed, the
 *  computer slept): said as stopped, with why, never left "running" forever. */
const SILENT_MS = 4 * 60_000

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  const { admin, ownerId, intg } = g
  let { lib, error } = await library(admin, ownerId)
  if (error) return NextResponse.json({ error }, { status: 500 })
  const official = {
    switchOn: videoListSwitchOn(),
    connected: !!intg.tiktok_access_token,
    hasScope: scopesIncludeVideoList(intg.tiktok_scopes),
    username: (intg.tiktok_username as string | null) ?? null,
  }
  if (!lib) return NextResponse.json({ ok: true, library: null, matches: [], videos: {}, official })

  if (lib.scan_status === 'running' && lib.scan_updated_at && Date.now() - Date.parse(lib.scan_updated_at) > SILENT_MS) {
    const now = new Date().toISOString()
    await admin.from('tiktok_library').update({ scan_status: 'stopped', scan_error: 'SCOUT stopped answering partway (Chrome closed or the computer slept). What it read is kept: press Scan again to finish.', scan_finished_at: now, updated_at: now }).eq('user_id', ownerId)
    lib = { ...lib, scan_status: 'stopped', scan_error: 'SCOUT stopped answering partway (Chrome closed or the computer slept). What it read is kept: press Scan again to finish.', scan_finished_at: now }
  }

  let matches = (Array.isArray(lib.matches) ? lib.matches : []) as KeptMatch[]
  let note = (lib.matched_note as string | null) ?? null
  const { count: kept } = await admin.from('tiktok_videos').select('video_id', { count: 'exact', head: true }).eq('user_id', ownerId)
  // Brands that joined TRYBE since the last check are matched now.
  if (lib.scan_status !== 'running' && (kept ?? 0) > 0 && (await matchesStale(admin, lib.matched_at ?? null))) {
    const r = await recomputeMatches(admin, ownerId, { budgetMs: 20_000 })
    if (!r.error) { matches = r.matches; note = r.note }
  }
  // The videos the matches point at, and the brands' TRYBE details for the cards.
  const ids = Array.from(new Set(matches.flatMap((m) => m.videoIds))).slice(0, 1500)
  const videos: Record<string, TikTokVideo> = {}
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from('tiktok_videos').select('*').eq('user_id', ownerId).in('video_id', ids.slice(i, i + 200))
    for (const r of (data || []) as Array<Record<string, unknown>>) {
      videos[String(r.video_id)] = {
        id: String(r.video_id), url: String(r.url), caption: String(r.caption || '').slice(0, 400), hashtags: [], mentions: [],
        postedAt: (r.posted_at as string | null) ?? null, views: r.views == null ? null : Number(r.views), likes: r.likes == null ? null : Number(r.likes),
        cover: (r.cover_url as string | null) ?? null, duration: (r.duration as number | null) ?? null, products: Array.isArray(r.products) ? r.products as TikTokVideo['products'] : [],
      }
    }
  }
  const brandIds = matches.map((m) => m.brandId).slice(0, 400)
  const brands: Record<string, { website: string | null; categories: string[]; trybeScore: number | null; requested: string | null }> = {}
  for (let i = 0; i < brandIds.length; i += 200) {
    const { data } = await admin.from('trybe_directory').select('brand_id, website, categories, trybe_score').in('brand_id', brandIds.slice(i, i + 200))
    for (const r of (data || []) as Array<Record<string, unknown>>) brands[String(r.brand_id)] = { website: (r.website as string | null) ?? null, categories: (r.categories as string[] | null) || [], trybeScore: (r.trybe_score as number | null) ?? null, requested: null }
  }
  // Brands the creator already asked on TRYBE, so the page says so.
  for (let i = 0; i < brandIds.length; i += 200) {
    const { data } = await admin.from('trybe_brands').select('brand_id, status').eq('user_id', ownerId).in('brand_id', brandIds.slice(i, i + 200))
    for (const r of (data || []) as Array<{ brand_id: string; status: string }>) if (brands[r.brand_id]) brands[r.brand_id].requested = r.status
  }
  return NextResponse.json({
    ok: true,
    library: {
      handle: lib.handle, name: lib.name ?? null, avatar: lib.avatar_url ?? null, videoCount: lib.video_count ?? null, privateAccount: lib.private_account ?? null,
      scan: {
        id: lib.scan_id ?? null, source: lib.scan_source ?? null, status: lib.scan_status ?? null, read: lib.scan_read ?? 0, total: lib.scan_total ?? null,
        withProduct: lib.scan_with_product ?? 0, reachedEnd: lib.scan_reached_end ?? null, error: lib.scan_error ?? null,
        startedAt: lib.scan_started_at ?? null, updatedAt: lib.scan_updated_at ?? null, finishedAt: lib.scan_finished_at ?? null,
      },
      daily: !!lib.daily, kept: kept ?? 0, matchedAt: lib.matched_at ?? null, matchedNote: note,
      matchedBrands: matches.filter(isMatch).length,
    },
    matches, videos, brands, official,
  })
}

export async function POST(request: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const { admin, ownerId, intg } = g
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const action = String(body.action || '')
  const now = new Date().toISOString()

  if (action === 'start') {
    const handle = cleanHandle(body.handle)
    if (!handle) return NextResponse.json({ error: 'That is not a TikTok handle. Type it as it shows on your profile, like @gominreviews.' }, { status: 400 })
    const { lib, error } = await library(admin, ownerId)
    if (error) return NextResponse.json({ error }, { status: 500 })
    if (lib?.scan_status === 'running' && lib.scan_updated_at && Date.now() - Date.parse(lib.scan_updated_at) < SILENT_MS && lib.handle === handle) {
      return NextResponse.json({ ok: true, scanId: lib.scan_id, handle, already: true })
    }
    if (body.daily === true && (!lib || lib.handle !== handle)) return NextResponse.json({ ok: false, error: 'The daily check is for a different handle than the one MVP holds. Turn it on again from Match my TikTok.' })
    // A different handle: the old account's videos and matches go, so one
    // creator's library is always one account.
    if (lib && lib.handle !== handle) await admin.from('tiktok_videos').delete().eq('user_id', ownerId)
    const scanId = randomUUID()
    const row = {
      user_id: ownerId, handle, scan_id: scanId, scan_source: body.daily === true ? 'scout_daily' : 'scout', scan_status: 'running', scan_read: 0, scan_total: lib && lib.handle === handle ? lib.video_count ?? null : null,
      scan_with_product: 0, scan_reached_end: null, scan_error: null, scan_started_at: now, scan_updated_at: now, scan_finished_at: null, updated_at: now,
      ...(lib && lib.handle !== handle ? { name: null, avatar_url: null, video_count: null, private_account: null, matches: [], matched_brands: 0, matched_at: null, matched_note: null } : {}),
    }
    const { error: e2 } = await admin.from('tiktok_library').upsert(row, { onConflict: 'user_id' })
    if (e2) return NextResponse.json({ error: dbWords(e2.message) }, { status: 500 })
    return NextResponse.json({ ok: true, scanId, handle })
  }

  if (action === 'batch') {
    const { lib, error } = await library(admin, ownerId)
    if (error) return NextResponse.json({ error }, { status: 500 })
    if (!lib || !body.scanId || lib.scan_id !== body.scanId || lib.scan_status !== 'running') return NextResponse.json({ ok: false, keep: false, error: 'stale-scan' })
    const handle = String(lib.handle)
    const raw: unknown[] = []
    for (const b of Array.isArray(body.bodies) ? body.bodies.slice(0, 40) : []) raw.push(...itemsOfBody(b && typeof b === 'object' && 'body' in (b as object) ? (b as { body: unknown }).body : b))
    if (Array.isArray(body.items)) raw.push(...body.items)
    const parsed = raw.slice(0, BATCH_ITEMS_MAX).map((r) => parseWebItem(r, handle)).filter((v): v is TikTokVideo => !!v)
    // Only the creator's own videos: a video by another account that shows on
    // the profile (a collab's original) is not theirs to match.
    const own = parsed.filter((v) => v.url.toLowerCase().includes(`/@${handle}/`))
    const saved = await saveVideos(admin, ownerId, handle, own, 'scout')
    if (saved.error) return NextResponse.json({ ok: false, keep: false, error: dbWords(saved.error) }, { status: 500 })
    const profile = body.profile ? cleanProfile(body.profile, handle) : null
    const update: Record<string, unknown> = { scan_updated_at: now, updated_at: now }
    if (profile) {
      if (profile.name) update.name = profile.name
      if (profile.avatar) update.avatar_url = profile.avatar
      if (profile.videoCount != null) { update.video_count = profile.videoCount; update.scan_total = profile.videoCount }
      if (profile.privateAccount != null) update.private_account = profile.privateAccount
    }
    const { count: readThisScan } = await admin.from('tiktok_videos').select('video_id', { count: 'exact', head: true }).eq('user_id', ownerId).gte('read_at', lib.scan_started_at)
    update.scan_read = readThisScan ?? lib.scan_read ?? 0
    update.scan_with_product = (lib.scan_with_product ?? 0) + withProductCount(own)
    const done = body.done === true
    if (done) {
      const err = typeof body.error === 'string' && body.error.trim() ? body.error.trim().slice(0, 400) : null
      update.scan_status = err ? 'failed' : 'done'
      update.scan_error = err
      update.scan_reached_end = body.reachedEnd === true
      update.scan_finished_at = now
      // The exact count with a product tag, from what was kept.
      const all = await loadVideos(admin, ownerId)
      update.scan_with_product = withProductCount(all)
    }
    const { error: ue } = await admin.from('tiktok_library').update(update).eq('user_id', ownerId)
    if (ue) return NextResponse.json({ ok: false, keep: false, error: dbWords(ue.message) }, { status: 500 })
    let matched: number | null = null
    if (done) {
      const r = await recomputeMatches(admin, ownerId, { budgetMs: 30_000 })
      matched = r.matches.filter(isMatch).length
    }
    return NextResponse.json({ ok: true, keep: !done, saved: saved.saved, known: saved.known, read: update.scan_read, matched })
  }

  if (action === 'stop') {
    const { lib } = await library(admin, ownerId)
    if (lib?.scan_status === 'running') {
      await admin.from('tiktok_library').update({ scan_status: 'stopped', scan_error: 'You stopped the scan. What it read is kept.', scan_finished_at: now, updated_at: now }).eq('user_id', ownerId)
      await recomputeMatches(admin, ownerId, { budgetMs: 20_000 })
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'daily') {
    const { error } = await admin.from('tiktok_library').update({ daily: body.on === true, updated_at: now }).eq('user_id', ownerId)
    if (error) return NextResponse.json({ error: dbWords(error.message) }, { status: 500 })
    return NextResponse.json({ ok: true, daily: body.on === true })
  }

  if (action === 'rematch') {
    const r = await recomputeMatches(admin, ownerId, { budgetMs: 40_000 })
    if (r.error) return NextResponse.json({ error: dbWords(r.error) }, { status: 500 })
    return NextResponse.json({ ok: true, matched: r.matches.filter(isMatch).length, note: r.note })
  }

  if (action === 'official') {
    if (!videoListSwitchOn()) return NextResponse.json({ error: 'TikTok has not approved MVP to read video lists yet, so this scan runs through SCOUT for now.' }, { status: 400 })
    if (!scopesIncludeVideoList(intg.tiktok_scopes)) return NextResponse.json({ error: 'Connect TikTok again so MVP can read your videos. Your posting stays as it is.', reconnect: true }, { status: 400 })
    const token = await getValidTikTokToken(admin, ownerId)
    if (!token) return NextResponse.json({ error: 'Your TikTok connection has expired. Connect TikTok again.', reconnect: true }, { status: 400 })
    const handle = cleanHandle(intg.tiktok_username) || cleanHandle(body.handle)
    if (!handle) return NextResponse.json({ error: 'MVP does not know your TikTok handle. Connect TikTok again.' }, { status: 400 })
    const { lib } = await library(admin, ownerId)
    if (lib && lib.handle !== handle) await admin.from('tiktok_videos').delete().eq('user_id', ownerId)
    const started = now
    await admin.from('tiktok_library').upsert({ user_id: ownerId, handle, scan_id: randomUUID(), scan_source: 'tiktok', scan_status: 'running', scan_read: 0, scan_error: null, scan_started_at: started, scan_updated_at: started, scan_finished_at: null, updated_at: started }, { onConflict: 'user_id' })
    const read = await readVideoList(token, handle, { deadline: Date.now() + 40_000 })
    const saved = await saveVideos(admin, ownerId, handle, read.videos, 'tiktok')
    const end = new Date().toISOString()
    await admin.from('tiktok_library').update({
      scan_status: read.error || saved.error ? 'failed' : 'done', scan_error: read.error || (saved.error ? dbWords(saved.error) : null) || (!read.reachedEnd ? 'Time ran out before the end of your videos. Press Scan again to read the rest.' : null),
      scan_read: read.videos.length, scan_total: lib?.video_count ?? null, scan_reached_end: read.reachedEnd, scan_with_product: 0, scan_finished_at: end, scan_updated_at: end, updated_at: end,
    }).eq('user_id', ownerId)
    const r = await recomputeMatches(admin, ownerId, { budgetMs: 15_000 })
    return NextResponse.json({ ok: !read.error, read: read.videos.length, reachedEnd: read.reachedEnd, error: read.error, matched: r.matches.filter(isMatch).length })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
