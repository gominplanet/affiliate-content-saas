// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/admin/proxy-usage: the download proxy's data this billing period,
// admin only. See lib/proxy-usage.ts.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { proxyUsage } from '@/lib/proxy-usage'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const { data: caller } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if ((caller as { tier?: string } | null)?.tier !== 'admin') return NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403 })
  return NextResponse.json(await proxyUsage())
}
