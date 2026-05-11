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

  // The correct endpoint: POST /v3/shorturls with query params
  const params = new URLSearchParams({
    url: 'https://www.amazon.com/dp/B08N5WRWNW',
    note: 'Test link',
  })

  try {
    const res = await fetch(`https://api.geni.us/v3/shorturls?${params.toString()}`, {
      method: 'POST',
      headers,
    })
    const body = await res.text()
    results['POST /v3/shorturls (query params)'] = { status: res.status, body: body.slice(0, 500) }
  } catch (err) {
    results['POST /v3/shorturls (query params)'] = { error: err instanceof Error ? err.message : String(err) }
  }

  // Also test GET /v1/links/list to confirm auth works
  try {
    const res = await fetch('https://api.geni.us/v1/links/list', { headers })
    const body = await res.text()
    results['GET /v1/links/list'] = { status: res.status, body: body.slice(0, 300) }
  } catch (err) {
    results['GET /v1/links/list'] = { error: err instanceof Error ? err.message : String(err) }
  }

  // Also test v2 endpoint
  const v2Params = new URLSearchParams({ Url: 'https://www.amazon.com/dp/B08N5WRWNW' })
  try {
    const res = await fetch(`https://api.geni.us/v2/shorturl?${v2Params.toString()}`, {
      method: 'POST',
      headers,
    })
    const body = await res.text()
    results['POST /v2/shorturl (query params)'] = { status: res.status, body: body.slice(0, 500) }
  } catch (err) {
    results['POST /v2/shorturl (query params)'] = { error: err instanceof Error ? err.message : String(err) }
  }

  return NextResponse.json(results)
}
