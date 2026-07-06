/**
 * POST /api/tools/redirects/match
 *
 * The matching half of the 404 → 301 tool. Given a list of dead URLs (from a
 * Search Console "Not found (404)" export), find the best live post to redirect
 * each one to. Read-only — proposes targets; nothing is written until /apply.
 *
 * Matching (against the site's LIVE WordPress posts), highest-confidence first:
 *   • base-slug  — the 404's slug shares a base with exactly one live post after
 *                  stripping WordPress's trailing "-<number>" (the classic
 *                  deleted-duplicate / re-slug case). High confidence.
 *   • base-multi — same, but several live posts share the base → pick the
 *                  shortest slug, medium confidence, surface the others.
 *   • fuzzy      — no base match; the live post with the highest slug-token
 *                  overlap (Jaccard ≥ 0.5). Medium/low confidence.
 *   • none       — nothing close; caller can send it to the homepage or skip it.
 *
 * Body: { urls: string[] }   (full URLs or bare paths; capped at 1000)
 * Access: Creator+. Owner-scoped (reads the owner's own WordPress).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { normalizeTier, type Tier } from '@/lib/tier'
import { getAuthAndOwner } from '@/lib/agency-auth'

export const maxDuration = 60

type MatchType = 'base' | 'base-multi' | 'fuzzy' | 'none'
type Confidence = 'high' | 'medium' | 'low' | 'none'
interface Match {
  from: string          // normalized path, e.g. "/old-slug/"
  fromUrl: string       // the original URL/path as given
  slug: string
  to: string | null     // suggested target (full URL) or null
  toTitle: string | null
  type: MatchType
  confidence: Confidence
  candidates: { url: string; title: string }[]  // other plausible targets
}

function normPath(u: string): string {
  let p = u.trim()
  try { p = new URL(p).pathname } catch { /* already a path */ }
  p = '/' + p.replace(/[?#].*$/, '').trim().replace(/^\/+|\/+$/g, '')
  if (p !== '/') p += '/'
  return p.toLowerCase()
}
function lastSeg(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return (parts[parts.length - 1] || '').toLowerCase()
}
function stripSuffix(slug: string): string {
  const m = slug.match(/^(.+)-(\d+)$/)
  return m ? m[1] : slug
}
function tokens(slug: string): string[] { return slug.split(/[-_]/).filter(Boolean) }
function jaccard(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b)
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  const uni = new Set([...a, ...b]).size
  return uni ? inter / uni : 0
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const auth = await getAuthAndOwner(supabase)
    if (auth.error) return auth.error
    const { ownerId } = auth

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await supabase
      .from('integrations').select('tier').eq('user_id', ownerId).maybeSingle()
    const tier = normalizeTier((tierRow?.tier as Tier) ?? 'trial')
    if (tier === 'trial') return NextResponse.json({ error: 'Upgrade to Creator or higher to fix 404s.' }, { status: 403 })

    const body = await request.json().catch(() => ({})) as { urls?: string[] }
    const rawUrls = Array.from(new Set((body.urls || []).map(u => (u || '').trim()).filter(Boolean))).slice(0, 1000)
    if (rawUrls.length === 0) return NextResponse.json({ error: 'Paste some 404 URLs first.' }, { status: 400 })

    const creds = await getWordPressCredentials(supabase, ownerId)
    if (!creds) return NextResponse.json({ error: 'WordPress isn’t connected — connect it in Setup, then try again.' }, { status: 400 })
    const wp = createWordPressService(creds.wordpress_url, creds.wordpress_username, creds.wordpress_app_password, creds.wordpress_api_token || undefined)
    const live = await wp.getPublishedPostsBrief()
    if (live.length === 0) return NextResponse.json({ error: 'Couldn’t read your live posts from WordPress — check the connection and try again.' }, { status: 502 })

    // Index the live posts once.
    const posts = live.map(p => ({ slug: p.slug, base: stripSuffix(p.slug), link: p.link, title: p.title, toks: tokens(p.slug) }))
    const byBase = new Map<string, typeof posts>()
    for (const p of posts) { const a = byBase.get(p.base) || []; a.push(p); byBase.set(p.base, a) }
    const liveSlugs = new Set(posts.map(p => p.slug))

    const matches: Match[] = rawUrls.map(raw => {
      const from = normPath(raw)
      const slug = lastSeg(from)
      const base = stripSuffix(slug)
      const out: Match = { from, fromUrl: raw, slug, to: null, toTitle: null, type: 'none', confidence: 'none', candidates: [] }
      if (!slug) return out

      // base match (exclude a live post at this exact slug — then it wouldn't 404)
      const baseHits = (byBase.get(base) || []).filter(p => p.slug !== slug)
      if (baseHits.length === 1) {
        out.to = baseHits[0].link; out.toTitle = baseHits[0].title; out.type = 'base'; out.confidence = 'high'
        return out
      }
      if (baseHits.length > 1) {
        const sorted = [...baseHits].sort((a, b) => a.slug.length - b.slug.length)
        out.to = sorted[0].link; out.toTitle = sorted[0].title; out.type = 'base-multi'; out.confidence = 'medium'
        out.candidates = sorted.slice(1, 5).map(p => ({ url: p.link, title: p.title }))
        return out
      }
      // fuzzy — best slug-token overlap
      let best: (typeof posts)[number] | null = null
      let bestScore = 0
      const t404 = tokens(slug)
      for (const p of posts) {
        if (liveSlugs.has(slug) && p.slug === slug) continue
        const s = jaccard(t404, p.toks)
        if (s > bestScore) { bestScore = s; best = p }
      }
      if (best && bestScore >= 0.5) {
        out.to = best.link; out.toTitle = best.title; out.type = 'fuzzy'
        out.confidence = bestScore >= 0.7 ? 'medium' : 'low'
      }
      return out
    })

    const siteUrl = creds.wordpress_url.replace(/\/$/, '')
    const summary = {
      total: matches.length,
      high: matches.filter(m => m.confidence === 'high').length,
      medium: matches.filter(m => m.confidence === 'medium').length,
      low: matches.filter(m => m.confidence === 'low').length,
      none: matches.filter(m => m.confidence === 'none').length,
    }
    return NextResponse.json({ ok: true, matches, siteUrl, summary })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Match failed' }, { status: 500 })
  }
}
