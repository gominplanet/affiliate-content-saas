// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/freeguide/subscribe — the one thing the free guide asks for.
//
// WHY IT IS NOT /api/newsletter/subscribe. That route exists for the
// [mvp-newsletter] shortcode on a creator's own WordPress blog, so it takes a
// creatorUserId from the form. Reusing it here would mean putting a user id in
// a public static file and inheriting rules written for somebody else's blog:
// an HMAC check that is currently accept-but-warn and would start rejecting the
// moment NEWSLETTER_REQUIRE_HMAC is turned on, and a refusal when that
// creator's newsletter is switched off. The guide is OUR page, and a flag
// flipped for a different feature must not quietly stop it collecting.
//
// THE ROW IS SAVED BEFORE THE EMAIL IS TRIED, and that ordering is the whole
// point. This page is about to take an ad campaign's worth of traffic. An
// address lost because a sending domain was not verified is an address nobody
// ever knows existed, and the failure looks exactly like nobody signing up.
// So: store, then send, and say which of those happened.
//
// IT IS NOT A GATE. The guide is free to read with no email, the ad creative
// says so in as many words, and this route exists for the people who want to
// hear when the page changes. Anything that made reading conditional on this
// would break a promise already in market.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail, isEmailConfigured } from '@/services/email'
import {
  EMAIL_RE,
  normaliseEmail,
  newToken,
  hashIp,
  confirmationEmailHtml,
} from '@/lib/newsletter'

export const runtime = 'nodejs'

/** Signups per IP per hour. Generous: a household, an office and a phone on
 *  the same carrier NAT all share one address, and turning away a real reader
 *  costs more than storing a handful of junk rows. */
const PER_IP_HOUR = 8

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, init)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    email?: string; hp?: string; sourceUrl?: string
  }

  // A BOT IS TOLD NOTHING. Honeypots only work while they look like success.
  if ((body.hp || '').trim()) return json({ ok: true, message: "You're on the list." })

  const email = normaliseEmail(body.email || '')
  if (!email || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: 'That address does not look right. Check it and try again.' }, { status: 400 })
  }

  // WHOSE LIST. Set FREEGUIDE_OWNER_USER_ID in the environment. Refusing
  // loudly beats writing rows onto whichever account happened to sort first,
  // and the sentence tells whoever is looking exactly what to do.
  const owner = (process.env.FREEGUIDE_OWNER_USER_ID || '').trim()
  if (!owner) {
    console.error('[freeguide-subscribe] FREEGUIDE_OWNER_USER_ID is not set — signup refused and NOT stored')
    return json({
      ok: false,
      error: 'Signups are not switched on yet. Nothing was saved, so please try again later.',
    }, { status: 503 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const ipHash = hashIp(ip)

  if (ipHash) {
    const since = new Date(Date.now() - 60 * 60_000).toISOString()
    const { count } = await admin.from('newsletter_subscribers')
      .select('id', { count: 'exact', head: true })
      .eq('signup_ip_hash', ipHash).gte('created_at', since)
    if ((count ?? 0) >= PER_IP_HOUR) {
      return json({ ok: false, error: 'Too many signups from this network just now. Try again in a little while.' }, { status: 429 })
    }
  }

  const { data: existing } = await admin.from('newsletter_subscribers')
    .select('id,status,confirm_token').eq('user_id', owner).eq('email', email).maybeSingle()

  // ALREADY CONFIRMED IS NOT AN ERROR, and re-sending to them would be a way
  // to make this form flood a real inbox.
  if (existing?.status === 'active') {
    return json({ ok: true, message: "You're already on the list. Nothing else to do." })
  }

  const token = newToken()
  const sourceUrl = (body.sourceUrl || '').slice(0, 500) || null

  if (existing) {
    await admin.from('newsletter_subscribers')
      .update({ status: 'pending', confirm_token: token, source: 'freeguide', source_url: sourceUrl })
      .eq('id', existing.id)
  } else {
    const { error } = await admin.from('newsletter_subscribers').insert({
      user_id: owner,
      email,
      status: 'pending',
      confirm_token: token,
      source: 'freeguide',
      source_url: sourceUrl,
      signup_ip_hash: ipHash,
    })
    if (error) {
      console.error('[freeguide-subscribe] insert failed', { said: error.message })
      return json({ ok: false, error: "That did not save. Try again in a moment." }, { status: 500 })
    }
  }

  // ── the email, and the truth about it ─────────────────────────────────────
  //
  // The address is already stored by this point. So a send that fails costs a
  // confirmation, not a lead, and the reader is told which happened rather than
  // being sent to an inbox that has nothing in it.
  if (!isEmailConfigured()) {
    console.warn('[freeguide-subscribe] stored but email is not configured', { email })
    return json({ ok: true, message: "You're on the list. Our confirmation email is not sending right now, so we will pick this up ourselves." })
  }

  // ── IT SENDS AS MVP, NOT AS THE BLOG ──────────────────────────────────────
  //
  // The first version derived the sender from this account's
  // newsletter_settings, the way the blog shortcode does. That row is
  // configured for a different product: the confirmation would have arrived
  // as "Gomin Reviews <newsletter@mail.gominreviews.com>" to somebody who had
  // just been reading a guide on mvpaffiliate.io and had never heard of that
  // domain.
  //
  // On a double opt-in that is not cosmetic. An unrecognised sender does not
  // get opened, the link never gets clicked, the row stays pending forever,
  // and the lead is lost in the one step that was supposed to secure it.
  //
  // So it uses MVP's own transactional sender, which matches the domain the
  // reader was just on. It also drops the dependency on a settings row
  // belonging to a different feature: `enabled` on that row is false today,
  // and every rule attached to it is one more way for this form to stop
  // working for reasons that have nothing to do with the guide.
  try {
    const appBase = process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io'
    const confirmUrl = `${appBase}/api/newsletter/confirm?token=${encodeURIComponent(token)}`
    const { html, text } = confirmationEmailHtml({
      brandName: 'the Amazon Influencer guide',
      confirmUrl,
      introLine: 'You asked to hear when the free Amazon Influencer guide changes. Confirm your address and we will send you the updates, and nothing else.',
    })
    await sendEmail({
      // No `from`: sendEmail falls back to EMAIL_FROM, which is the address
      // every other transactional mail in the product already sends from.
      to: email,
      subject: 'Confirm: updates to the Amazon Influencer guide',
      html,
      text,
    })
  } catch (e) {
    console.warn('[freeguide-subscribe] stored but the confirmation did not send', {
      said: e instanceof Error ? e.message : String(e),
    })
    return json({ ok: true, message: "You're on the list. The confirmation email did not go out, so we will pick this up ourselves." })
  }

  return json({ ok: true, message: 'Check your inbox and click the link to confirm.' })
}
