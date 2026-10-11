/**
 * GET /api/seo/inspect-link?url=…
 *
 * Google's own link to one address in Search Console's URL inspection, the
 * page with the Request indexing button (2026-10-11: a link MVP built by hand
 * opened Google's 404 page). Asked of the URL Inspection API, which returns
 * inspectionResultLink. Also says what Google currently knows about the
 * address, so the page can show it.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { getValidGscToken, inspectUrl } from '@/lib/gsc'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get('url') || ''
  if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: 'No post address was given.' }, { status: 400 })
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await (supabase as any).from('integrations').select('gsc_property').eq('user_id', ownerId).maybeSingle()
  const property: string | null = integ?.gsc_property || null
  if (!property) return NextResponse.json({ error: 'Search Console is not connected.' }, { status: 409 })
  const token = await getValidGscToken(supabase, ownerId).catch(() => null)
  if (!token) return NextResponse.json({ error: 'Search Console sign-in expired. Reconnect it under Connections.' }, { status: 409 })
  const r = await inspectUrl(token, property, url)
  if (!r) return NextResponse.json({ error: 'Search Console did not answer for this address. Open Search Console and paste the address into the bar at the top instead.' }, { status: 502 })
  return NextResponse.json({ link: r.inspectionLink, coverageState: r.coverageState, indexed: r.indexed })
}
