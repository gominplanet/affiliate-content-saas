/**
 * GET  /api/agency  → list current members + pending invites + seat info
 * POST /api/agency  → mint a new invite, body { email, role?, note? }
 *
 * Pro-gated. The list endpoint also returns the caller's seat ceiling so
 * the UI can display "2 of 3 seats used" and disable the "Invite" form
 * when the ceiling is hit.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { generateAgencyToken, maxSeatsForTier, INVITE_TTL_DAYS, DEFAULT_VA_PERMISSIONS, normalizePermissions } from '@/lib/agency'
import { sendEmail } from '@/services/email'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Caller's tier — determines the seat ceiling.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = (integ?.tier as string | undefined) ?? 'trial'
  const seatCeiling = maxSeatsForTier(tier)

  // Active members (revoked_at IS NULL) — include member email by joining
  // through auth (via the admin client in a follow-up if we want; for now
  // we just return the user_id + role and let the UI hydrate emails).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: members } = await (supabase as any)
    .from('agency_members')
    .select('id, member_user_id, role, permissions, created_at')
    .eq('owner_user_id', user.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: true })

  // Pending invites — neither accepted nor declined, not expired.
  const ttlCutoff = new Date(Date.now() - INVITE_TTL_DAYS * 86400000).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invites } = await (supabase as any)
    .from('agency_invites')
    .select('id, email, role, note, permissions, created_at')
    .eq('owner_user_id', user.id)
    .is('accepted_at', null)
    .is('declined_at', null)
    .gte('created_at', ttlCutoff)
    .order('created_at', { ascending: false })

  const used = (members?.length ?? 0) + (invites?.length ?? 0)
  // Infinity → null in JSON (so the client's typeof check is clean) +
  // a separate `seatCeilingUnbounded` boolean for the UI to render
  // "Unlimited" instead of a number. Earlier code returned
  // Number.MAX_SAFE_INTEGER which leaked "0 of 9007199254740991 seats
  // used" to admin users.
  const seatCeilingUnbounded = !Number.isFinite(seatCeiling)
  const seatsRemaining = seatCeilingUnbounded ? Number.POSITIVE_INFINITY : Math.max(0, seatCeiling - used)

  return NextResponse.json({
    tier,
    seatCeiling: seatCeilingUnbounded ? null : seatCeiling,
    seatCeilingUnbounded,
    seatsUsed: used,
    seatsRemaining: Number.isFinite(seatsRemaining) ? seatsRemaining : null,
    members: members ?? [],
    invites: invites ?? [],
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = (integ?.tier as string | undefined) ?? 'trial'
  const seatCeiling = maxSeatsForTier(tier)
  if (seatCeiling === 0) {
    return NextResponse.json({
      error: 'Agency seats require the Pro tier',
      code: 'tier_not_allowed',
    }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const email = String(body.email || '').trim().toLowerCase()
  const role = body.role === 'admin' ? 'admin' : 'member'
  const note = body.note ? String(body.note).trim().slice(0, 280) : null
  // Permissions on the invite (the VA inherits whatever was set here when
  // they accept). Body may omit it; default to DEFAULT_VA_PERMISSIONS so
  // owners who don't customise still get a sensible "content VA" preset.
  const permissions = body.permissions !== undefined
    ? normalizePermissions(body.permissions)
    : DEFAULT_VA_PERMISSIONS

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }
  if (email === (user.email || '').toLowerCase()) {
    return NextResponse.json({ error: 'You cannot invite yourself' }, { status: 400 })
  }

  // Seat-ceiling check — count current members + pending invites against
  // the cap from maxSeatsForTier.
  const ttlCutoff = new Date(Date.now() - INVITE_TTL_DAYS * 86400000).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: memberCount } = await (supabase as any)
    .from('agency_members')
    .select('*', { count: 'exact', head: true })
    .eq('owner_user_id', user.id)
    .is('revoked_at', null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: pendingCount } = await (supabase as any)
    .from('agency_invites')
    .select('*', { count: 'exact', head: true })
    .eq('owner_user_id', user.id)
    .is('accepted_at', null)
    .is('declined_at', null)
    .gte('created_at', ttlCutoff)

  const used = (memberCount ?? 0) + (pendingCount ?? 0)
  // Skip seat check entirely when ceiling is unbounded (admin tier) —
  // earlier code compared against MAX_SAFE_INTEGER which always passed
  // but tripped Infinity arithmetic if anyone refactored. Now explicit.
  if (Number.isFinite(seatCeiling) && used >= seatCeiling) {
    return NextResponse.json({
      error: `You've reached your seat ceiling (${seatCeiling}). Revoke a seat or contact support to expand.`,
      code: 'seat_limit',
    }, { status: 403 })
  }

  // Mint the token + persist hash.
  const { plaintext, hash } = generateAgencyToken()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('agency_invites')
    .insert({ owner_user_id: user.id, email, token_hash: hash, role, note, permissions })
    .select('id, email, role, note, permissions, created_at')
    .single()

  if (error || !data) {
    // Likely the unique (owner, email, declined_at) hit — give a clean
    // error so the UI can suggest revoking the existing invite first.
    return NextResponse.json({
      error: error?.message?.includes('unique')
        ? 'An invite to this email is already pending. Revoke it first to re-invite.'
        : (error?.message || 'Failed to create invite'),
    }, { status: 400 })
  }

  // Send the email. Best-effort: the invite row exists either way, and the
  // owner can re-send manually if delivery failed.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io'
  const acceptUrl = `${appUrl}/agency/accept/${plaintext}`
  // Escape every interpolated value before it touches the HTML email
  // body. user.email + role are technically safe at the API layer
  // (Supabase validates emails; role is an enum-checked literal), but
  // defence-in-depth here is cheap — a future code path that loosens
  // either input shouldn't be able to XSS the recipient.
  const ownerEmailSafe = escapeHtml(user.email || 'Someone')
  const roleSafe = escapeHtml(role)
  const subjectSafe = `${user.email || 'Someone'} invited you to their MVP Affiliate team`
  try {
    await sendEmail({
      to: email,
      subject: subjectSafe,
      html: `<p>Hi,</p>
<p>${ownerEmailSafe} invited you to join their MVP Affiliate team as a <b>${roleSafe}</b>.</p>
${note ? `<p>Personal note: <em>${escapeHtml(note)}</em></p>` : ''}
<p><a href="${acceptUrl}" style="background:#7C3AED;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">Accept invite</a></p>
<p style="color:#666;font-size:13px">Or paste this URL into your browser:<br><code style="font-size:12px">${acceptUrl}</code></p>
<p style="color:#999;font-size:12px;margin-top:24px">This invite expires in ${INVITE_TTL_DAYS} days. If you weren't expecting it, you can safely ignore this email.</p>`,
    })
  } catch (e) {
    // Don't fail the route — the invite is created, the owner can resend.
    console.warn('[agency] invite email send failed', e instanceof Error ? e.message : String(e))
  }

  return NextResponse.json({ invite: data })
}

/** Escape user-provided HTML so a malicious "note" can't inject script in
 *  the recipient's inbox. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
