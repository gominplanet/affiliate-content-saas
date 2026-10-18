// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/admin/refunds: the 7-day refund, once per creator (Seb, 2026-10-18).
//
// GET   recent Pro members (joined in the last 14 days), or one by ?email=,
//       each with the refund check: which day of the window, and whether an
//       earlier refund matches them on email, card, YouTube channel, Amazon
//       tag or storefront (lib/creator-refund).
// POST  { userId, force? } refunds the first payment through Stripe, cancels
//       the subscription now and records the refund. Refused when the check
//       says no, unless force is set from the second confirm on the page.
//
// Every step's result is reported on its own: a refund that went through with
// a cancel that failed must not read as both done.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe'
import {
  normalizeEmail, normalizeTag, normalizeStorefront, priorRefunds, refundCheck,
  type CreatorIds, type RefundRow,
} from '@/lib/creator-refund'

export const runtime = 'nodejs'
export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

const NEEDS_SQL = 'Refunds need migration 439 in the database first.'
const missing = (m?: string) => /creator_refunds|subscribed_at/.test(m || '') && /does not exist|could not find|schema cache/i.test(m || '')

async function requireAdmin(): Promise<{ error: NextResponse } | { userId: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') return { error: NextResponse.json({ error: 'Admin only' }, { status: 403 }) }
  return { userId: user.id }
}

interface Member {
  user_id: string
  tier: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  subscription_status: string | null
  subscribed_at?: string | null
  youtube_channel_id?: string | null
  amazon_associates_tag?: string | null
  created_at?: string | null
}

/** The payment the refund would return: the newest charge that went through
 *  and is not already refunded, with the card's fingerprint. */
async function firstPayment(customerId: string | null) {
  if (!customerId) return null
  const stripe = getStripe()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list: any = await stripe.charges.list({ customer: customerId, limit: 10 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paid = (list.data as any[]).filter((c) => c.status === 'succeeded' && c.paid)
  if (!paid.length) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const open = paid.find((c: any) => !c.refunded && (c.amount_refunded ?? 0) < c.amount) ?? null
  const oldest = paid[paid.length - 1]
  return {
    chargeId: open?.id as string | undefined,
    amountCents: (open?.amount ?? 0) as number,
    fullyRefunded: !open,
    paidAt: new Date((oldest.created as number) * 1000).toISOString(),
    card: (open ?? oldest)?.payment_method_details?.card?.fingerprint as string | undefined ?? null,
  }
}

async function checkMember(admin: Sb, m: Member, ledger: RefundRow[]) {
  const { data: auth } = await admin.auth.admin.getUserById(m.user_id)
  const email = auth?.user?.email ?? null
  const { data: bp } = await admin.from('brand_profiles').select('amazon_storefront_url').eq('user_id', m.user_id).maybeSingle()
  let pay: Awaited<ReturnType<typeof firstPayment>> = null
  let stripeError: string | null = null
  try { pay = await firstPayment(m.stripe_customer_id) } catch (e) { stripeError = e instanceof Error ? e.message : 'Stripe did not answer' }
  const ids: CreatorIds = {
    email: normalizeEmail(email),
    card: pay?.card ?? null,
    channel: m.youtube_channel_id || null,
    tag: normalizeTag(m.amazon_associates_tag),
    storefront: normalizeStorefront(bp?.amazon_storefront_url),
  }
  const matches = priorRefunds(m.user_id, ids, ledger)
  const alreadyRefunded = ledger.some((r) => r.user_id === m.user_id) || !!pay?.fullyRefunded
  const check = refundCheck({ paidAtISO: pay?.paidAt ?? m.subscribed_at ?? null, alreadyRefunded, matches })
  return {
    userId: m.user_id, email, tier: m.tier, status: m.subscription_status,
    subscribedAt: m.subscribed_at ?? null, paidAt: pay?.paidAt ?? null,
    amount: pay ? pay.amountCents / 100 : null, chargeId: pay?.chargeId ?? null,
    ids, matches: matches.map((x) => ({ email: x.row.email_norm, refundedAt: x.row.refunded_at, on: x.on })),
    stripeError, ...check,
  }
}

async function readLedger(admin: Sb): Promise<{ rows: RefundRow[]; need: string | null }> {
  const { data, error } = await admin.from('creator_refunds').select('user_id,email_norm,card_fingerprint,youtube_channel_id,amazon_tag,storefront,refunded_at').limit(5000)
  if (error) return { rows: [], need: missing(error.message) ? NEEDS_SQL : error.message }
  return { rows: (data ?? []) as RefundRow[], need: null }
}

export async function GET(req: Request) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const admin = createAdminClient() as Sb
  const ledger = await readLedger(admin)
  const email = (new URL(req.url).searchParams.get('email') || '').trim().toLowerCase()

  let members: Member[] = []
  if (email) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }) as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const found = (list?.users ?? []).filter((u: any) => normalizeEmail(u.email) === normalizeEmail(email))
    if (!found.length) return NextResponse.json({ ok: true, members: [], need: ledger.need, note: `No account with ${email}.` })
    const { data } = await admin.from('integrations').select('*').in('user_id', found.map((u: { id: string }) => u.id))
    members = (data ?? []) as Member[]
  } else {
    // Joined in the last 14 days: the window is 7, and a week after it closes
    // the row is still worth seeing when somebody writes in late.
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await admin.from('integrations').select('*').eq('tier', 'pro').gte('subscribed_at', since)
      .order('subscribed_at', { ascending: false }).limit(30)
    if (error) return NextResponse.json({ ok: true, members: [], need: missing(error.message) ? NEEDS_SQL : error.message })
    members = (data ?? []) as Member[]
  }
  const out = []
  for (const m of members) out.push(await checkMember(admin, m, ledger.rows))
  return NextResponse.json({ ok: true, members: out, need: ledger.need })
}

export async function POST(req: Request) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const body = await req.json().catch(() => ({})) as { userId?: string; force?: boolean }
  const userId = String(body.userId || '')
  if (!userId) return NextResponse.json({ error: 'No member.' }, { status: 400 })
  const admin = createAdminClient() as Sb
  const ledger = await readLedger(admin)
  if (ledger.need) return NextResponse.json({ error: ledger.need }, { status: 503 })
  const { data: m } = await admin.from('integrations').select('*').eq('user_id', userId).maybeSingle()
  if (!m) return NextResponse.json({ error: 'That member was not found.' }, { status: 404 })
  const c = await checkMember(admin, m as Member, ledger.rows)
  if (!c.chargeId) return NextResponse.json({ error: c.stripeError || 'No payment on this account is left to refund.' }, { status: 409 })
  if (!c.eligible && body.force !== true) return NextResponse.json({ error: c.reason, check: c }, { status: 409 })

  const stripe = getStripe()
  // 1. The money back. Nothing after this runs if it fails.
  let refundId: string
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const refund: any = await stripe.refunds.create({ charge: c.chargeId })
    refundId = refund.id
  } catch (e) {
    return NextResponse.json({ error: `Stripe did not refund it: ${e instanceof Error ? e.message : 'no answer'}` }, { status: 502 })
  }
  // 2. Cancel now, so nothing renews. Said separately if it fails.
  let cancelled = false
  let cancelError: string | null = null
  if ((m as Member).stripe_subscription_id) {
    try { await stripe.subscriptions.cancel((m as Member).stripe_subscription_id as string); cancelled = true } catch (e) {
      cancelError = e instanceof Error ? e.message : 'Stripe did not cancel it'
    }
  } else cancelError = 'No subscription on file to cancel.'
  // 3. Remember it, so the refund is not given twice.
  const { error: lErr } = await admin.from('creator_refunds').insert({
    user_id: userId, email_norm: c.ids.email, card_fingerprint: c.ids.card, youtube_channel_id: c.ids.channel,
    amazon_tag: c.ids.tag, storefront: c.ids.storefront, stripe_customer_id: (m as Member).stripe_customer_id,
    stripe_subscription_id: (m as Member).stripe_subscription_id, stripe_refund_id: refundId,
    amount_cents: Math.round((c.amount ?? 0) * 100), refunded_by: gate.userId,
    note: c.eligible ? null : `Given anyway: ${c.reason}`,
  })
  return NextResponse.json({
    ok: true, refunded: c.amount, refundId, cancelled, cancelError,
    recorded: !lErr, recordError: lErr ? lErr.message : null,
  })
}
