import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations')
    .select('geniuslink_api_key,geniuslink_api_secret')
    .eq('user_id', user.id)
    .single()

  if (!intRow?.geniuslink_api_key) {
    return NextResponse.json({ error: 'No Geniuslink credentials saved' })
  }

  const apiKey = intRow.geniuslink_api_key as string
  const apiSecret = intRow.geniuslink_api_secret as string

  const headers = {
    'X-Api-Key': apiKey,
    'X-Api-Secret': apiSecret,
    Accept: 'application/json',
  }

  const results: Record<string, unknown> = {}

  // Step 1: get groups
  let groupId: number | null = null
  try {
    const res = await fetch('https://api.geni.us/v1/groups/list', { headers })
    const body = await res.text()
    const parsed = JSON.parse(body)
    const groups = parsed.Results ?? (Array.isArray(parsed) ? parsed : [])
    groupId = groups[0]?.Id ?? null
    results['GET /v1/groups/list'] = { status: res.status, groupId, groups: groups.slice(0, 3) }
  } catch (err) {
    results['GET /v1/groups/list'] = { error: err instanceof Error ? err.message : String(err) }
  }

  // Step 2: create link with groupId
  if (groupId) {
    const params = new URLSearchParams({
      url: 'https://www.amazon.com/dp/B08N5WRWNW',
      groupId: String(groupId),
      note: 'Test link from MVP Affiliate',
    })
    try {
      const res = await fetch(`https://api.geni.us/v3/shorturls?${params.toString()}`, {
        method: 'POST',
        headers,
      })
      const body = await res.text()
      results['POST /v3/shorturls'] = { status: res.status, body: body.slice(0, 500) }
    } catch (err) {
      results['POST /v3/shorturls'] = { error: err instanceof Error ? err.message : String(err) }
    }
  }

  return NextResponse.json(results)
}
