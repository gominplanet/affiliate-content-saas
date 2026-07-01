/**
 * POST /api/brand-inquiry — public "Work with brands" inbox endpoint.
 *
 * Invoked by the discreet "Are you a brand that wants to get featured here?"
 * form the MVP WordPress plugin renders on a creator's blog. A brand's message
 * lands in the creator's MVP dashboard (no public email needed).
 *
 *   { creatorUserId, name?, company?, email?, message, hp?, sourceUrl?,
 *     origin?, ts?, sig? }
 *
 * Same guardrails as /api/newsletter/subscribe (public, unauthenticated):
 *   1. honeypot `hp` → silent 200.
 *   2. HMAC (plugin-signed creatorUserId|origin|ts) — reject verifiable fails.
 *   3. IP rate-limit (hashed) — cap submissions/hour.
 *   4. Respect the creator's toggle: only accept when brandCta.enabled &&
 *      brandCta.inbox in their blog_customizations.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyWpFormHmac } from '@/lib/wp-form-hmac'
import { EMAIL_RE, normaliseEmail, hashIp } from '@/lib/newsletter'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}
function json(body: Record<string, unknown>, init: { status?: number } = {}) {
  return NextResponse.json(body, { status: init.status ?? 200, headers: CORS_HEADERS })
}
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(req: NextRequest) {
  let p: {
    creatorUserId?: string; name?: string; company?: string; email?: string
    message?: string; hp?: string; sourceUrl?: string; origin?: string; ts?: string; sig?: string
  }
  try { p = await req.json() } catch { return json({ ok: false, error: 'Bad request.' }, { status: 400 }) }

  // 1. Honeypot — bots fill it, humans don't. Silent success.
  if (p.hp && p.hp.trim() !== '') return json({ ok: true })

  // 2. Validate the creator id + the message (the only required fields).
  const creatorUserId = (p.creatorUserId || '').trim()
  if (!creatorUserId || !/^[0-9a-f-]{36}$/i.test(creatorUserId)) {
    return json({ ok: false, error: 'This form is misconfigured. Please contact the site owner.' }, { status: 400 })
  }
  const message = (p.message || '').trim()
  if (message.length < 2 || message.length > 4000) {
    return json({ ok: false, error: 'Please add a short message.' }, { status: 400 })
  }
  const email = normaliseEmail(p.email || '')
  if (email && (!EMAIL_RE.test(email) || email.length > 320)) {
    return json({ ok: false, error: 'That email address looks off — double-check it.' }, { status: 400 })
  }

  const admin = createAdminClient()

  // 3. HMAC — same protection as the newsletter form. Verifiable fail → reject;
  //    absent/unverifiable (old plugin) → accept-but-warn.
  const hmac = await verifyWpFormHmac(admin, creatorUserId, p)
  if (hmac.valid === false) {
    console.warn('[brand-inquiry] HMAC verification failed', { creatorUserId, reason: hmac.reason, origin: p.origin })
    return json({ ok: false, error: 'This form is misconfigured or its signature expired. Refresh the page and try again.' }, { status: 400 })
  }
  if (hmac.valid === null) {
    console.warn('[brand-inquiry] accept-but-warn (HMAC unavailable)', { creatorUserId, reason: hmac.reason })
  }

  // 4. Respect the creator's toggle — only accept when they enabled the inbox.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await admin
    .from('integrations')
    .select('blog_customizations')
    .eq('user_id', creatorUserId)
    .maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const brandCta = (integ?.blog_customizations as any)?.brandCta ?? null
  if (!brandCta?.enabled || !brandCta?.inbox) {
    return json({ ok: false, error: "This creator isn't accepting messages here right now." }, { status: 404 })
  }

  // 5. Rate-limit by source IP — cap 5/hour (a naive bot flooding the inbox).
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
  const ipHash = hashIp(ip)
  if (ipHash) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (admin as any)
      .from('brand_inquiries')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', oneHourAgo)
    if ((count ?? 0) >= 5) {
      return json({ ok: false, error: 'Too many messages from this network. Try again in a bit.' }, { status: 429 })
    }
  }

  // 6. Insert.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('brand_inquiries').insert({
    owner_id: creatorUserId,
    brand_name: (p.company || '').trim().slice(0, 200) || null,
    contact_name: (p.name || '').trim().slice(0, 200) || null,
    contact_email: email || null,
    message: message.slice(0, 4000),
    source_url: (p.sourceUrl || '').slice(0, 1000) || null,
    ip_hash: ipHash,
  })
  if (error) {
    console.error('[brand-inquiry] insert failed:', error.message)
    return json({ ok: false, error: "Couldn't send your message. Please try again in a moment." }, { status: 500 })
  }

  return json({ ok: true })
}
