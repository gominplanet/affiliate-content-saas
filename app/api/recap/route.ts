// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/recap?back=0 — what MVP did for the creator in a past week
// (lib/week-recap.ts). back=0 is last week, back=1 the week before, up to 8.
// Database reads only.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { weekWindow } from '@/lib/week-window'
import { gatherWeek } from '@/lib/week-recap'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return auth.error
  const { ownerId } = auth as { ownerId: string }
  const back = Math.max(0, Math.min(8, Number(req.nextUrl.searchParams.get('back')) || 0))
  const now = new Date()
  const recap = await gatherWeek(createAdminClient(), ownerId, weekWindow(now, back), weekWindow(now, back + 1))
  return NextResponse.json({ ...recap, back })
}
