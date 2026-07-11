/**
 * POST /api/geniuslink/test
 *
 * Live "does this actually work?" check for a user's Geniuslink API
 * credentials. Runs the real `GET /v1/groups/list` call and reports back:
 *   { ok: true,  groupCount }                       — credentials accepted
 *   { ok: false, error, status? }                   — rejected / unreachable
 *
 * Body (optional): { apiKey, apiSecret } — test the values the user just
 * typed, BEFORE saving, so they get ✓/✗ feedback immediately. With no body
 * it tests whatever is already saved on the (owner's) integrations row.
 *
 * Why this exists: MVP used to show "Connected" the moment the two fields
 * were non-empty — a false positive. Users pasted the wrong thing (an email,
 * a store name) and only discovered the 401 later in the group-setup panel.
 * This turns a valid/invalid credential into an immediate, obvious signal.
 * listGroups() throws a friendly, actionable message on 401 (see
 * services/geniuslink), which we surface verbatim.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createGeniuslinkService } from '@/services/geniuslink'
import { getOwnerUserId } from '@/lib/agency'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Not logged in' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as { apiKey?: string; apiSecret?: string }
    let apiKey = (body.apiKey || '').trim()
    let apiSecret = (body.apiSecret || '').trim()

    // No creds supplied → fall back to whatever is saved on the owner's row
    // (VAs test the owner's account, matching how generation reads them).
    if (!apiKey || !apiSecret) {
      const ownerId = await getOwnerUserId(user.id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('integrations')
        .select('geniuslink_api_key, geniuslink_api_secret')
        .eq('user_id', ownerId)
        .maybeSingle()
      apiKey = (data?.geniuslink_api_key || '').trim()
      apiSecret = (data?.geniuslink_api_secret || '').trim()
    }

    if (!apiKey || !apiSecret) {
      return NextResponse.json({ ok: false, error: 'Enter your Geniuslink API Key and Secret first.' })
    }

    const svc = createGeniuslinkService(apiKey, apiSecret)
    const groups = await svc.listGroups() // throws the friendly 401 message if rejected
    return NextResponse.json({ ok: true, groupCount: groups.length })
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Could not reach Geniuslink. Try again in a moment.'
    return NextResponse.json({ ok: false, error })
  }
}
