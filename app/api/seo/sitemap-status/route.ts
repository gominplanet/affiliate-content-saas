/**
 * GET /api/seo/sitemap-status
 *
 * Is the blog's sitemap submitted to Google, and what did Google make of it?
 * Read from Search Console (webmasters.readonly, the scope MVP already has):
 * each sitemap Google holds, when it was last read, its errors and warnings,
 * and how many addresses it carried. MVP cannot press Submit for the creator
 * (that needs a write scope), so when none is submitted the page shows the
 * exact address to paste and a link to Search Console's Sitemaps page.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { getValidGscToken } from '@/lib/gsc'
import { fetchWithTimeout } from '@/lib/fetch-timeout'

export const dynamic = 'force-dynamic'

type GscSitemap = {
  path?: string; lastSubmitted?: string; lastDownloaded?: string; isPending?: boolean
  errors?: string | number; warnings?: string | number
  contents?: Array<{ type?: string; submitted?: string | number }>
}

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await (supabase as any).from('integrations').select('gsc_property').eq('user_id', ownerId).maybeSingle()
  const property: string | null = integ?.gsc_property || null
  if (!property) return NextResponse.json({ connected: false, property: null, sitemaps: [] })
  const token = await getValidGscToken(supabase, ownerId).catch(() => null)
  if (!token) return NextResponse.json({ connected: false, property, sitemaps: [], error: 'Search Console is not connected, or its sign-in expired. Reconnect it under Connections.' })
  try {
    const res = await fetchWithTimeout(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/sitemaps`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      return NextResponse.json({ connected: true, property, sitemaps: [], error: `Search Console did not answer (HTTP ${res.status}), so MVP cannot say whether your sitemap is submitted.` })
    }
    const j = await res.json().catch(() => ({})) as { sitemap?: GscSitemap[] }
    const sitemaps = (j.sitemap ?? []).map((s) => ({
      path: String(s.path || ''),
      lastSubmitted: s.lastSubmitted ?? null,
      lastDownloaded: s.lastDownloaded ?? null,
      pending: s.isPending === true,
      errors: Number(s.errors || 0),
      warnings: Number(s.warnings || 0),
      urls: (s.contents ?? []).reduce((n, c) => n + Number(c.submitted || 0), 0),
    }))
    return NextResponse.json({ connected: true, property, sitemaps })
  } catch (e) {
    return NextResponse.json({ connected: true, property, sitemaps: [], error: `Could not reach Search Console (${e instanceof Error ? e.message : 'error'}).` })
  }
}
