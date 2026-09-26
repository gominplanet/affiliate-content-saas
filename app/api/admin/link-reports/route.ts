// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/admin/link-reports — reports about mvpl.ink links, and the switch.
//
// GET  the reports, open first, each with the link it names: where it goes,
//      whether it is live, who made it and how many links that account has.
// POST { action, code?, id? }
//        disable_link           switch one link off (passport_links.disabled)
//        enable_link            switch it back on
//        dismiss                the report is wrong, the link stays live
//        disable_account_links  switch off every link the account has made
//
// The link policy on mvpl.ink promises every report is reviewed and a bad link
// is switched off. This is where that happens, and the answer reports what the
// database actually did: a switch that changed no row says so.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { describeLinkTarget } from '@/lib/link-trust'

export const dynamic = 'force-dynamic'

async function adminUser() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: caller } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((caller as any)?.tier !== 'admin') return { error: NextResponse.json({ error: 'Admin only' }, { status: 403 }) }
  return { user }
}

const missingTable = (msg: string) => /link_reports/.test(msg) && /does not exist|schema cache|not find/i.test(msg)

export async function GET() {
  const gate = await adminUser()
  if (gate.error) return gate.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: reports, error } = await admin.from('link_reports').select('*').order('created_at', { ascending: false }).limit(300)
  if (error) {
    if (missingTable(error.message)) return NextResponse.json({ reports: [], missingTable: true })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const rows = (reports ?? []) as Array<Record<string, unknown>>
  const codes = [...new Set(rows.map((r) => String(r.code)))]
  const { data: links } = codes.length
    ? await admin.from('passport_links').select('*').in('code', codes)
    : { data: [] }
  const byCode = new Map<string, Record<string, unknown>>(((links ?? []) as Array<Record<string, unknown>>).map((l) => [String(l.code), l]))

  const owners = [...new Set(((links ?? []) as Array<Record<string, unknown>>).map((l) => String(l.user_id)))]
  const emails = new Map<string, string>()
  const linkCounts = new Map<string, { total: number; off: number }>()
  for (const id of owners.slice(0, 50)) {
    try {
      const { data } = await admin.auth.admin.getUserById(id)
      if (data?.user?.email) emails.set(id, data.user.email)
    } catch { /* email is a nicety */ }
    const [{ count: total }, { count: off }] = await Promise.all([
      admin.from('passport_links').select('code', { count: 'exact', head: true }).eq('user_id', id),
      admin.from('passport_links').select('code', { count: 'exact', head: true }).eq('user_id', id).eq('disabled', true),
    ])
    linkCounts.set(id, { total: total ?? 0, off: off ?? 0 })
  }

  const out = rows.map((r) => {
    const l = byCode.get(String(r.code)) ?? null
    const owner = l ? String(l.user_id) : null
    return {
      id: r.id, code: r.code, reason: r.reason, details: r.details, reporterEmail: r.reporter_email,
      state: r.state, createdAt: r.created_at, handledAt: r.handled_at,
      link: l ? {
        exists: true, live: l.disabled !== true, target: describeLinkTarget(l as { asin?: string; destination_url?: string; label?: string }),
        ownerId: owner, ownerEmail: owner ? emails.get(owner) ?? null : null,
        ownerLinks: owner ? linkCounts.get(owner) ?? null : null,
      } : { exists: false },
    }
  })
  // Open first, then newest.
  out.sort((a, b) => (a.state === 'open' ? 0 : 1) - (b.state === 'open' ? 0 : 1))
  return NextResponse.json({ reports: out, open: out.filter((r) => r.state === 'open').length })
}

export async function POST(req: Request) {
  const gate = await adminUser()
  if (gate.error) return gate.error
  const body = await req.json().catch(() => ({})) as { action?: string; code?: string; id?: string }
  const code = String(body.code ?? '')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const at = new Date().toISOString()
  const mark = (state: string) => admin.from('link_reports').update({ state, handled_at: at, handled_by: gate.user.id }).eq('code', code).eq('state', 'open')

  if (body.action === 'dismiss') {
    if (!body.id) return NextResponse.json({ error: 'Which report?' }, { status: 400 })
    const { data, error } = await admin.from('link_reports').update({ state: 'dismissed', handled_at: at, handled_by: gate.user.id }).eq('id', body.id).select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: (data ?? []).length === 1, changed: (data ?? []).length })
  }

  if (!/^[A-Za-z0-9]{4,16}$/.test(code)) return NextResponse.json({ error: 'That is not a link code.' }, { status: 400 })

  if (body.action === 'disable_link' || body.action === 'enable_link') {
    const off = body.action === 'disable_link'
    const { data, error } = await admin.from('passport_links').update({ disabled: off }).eq('code', code).select('code,disabled')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const changed = (data ?? []).length
    if (changed === 0) return NextResponse.json({ ok: false, error: 'No link has this code, so nothing was switched.' }, { status: 404 })
    if (off) await mark('link_disabled')
    return NextResponse.json({ ok: true, changed, live: !off })
  }

  if (body.action === 'disable_account_links') {
    const { data: link } = await admin.from('passport_links').select('user_id').eq('code', code).maybeSingle()
    if (!link?.user_id) return NextResponse.json({ ok: false, error: 'No link has this code, so there is no account to switch off.' }, { status: 404 })
    const { data, error } = await admin.from('passport_links').update({ disabled: true }).eq('user_id', link.user_id).eq('disabled', false).select('code')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await admin.from('link_reports').update({ state: 'link_disabled', handled_at: at, handled_by: gate.user.id }).eq('link_user_id', link.user_id).eq('state', 'open')
    return NextResponse.json({ ok: true, changed: (data ?? []).length })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
