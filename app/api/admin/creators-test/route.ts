// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/admin/creators-test?asin=B0...   (admin only)
//
// One-click diagnostic for the Amazon Creators API integration: verifies the
// OAuth token exchange and a live GetItems call, and reports exactly where it
// breaks (token 415/401, GetItems 4xx, resource-string issues) with raw status
// codes + a redacted response sample — so we can confirm the spec against the
// live key without guessing. Secrets are never returned.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function tokenEndpoint(mkt: string): string {
  if (/amazon\.(co\.uk|de|fr|it|es|nl|se|pl|ie|com\.be|com\.tr)$/i.test(mkt)) return 'https://api.amazon.co.uk/auth/o2/token'
  if (/amazon\.(co\.jp|com\.au|sg|ae|sa|in|eg)$/i.test(mkt)) return 'https://api.amazon.co.jp/auth/o2/token'
  return 'https://api.amazon.com/auth/o2/token'
}

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (normalizeTier(intRow?.tier) !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const id = (process.env.AMAZON_CREATORS_CLIENT_ID || '').trim()
  const secret = (process.env.AMAZON_CREATORS_CLIENT_SECRET || '').trim()
  const partnerTag = (process.env.AMAZON_PARTNER_TAG || '').trim()
  const mkt = (process.env.AMAZON_MARKETPLACE || 'www.amazon.com').trim()
  const asin = (new URL(request.url).searchParams.get('asin') || 'B08N5WRWNW').toUpperCase()

  const report: Record<string, unknown> = {
    configured: !!(id && secret && partnerTag),
    env: { clientId: id ? `${id.slice(0, 24)}…` : null, hasSecret: !!secret, partnerTag: partnerTag || null, marketplace: mkt },
  }
  if (!report.configured) { report.next = 'Set AMAZON_CREATORS_CLIENT_ID / _SECRET / AMAZON_PARTNER_TAG in Vercel.'; return NextResponse.json(report) }

  // ── 1. Token ──
  const params = { grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: 'creatorsapi::default' }
  const tokenUrl = tokenEndpoint(mkt)
  let token = ''
  try {
    let res = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(15_000) })
    let usedForm = false
    if (res.status === 415) {
      usedForm = true
      res = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString(), signal: AbortSignal.timeout(15_000) })
    }
    const bodyText = await res.text()
    let parsed: { access_token?: string; expires_in?: number; error?: string; error_description?: string } = {}
    try { parsed = JSON.parse(bodyText) } catch { /* keep raw */ }
    token = parsed.access_token || ''
    report.token = { url: tokenUrl, status: res.status, ok: !!token, usedFormFallback: usedForm, expiresIn: parsed.expires_in ?? null, error: parsed.error ?? null, errorDescription: parsed.error_description ?? null, sample: token ? null : bodyText.slice(0, 300) }
  } catch (e) {
    report.token = { url: tokenUrl, ok: false, error: e instanceof Error ? e.message : String(e) }
    return NextResponse.json(report)
  }
  if (!token) { report.next = 'Token exchange failed — check the credential ID/secret and that the app is enabled.'; return NextResponse.json(report) }

  // ── 2. GetItems ──
  try {
    const body = { itemIds: [asin], itemIdType: 'ASIN', marketplace: mkt, partnerTag, resources: ['images.primary.large', 'itemInfo.title', 'offersV2.listings.price', 'parentASIN'] }
    const res = await fetch('https://creatorsapi.amazon/catalog/v1/getItems', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-marketplace': mkt },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    })
    const bodyText = await res.text()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any = {}
    try { parsed = JSON.parse(bodyText) } catch { /* keep raw */ }
    const item = parsed?.itemResults?.items?.[0] ?? null
    report.getItems = {
      status: res.status, ok: res.ok, asin,
      itemFound: !!item,
      imageUrl: item?.images?.primary?.large?.url ?? null,
      title: item?.itemInfo?.title?.displayValue ?? null,
      errors: parsed?.errors ?? null,
      sample: item ? null : bodyText.slice(0, 500),
    }
    report.verdict = res.ok && item?.images?.primary?.large?.url ? '✅ Working — images will populate.' : '⚠️ Token OK but GetItems/image failed — see getItems.sample/errors.'
  } catch (e) {
    report.getItems = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  return NextResponse.json(report)
}
