// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/global-sync/dub — dub ONE market's copy, for a creator at a screen.
//   body: { jobId, domain, voice? }  ->  { ok, videoUrl } | { error }
//
// THE DUB ITSELF IS IN lib/dub-target. This route is the authorization half:
// who you are, whether your tier includes it, and whether your account is
// inside its spend ceiling. The lane underneath (YouTube's own track first, our
// own translate-synthesize-mux second) is shared with the background catalogue
// drain, which has no session and so cannot come through here.
//
// They were one function and one caller until the drain needed it. Copying the
// body into the cron would have been the obvious move and the wrong one: the
// YouTube-track-first ordering is the kind of thing that silently stops
// happening in a second copy, and nothing on any screen would show it.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'
import { ttsConfigured } from '@/lib/tts'
import { ingestConfigured } from '@/lib/youtube-ingest'
import { dubTarget } from '@/lib/dub-target'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integ } = await supabase
    .from('integrations').select('tier,subscription_period_start,subscription_period_end').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(integ?.tier)
  if (!['pro', 'admin'].includes(tier)) {
    return NextResponse.json({ error: 'Global Storefront Sync is a Pro feature.', code: 'tier_not_allowed', currentTier: tier }, { status: 403 })
  }
  const gate = await spendGate(user.id, tier)
  if (gate) return gate

  if (!ingestConfigured()) {
    return NextResponse.json({ error: 'The video service is not available right now. Please try again shortly.' }, { status: 503 })
  }
  if (!ttsConfigured()) {
    return NextResponse.json({ error: 'Voiceover is not configured right now.' }, { status: 503 })
  }

  const body = await req.json().catch(() => ({})) as { jobId?: string; domain?: string; voice?: string }

  const res = await dubTarget({
    sb: supabase,
    userId: user.id,
    tier,
    jobId: (body.jobId || '').trim(),
    domain: (body.domain || '').trim(),
    // The creator can opt for the free generic voice even when they have a clone.
    requestedStandard: body.voice === 'standard',
    periodStart: (integ?.subscription_period_start as string | null) ?? null,
  })

  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, ...(res.noTranscript ? { noTranscript: true } : {}) },
      { status: res.status },
    )
  }
  return NextResponse.json({
    ok: true,
    videoUrl: res.videoUrl,
    ...(res.audioUrl ? { audioUrl: res.audioUrl } : {}),
    voice: res.voice,
    ...(res.note ? { note: res.note } : {}),
    clonedDubsRemaining: res.clonedDubsRemaining,
    outOfCredits: res.outOfCredits,
  })
}
