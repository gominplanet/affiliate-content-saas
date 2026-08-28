/**
 * POST /api/clip-factory/reframe
 *
 * Reframe a creator's uploaded HORIZONTAL video to a 9:16 vertical clip so it can
 * flow into Clip Factory's Enhance/Publish like any other Short. A vertical upload
 * needs none of this (it drops straight into Enhance); a horizontal one would get
 * naively center-cropped by the burn step and lose its sides, so we run it through
 * the ingest service's one-pass reframe first and let the creator pick the layout:
 *   - center: center-crop the horizontal frame to 9:16 (subject in the middle)
 *   - split:  seamless top/bottom stack of the frame (keeps the whole width)
 *
 * Body: { videoUrl, reframe?: 'center'|'split', durationSec? }
 * Returns: { ok, url, durationSeconds } | { error }
 *
 * Pro-only, matching the rest of Clip Factory. No AI cost (pure ffmpeg reframe),
 * so it's off the generation quota.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { ingestConfigured, renderShort, getLastIngestError } from '@/lib/youtube-ingest'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).single()
    const tier = normalizeTier(intRow?.tier)
    if (tier !== 'pro' && tier !== 'admin') {
      return NextResponse.json({
        error: 'Reframing uploads is a Pro feature.',
        limitReached: true, cap: 'shorts_studio', currentTier: tier,
        upgrade: { tier: 'pro', label: 'Pro', limit: null },
      }, { status: 403 })
    }

    if (!ingestConfigured()) {
      return NextResponse.json({ error: 'The render service is not available right now. Please try again shortly.' }, { status: 503 })
    }

    const body = await request.json().catch(() => ({})) as { videoUrl?: string; reframe?: string; durationSec?: number }
    const videoUrl = String(body.videoUrl || '').trim()
    if (!/^https:\/\//i.test(videoUrl)) return NextResponse.json({ error: 'A video URL is required.' }, { status: 400 })
    const reframe: 'center' | 'split' = body.reframe === 'split' ? 'split' : 'center'

    // The ingest service caps the render at 180s; pass the measured length (or a
    // safe default) as the window so the whole clip is reframed.
    const measured = Number(body.durationSec)
    const endSec = Number.isFinite(measured) && measured > 0 ? Math.min(180, Math.ceil(measured)) : 180

    const r = await renderShort(videoUrl, 0, endSec, [], user.id, undefined, { reframe })
    if (!r?.url) {
      const detail = getLastIngestError() || 'We could not reframe that video. Please try again.'
      return NextResponse.json({ error: detail }, { status: 502 })
    }

    return NextResponse.json({ ok: true, url: r.url, durationSeconds: r.durationSeconds ?? null })
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Could not reframe that video. Please try again.'
    return NextResponse.json({ error }, { status: 500 })
  }
}
