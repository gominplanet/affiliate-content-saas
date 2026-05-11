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

  // Show raw body for every group endpoint
  for (const path of [
    '/v1/groups/list',
    '/v1/groups/get-all-with-details',
    '/v1/groups/add?GroupName=Default&Notes=Auto-created',
  ]) {
    const method = path.includes('add') ? 'GET' : 'GET'
    try {
      const res = await fetch(`https://api.geni.us${path}`, { method, headers })
      const body = await res.text()
      results[path] = { status: res.status, raw: body.slice(0, 600) }
    } catch (err) {
      results[path] = { error: err instanceof Error ? err.message : String(err) }
    }
  }

  // Also pull a link from the list to see if GroupId is on it
  try {
    const res = await fetch('https://api.geni.us/v1/links/list', { headers })
    const body = await res.text()
    results['/v1/links/list raw'] = body.slice(0, 800)
  } catch (err) {
    results['/v1/links/list raw'] = { error: err instanceof Error ? err.message : String(err) }
  }

  // Try creating a link with no groupId at all, and with groupId=0
  for (const extra of ['', '&groupId=0', '&groupId=1']) {
    const params = `url=https://www.amazon.com/dp/B08N5WRWNW&note=Test${extra}`
    try {
      const res = await fetch(`https://api.geni.us/v3/shorturls?${params}`, { method: 'POST', headers })
      const body = await res.text()
      results[`POST /v3/shorturls${extra}`] = { status: res.status, body: body.slice(0, 400) }
    } catch (err) {
      results[`POST /v3/shorturls${extra}`] = { error: err instanceof Error ? err.message : String(err) }
    }
  }

  return NextResponse.json(results)
}
