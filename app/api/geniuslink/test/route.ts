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

  // Auth variants to test
  const basicAuth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')

  const authVariants = [
    {
      label: 'X-Api-Key + X-Api-Secret (current)',
      headers: {
        'X-Api-Key': apiKey,
        'X-Api-Secret': apiSecret,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; MVP-Affiliate/1.0)',
      },
    },
    {
      label: 'Authorization: Basic (apiKey:apiSecret)',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; MVP-Affiliate/1.0)',
      },
    },
    {
      label: 'Authorization: Bearer apiKey',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; MVP-Affiliate/1.0)',
      },
    },
  ]

  const results: Record<string, unknown> = {}

  // ── 1. GET root — test connectivity (no Content-Type on GET)
  for (const variant of authVariants) {
    const getHeaders = { ...variant.headers }
    delete (getHeaders as Record<string, string>)['Content-Type']
    try {
      const res = await fetch('https://api.geni.us/', { headers: getHeaders })
      const body = await res.text()
      results[`GET / [${variant.label}]`] = { status: res.status, body: body.slice(0, 300) }
    } catch (err) {
      results[`GET / [${variant.label}]`] = { error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ── 2. GET routing_links — test if resource exists (should return 401 if auth wrong, 404 if path wrong)
  const getOnlyHeaders = {
    'X-Api-Key': apiKey,
    'X-Api-Secret': apiSecret,
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (compatible; MVP-Affiliate/1.0)',
  }
  const getPaths = [
    'https://api.geni.us/v3/routing_links',
    'https://api.geni.us/routing_links',
    'https://api.geni.us/v3/links',
    'https://api.geni.us/links',
    'https://api.geni.us/v3/smart_links',
  ]
  for (const url of getPaths) {
    try {
      const res = await fetch(url, { headers: getHeaders })
      const body = await res.text()
      results[`GET ${url}`] = { status: res.status, body: body.slice(0, 300) }
    } catch (err) {
      results[`GET ${url}`] = { error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ── 3. POST routing_links — the most likely correct endpoint
  const postEndpoints = [
    { url: 'https://api.geni.us/v3/routing_links', body: { url: 'https://www.amazon.com/dp/B08N5WRWNW', label: 'Test Link' } },
    { url: 'https://api.geni.us/routing_links', body: { url: 'https://www.amazon.com/dp/B08N5WRWNW', label: 'Test Link' } },
    { url: 'https://api.geni.us/v3/routing_links', body: { destination_url: 'https://www.amazon.com/dp/B08N5WRWNW', label: 'Test Link' } },
    { url: 'https://api.geni.us/v3/links', body: { url: 'https://www.amazon.com/dp/B08N5WRWNW', label: 'Test Link' } },
    { url: 'https://api.geni.us/links', body: { url: 'https://www.amazon.com/dp/B08N5WRWNW', label: 'Test Link' } },
  ]

  for (const { url, body } of postEndpoints) {
    // Try with X-Api-Key headers
    for (const variant of authVariants.slice(0, 2)) { // test key+secret and basic auth
      const label = `POST ${url} [${variant.label}]`
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: variant.headers,
          body: JSON.stringify(body),
        })
        const resBody = await res.text()
        results[label] = { status: res.status, body: resBody.slice(0, 300) }
      } catch (err) {
        results[label] = { error: err instanceof Error ? err.message : String(err) }
      }
    }
  }

  return NextResponse.json(results, { headers: { 'Content-Type': 'application/json' } })
}
