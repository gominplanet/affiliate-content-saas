// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/levanta/prefer — the creator's "Use Levanta links when they pay
//      more" switch (lib/levanta-first), whether Levanta is connected, and
//      what MVP decided for each product it checked.
// POST /api/levanta/prefer { on } — turn it on or off.
// POST /api/levanta/prefer { recheck: true } — forget the saved answers, so
//      the next links ask Levanta again (after joining a brand).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getExternalKey } from '@/lib/external-keys'
import { levantaStateWords } from '@/lib/levanta-first'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

async function who() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function GET() {
  const { supabase, user } = await who()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin: Db = createAdminClient()
  const { data: ig } = await admin.from('integrations').select('*').eq('user_id', user.id).maybeSingle()
  const connected = !!(await getExternalKey(supabase, user.id, 'levanta'))
  const { data: rows, error } = await admin.from('levanta_links')
    .select('asin, state, commission, cc_commission, checked_at, used_at')
    .eq('user_id', user.id).order('checked_at', { ascending: false }).limit(200)
  const list = ((rows || []) as Array<{ asin: string; state: string; commission: number | null; cc_commission: number | null; checked_at: string; used_at: string | null }>)
    .map(r => ({ asin: r.asin, state: r.state, checkedAt: r.checked_at, usedAt: r.used_at, words: levantaStateWords(r.state, { commission: r.commission, ccCommission: r.cc_commission }), commission: r.commission }))
  return NextResponse.json({
    on: ig?.prefer_levanta === true,
    connected,
    // Migration 455 not run: nothing is kept and the switch cannot be saved.
    ready: !error && ig != null && 'prefer_levanta' in ig,
    team: ig?.tier === 'admin',
    products: list,
    counts: {
      levanta: list.filter(r => r.state === 'use').length,
      amazon: list.filter(r => r.state !== 'use').length,
    },
  })
}

export async function POST(req: Request) {
  const { supabase, user } = await who()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { on?: unknown; recheck?: unknown }
  const admin: Db = createAdminClient()

  if (body.recheck === true) {
    const { error } = await admin.from('levanta_links').delete().eq('user_id', user.id)
    if (error) return NextResponse.json({ error: 'MVP could not clear the saved answers. Try again in a minute.' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (typeof body.on !== 'boolean') return NextResponse.json({ error: 'Say on or off.' }, { status: 400 })
  if (body.on && !(await getExternalKey(supabase, user.id, 'levanta'))) {
    return NextResponse.json({ error: 'Connect your Levanta API key at the top of this page first.' }, { status: 400 })
  }
  const { error } = await admin.from('integrations').update({ prefer_levanta: body.on }).eq('user_id', user.id)
  if (error) {
    const { data: ig } = await admin.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    const missing = /prefer_levanta|schema cache|does not exist/i.test(error.message)
    return NextResponse.json({
      error: missing
        ? (ig?.tier === 'admin' ? 'Run migration 455 in Supabase first.' : 'This needs an update on MVP’s side first. Let MVP support know.')
        : 'MVP could not save that. Try again in a minute.',
    }, { status: missing ? 409 : 500 })
  }
  return NextResponse.json({ ok: true, on: body.on })
}
