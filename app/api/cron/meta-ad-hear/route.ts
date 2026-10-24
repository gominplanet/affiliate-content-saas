// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/meta-ad-hear — MVP listens to the Meta ads' videos the team's
// SCOUT copied (lib/meta-ad-hear), every 20 minutes, so what each ad says
// first is in before Meta's file links run out (Seb, 2026-10-24).
//
// Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { transcriptionConfigured } from '@/lib/shorts-transcribe'
import { hearMetaAds } from '@/lib/meta-ad-hear'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Listens a run; the daily cap is in lib/trybe-adsgallery. */
const PER_RUN = 20
/** Stop starting new listens this close to the time limit. */
const BUDGET_MS = 240_000

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!transcriptionConfigured()) return NextResponse.json({ ok: false, heard: 0, why: 'Transcription is not configured on this deployment (FAL_KEY).' })
  try {
    const run = await hearMetaAds(createAdminClient(), PER_RUN, BUDGET_MS)
    return NextResponse.json({ ok: true, ...run })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'the run stopped' }, { status: 500 })
  }
}
