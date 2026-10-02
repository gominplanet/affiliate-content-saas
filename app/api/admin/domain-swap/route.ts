// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/admin/domain-swap?userId=…   which site addresses a creator's
//                                        YouTube descriptions link to
// POST /api/admin/domain-swap            swap one address for another in them
//
// WHY. A creator connected WordPress while his site was still on the host's
// temporary address, so every description MVP wrote linked there. When his
// real domain is live, this swaps the address in each description (lib/
// domain-swap): the live description is read from YouTube first, so nothing he
// wrote since is lost, and only the address changes.
//
// WHAT IT REFUSES. A new address that does not answer, so no description is
// pointed at a dead site. Each run edits at most SWAP_PER_RUN videos (every
// edit costs 50 of the app's shared daily YouTube quota) and says how many are
// left, so press it again for the rest.
//
// MVP'S OWN RECORDS. The stored descriptions follow the live ones. Post and
// site addresses on file change only once WordPress itself reports the new
// address as its home, since MVP checks a post's address against WordPress
// before it rebuilds one.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getValidYouTubeToken, createYouTubeOAuthService } from '@/services/youtube'
import { getChannelOAuthToken } from '@/lib/youtube-channels'
import { fetchWithTimeout } from '@/lib/fetch-timeout'
import { normalizeHost, swapDomain, countHost, isTemporaryHost } from '@/lib/domain-swap'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SWAP_PER_RUN = 25

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

async function requireAdmin(): Promise<{ admin: Sb } | { error: NextResponse }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) }
  const { data: caller } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((caller as any)?.tier !== 'admin') return { error: NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403 }) }
  return { admin: createAdminClient() }
}

type VideoRow = { id: string; title: string | null; youtube_video_id: string | null; channel_id: string | null; description: string | null }

async function videosLinking(admin: Sb, userId: string, host: string, limit: number, skip: string[] = []): Promise<{ rows: VideoRow[]; total: number }> {
  // Every candidate is read (ilike also matches a longer host that ends the
  // same way, so the count is made exactly), and videos that already failed
  // in an earlier run are skipped, so a run always reaches new videos instead
  // of trying the same unfixable ones forever.
  const all: VideoRow[] = []
  for (let from = 0; from < 5000; from += 500) {
    const { data, error } = await admin.from('youtube_videos')
      .select('id,title,youtube_video_id,channel_id,description')
      .eq('user_id', userId).ilike('description', `%${host}%`)
      .order('published_at', { ascending: false, nullsFirst: false }).order('id').range(from, from + 499)
    if (error) throw new Error(error.message)
    all.push(...((data ?? []) as VideoRow[]))
    if ((data ?? []).length < 500) break
  }
  const exact = all.filter((v) => countHost(v.description, host) > 0)
  const skipped = new Set(skip)
  return { rows: exact.filter((v) => !skipped.has(v.id)).slice(0, limit), total: exact.length }
}

/** What WordPress at this address says its home is, or why it could not be read. */
async function siteAnswers(host: string): Promise<{ ok: boolean; home: string | null; note: string }> {
  try {
    const r = await fetchWithTimeout(`https://${host}/wp-json/`, { timeoutMs: 15_000, signal: AbortSignal.timeout(15_000), redirect: 'follow' })
    if (r.status >= 500) return { ok: false, home: null, note: `https://${host} answered with an error (${r.status}).` }
    const j = await r.json().catch(() => null) as { home?: string; url?: string; namespaces?: unknown } | null
    // A parked domain answers too. Only a WordPress site counts.
    if (!j || (!j.home && !j.url && !Array.isArray(j.namespaces))) {
      return { ok: false, home: null, note: `https://${host} answers, but not as a WordPress site (no WordPress at /wp-json/). It may be parked or not connected to the site yet.` }
    }
    const home = normalizeHost(j?.home || j?.url || '') || null
    return { ok: true, home, note: home ? `WordPress at ${host} says its address is ${home}.` : `https://${host} is WordPress, but did not say its address.` }
  } catch (e) {
    return { ok: false, home: null, note: `https://${host} did not answer (${e instanceof Error ? e.message : String(e)}).` }
  }
}

export async function GET(request: Request) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const { admin } = gate
  const userId = new URL(request.url).searchParams.get('userId')
  if (!userId) return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 })
  try {
    const [{ data: sites }, { data: integ }, { data: posts }] = await Promise.all([
      admin.from('wordpress_sites').select('url,is_default').eq('user_id', userId),
      admin.from('integrations').select('wordpress_url').eq('user_id', userId).maybeSingle(),
      admin.from('blog_posts').select('wordpress_url').eq('user_id', userId).not('wordpress_url', 'is', null).limit(2000),
    ])
    const hosts = new Map<string, { posts: number; onFile: boolean }>()
    const add = (u: string | null | undefined, k: 'post' | 'site') => {
      const h = normalizeHost(u)
      if (!h) return
      const e = hosts.get(h) ?? { posts: 0, onFile: false }
      if (k === 'post') e.posts++; else e.onFile = true
      hosts.set(h, e)
    }
    for (const s of (sites ?? []) as Array<{ url: string | null }>) add(s.url, 'site')
    add((integ as { wordpress_url?: string | null } | null)?.wordpress_url, 'site')
    for (const p of (posts ?? []) as Array<{ wordpress_url: string | null }>) add(p.wordpress_url, 'post')

    const out = []
    for (const [host, e] of hosts) {
      const { total } = await videosLinking(admin, userId, host, 1)
      out.push({ host, temporary: isTemporaryHost(host), posts: e.posts, siteOnFile: e.onFile, videos: total })
    }
    out.sort((a, b) => Number(b.temporary) - Number(a.temporary) || b.videos - a.videos)
    return NextResponse.json({ ok: true, hosts: out })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'lookup failed' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const { admin } = gate
  const body = await request.json().catch(() => ({})) as { userId?: string; from?: string; to?: string; skip?: string[] }
  const userId = body.userId
  const from = normalizeHost(body.from), to = normalizeHost(body.to)
  if (!userId || !from || !to) return NextResponse.json({ ok: false, error: 'Give the creator, the old address and the new address (for example mysite.com).' }, { status: 400 })
  if (from === to) return NextResponse.json({ ok: false, error: 'The old and new addresses are the same.' }, { status: 400 })
  if (isTemporaryHost(to)) return NextResponse.json({ ok: false, error: `${to} is a temporary host address, not a real domain.` }, { status: 400 })

  // Never point a description at a site that is not there.
  const site = await siteAnswers(to)
  if (!site.ok) return NextResponse.json({ ok: false, error: `Nothing was changed. ${site.note} Connect the domain first, then try again.` }, { status: 422 })
  const wordpressMoved = site.home === to

  const skip = Array.isArray(body.skip) ? body.skip.filter((x) => typeof x === 'string').slice(0, 2000) : []
  const { rows, total } = await videosLinking(admin, userId, from, SWAP_PER_RUN, skip)
  const { data: integ } = await admin.from('integrations').select('*').eq('user_id', userId).maybeSingle()
  const tokens = new Map<string, string | null>()
  const tokenFor = async (channelId: string | null): Promise<string | null> => {
    const k = channelId || 'default'
    if (!tokens.has(k)) {
      const owned = await getChannelOAuthToken(admin, userId, channelId).catch(() => null)
      const fallback = !owned && (integ as Record<string, unknown> | null)?.youtube_oauth_access_token
        ? await getValidYouTubeToken(integ as Record<string, unknown>).catch(() => null) : null
      tokens.set(k, owned || fallback || null)
    }
    return tokens.get(k) ?? null
  }

  const report = { changed: 0, alreadyRight: 0, missing: 0, failed: [] as Array<{ id: string; title: string; reason: string }> }
  for (const v of rows) {
    const title = v.title || 'Untitled video'
    if (!v.youtube_video_id) { report.failed.push({ id: v.id, title, reason: 'no YouTube id on record' }); continue }
    try {
      const token = await tokenFor(v.channel_id)
      if (!token) { report.failed.push({ id: v.id, title, reason: 'the channel this video is on is not connected for editing' }); continue }
      const outcome = await createYouTubeOAuthService(token).swapDescriptionDomain(v.youtube_video_id, (d) => swapDomain(d, from, to))
      if (outcome === 'missing') report.missing++
      else if (outcome === 'changed') report.changed++
      else report.alreadyRight++
      // Our copy follows the live one, so it leaves this list either way.
      await admin.from('youtube_videos').update({ description: swapDomain(v.description || '', from, to) }).eq('id', v.id)
    } catch (e) {
      report.failed.push({ id: v.id, title, reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) })
    }
  }

  // Post and site addresses on file, only once WordPress says it has moved.
  let postsUpdated = 0
  if (wordpressMoved) {
    const { data: posts } = await admin.from('blog_posts').select('id,wordpress_url').eq('user_id', userId).ilike('wordpress_url', `%${from}%`).limit(2000)
    for (const p of (posts ?? []) as Array<{ id: string; wordpress_url: string }>) {
      const next = swapDomain(p.wordpress_url, from, to)
      if (next !== p.wordpress_url && !(await admin.from('blog_posts').update({ wordpress_url: next }).eq('id', p.id)).error) postsUpdated++
    }
    const { data: sites } = await admin.from('wordpress_sites').select('id,url').eq('user_id', userId).ilike('url', `%${from}%`)
    for (const s of (sites ?? []) as Array<{ id: string; url: string }>) await admin.from('wordpress_sites').update({ url: swapDomain(s.url, from, to) }).eq('id', s.id)
    const iu = (integ as { wordpress_url?: string | null } | null)?.wordpress_url
    if (iu && countHost(iu, from)) await admin.from('integrations').update({ wordpress_url: swapDomain(iu, from, to) }).eq('user_id', userId)
  }

  // Still carrying the old address: skipped failures from earlier runs, this
  // run's failures, and the ones not reached yet.
  const left = Math.max(0, total - report.changed - report.alreadyRight - report.missing)
  const notReached = Math.max(0, left - skip.length - report.failed.length)
  return NextResponse.json({
    ok: report.failed.length === 0,
    ...report,
    left,
    notReached,
    site: site.note,
    wordpressMoved,
    postsUpdated,
  })
}
