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

  // Use the real YouTube Links group ID from the user's account
  const GROUP_ID = 352885

  const params = new URLSearchParams({
    url: 'https://www.amazon.com/dp/B08N5WRWNW',
    groupId: String(GROUP_ID),
    note: 'Test from MVP Affiliate',
  })

  const res = await fetch(`https://api.geni.us/v3/shorturls?${params}`, {
    method: 'POST',
    headers,
  })

  const text = await res.text()
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { parsed = text }

  // Also show what fields exist on the first item from links list (to find the short URL field name)
  const listRes = await fetch('https://api.geni.us/v1/links/list?take=1', { headers })
  const listText = await listRes.text()

  return NextResponse.json({
    'POST /v3/shorturls status': res.status,
    'POST /v3/shorturls full response': parsed,
    'GET /v1/links/list first item keys': Object.keys((JSON.parse(listText)?.Results?.[0] ?? {})),
  })
}
