// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/admin/broadcast — admin-only. Email your MVP users at once.
//
//   { action: 'count',  audience }                → { count, total }
//   { action: 'test',   audience, subject, body, testTo? } → sends ONE test
//   { action: 'send',   audience, subject, body }  → sends to the whole segment
//
// Recipients come from auth.users (paginated) joined to integrations.tier.
// Audience segments:
//   all     → every non-admin user
//   trial   → tier 'trial' (or no integrations row)
//   paid    → creator | studio | pro
//   creator | studio | pro → that exact tier
// Anyone with integrations.marketing_opt_out = true is always excluded, and
// every email carries a one-click List-Unsubscribe that sets that flag.
//
// Sends go out in paced chunks (proven newsletter pattern) so we stay under
// Vercel's maxDuration and don't trip Resend's rate limit. The operator
// clicks send in the /admin/broadcast UI — nothing sends automatically.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail, isEmailConfigured } from '@/services/email'
import { signUnsub } from '@/lib/broadcast-token'
import { renderBroadcastHtml, renderBroadcastText } from '@/lib/broadcast-email'

export const maxDuration = 300

const APP_BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io'
type Audience = 'all' | 'trial' | 'paid' | 'creator' | 'studio' | 'pro'
const PAID = new Set(['creator', 'studio', 'pro'])

// Send in chunks with a short breather between them — keeps concurrency and
// throughput inside Resend's limits.
const CHUNK = 40
const PAUSE_MS = 900

type Recipient = { id: string; email: string }

/** Walk auth.users + integrations, return de-duped recipients for a segment. */
async function resolveRecipients(
  admin: ReturnType<typeof createAdminClient>,
  audience: Audience,
): Promise<Recipient[]> {
  // Tier + opt-out per user id (one query, whole table is small at our scale).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (admin as any)
    .from('integrations')
    .select('user_id,tier,marketing_opt_out')
  const meta = new Map<string, { tier: string; optOut: boolean }>()
  for (const r of (rows ?? []) as { user_id: string; tier: string | null; marketing_opt_out: boolean | null }[]) {
    if (r.user_id) meta.set(r.user_id, { tier: (r.tier || 'trial'), optOut: !!r.marketing_opt_out })
  }

  const wants = (tier: string): boolean => {
    if (tier === 'admin') return false // never blast staff/self accounts
    switch (audience) {
      case 'all': return true
      case 'trial': return tier === 'trial'
      case 'paid': return PAID.has(tier)
      default: return tier === audience
    }
  }

  const out: Recipient[] = []
  const seen = new Set<string>()
  const PAGE_SIZE = 1000
  const MAX_PAGES = 50 // 50k users — well past current scale
  for (let page = 1; page <= MAX_PAGES; page++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: list, error } = await (admin.auth.admin as any).listUsers({ page, perPage: PAGE_SIZE })
    if (error) throw new Error(error.message)
    const users = list?.users ?? []
    for (const u of users) {
      const email = (u.email ?? '').trim().toLowerCase()
      if (!email || seen.has(email)) continue
      const m = meta.get(u.id)
      if (m?.optOut) continue
      const tier = m?.tier ?? 'trial' // no integrations row → treat as trial
      if (!wants(tier)) continue
      seen.add(email)
      out.push({ id: u.id, email: u.email as string })
    }
    if (users.length < PAGE_SIZE) break
  }
  return out
}

function buildEmail(subject: string, body: string, userId: string, broadcastId?: string) {
  const unsubscribeUrl = `${APP_BASE}/api/email/unsubscribe?token=${encodeURIComponent(signUnsub(userId))}`
  return {
    subject,
    html: renderBroadcastHtml({ subject, bodyText: body, unsubscribeUrl }),
    text: renderBroadcastText(body, unsubscribeUrl),
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    // Tags come back on Resend's webhook events so we can attribute each
    // open/click/bounce to this blast + recipient (send-history log).
    tags: [
      { name: 'kind', value: 'broadcast' },
      { name: 'user_id', value: userId },
      ...(broadcastId ? [{ name: 'broadcast_id', value: broadcastId }] : []),
    ],
  }
}

const sleep = (ms: number) => new Promise<void>(res => { setTimeout(res, ms) })

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: caller } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    if (caller?.tier !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({})) as {
      action?: 'count' | 'test' | 'send' | 'log'
      audience?: string
      subject?: string
      body?: string
      testTo?: string
    }
    const action = body.action ?? 'count'
    const audience = (['all', 'trial', 'paid', 'creator', 'studio', 'pro'].includes(body.audience || '')
      ? body.audience : 'all') as Audience
    const admin = createAdminClient()

    if (action === 'count') {
      const recipients = await resolveRecipients(admin, audience)
      return NextResponse.json({ ok: true, count: recipients.length })
    }

    // Send-history log — recent blasts + unique engagement from webhook events.
    if (action === 'log') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rows } = await (admin as any)
        .from('admin_broadcasts')
        .select('id,created_at,subject,audience,total,sent,failed')
        .order('created_at', { ascending: false }).limit(25)
      const list = (rows ?? []) as Array<{
        id: string; created_at: string; subject: string; audience: string
        total: number; sent: number; failed: number
      }>
      const ids = list.map(r => r.id)
      const tally: Record<string, Record<string, number>> = {}
      if (ids.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: evts } = await (admin as any)
          .from('admin_broadcast_events').select('broadcast_id,event_type').in('broadcast_id', ids)
        for (const e of (evts ?? []) as { broadcast_id: string; event_type: string }[]) {
          (tally[e.broadcast_id] ??= {})[e.event_type] = (tally[e.broadcast_id]?.[e.event_type] || 0) + 1
        }
      }
      const broadcasts = list.map(r => ({
        id: r.id, createdAt: r.created_at, subject: r.subject, audience: r.audience,
        total: r.total, sent: r.sent, failed: r.failed,
        delivered: tally[r.id]?.delivered || 0,
        opened: tally[r.id]?.opened || 0,
        clicked: tally[r.id]?.clicked || 0,
        bounced: (tally[r.id]?.bounced || 0) + (tally[r.id]?.complained || 0),
      }))
      return NextResponse.json({ ok: true, broadcasts })
    }

    if (!isEmailConfigured()) {
      return NextResponse.json({ error: 'Email is not configured (RESEND_API_KEY missing).' }, { status: 503 })
    }
    const subject = (body.subject || '').trim()
    const text = (body.body || '').trim()
    if (!subject || !text) {
      return NextResponse.json({ error: 'Subject and body are both required.' }, { status: 400 })
    }
    // Replies should reach the operator, not the noreply mailbox.
    const replyTo = user.email || undefined

    // TEST — one email to the given address (defaults to the admin's own).
    if (action === 'test') {
      const to = (body.testTo || user.email || '').trim()
      if (!to) return NextResponse.json({ error: 'No test address.' }, { status: 400 })
      const email = buildEmail(subject, text, user.id) // sign with admin id → real, working unsub
      await sendEmail({ to, replyTo, ...email })
      return NextResponse.json({ ok: true, test: true, to })
    }

    // SEND — the whole segment, chunked + paced.
    const recipients = await resolveRecipients(admin, audience)
    if (!recipients.length) {
      return NextResponse.json({ error: 'That segment has no reachable recipients.' }, { status: 400 })
    }

    // Log the blast first so webhook events arriving mid-send can attribute.
    // Best-effort: if the log table isn't migrated yet, still send the emails.
    let broadcastId: string | undefined
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row } = await (admin as any)
        .from('admin_broadcasts')
        .insert({ created_by: user.id, subject, audience, total: recipients.length })
        .select('id').single()
      broadcastId = row?.id
    } catch { /* logging is optional — never block the send */ }

    let sent = 0
    let failed = 0
    for (let i = 0; i < recipients.length; i += CHUNK) {
      const chunk = recipients.slice(i, i + CHUNK)
      const results = await Promise.allSettled(
        chunk.map(r => sendEmail({ to: r.email, replyTo, ...buildEmail(subject, text, r.id, broadcastId) })),
      )
      for (const res of results) (res.status === 'fulfilled' ? sent++ : failed++)
      if (i + CHUNK < recipients.length) await sleep(PAUSE_MS)
    }

    if (broadcastId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { await (admin as any).from('admin_broadcasts').update({ sent, failed }).eq('id', broadcastId) }
      catch { /* count update optional */ }
    }

    return NextResponse.json({ ok: true, total: recipients.length, sent, failed, audience })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
