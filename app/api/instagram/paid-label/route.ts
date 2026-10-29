// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/instagram/paid-label — the Paid partnership label card
// (lib/ig-paid-label). GET: for each connected Instagram account, whether
// MVP's posts will carry the label, why not when they will not, and what
// happened to the last posts. POST { enabled }: turns it on or off for all of
// the member's Instagram accounts.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { maybeDecrypt } from '@/lib/secrets'
import { findPaidLabelRoute, paidLabelAllowed, paidLabelWords, directRefused, entryWords, DIRECT_SWITCH_WORKS, type PaidLabelEntry } from '@/lib/ig-paid-label'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

async function signedIn() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient() as Sb
  const { data: integ } = await admin.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  return { user, admin, tier: (integ?.tier as string | null) ?? null }
}

export async function GET() {
  const me = await signedIn()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!paidLabelAllowed(me.tier)) return NextResponse.json({ allowed: false })
  const { data: rows } = await me.admin.from('social_accounts').select('id,external_id,display_name,access_token,extra').eq('user_id', me.user.id).eq('platform', 'instagram')
  const list = (rows ?? []) as { id: string; external_id: string; display_name: string | null; access_token: string | null; extra: Record<string, unknown> | null }[]
  const enabled = !list.some((r) => r.extra?.paid_label_off === true)
  const accounts = await Promise.all(list.map(async (r) => {
    const token = maybeDecrypt(r.access_token) || ''
    let ready = false, why: string | null = null, page: string | null = null, checked: string[] = []
    if (!token) why = 'This Instagram account needs reconnecting in MVP.'
    else if (DIRECT_SWITCH_WORKS && !directRefused(r.extra)) {
      // The simple way: the switch goes on the usual post.
      ready = true
    } else {
      checked = DIRECT_SWITCH_WORKS
        ? [`Instagram did not take the label switch on a direct post: ${String(r.extra?.paid_label_direct_refused_why ?? 'no reason given').slice(0, 200)}. MVP tries again after a week, and meanwhile posts through a linked Facebook Page when there is one.`]
        : ['Instagram only shows the label when MVP posts through the Facebook Page this Instagram account is linked to.']
      try {
        const found = await findPaidLabelRoute(r.external_id, token)
        checked = [...checked, ...(found.checked ?? [])]
        if (found.route) { ready = true; page = found.route.pageName }
        else why = paidLabelWords(found.why)
      } catch (e) { why = `MVP could not check this account (${e instanceof Error ? e.message : 'no answer'}).` }
    }
    const log = (Array.isArray(r.extra?.paid_label_log) ? r.extra?.paid_label_log : []) as PaidLabelEntry[]
    return {
      username: r.display_name,
      ready,
      page,
      why,
      checked,
      recent: log.slice(0, 5).map((e) => ({ at: e.at, on: e.on, kind: e.kind ?? null, words: entryWords(e) ?? (e.on ? `Posted with the label switched on.${e.detail ? ` ${e.detail}` : ''}` : `Posted without the label. ${paidLabelWords(e.why ?? 'refused', e.detail)}`) })),
    }
  }))
  return NextResponse.json({ allowed: true, enabled, accounts })
}

export async function POST(request: Request) {
  const me = await signedIn()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!paidLabelAllowed(me.tier)) return NextResponse.json({ error: 'The label is not open to your account yet.' }, { status: 403 })
  const body = await request.json().catch(() => ({})) as { enabled?: boolean }
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'Say whether to turn it on or off.' }, { status: 400 })
  const { data: rows } = await me.admin.from('social_accounts').select('id,extra').eq('user_id', me.user.id).eq('platform', 'instagram')
  let saved = 0
  for (const r of (rows ?? []) as { id: string; extra: Record<string, unknown> | null }[]) {
    const { error } = await me.admin.from('social_accounts').update({ extra: { ...(r.extra ?? {}), paid_label_off: !body.enabled } }).eq('id', r.id)
    if (!error) saved++
  }
  if (!saved) return NextResponse.json({ error: 'No Instagram account is connected, so there was nothing to change.' }, { status: 400 })
  return NextResponse.json({ ok: true, enabled: body.enabled })
}
