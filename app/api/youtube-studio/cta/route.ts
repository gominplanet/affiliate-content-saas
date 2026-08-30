// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/youtube-studio/cta — burn a branded call-to-action onto a full
// horizontal video (the "MVP as origin" upload pipeline). Part 1 of the
// in-MVP upload + CTA feature: the render step. Pro-gated.
//   body: { videoUrl, durationSec, text, subtext?, style: 'lowerthird'|'endcard',
//           startSec?, endSec? }
//   -> { ok, url }  the hosted rendered video
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { renderCta } from '@/lib/youtube-ingest'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integ } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(integ?.tier)
  if (!['pro', 'admin'].includes(tier)) {
    return NextResponse.json({ error: 'Video CTA burn-in is a Pro feature.', code: 'tier_not_allowed', currentTier: tier }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as {
    videoUrl?: string; durationSec?: number; text?: string; subtext?: string
    style?: string; startSec?: number; endSec?: number
  }
  const videoUrl = (body.videoUrl || '').trim()
  const text = (body.text || '').trim()
  const style: 'lowerthird' | 'endcard' = body.style === 'endcard' ? 'endcard' : 'lowerthird'
  const dur = Math.max(0, Number(body.durationSec) || 0)
  if (!/^https?:\/\//i.test(videoUrl)) return NextResponse.json({ error: 'A hosted video URL is required.' }, { status: 400 })
  if (!text) return NextResponse.json({ error: 'CTA text is required.' }, { status: 400 })

  // Derive the on-screen window from the style unless the caller set it. End card
  // rides the last 8 seconds; a lower third shows early for ~10 seconds.
  let startSec = Number(body.startSec)
  let endSec = Number(body.endSec)
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
    if (style === 'endcard' && dur > 0) { startSec = Math.max(0, dur - 8); endSec = dur }
    else { startSec = 3; endSec = dur > 0 ? Math.min(dur, 13) : 13 }
  }

  const out = await renderCta(videoUrl, { text, subtext: (body.subtext || '').trim(), style, startSec, endSec }, user.id)
  if (!out) {
    return NextResponse.json({ error: 'Couldn’t render the CTA just now. If this keeps happening, the video service may be busy.' }, { status: 502 })
  }
  return NextResponse.json({ ok: true, url: out })
}
