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
    stickerUrl?: string; widthPct?: number; position?: string; xPct?: number; yPct?: number
  }
  const videoUrl = (body.videoUrl || '').trim()
  const text = (body.text || '').trim()
  const style: 'lowerthird' | 'endcard' = body.style === 'endcard' ? 'endcard' : 'lowerthird'
  const dur = Math.max(0, Number(body.durationSec) || 0)
  // A designed CTA box (PNG) is an alternative to plain text. Accept our own
  // /cta-burner gallery OR an AI-generated badge we stored on our Supabase
  // storage (the "write your own" path) — never an arbitrary external URL.
  const stickerUrl = (body.stickerUrl || '').trim()
  const supaBase = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
  const galleryOk = /^https:\/\/[^/]+\/cta-burner\/[A-Za-z0-9._-]+\.png$/i.test(stickerUrl)
  const customOk = !!supaBase && stickerUrl.startsWith(`${supaBase}/storage/v1/object/public/instagram-videos/`) && /\.png(\?|$)/i.test(stickerUrl)
  const stickerOk = galleryOk || customOk
  if (!/^https?:\/\//i.test(videoUrl)) return NextResponse.json({ error: 'A hosted video URL is required.' }, { status: 400 })
  if (!text && !stickerOk) return NextResponse.json({ error: 'Pick a CTA design or enter CTA text.' }, { status: 400 })

  // Derive the on-screen window from the style unless the caller set it. End card
  // rides the last 8 seconds; a lower third shows early for ~10 seconds.
  let startSec = Number(body.startSec)
  let endSec = Number(body.endSec)
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
    if (style === 'endcard' && dur > 0) { startSec = Math.max(0, dur - 8); endSec = dur }
    else { startSec = 3; endSec = dur > 0 ? Math.min(dur, 13) : 13 }
  }

  const hasFree = Number.isFinite(Number(body.xPct)) && Number.isFinite(Number(body.yPct))
  const out = await renderCta(videoUrl, {
    text, subtext: (body.subtext || '').trim(), style, startSec, endSec,
    ...(stickerOk ? { stickerUrl } : {}),
    ...(Number(body.widthPct) ? { widthPct: Number(body.widthPct) } : {}),
    ...(body.position ? { position: String(body.position) } : {}),
    ...(hasFree ? { xPct: Number(body.xPct), yPct: Number(body.yPct) } : {}),
  }, user.id)
  if (!out.ok) {
    // Map the render failure to a message the creator can act on. The raw
    // reason is logged server-side; keep the public copy friendly but specific.
    const friendly =
      out.reason === 'render-service-not-configured'
        ? 'The video rendering service isn’t connected yet. We’re on it, please try again shortly.'
        : out.reason === 'render-timeout'
          ? 'Rendering took too long, usually a large video. Try a shorter clip or retry in a moment.'
          : out.reason.startsWith('ingest-')
            ? 'The video service rejected this render. If it keeps happening, your CTA design or video may be unsupported.'
            : 'Couldn’t render the CTA just now. If this keeps happening, the video service may be busy.'
    return NextResponse.json({ error: friendly, reason: out.reason }, { status: 502 })
  }
  return NextResponse.json({ ok: true, url: out.url })
}
