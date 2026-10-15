/**
 * GET  /api/seo/audit  → the last audit, if any: { audit, at }
 * POST /api/seo/audit  → run "Audit my site" now: { audit, fresh }
 *
 * One button on the SEO page (Seb, 2026-10-15). Gathers what MVP knows (every
 * published post and what Google said about it, Search Console, the 2 a day
 * Google nudge), then opens the live site the way a visitor would: the
 * homepage, robots.txt, the sitemap, and the posts most likely to be broken
 * (the ones Google has not listed, plus the newest). lib/seo-audit turns those
 * facts into a short list in order.
 *
 * A second press within two minutes returns the saved audit rather than
 * visiting the member's site again; hosts treat bursts of visits as a robot.
 * Saving needs migration 433 and is best effort: without it the audit still
 * runs and is shown, just not kept.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { getValidGscToken, tokenHasIndexingScope } from '@/lib/gsc'
import { getDefaultSite, getWordPressCredentials } from '@/lib/wordpress-sites'
import { fetchSitemapSlugs } from '@/lib/sitemap'
import { WP_USER_AGENT } from '@/lib/wp-user-agent'
import { INDEX_NUDGES_PER_DAY } from '@/lib/daily-limits'
import { auditSite, readAudit, coverageKind, type AuditFacts, type AuditPost, type LiveCheck, type GscState } from '@/lib/seo-audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const LIVE_MAX = 30
const AGAIN_MS = 2 * 60_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  try {
    const { data } = await (supabase as Db).from('integrations').select('seo_audit,seo_audit_at').eq('user_id', auth.ownerId).maybeSingle()
    return NextResponse.json({ audit: readAudit(data?.seo_audit), at: data?.seo_audit_at ?? null })
  } catch {
    return NextResponse.json({ audit: null, at: null })
  }
}

/** Open one address like a browser: status, time to first answer, where it
 *  ended up, and whether it tells Google not to list it. Never throws. */
/** A host's robot check instead of the page: SiteGround answers 202 with an
 *  "sg-captcha" header, Cloudflare marks "cf-mitigated: challenge". Its
 *  noindex is about the check page, never the site, so it counts as refused. */
function isChallenge(res: Response, body = ''): boolean {
  return res.status === 202 || !!res.headers.get('sg-captcha') || res.headers.get('cf-mitigated') === 'challenge'
    || /sgcaptcha|challenge-platform|<title>\s*just a moment/i.test(body.slice(0, 3000))
}
/** Per audit run: did the host show a robot check anywhere. */
type Run = { challenged: boolean }

async function openPage(run: Run, url: string, timeoutMs = 15_000): Promise<{ status: number | null; ms: number | null; finalUrl: string | null; noindex: boolean; title: string | null }> {
  const t0 = Date.now()
  try {
    const res = await fetch(url, { headers: { 'User-Agent': WP_USER_AGENT, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
    const ms = Date.now() - t0
    if (isChallenge(res)) { run.challenged = true; await res.body?.cancel().catch(() => {}); return { status: 429, ms, finalUrl: res.url || url, noindex: false, title: null } }
    let noindex = /noindex/i.test(res.headers.get('x-robots-tag') || '')
    let title: string | null = null
    if (res.ok) {
      const html = (await res.text().catch(() => '')).slice(0, 400_000)
      if (isChallenge(res, html)) { run.challenged = true; return { status: 429, ms, finalUrl: res.url || url, noindex: false, title: null } }
      const head = html.split(/<\/head>/i)[0]
      for (const m of head.matchAll(/<meta[^>]+>/gi)) {
        const tag = m[0]
        if (/name=["']?(robots|googlebot)["']?/i.test(tag) && /content=["'][^"']*noindex/i.test(tag)) noindex = true
      }
      const tm = head.match(/<title[^>]*>([^<]*)<\/title>/i)
      title = tm ? tm[1].replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;/g, "'").replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, '-').replace(/\s+/g, ' ').trim() : null
    } else {
      await res.body?.cancel().catch(() => {})
    }
    return { status: res.status, ms, finalUrl: res.url || url, noindex, title }
  } catch {
    return { status: null, ms: null, finalUrl: null, noindex: false, title: null }
  }
}

/** robots.txt: does it shut every search engine out of the whole site? */
async function readRobots(run: Run, base: string): Promise<AuditFacts['robots']> {
  try {
    const r = await fetch(`${base}/robots.txt`, { headers: { 'User-Agent': WP_USER_AGENT }, signal: AbortSignal.timeout(10_000) })
    if (r.status === 404) return { found: false, blocksAll: false }
    if (!r.ok || isChallenge(r)) { if (isChallenge(r)) run.challenged = true; return null }
    const txt = await r.text()
    if (/<html/i.test(txt.slice(0, 500))) return null
    let agents: string[] = [], blocksAll = false, inRules = false
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, '').trim()
      const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
      if (!m) continue
      const key = m[1].toLowerCase(), val = m[2].trim()
      if (key === 'user-agent') { if (inRules) { agents = []; inRules = false } agents.push(val.toLowerCase()) }
      else if (key === 'disallow' || key === 'allow') {
        inRules = true
        if (key === 'disallow' && val === '/' && agents.some((a) => a === '*' || a === 'googlebot')) blocksAll = true
      }
    }
    return { found: true, blocksAll }
  } catch { return null }
}

/** Every public post date on the site, so pace and quiet spells include the
 *  posts from before MVP. Null when WordPress does not share them. */
async function readWpDates(base: string): Promise<string[] | null> {
  const out: string[] = []
  try {
    for (let page = 1; page <= 5; page++) {
      const r = await fetch(`${base}/wp-json/wp/v2/posts?per_page=100&page=${page}&_fields=date&orderby=date&order=desc`, { headers: { 'User-Agent': WP_USER_AGENT }, signal: AbortSignal.timeout(12_000) })
      if (r.status !== 200) return page === 1 ? null : out
      const j = await r.json().catch(() => null) as { date?: string }[] | null
      if (!Array.isArray(j)) return page === 1 ? null : out
      for (const x of j) if (x?.date) out.push(x.date)
      const pages = Number(r.headers.get('x-wp-totalpages') || 1)
      if (page >= pages) break
    }
    return out
  } catch { return out.length ? out : null }
}

/** For a post that shows "Page not found": what WordPress says happened. */
async function wpStatusOf(creds: { wordpress_url: string; wordpress_username: string; wordpress_app_password: string } | null, wpId: number | null): Promise<LiveCheck['wpStatus']> {
  if (!creds || !wpId) return null
  try {
    const base = creds.wordpress_url.replace(/\/$/, '')
    const r = await fetch(`${base}/wp-json/wp/v2/posts/${wpId}?context=edit&_fields=status`, {
      headers: { 'User-Agent': WP_USER_AGENT, Authorization: `Basic ${Buffer.from(`${creds.wordpress_username}:${creds.wordpress_app_password}`).toString('base64')}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (r.status === 404 || r.status === 410) return 'deleted'
    if (!r.ok) return null
    const j = await r.json().catch(() => null) as { status?: string } | null
    const s = j?.status
    return s === 'trash' || s === 'draft' || s === 'private' || s === 'pending' || s === 'future' || s === 'publish' ? s : null
  } catch { return null }
}

async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)))
  return out
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth
  const db = supabase as Db
  const force = new URL(request.url).searchParams.get('force') === '1'
  const run: Run = { challenged: false }

  // A press within two minutes returns the last audit.
  if (!force) {
    try {
      const { data } = await db.from('integrations').select('seo_audit,seo_audit_at').eq('user_id', ownerId).maybeSingle()
      const saved = readAudit(data?.seo_audit)
      if (saved && data?.seo_audit_at && Date.now() - Date.parse(data.seo_audit_at) < AGAIN_MS) {
        return NextResponse.json({ audit: saved, fresh: false })
      }
    } catch { /* column not there yet: just run it */ }
  }

  // ── What MVP knows ─────────────────────────────────────────────────────────
  const site = await getDefaultSite(db, ownerId).catch(() => null)
  const siteUrl = site?.url ? site.url.replace(/\/$/, '') : null

  const { data: integ } = await db.from('integrations').select('gsc_property,gsc_oauth_refresh_token').eq('user_id', ownerId).maybeSingle()
  const property: string | null = integ?.gsc_property || null
  const hadGsc = !!integ?.gsc_oauth_refresh_token
  const token = hadGsc ? await getValidGscToken(db, ownerId).catch(() => null) : null
  const gsc: GscState = !hadGsc ? 'none' : !token ? 'expired' : !property ? 'no-property' : 'ok'

  const { data: rows } = await db.from('blog_posts')
    .select('id,title,wordpress_url,wordpress_post_id,wordpress_site_id,published_at')
    .eq('user_id', ownerId).eq('status', 'published')
    .order('published_at', { ascending: false }).limit(1000)
  type Row = { id: string; title: string | null; wordpress_url: string | null; wordpress_post_id: number | null; wordpress_site_id: string | null; published_at: string | null }
  const postRows: Row[] = rows || []
  const seo = new Map<string, { indexed_state: string | null; coverage_state: string | null; clicks: number | null; impressions: number | null; dropped_at: string | null }>()
  for (let i = 0; i < postRows.length; i += 200) {
    const ids = postRows.slice(i, i + 200).map((r) => r.id)
    const { data } = await db.from('post_seo').select('post_id,indexed_state,coverage_state,clicks,impressions,dropped_at').eq('user_id', ownerId).in('post_id', ids)
    for (const s of data || []) seo.set(s.post_id, s)
  }
  const posts: AuditPost[] = postRows.map((r) => {
    const s = seo.get(r.id)
    const st = s?.indexed_state
    return {
      id: r.id, title: (r.title || 'Untitled post').slice(0, 160), url: r.wordpress_url || null, publishedAt: r.published_at,
      indexed: st === 'indexed' || st === 'not_indexed' || st === 'unknown' ? st : null,
      coverage: s?.coverage_state ?? null, clicks: Number(s?.clicks || 0), impressions: Number(s?.impressions || 0), droppedAt: s?.dropped_at ?? null,
    }
  })

  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const since24 = new Date(Date.now() - 86_400_000).toISOString()
  const [{ count: last30 }, { count: last24 }] = await Promise.all([
    db.from('indexing_submissions').select('*', { count: 'exact', head: true }).eq('user_id', ownerId).gte('created_at', since30),
    db.from('indexing_submissions').select('*', { count: 'exact', head: true }).eq('user_id', ownerId).gte('created_at', since24),
  ])
  const scopeOk = gsc === 'ok' && token ? await tokenHasIndexingScope(token) : null

  // Search Console's sitemaps for the property.
  let gscSitemaps: AuditFacts['gscSitemaps'] = null
  if (gsc === 'ok' && token && property) {
    try {
      const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/sitemaps`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) })
      if (r.ok) {
        const j = await r.json().catch(() => ({})) as { sitemap?: { path?: string; lastDownloaded?: string; errors?: string | number }[] }
        gscSitemaps = (j.sitemap || []).map((s) => ({ path: String(s.path || ''), lastDownloaded: s.lastDownloaded ?? null, errors: Number(s.errors || 0) }))
      }
    } catch { /* stays null: said under could not check */ }
  }

  // ── The live site ──────────────────────────────────────────────────────────
  let home: AuditFacts['home'] = null, robots: AuditFacts['robots'] = null, wpDates: string[] | null = null
  let sitemap: AuditFacts['sitemap'] = { found: false, urls: 0, address: null }
  if (siteUrl) {
    const [h, rb, sm, dates] = await Promise.all([openPage(run, siteUrl), readRobots(run, siteUrl), fetchSitemapSlugs(siteUrl).catch(() => ({ slugs: new Set<string>(), found: false })), readWpDates(siteUrl)])
    home = h.status == null && h.ms == null ? null : { status: h.status, ms: h.ms, title: h.title, noindex: h.noindex }
    robots = rb
    wpDates = dates
    // Which sitemap address answered, for the "paste this" step.
    let address: string | null = null
    if (sm.found) {
      for (const c of [`${siteUrl}/sitemap_index.xml`, `${siteUrl}/sitemap.xml`, `${siteUrl}/wp-sitemap.xml`]) {
        try { const r = await fetch(c, { method: 'HEAD', headers: { 'User-Agent': WP_USER_AGENT }, signal: AbortSignal.timeout(6000) }); if (r.ok) { address = c; break } } catch { /* next */ }
      }
    }
    sitemap = { found: sm.found, urls: sm.slugs.size, address }
  }

  // The posts most likely to be broken first, then the newest, then a few
  // Google shows (so speed is not judged only on the problem posts).
  const withUrl = posts.filter((p) => p.url)
  const pick: AuditPost[] = []
  const add = (p: AuditPost) => { if (pick.length < LIVE_MAX && !pick.includes(p)) pick.push(p) }
  withUrl.filter((p) => p.droppedAt).forEach(add)
  withUrl.filter((p) => ['gone', 'redirect', 'noindex'].includes(coverageKind(p.coverage))).forEach(add)
  withUrl.slice(0, 10).forEach(add)
  withUrl.filter((p) => p.indexed !== 'indexed').slice(0, 12).forEach(add)
  withUrl.filter((p) => p.indexed === 'indexed').slice(0, 5).forEach(add)

  const opened = await inBatches(pick, 4, async (p) => ({ p, r: await openPage(run, p.url as string) }))
  const live: LiveCheck[] = opened.map(({ p, r }) => ({ postId: p.id, url: p.url as string, status: r.status, ms: r.ms, finalUrl: r.finalUrl, noindex: r.noindex }))
  const refused = live.filter((l) => l.status === 403 || l.status === 429).length
  const blocked = refused >= 2 || (home?.status === 403 || home?.status === 429)

  // For pages that are gone, ask WordPress what happened (Trash, draft, deleted).
  const goneChecks = live.filter((l) => l.status === 404 || l.status === 410).slice(0, 10)
  if (goneChecks.length) {
    const credCache = new Map<string, Awaited<ReturnType<typeof getWordPressCredentials>>>()
    for (const l of goneChecks) {
      const row = postRows.find((r) => r.id === l.postId)
      const key = row?.wordpress_site_id || 'default'
      if (!credCache.has(key)) credCache.set(key, await getWordPressCredentials(db, ownerId, row?.wordpress_site_id || null, { skipCapGuard: true }).catch(() => null))
      l.wpStatus = await wpStatusOf(credCache.get(key) || null, row?.wordpress_post_id ?? null)
    }
  }

  const audit = auditSite({
    now: Date.now(), siteUrl, gsc, property, posts, wpDates, home, robots, sitemap, gscSitemaps, live, blocked: blocked || run.challenged, challenged: run.challenged,
    nudges: { last30: last30 ?? 0, roomToday: Math.max(0, INDEX_NUDGES_PER_DAY - (last24 ?? 0)), perDay: INDEX_NUDGES_PER_DAY, scopeOk },
  })
  if (!siteUrl) audit.unchecked.unshift('MVP has no WordPress site connected for you, so it could not open your site.')

  let saved = true
  try {
    const { error } = await db.from('integrations').update({ seo_audit: audit, seo_audit_at: audit.at }).eq('user_id', ownerId)
    if (error) saved = false
  } catch { saved = false }

  return NextResponse.json({ audit, fresh: true, saved })
}
