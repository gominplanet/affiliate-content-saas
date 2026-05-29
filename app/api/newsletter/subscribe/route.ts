/**
 * POST /api/newsletter/subscribe — public-facing signup endpoint
 *
 * Invoked by the [mvp-newsletter] shortcode the MVP WordPress plugin renders
 * on the creator's blog. The request shape is deliberately minimal so the
 * shortcode form stays simple and stateless:
 *
 *   {
 *     creatorUserId: string  // baked into the shortcode at render-time
 *     email: string          // raw user input
 *     hp?: string            // honeypot — bots fill it, humans don't
 *     sourceUrl?: string     // page they signed up on (analytics)
 *   }
 *
 * Behaviour:
 *   1. Honeypot present → silently 200 (don't tell the bot it failed).
 *   2. Bad email → 400 with a short, plain-English message the form can render.
 *   3. Already 'active' → 200 with a friendly "you're already on the list" —
 *      no error, no resend (which would let abusers flood real inboxes).
 *   4. Already 'pending' → re-send the confirmation (token rotated) so users
 *      who lost the first email can finish signing up.
 *   5. Creator at their tier's subscriber cap → 503 with an upgrade nudge
 *      that the WP form turns into "this newsletter is currently full".
 *   6. New row → status='pending', confirmation email via Resend, return 200.
 *
 * Critical security notes:
 *   * The route does NOT require auth (it's called from the public WP blog).
 *   * We dedupe by (creatorUserId, lower(email)) and rate-limit by IP-hash.
 *   * Newsletter MUST be enabled on the creator's settings row, otherwise we
 *     refuse the signup — protects creators who turned it off.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier, allowedNewsletterSubscribers } from '@/lib/tier'
import { sendEmail, isEmailConfigured } from '@/services/email'
import {
  EMAIL_RE,
  normaliseEmail,
  newToken,
  hashIp,
  deriveFromAddress,
  confirmationEmailHtml,
} from '@/lib/newsletter'

// Open CORS for the WP blog — the form is on the creator's domain, the API
// is on mvpaffiliate.io, so the browser sends a preflight. We don't accept
// credentials, so '*' is safe (and avoids per-creator allowlists).
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
  let payload: { creatorUserId?: string; email?: string; hp?: string; sourceUrl?: string }
  try { payload = await req.json() } catch { return json({ ok: false, error: 'Bad request.' }, { status: 400 }) }

  // ── 1. Honeypot ────────────────────────────────────────────────────────────
  // The form ships with a hidden field named "hp" — humans never fill it,
  // bots always do. Silently 200 so the bot's success metric goes up and it
  // doesn't try harder. No DB hit, no email sent.
  if (payload.hp && payload.hp.trim() !== '') {
    return json({ ok: true })
  }

  // ── 2. Input validation ────────────────────────────────────────────────────
  const creatorUserId = (payload.creatorUserId || '').trim()
  if (!creatorUserId || !/^[0-9a-f-]{36}$/i.test(creatorUserId)) {
    return json({ ok: false, error: 'This newsletter form is misconfigured. Please contact the site owner.' }, { status: 400 })
  }
  const email = normaliseEmail(payload.email || '')
  if (!email || !EMAIL_RE.test(email) || email.length > 320) {
    return json({ ok: false, error: 'Please enter a valid email address.' }, { status: 400 })
  }

  // ── 3. Load the creator's settings + tier ─────────────────────────────────
  // Service-role bypasses RLS because the WP form caller is unauthenticated
  // — but we scope every query to the creatorUserId from the form, which the
  // shortcode signed at render-time (TODO milestone 1.5: HMAC the form
  // payload so a scraper can't repoint creatorUserId at another account).
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settings } = await (admin as any)
    .from('newsletter_settings')
    .select('user_id,enabled,sender_domain,sender_local_part,sender_name,domain_status')
    .eq('user_id', creatorUserId)
    .maybeSingle()
  if (!settings || !settings.enabled) {
    return json({ ok: false, error: "This newsletter isn't accepting signups right now." }, { status: 404 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await (admin as any)
    .from('integrations')
    .select('tier')
    .eq('user_id', creatorUserId)
    .maybeSingle()
  const tier = normalizeTier(integ?.tier as string | undefined)

  // ── 4. Cap check (count active + pending — both consume the cap) ──────────
  // Pending counts because spammers could flood pendings to push real
  // signups past the cap. A row only "frees" the cap if it's unsubscribed
  // or hard-bounced (deletable later).
  const cap = allowedNewsletterSubscribers(tier)
  if (cap !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (admin as any)
      .from('newsletter_subscribers')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', creatorUserId)
      .in('status', ['pending', 'active'])
    if ((count ?? 0) >= cap) {
      return json({ ok: false, error: 'This newsletter is currently full. Please try again later.' }, { status: 503 })
    }
  }

  // ── 4.5. Rate-limit by source IP ──────────────────────────────────────────
  // Without this, a scraper can mass-create pending rows against a creator's
  // list (every pending burns a slot toward the cap) until the cap-hit error
  // locks out real signups. 5 signups/hour from one IP is generous for a
  // family + a coffee shop NAT but cheap to enforce thanks to the partial
  // index in migration 080.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
  if (ip) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count: recent } = await (admin as any)
      .from('newsletter_subscribers')
      .select('id', { count: 'exact', head: true })
      .eq('signup_ip_hash', hashIp(ip))
      .gte('created_at', oneHourAgo)
    if ((recent ?? 0) >= 5) {
      return json({ ok: false, error: 'Too many signups from this network. Try again in a bit.' }, { status: 429 })
    }
  }

  // ── 5. Lookup existing row ────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (admin as any)
    .from('newsletter_subscribers')
    .select('id,status,confirm_token')
    .eq('user_id', creatorUserId)
    .eq('email', email)
    .maybeSingle()

  // Already an active subscriber — friendly confirm, no re-send (so abusers
  // can't use this endpoint to mailbomb a real inbox by re-submitting).
  if (existing?.status === 'active') {
    return json({ ok: true, alreadySubscribed: true })
  }

  // Existing unsubscribed row: re-open as 'pending' so the user can rejoin.
  // Bounced rows: leave alone — the email's permanently broken.
  if (existing?.status === 'bounced') {
    return json({ ok: false, error: "We can't deliver to that address." }, { status: 400 })
  }

  // ip is captured above in step 4.5 for the rate-limit check.
  const sourceUrl = (payload.sourceUrl || '').slice(0, 1000) || null
  const token = newToken()

  if (existing) {
    // Pending or unsubscribed → reset token + re-send confirmation.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from('newsletter_subscribers')
      .update({
        status: 'pending',
        confirm_token: token,
        confirmed_at: null,
        unsubscribed_at: null,
        signup_ip_hash: hashIp(ip),
        source: 'blog_form',
        source_url: sourceUrl,
      })
      .eq('id', existing.id)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insertErr } = await (admin as any)
      .from('newsletter_subscribers')
      .insert({
        user_id: creatorUserId,
        email,
        status: 'pending',
        confirm_token: token,
        source: 'blog_form',
        source_url: sourceUrl,
        signup_ip_hash: hashIp(ip),
      })
    if (insertErr) {
      return json({ ok: false, error: "Couldn't save your signup. Please try again in a moment." }, { status: 500 })
    }
  }

  // ── 6. Send the confirmation email ────────────────────────────────────────
  // If Resend isn't configured (local dev with no key) we STILL return 200 —
  // the row exists and the next attempt will resend. Better than a 500.
  if (isEmailConfigured()) {
    const appBase = process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io'
    const confirmUrl = `${appBase}/api/newsletter/confirm?token=${encodeURIComponent(token)}`
    const from = deriveFromAddress({
      senderDomain: settings.sender_domain as string | null,
      senderLocalPart: settings.sender_local_part as string | null,
      senderName: settings.sender_name as string | null,
      domainStatus: settings.domain_status as string | null,
    })
    if (from) {
      const { html, text } = confirmationEmailHtml({
        brandName: (settings.sender_name as string) || 'this newsletter',
        confirmUrl,
      })
      try {
        await sendEmail({
          to: email,
          from,
          subject: `Confirm your subscription to ${(settings.sender_name as string) || 'the newsletter'}`,
          html,
          text,
        })
      } catch (err) {
        // Don't 500 the user — the row's saved, they can re-submit and we'll
        // resend. Log so we can see it in Vercel logs.
        console.warn('[newsletter/subscribe] confirmation send failed:', err instanceof Error ? err.message : err)
      }
    }
  }

  return json({ ok: true, confirmationSent: true })
}
