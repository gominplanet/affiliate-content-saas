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
  const basicAuth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')

  const authHeaders = {
    'X-Api-Key': apiKey,
    'X-Api-Secret': apiSecret,
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (compatible; MVP-Affiliate/1.0)',
  }

  const authHeadersBasic = {
    Authorization: `Basic ${basicAuth}`,
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (compatible; MVP-Affiliate/1.0)',
  }

  const postHeaders = { ...authHeaders, 'Content-Type': 'application/json' }
  const postHeadersBasic = { ...authHeadersBasic, 'Content-Type': 'application/json' }

  const results: Record<string, unknown> = {}

  // ── 1. Fetch the full root HTML to find the Swagger spec URL
  try {
    const res = await fetch('https://api.geni.us/', { headers: authHeaders })
    const html = await res.text()
    // Extract spec URL from Swagger UI JS config
    const specMatch = html.match(/url\s*:\s*["']([^"']+\.json[^"']*)["']/i)
      || html.match(/url\s*:\s*["']([^"']+api-docs[^"']*)["']/i)
      || html.match(/url\s*:\s*["']([^"']+swagger[^"']*)["']/i)
      || html.match(/"url"\s*:\s*"([^"]+)"/i)
    results['root_spec_url'] = specMatch ? specMatch[1] : 'NOT FOUND IN HTML'
    results['root_html_snippet'] = html.slice(html.indexOf('<script'), html.indexOf('<script') + 2000)
  } catch (err) {
    results['root'] = { error: err instanceof Error ? err.message : String(err) }
  }

  // ── 2. Try common Swagger spec JSON URLs
  const specUrls = [
    'https://api.geni.us/api-docs',
    'https://api.geni.us/api-docs.json',
    'https://api.geni.us/swagger.json',
    'https://api.geni.us/swagger/v3/swagger.json',
    'https://api.geni.us/v3/api-docs',
    'https://api.geni.us/api/v3/swagger.json',
  ]
  for (const url of specUrls) {
    try {
      const res = await fetch(url, { headers: authHeaders })
      const body = await res.text()
      results[`SPEC ${url}`] = { status: res.status, body: body.slice(0, 400) }
    } catch (err) {
      results[`SPEC ${url}`] = { error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ── 3. GET endpoints with auth (these had the getHeaders bug before — fixed now)
  const getEndpoints = [
    'https://api.geni.us/v3/routing_links',
    'https://api.geni.us/routing_links',
    'https://api.geni.us/v3/links',
    'https://api.geni.us/links',
    'https://api.geni.us/v3/smart_links',
    'https://api.geni.us/v3/channels',
    'https://api.geni.us/v3/groups',
  ]
  for (const url of getEndpoints) {
    try {
      const res = await fetch(url, { headers: authHeaders })
      const body = await res.text()
      results[`GET ${url}`] = { status: res.status, body: body.slice(0, 300) }
    } catch (err) {
      results[`GET ${url}`] = { error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ── 4. POST routing_links with both auth styles
  const postBody = JSON.stringify({ url: 'https://www.amazon.com/dp/B08N5WRWNW', label: 'Test' })
  const postBodyAlt = JSON.stringify({ destination_url: 'https://www.amazon.com/dp/B08N5WRWNW', label: 'Test' })

  const postTests: Array<{ url: string; headers: Record<string, string>; body: string; label: string }> = [
    { url: 'https://api.geni.us/v3/routing_links', headers: postHeaders, body: postBody, label: 'X-Api headers' },
    { url: 'https://api.geni.us/v3/routing_links', headers: postHeadersBasic, body: postBody, label: 'Basic auth' },
    { url: 'https://api.geni.us/v3/routing_links', headers: postHeaders, body: postBodyAlt, label: 'X-Api headers + destination_url' },
  ]
  for (const t of postTests) {
    try {
      const res = await fetch(t.url, { method: 'POST', headers: t.headers, body: t.body })
      const resBody = await res.text()
      results[`POST routing_links [${t.label}]`] = { status: res.status, body: resBody.slice(0, 300) }
    } catch (err) {
      results[`POST routing_links [${t.label}]`] = { error: err instanceof Error ? err.message : String(err) }
    }
  }

  return NextResponse.json(results)
}
