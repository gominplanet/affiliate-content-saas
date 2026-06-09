/**
 * GET  /api/analytics/geniuslink-groups-probe
 *   List every group on the user's Geniuslink account (Id, Name, Enabled).
 *   Useful to confirm credentials work + see what groups exist already.
 *
 * POST /api/analytics/geniuslink-groups-probe { name: "MVP-YOUTUBE" }
 *   Tries to CREATE a group with the given name by attempting every known
 *   Geniuslink endpoint shape in parallel. Returns the full per-attempt
 *   report (status, body sample, latency) so we can see EXACTLY which
 *   call shape Geniuslink accepts on this account. Use this to discover
 *   the correct endpoint without re-deploying every time.
 *
 *   Idempotent-ish: if the group already exists, the POST attempts will
 *   still fire (some return "already exists" errors), but no duplicate
 *   group will be created (Geniuslink enforces unique names per account).
 *
 * Tied to /lib/geniuslink-group.ts — the resolver hits the same code path
 * for real generations; this endpoint just makes it visible.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

const GENIUSLINK_API = 'https://api.geni.us'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Creds {
  apiKey: string
  apiSecret: string
}

async function getCreds(): Promise<{ creds?: Creds; err?: NextResponse }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { err: NextResponse.json({ error: 'Not logged in' }, { status: 401 }) }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await supabase
    .from('integrations')
    .select('geniuslink_api_key, geniuslink_api_secret')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!intRow?.geniuslink_api_key || !intRow?.geniuslink_api_secret) {
    return { err: NextResponse.json({ error: 'No Geniuslink credentials saved on this account.' }, { status: 400 }) }
  }
  return { creds: { apiKey: intRow.geniuslink_api_key, apiSecret: intRow.geniuslink_api_secret } }
}

function authHeaders(c: Creds): Record<string, string> {
  return {
    'X-Api-Key': c.apiKey,
    'X-Api-Secret': c.apiSecret,
    Accept: 'application/json',
  }
}

export async function GET() {
  const { creds, err } = await getCreds()
  if (err) return err
  if (!creds) return NextResponse.json({ error: 'No credentials' }, { status: 500 })

  try {
    const res = await fetch(`${GENIUSLINK_API}/v1/groups/list`, {
      headers: authHeaders(creds),
      signal: AbortSignal.timeout(8000),
    })
    const text = await res.text()
    if (!res.ok) {
      return NextResponse.json({ ok: false, status: res.status, body: text.slice(0, 500) })
    }
    const data = JSON.parse(text)
    return NextResponse.json({ ok: true, groups: data.Groups ?? data.groups ?? data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}

export async function POST(request: Request) {
  const { creds, err } = await getCreds()
  if (err) return err
  if (!creds) return NextResponse.json({ error: 'No credentials' }, { status: 500 })

  const body = await request.json().catch(() => ({})) as { name?: string }
  const name = (body.name || 'MVP-TEST-GROUP').trim().slice(0, 80)
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  // Same matrix the production createGroup() in services/geniuslink uses,
  // run in PARALLEL with per-attempt latency so we can see at a glance
  // which shape Geniuslink's API accepts.
  const formBody = new URLSearchParams({ name, enabled: '1' }).toString()
  const formBodyCap = new URLSearchParams({ Name: name, Enabled: '1' }).toString()
  const jsonLowerBody = JSON.stringify({ name, enabled: true })
  const jsonCapBody = JSON.stringify({ Name: name, Enabled: 1 })

  const attempts: Array<{ label: string; url: string; body?: string; contentType?: string }> = [
    { label: 'v3-querystring',     url: `${GENIUSLINK_API}/v3/groups?${formBody}` },
    { label: 'v1-querystring',     url: `${GENIUSLINK_API}/v1/groups?${formBody}` },
    { label: 'v1-add-querystring', url: `${GENIUSLINK_API}/v1/groups/add?${formBody}` },
    { label: 'v3-form',            url: `${GENIUSLINK_API}/v3/groups`,      body: formBody,    contentType: 'application/x-www-form-urlencoded' },
    { label: 'v1-form',            url: `${GENIUSLINK_API}/v1/groups`,      body: formBody,    contentType: 'application/x-www-form-urlencoded' },
    { label: 'v1-add-form',        url: `${GENIUSLINK_API}/v1/groups/add`,  body: formBody,    contentType: 'application/x-www-form-urlencoded' },
    { label: 'v1-add-form-cap',    url: `${GENIUSLINK_API}/v1/groups/add`,  body: formBodyCap, contentType: 'application/x-www-form-urlencoded' },
    { label: 'v3-json',            url: `${GENIUSLINK_API}/v3/groups`,      body: jsonLowerBody, contentType: 'application/json' },
    { label: 'v3-json-cap',        url: `${GENIUSLINK_API}/v3/groups`,      body: jsonCapBody,   contentType: 'application/json' },
    { label: 'v1-json',            url: `${GENIUSLINK_API}/v1/groups`,      body: jsonLowerBody, contentType: 'application/json' },
    { label: 'v1-add-json-cap',    url: `${GENIUSLINK_API}/v1/groups/add`,  body: jsonCapBody,   contentType: 'application/json' },
  ]

  const results = await Promise.all(attempts.map(async (a) => {
    const t0 = performance.now()
    try {
      const headers: Record<string, string> = { ...authHeaders(creds) }
      if (a.contentType) headers['Content-Type'] = a.contentType
      const res = await fetch(a.url, {
        method: 'POST',
        headers,
        body: a.body,
        signal: AbortSignal.timeout(6000),
      })
      const text = await res.text().catch(() => '')
      const ms = Math.round(performance.now() - t0)
      return {
        label: a.label,
        url: a.url.replace(/\?.*$/, '') + (a.url.includes('?') ? '?…' : ''),
        contentType: a.contentType ?? '(none — query string)',
        status: res.status,
        ok: res.ok,
        bodySample: text.slice(0, 300),
        ms,
      }
    } catch (e) {
      const ms = Math.round(performance.now() - t0)
      return {
        label: a.label,
        url: a.url.replace(/\?.*$/, '') + (a.url.includes('?') ? '?…' : ''),
        contentType: a.contentType ?? '(none — query string)',
        status: 0,
        ok: false,
        bodySample: e instanceof Error ? e.message : String(e),
        ms,
      }
    }
  }))

  const winners = results.filter(r => r.ok)
  return NextResponse.json({
    triedName: name,
    winners: winners.map(w => w.label),
    summary: winners.length
      ? `${winners.length}/${results.length} endpoint shape(s) returned 2xx — see winners[]`
      : `0/${results.length} succeeded — share this report so we can pick the right shape.`,
    results,
  })
}
