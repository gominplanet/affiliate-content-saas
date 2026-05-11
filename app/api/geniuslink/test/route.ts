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

  const headers = {
    'X-Api-Key': intRow.geniuslink_api_key,
    'X-Api-Secret': intRow.geniuslink_api_secret,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  const results: Record<string, unknown> = {}

  // Try multiple endpoint variations
  const endpoints = [
    'https://api.geni.us/links',
    'https://api.geni.us/v3/links',
    'https://api.geni.us/v2/links',
    'https://api.geni.us/routing_links',
  ]

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: 'https://www.amazon.com/dp/B01EXAMPLE1', label: 'Test' }),
      })
      const body = await res.text()
      results[url] = { status: res.status, body: body.slice(0, 300) }
    } catch (err) {
      results[url] = { error: err instanceof Error ? err.message : String(err) }
    }
  }

  return NextResponse.json(results)
}
